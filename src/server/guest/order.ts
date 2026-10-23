import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { checkFirstName, isPlaceholderName } from "@/domain/guest-name";
import { priceLine, quoteKey, type PriceQuote } from "@/domain/pricing";
import { LOCK_THEN_READ } from "../db-types";
import { AppError } from "../errors";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import { visitChanged } from "../floor/assignments";
import { sendOutletPush } from "../staff/web-push";
import type { GuestContext } from "./context";
import { isWithinCategoryWindow, loadItems } from "./menu";

// Place order: one order per round, one kitchen ticket per station (PS 3.5, 5.1).

type PlaceInput = {
  note?: string;
  /** One per Place-order attempt from the phone; a retry with the same id returns the same order */
  requestId?: string;
  /** Open mode: the guest's first name, needed once before their first order */
  name?: string;
  /**
   * The unit prices the guest last saw in their cart. Comparison only: the order is always priced
   * from the server's current menu, and a difference stops the order so the guest can review it.
   * Staff orders and internal callers leave it out.
   */
  quote?: PriceQuote;
};

export async function placeOrder(ctx: GuestContext, input: PlaceInput = {}, now = new Date()) {
  const placed = await placeOrderTx(ctx, input, now);
  // A replayed request already announced itself the first time
  if (placed.replayed) return placed;
  void publish(ctx, [
    { topic: topics.kitchen, type: "ticket.created", data: { orderId: placed.orderId, stations: placed.stations } },
    { topic: topics.session(ctx.sessionId), type: "order.status", data: { orderId: placed.orderId, status: placed.status } },
    { topic: topics.session(ctx.sessionId), type: "cart.updated" },
    visitChanged(ctx.sessionId, "order"),
    // Portion counters that reached zero take the dish off every phone's menu
    ...placed.soldOutItemIds.map((itemId) => ({ topic: topics.menu, type: "item.availability", data: { itemId, available: false } })),
  ]);
  await sendOutletPush(ctx, { title: "New table order", body: "A guest placed an order. Open TableQR to view it.", url: "/console", tag: `order-${placed.orderId}` }, { sessionId: ctx.sessionId, kind: "order" });
  return placed;
}

export type StaffDraftLine = { itemId: string; qty: number; modifierIds: string[]; note?: string };

type StaffOrder = { userId: string; lines: StaffDraftLine[] };

/** Internal shared transaction; staff caller authenticates before providing staffDraft. */
export function placeOrderTx(ctx: GuestContext, input: PlaceInput, now: Date, staffDraft?: StaffOrder) {
  return db.transaction(async (tx) => {
    // Lock the session so two phones at the table cannot take the same round number
    const [session] = await tx
      .select()
      .from(s.tableSessions)
      .where(and(eq(s.tableSessions.tenantId, ctx.tenantId), eq(s.tableSessions.outletId, ctx.outletId), eq(s.tableSessions.tableId, ctx.tableId), eq(s.tableSessions.id, ctx.sessionId)))
      .for("update");
    if (session && staffDraft && input.requestId) {
      const [done] = await tx.select().from(s.orders).where(and(eq(s.orders.tenantId,ctx.tenantId),eq(s.orders.sessionId,ctx.sessionId),eq(s.orders.clientRequestId,input.requestId)));
      if(done) {
        if(done.placedByUserId !== staffDraft.userId || done.placedByParticipantId !== ctx.participantId) throw new AppError("conflict", "This request id was used by another diner or staff member.");
        return {orderId:done.id,roundNo:done.roundNo,status:done.status,subtotalPaise:0,stations:[] as string[],itemCount:0,soldOutItemIds:[] as string[],replayed:true};
      }
    }
    if (!session || session.status === "closed") {
      throw new AppError("session_expired", "Your table session has ended. Scan the table QR again to continue.");
    }

    const [me] = await tx
      .select({ displayName: s.participants.displayName, guestId: s.participants.guestId })
      .from(s.participants)
      .where(and(eq(s.participants.tenantId, ctx.tenantId), eq(s.participants.sessionId, ctx.sessionId), eq(s.participants.id, ctx.participantId), isNull(s.participants.removedAt), isNull(s.participants.paidOutAt)))
      .for("update");
    if (!me) throw new AppError("session_expired", "You have already paid and left this table.");

    // Double tap, retry, or a response lost on the way: the same request returns its order
    const requestId = input.requestId?.trim().slice(0, 64) || null;
    if (requestId) {
      const [done] = await tx
        .select({ id: s.orders.id, roundNo: s.orders.roundNo, status: s.orders.status })
        .from(s.orders)
        .where(and(eq(s.orders.tenantId, ctx.tenantId), eq(s.orders.sessionId, ctx.sessionId), eq(s.orders.clientRequestId, requestId)));
      if (done) {
        return { orderId: done.id, roundNo: done.roundNo, status: done.status, subtotalPaise: 0, stations: [] as string[], itemCount: 0, soldOutItemIds: [] as string[], replayed: true };
      }
    }
    if (!staffDraft && !me.guestId) {
      throw new AppError("verification_required", "Verify your phone number before placing this order.");
    }
    if (session.status === "bill_requested") {
      throw new AppError("table_settling", "The bill has been requested, so new orders are paused. Ask staff to reopen the bill.");
    }
    if (session.orderingLocked && !staffDraft) {
      const [host] = session.hostParticipantId
        ? await tx
            .select({ name: s.participants.displayName })
            .from(s.participants)
            .where(and(eq(s.participants.tenantId, ctx.tenantId), eq(s.participants.id, session.hostParticipantId)))
        : [];
      throw new AppError("ordering_locked", `Ordering paused by ${host?.name ?? "the host"}.`);
    }

    // OTP verification already saved the guest's name on the participant before order placement.
    if (!staffDraft && session.mode === "open" && isPlaceholderName(me.displayName)) {
      const name = checkFirstName(input.name ?? me.displayName);
      if (!name.ok) {
        throw new AppError(name.reason === "empty" ? "name_required" : "invalid_name", "Add your first name to order.");
      }
      await tx
        .update(s.participants)
        .set({ displayName: name.name })
        .where(and(eq(s.participants.tenantId, ctx.tenantId), eq(s.participants.id, ctx.participantId)));
    }

    const cart = staffDraft ? staffDraft.lines.map((line, i) => ({ id: String(i), itemId: line.itemId, qty: line.qty, modifiers: line.modifierIds.map(modifierId => ({ modifierId })), note: line.note?.trim().slice(0, 140) || null, sharedWith: null, personalForPickup: false })) : await tx
      .select()
      .from(s.cartLines)
      .where(
        and(
          eq(s.cartLines.tenantId, ctx.tenantId),
          eq(s.cartLines.sessionId, ctx.sessionId),
          eq(s.cartLines.participantId, ctx.participantId),
        ),
      );
    if (cart.length === 0) throw new AppError("cart_empty", "Your cart is empty. Add a dish to place an order.");

    const itemIds = [...new Set(cart.map((l) => l.itemId))];

    // Lock portion counters before reading availability so two orders cannot take the last plate
    await tx
      .select({ id: s.outletItemOverrides.id })
      .from(s.outletItemOverrides)
      .where(
        and(
          eq(s.outletItemOverrides.tenantId, ctx.tenantId),
          eq(s.outletItemOverrides.outletId, ctx.outletId),
          inArray(s.outletItemOverrides.itemId, itemIds),
        ),
      )
      .for("update");
    const loaded = new Map((await loadItems(tx, ctx, now, itemIds)).map((x) => [x.item.id, x]));

    const unavailable: string[] = [];
    // Category hours (breakfast) are checked again here: a dish added before its window closed
    // must not reach the kitchen unnoticed
    const outsideHours: string[] = [];
    const priced = cart.map((line) => {
      const item = loaded.get(line.itemId);
      if (item && !isWithinCategoryWindow(item.categoryWindow, ctx.timezone, now)) {
        outsideHours.push(line.id);
        return null;
      }
      const res = item ? priceLine(item.pricing, line.qty, (line.modifiers ?? []).map((m) => m.modifierId)) : null;
      if (!item || !res?.ok) {
        unavailable.push(line.id);
        return null;
      }
      return { line, item, priced: res.line };
    });

    // Portion counters: the total asked for across lines must fit what is left
    const qtyByItem = new Map<string, number>();
    for (const p of priced) if (p) qtyByItem.set(p.item.item.id, (qtyByItem.get(p.item.item.id) ?? 0) + p.line.qty);
    for (const [itemId, qty] of qtyByItem) {
      const left = loaded.get(itemId)!.portionsLeft;
      if (left !== null && qty > left) {
        for (const p of priced) if (p && p.item.item.id === itemId) unavailable.push(p.line.id);
      }
    }
    if (unavailable.length || outsideHours.length) {
      throw new AppError("items_unavailable", "Some dishes in your cart are not available right now. Nothing was charged.", {
        cartLineIds: [...new Set([...unavailable, ...outsideHours])],
        outsideHoursLineIds: outsideHours,
      });
    }
    const lines = priced.filter((p) => p !== null);
    // Never charge a price the guest did not review: a changed (higher or lower) or unseen price stops here,
    // before anything is written, and the cart shows the current prices to confirm
    if (!staffDraft && input.quote) {
      const quote = input.quote;
      const changed = lines.filter(({ line, priced: p }) => quote[quoteKey(line.itemId, (line.modifiers ?? []).map((m) => m.modifierId))] !== p.unitPricePaise);
      if (changed.length) {
        throw new AppError("price_changed", "Prices have changed. Please review your cart before placing the order.", { cartLineIds: changed.map((c) => c.line.id) });
      }
    }
    const subtotalPaise = lines.reduce((sum, p) => sum + p.priced.linePaise, 0);

    const [{ rounds }] = await tx
      .select({ rounds: sql<number>`count(*)` })
      .from(s.orders)
      .where(and(eq(s.orders.tenantId, ctx.tenantId), eq(s.orders.sessionId, ctx.sessionId)));
    const roundNo = Number(rounds) + 1;

    const [outlet] = await tx
      .select({ autoAccept: s.outlets.autoAcceptOrders, cap: s.outlets.newSessionCapPaise })
      .from(s.outlets)
      .where(and(eq(s.outlets.tenantId, ctx.tenantId), eq(s.outlets.id, ctx.outletId)));

    // Open mode: a big first order on a fresh table waits for staff (PS 3.3)
    if (!staffDraft && session.mode === "open" && roundNo === 1 && subtotalPaise > outlet.cap) {
      throw new AppError("needs_staff_confirmation", "This is a large first order, so a staff member will confirm it. Please ask your waiter.", {
        subtotalPaise,
        capPaise: outlet.cap,
      });
    }

    const orderId = uuidv7();
    await tx.insert(s.orders).values({
      id: orderId,
      tenantId: ctx.tenantId,
      outletId: ctx.outletId,
      sessionId: ctx.sessionId,
      roundNo,
      placedByParticipantId: ctx.participantId,
      placedByUserId: staffDraft?.userId ?? null,
      clientRequestId: requestId,
      status: outlet.autoAccept ? "accepted" : "placed",
      note: input.note?.trim().slice(0, 140) || null,
      placedAt: now,
      acceptedAt: outlet.autoAccept ? now : null,
    });

    await tx.insert(s.orderLines).values(
      lines.map(({ line, item, priced: p }) => ({
        tenantId: ctx.tenantId,
        orderId,
        sessionId: ctx.sessionId,
        participantId: ctx.participantId,
        itemId: item.item.id,
        nameEn: item.item.nameEn,
        nameHi: item.item.nameHi,
        modifiers: p.modifiers.map((m) => ({ nameEn: m.nameEn, nameHi: m.nameHi, priceDeltaPaise: m.priceDeltaPaise })),
        unitPricePaise: p.unitPricePaise,
        qty: line.qty,
        taxRateBp: item.item.taxRateBp,
        station: item.item.station,
        prepMinutes: Math.max(1, item.item.prepMinutes),
        // Kitchen safety snapshots (S2): copied as stated, null stays null (unknown)
        allergensSnapshot: item.item.allergens ?? null,
        isJainSnapshot: item.item.isJain,
        spiceLevelSnapshot: item.item.spiceLevel ?? null,
        note: line.note,
        sharedWith: line.sharedWith,
        personalForPickup: !!line.personalForPickup,
        status: outlet.autoAccept ? ("accepted" as const) : ("placed" as const),
        createdAt: now,
      })),
    );

    const stations = [...new Set(lines.map((p) => p.item.item.station))];
    await tx.insert(s.tickets).values(
      stations.map((station) => ({ tenantId: ctx.tenantId, outletId: ctx.outletId, orderId, station, createdAt: now })),
    );

    for (const [itemId, qty] of qtyByItem) {
      if (loaded.get(itemId)!.portionsLeft !== null) {
        await tx
          .update(s.outletItemOverrides)
          .set({ portionsLeft: sql`${s.outletItemOverrides.portionsLeft} - ${qty}` })
          .where(
            and(
              eq(s.outletItemOverrides.tenantId, ctx.tenantId),
              eq(s.outletItemOverrides.outletId, ctx.outletId),
              eq(s.outletItemOverrides.itemId, itemId),
            ),
          );
      }
    }

    if (staffDraft) await tx.insert(s.auditLog).values({ tenantId: ctx.tenantId, outletId: ctx.outletId, actorLabel: "staff", actorUserId: staffDraft.userId, action: "waiter.order_placed", entity: "order", entityId: orderId, after: { sessionId: ctx.sessionId, tableId: ctx.tableId, participantId: ctx.participantId, requestId, pauseBypassed: session.orderingLocked, capBypassed: session.mode === "open" && roundNo === 1 && subtotalPaise > outlet.cap }, createdAt: now });
    if (!staffDraft) await tx
      .delete(s.cartLines)
      .where(and(eq(s.cartLines.tenantId, ctx.tenantId), inArray(s.cartLines.id, cart.map((l) => l.id))));
    await tx
      .update(s.tableSessions)
      .set({ lastActivityAt: now })
      .where(and(eq(s.tableSessions.tenantId, ctx.tenantId), eq(s.tableSessions.id, ctx.sessionId)));

    const soldOutItemIds = [...qtyByItem].filter(([itemId, qty]) => {
      const left = loaded.get(itemId)!.portionsLeft;
      return left !== null && left - qty <= 0;
    }).map(([itemId]) => itemId);

    return { orderId, roundNo, status: outlet.autoAccept ? "accepted" as const : "placed" as const, subtotalPaise, stations, itemCount: lines.reduce((n, p) => n + p.line.qty, 0), soldOutItemIds, replayed: false };
  }, LOCK_THEN_READ);
}
