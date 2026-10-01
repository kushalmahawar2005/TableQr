import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { nextLocalMidnight } from "@/domain/hours";
import { RECALL_WINDOW_MS, type OrderStatus } from "@/domain/kitchen";
import { LOCK_THEN_READ, type Tx } from "../db-types";
import { AppError } from "../errors";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import type { StaffContext } from "../staff/context";
import { lockOrder, syncOrderStatus, syncTickets } from "./order-state";

// Kitchen actions from the KDS (PS 5.1, 5.2). Each locks the order, changes lines, then
// re-derives the order status so the guest tracker and the ticket always agree.

type Changed = { orderId: string; sessionId: string; status: OrderStatus };

/** After commit: the KDS and that table's phones refresh */
function announce(ctx: StaffContext, changes: Changed[]) {
  void publish(
    ctx,
    changes.flatMap((c) => [
      { topic: topics.kitchen, type: "ticket.updated", data: { orderId: c.orderId } },
      { topic: topics.session(c.sessionId), type: "order.status", data: { orderId: c.orderId, status: c.status } },
    ]),
  );
}

async function ticketFor(tx: Tx, ctx: StaffContext, ticketId: string) {
  const [ticket] = await tx
    .select()
    .from(s.tickets)
    .where(and(eq(s.tickets.tenantId, ctx.tenantId), eq(s.tickets.outletId, ctx.outletId), eq(s.tickets.id, ticketId)));
  if (!ticket) throw new AppError("not_found", "This ticket no longer exists.");
  return ticket;
}

/** Kitchen confirms a placed order (skipped when the outlet auto-accepts) */
export async function acceptOrder(ctx: StaffContext, orderId: string, now = new Date()) {
  const res = await db.transaction(async (tx): Promise<Changed & { changed: boolean }> => {
    const order = await lockOrder(tx, ctx.tenantId, ctx.outletId, orderId);
    if (order.status !== "placed") return { orderId, sessionId: order.sessionId, status: order.status, changed: false };
    await tx
      .update(s.orderLines)
      .set({ status: "accepted" })
      .where(and(eq(s.orderLines.tenantId, ctx.tenantId), eq(s.orderLines.orderId, orderId), eq(s.orderLines.status, "placed")));
    return { orderId, sessionId: order.sessionId, status: await syncOrderStatus(tx, ctx.tenantId, orderId, now), changed: true };
  }, LOCK_THEN_READ);
  if (res.changed) announce(ctx, [res]);
  return res.status;
}

/** Station starts cooking a ticket; accepting it too if nobody had */
export async function startTicket(ctx: StaffContext, ticketId: string, now = new Date()) {
  const res = await db.transaction(async (tx): Promise<Changed> => {
    const ticket = await ticketFor(tx, ctx, ticketId);
    const order = await lockOrder(tx, ctx.tenantId, ctx.outletId, ticket.orderId);
    await tx
      .update(s.orderLines)
      .set({ status: "preparing" })
      .where(
        and(
          eq(s.orderLines.tenantId, ctx.tenantId),
          eq(s.orderLines.orderId, ticket.orderId),
          eq(s.orderLines.station, ticket.station),
          inArray(s.orderLines.status, ["placed", "accepted"]),
        ),
      );
    await tx
      .update(s.tickets)
      .set({ status: "in_progress" })
      .where(and(eq(s.tickets.tenantId, ctx.tenantId), eq(s.tickets.id, ticketId), ne(s.tickets.status, "done")));
    return { orderId: order.id, sessionId: order.sessionId, status: await syncOrderStatus(tx, ctx.tenantId, order.id, now) };
  }, LOCK_THEN_READ);
  announce(ctx, [res]);
  return res.status;
}

/** Tap a line to bump one item */
export async function bumpLine(ctx: StaffContext, lineId: string, now = new Date()) {
  const res = await db.transaction(async (tx): Promise<Changed> => {
    const [line] = await tx
      .select()
      .from(s.orderLines)
      .where(and(eq(s.orderLines.tenantId, ctx.tenantId), eq(s.orderLines.id, lineId)));
    if (!line) throw new AppError("not_found", "This item is no longer on the order.");
    const order = await lockOrder(tx, ctx.tenantId, ctx.outletId, line.orderId);
    // A guest cancellation may have committed while this transaction waited for the order lock.
    const [fresh] = await tx.select({ status: s.orderLines.status }).from(s.orderLines)
      .where(and(eq(s.orderLines.tenantId, ctx.tenantId), eq(s.orderLines.id, lineId)));
    if (!fresh || !["placed", "accepted", "preparing"].includes(fresh.status)) {
      throw new AppError("invalid_state", `${line.nameEn} is already ${fresh?.status ?? "removed"}.`);
    }
    await tx
      .update(s.orderLines)
      .set({ status: "ready", readyAt: now })
      .where(and(eq(s.orderLines.tenantId, ctx.tenantId), eq(s.orderLines.id, lineId)));
    await syncTickets(tx, ctx.tenantId, order.id, now);
    return { orderId: order.id, sessionId: order.sessionId, status: await syncOrderStatus(tx, ctx.tenantId, order.id, now) };
  }, LOCK_THEN_READ);
  announce(ctx, [res]);
  return res.status;
}

/** Bump ticket: everything for this station on this order is ready */
export async function bumpTicket(ctx: StaffContext, ticketId: string, now = new Date()) {
  const res = await db.transaction(async (tx): Promise<Changed> => {
    const ticket = await ticketFor(tx, ctx, ticketId);
    const order = await lockOrder(tx, ctx.tenantId, ctx.outletId, ticket.orderId);
    await tx
      .update(s.orderLines)
      .set({ status: "ready", readyAt: now })
      .where(
        and(
          eq(s.orderLines.tenantId, ctx.tenantId),
          eq(s.orderLines.orderId, ticket.orderId),
          eq(s.orderLines.station, ticket.station),
          inArray(s.orderLines.status, ["placed", "accepted", "preparing"]),
        ),
      );
    await syncTickets(tx, ctx.tenantId, order.id, now);
    return { orderId: order.id, sessionId: order.sessionId, status: await syncOrderStatus(tx, ctx.tenantId, order.id, now) };
  }, LOCK_THEN_READ);
  announce(ctx, [res]);
  return res.status;
}

/** Brings back a ticket bumped by mistake, within 10 minutes */
export async function recallTicket(ctx: StaffContext, ticketId: string, now = new Date()) {
  const res = await db.transaction(async (tx): Promise<Changed> => {
    const ticket = await ticketFor(tx, ctx, ticketId);
    const order = await lockOrder(tx, ctx.tenantId, ctx.outletId, ticket.orderId);
    if (ticket.status !== "done" || !ticket.bumpedAt) throw new AppError("invalid_state", "This ticket is still open.");
    if (now.getTime() - ticket.bumpedAt.getTime() > RECALL_WINDOW_MS) {
      throw new AppError("recall_expired", "Tickets can be recalled for 10 minutes after bumping.");
    }
    await tx
      .update(s.orderLines)
      .set({ status: "preparing", readyAt: null })
      .where(
        and(
          eq(s.orderLines.tenantId, ctx.tenantId),
          eq(s.orderLines.orderId, ticket.orderId),
          eq(s.orderLines.station, ticket.station),
          eq(s.orderLines.status, "ready"),
        ),
      );
    await tx
      .update(s.tickets)
      .set({ status: "in_progress", bumpedAt: null })
      .where(and(eq(s.tickets.tenantId, ctx.tenantId), eq(s.tickets.id, ticketId)));
    return { orderId: order.id, sessionId: order.sessionId, status: await syncOrderStatus(tx, ctx.tenantId, order.id, now) };
  }, LOCK_THEN_READ);
  announce(ctx, [res]);
  return res.status;
}

/** Waiter marks plates as served at the table */
export async function markServed(ctx: StaffContext, lineIds: string[], now = new Date()) {
  if (lineIds.length === 0) return;
  const changes = await db.transaction(async (tx): Promise<Changed[]> => {
    const lines = await tx
      .select({ orderId: s.orderLines.orderId })
      .from(s.orderLines)
      .where(and(eq(s.orderLines.tenantId, ctx.tenantId), inArray(s.orderLines.id, lineIds)));
    const orders = [];
    for (const orderId of [...new Set(lines.map((l) => l.orderId))]) {
      orders.push(await lockOrder(tx, ctx.tenantId, ctx.outletId, orderId));
    }
    await tx
      .update(s.orderLines)
      .set({ status: "served", servedAt: now })
      .where(
        and(eq(s.orderLines.tenantId, ctx.tenantId), inArray(s.orderLines.id, lineIds), eq(s.orderLines.status, "ready")),
      );
    const out: Changed[] = [];
    for (const order of orders) {
      out.push({ orderId: order.id, sessionId: order.sessionId, status: await syncOrderStatus(tx, ctx.tenantId, order.id, now) });
    }
    return out;
  }, LOCK_THEN_READ);
  announce(ctx, changes);
}

/**
 * Out of stock from the KDS: hidden from every guest menu at once and back automatically
 * at the start of the next day in the outlet's timezone. Returns how many open carts hold it.
 */
export async function setOutOfStock(ctx: StaffContext, itemId: string, outOfStock: boolean, now = new Date()) {
  const [outlet] = await db
    .select({ timezone: s.outlets.timezone, brandId: s.outlets.brandId })
    .from(s.outlets)
    .where(and(eq(s.outlets.tenantId, ctx.tenantId), eq(s.outlets.id, ctx.outletId)));
  const [item] = await db
    .select({ id: s.menuItems.id })
    .from(s.menuItems)
    .where(and(eq(s.menuItems.tenantId, ctx.tenantId), eq(s.menuItems.brandId, outlet.brandId), eq(s.menuItems.id, itemId)));
  if (!item) throw new AppError("not_found", "This dish is not on this outlet's menu.");

  const until = outOfStock ? nextLocalMidnight(now, outlet.timezone) : null;
  await db
    .insert(s.outletItemOverrides)
    .values({ tenantId: ctx.tenantId, outletId: ctx.outletId, itemId, isAvailable: !outOfStock, soldOutUntil: until })
    .onDuplicateKeyUpdate({ set: { isAvailable: !outOfStock, soldOutUntil: until } });

  const [{ carts }] = await db
    .select({ carts: sql<number>`count(distinct ${s.cartLines.participantId})` })
    .from(s.cartLines)
    .innerJoin(s.tableSessions, eq(s.tableSessions.id, s.cartLines.sessionId))
    .where(
      and(
        eq(s.cartLines.tenantId, ctx.tenantId),
        eq(s.cartLines.itemId, itemId),
        eq(s.tableSessions.outletId, ctx.outletId),
        ne(s.tableSessions.status, "closed"),
      ),
    );

  // Every phone at the outlet hides or shows the dish within seconds (PS 5.2)
  void publish(ctx, [
    { topic: topics.menu, type: "item.availability", data: { itemId, available: !outOfStock } },
    { topic: topics.kitchen, type: "item.availability", data: { itemId, available: !outOfStock } },
  ]);
  return { soldOutUntil: until, cartsAffected: Number(carts) };
}
