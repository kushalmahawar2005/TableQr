import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { GUEST_STATUS_TEXT, type OrderStatus } from "@/domain/kitchen";
import { lockSession, syncBill } from "../billing/bill";
import { LOCK_THEN_READ } from "../db-types";
import { AppError } from "../errors";
import { lockOrder, syncOrderStatus, syncTickets } from "../kitchen/order-state";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import type { GuestContext } from "./context";
import { addConfiguredLine, assertCartEditable } from "./cart";

// Order tracker (G6): every round with live item status, and cancelling before the kitchen accepts.

const STEPS: OrderStatus[] = ["placed", "accepted", "preparing", "ready"];

export async function getOrderTracker(ctx: GuestContext, now = new Date()) {
  const orders = await db
    .select({ order: s.orders, placedByName: s.participants.displayName })
    .from(s.orders)
    .leftJoin(s.participants, and(eq(s.participants.tenantId, ctx.tenantId), eq(s.participants.id, s.orders.placedByParticipantId)))
    .where(and(eq(s.orders.tenantId, ctx.tenantId), eq(s.orders.outletId, ctx.outletId), eq(s.orders.sessionId, ctx.sessionId)))
    .orderBy(desc(s.orders.roundNo));
  if (orders.length === 0) return { rounds: [], inProgress: 0 };

  // The dish's photo, veg mark and spice come from the menu as it is now; name and price stay as placed
  const lines = await db
    .select({ line: s.orderLines, imageUrl: s.menuItems.imageUrl, isVeg: s.menuItems.isVeg, spice: s.menuItems.spiceLevel })
    .from(s.orderLines)
    .leftJoin(s.menuItems, and(eq(s.menuItems.tenantId, ctx.tenantId), eq(s.menuItems.id, s.orderLines.itemId)))
    .where(and(eq(s.orderLines.tenantId, ctx.tenantId), eq(s.orderLines.sessionId, ctx.sessionId)))
    .orderBy(asc(s.orderLines.id));

  const rounds = orders.map(({ order, placedByName }) => {
    const own = lines.filter((l) => l.line.orderId === order.id);
    const lateAt = own.filter(({ line }) => ["placed", "accepted", "preparing"].includes(line.status))
      .map(({ line }) => order.placedAt.getTime() + Math.max(1, line.prepMinutes) * 90_000);
    const lateThreshold = lateAt.length ? Math.min(...lateAt) : null;
    return {
      orderId: order.id,
      roundNo: order.roundNo,
      placedAt: order.placedAt,
      placedBy: placedByName,
      status: order.status,
      statusText: GUEST_STATUS_TEXT[order.status],
      /** Index into placed, accepted, preparing, ready for the four-segment progress bar */
      step: order.status === "served" ? 3 : STEPS.indexOf(order.status),
      /** "Taking longer than usual, the kitchen knows" after 1.5 times the prep time */
      isLate: lateThreshold !== null && now.getTime() >= lateThreshold,
      lateAt: lateThreshold,
      canRepeat: own.some(({ line }) => line.participantId === ctx.participantId && line.status !== "cancelled" && line.status !== "voided"),
      lines: own.map(({ line, imageUrl, isVeg, spice }) => ({
        id: line.id,
        imageUrl,
        isVeg,
        spice,
        nameEn: line.nameEn,
        nameHi: line.nameHi,
        qty: line.qty,
        /** Price with its options, times the quantity, as placed */
        amountPaise: line.unitPricePaise * line.qty,
        options: line.modifiers ?? [],
        note: line.note,
        status: line.status,
        isMine: line.participantId === ctx.participantId,
        canCancel: line.status === "placed" && line.participantId === ctx.participantId,
      })),
    };
  });

  const inProgress = lines.filter((l) => ["placed", "accepted", "preparing", "ready"].includes(l.line.status)).reduce((n, l) => n + l.line.qty, 0);
  return { rounds, inProgress };
}

/** Rebuild only the caller's lines from a prior round into their current cart. Never places an order. */
export async function repeatOrderRound(ctx: GuestContext, orderId: string, now = new Date()) {
  await assertCartEditable(ctx);
  const [order] = await db.select({ id: s.orders.id }).from(s.orders).where(and(
    eq(s.orders.tenantId, ctx.tenantId),
    eq(s.orders.outletId, ctx.outletId),
    eq(s.orders.sessionId, ctx.sessionId),
    eq(s.orders.id, orderId),
  )).limit(1);
  if (!order) throw new AppError("not_found", "This order round is no longer available.");

  const previous = await db.select().from(s.orderLines).where(and(
    eq(s.orderLines.tenantId, ctx.tenantId),
    eq(s.orderLines.sessionId, ctx.sessionId),
    eq(s.orderLines.orderId, orderId),
    eq(s.orderLines.participantId, ctx.participantId),
  )).orderBy(asc(s.orderLines.id));
  // Open items typed in at the POS are not on the menu, so they cannot be ordered again from the phone
  const eligible = previous.filter((line): line is typeof line & { itemId: string } => line.status !== "cancelled" && line.status !== "voided" && !!line.itemId);
  if (!eligible.length) throw new AppError("not_found", "There are no repeatable items from your order in this round.");

  let added = 0;
  let skipped = 0;
  for (const line of eligible) {
    // Old rows have display-only modifier snapshots. Never repeat those as a different dish.
    if (line.modifiers?.length && !line.modifierChoices?.length) { skipped++; continue; }
    try {
      await addConfiguredLine(ctx, {
        itemId: line.itemId,
        qty: line.qty,
        modifierIds: line.modifierChoices?.map((choice) => choice.modifierId) ?? [],
        note: line.note ?? undefined,
        personalForPickup: line.personalForPickup,
      }, now);
      added++;
    } catch {
      // Menus, stock, modifier choices and cart limits can change after the original order.
      skipped++;
    }
  }
  return { added, skipped };
}

/** A guest can cancel their own item until the kitchen accepts it (PS 3.5) */
export async function cancelOrderLine(ctx: GuestContext, lineId: string, now = new Date()) {
  const res = await cancelOrderLineTx(ctx, lineId, now);
  if (res.changed) await publish(ctx, [
    { topic: topics.kitchen, type: "ticket.updated", data: { orderId: res.orderId } },
    { topic: topics.session(ctx.sessionId), type: "order.status", data: { orderId: res.orderId, status: res.status } },
    ...(res.portionsRestored ? [{ topic: topics.menu, type: "item.availability", data: { itemId: res.itemId } }] : []),
    ...(res.billUpdated ? [{ topic: topics.session(ctx.sessionId), type: "bill.updated" }] : []),
  ]);
  return res.status;
}

function cancelOrderLineTx(ctx: GuestContext, lineId: string, now: Date) {
  return db.transaction(async (tx) => {
    const session = await lockSession(tx, ctx);
    if (session.status === "closed") throw new AppError("session_expired", "This table has already been settled.");
    const [me] = await tx.select({ id: s.participants.id }).from(s.participants)
      .where(and(eq(s.participants.tenantId, ctx.tenantId), eq(s.participants.sessionId, ctx.sessionId), eq(s.participants.id, ctx.participantId), isNull(s.participants.removedAt), isNull(s.participants.paidOutAt)))
      .for("update");
    if (!me) throw new AppError("session_expired", "You have already left this table.");
    const [line] = await tx
      .select()
      .from(s.orderLines)
      .where(
        and(
          eq(s.orderLines.tenantId, ctx.tenantId),
          eq(s.orderLines.sessionId, ctx.sessionId),
          eq(s.orderLines.participantId, ctx.participantId),
          eq(s.orderLines.id, lineId),
        ),
      );
    if (!line) throw new AppError("not_found", "This item is not in your order.");
    const order = await lockOrder(tx, ctx.tenantId, ctx.outletId, line.orderId);

    const [fresh] = await tx
      .select({ status: s.orderLines.status })
      .from(s.orderLines)
      .where(and(eq(s.orderLines.tenantId, ctx.tenantId), eq(s.orderLines.id, lineId)));
    if (fresh.status === "cancelled") return { orderId: line.orderId, itemId: line.itemId, status: order.status, changed: false, portionsRestored: false, billUpdated: false };
    if (fresh.status !== "placed") {
      throw new AppError("invalid_state", "The kitchen has already started this. Please ask your waiter to cancel it.");
    }

    await tx
      .update(s.orderLines)
      .set({ status: "cancelled" })
      .where(and(eq(s.orderLines.tenantId, ctx.tenantId), eq(s.orderLines.id, lineId)));

    // Give the portion back if the dish has a counter
    const [restored] = !line.itemId ? [{ affectedRows: 0 }] : await tx
      .update(s.outletItemOverrides)
      .set({ portionsLeft: sql`${s.outletItemOverrides.portionsLeft} + ${line.qty}` })
      .where(
        and(
          eq(s.outletItemOverrides.tenantId, ctx.tenantId),
          eq(s.outletItemOverrides.outletId, ctx.outletId),
          eq(s.outletItemOverrides.itemId, line.itemId),
          sql`${s.outletItemOverrides.portionsLeft} IS NOT NULL`,
        ),
      );

    await syncTickets(tx, ctx.tenantId, line.orderId, now);
    const status = await syncOrderStatus(tx, ctx.tenantId, line.orderId, now);
    if (session.status === "bill_requested") await syncBill(tx, ctx, now);
    return { orderId: line.orderId, itemId: line.itemId, status, changed: true, portionsRestored: restored.affectedRows > 0, billUpdated: session.status === "bill_requested" };
  }, LOCK_THEN_READ);
}

export type TrackerRound = Awaited<ReturnType<typeof getOrderTracker>>["rounds"][number];
