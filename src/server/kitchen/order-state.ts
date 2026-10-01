import "server-only";
import { and, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { deriveOrderStatus, type LineStatus } from "@/domain/kitchen";
import type { Tx } from "../db-types";
import { AppError } from "../errors";

/** Locks an order row for the rest of the transaction; every status change goes through here */
export async function lockOrder(tx: Tx, tenantId: string, outletId: string, orderId: string) {
  const [order] = await tx
    .select()
    .from(s.orders)
    .where(and(eq(s.orders.tenantId, tenantId), eq(s.orders.outletId, outletId), eq(s.orders.id, orderId)))
    .for("update");
  if (!order) throw new AppError("not_found", "This order no longer exists.");
  return order;
}

/** Re-derives the order status from its lines and stamps the time of each first transition */
export async function syncOrderStatus(tx: Tx, tenantId: string, orderId: string, now: Date) {
  const [order] = await tx
    .select()
    .from(s.orders)
    .where(and(eq(s.orders.tenantId, tenantId), eq(s.orders.id, orderId)));
  const lines = await tx
    .select({ status: s.orderLines.status })
    .from(s.orderLines)
    .where(and(eq(s.orderLines.tenantId, tenantId), eq(s.orderLines.orderId, orderId)));
  const status = deriveOrderStatus(lines.map((l) => l.status as LineStatus));

  const progress = ["placed", "accepted", "preparing", "ready", "served"];
  const reached = (step: string) => status !== "cancelled" && progress.indexOf(status) >= progress.indexOf(step);

  await tx
    .update(s.orders)
    .set({
      status,
      acceptedAt: order.acceptedAt ?? (reached("accepted") ? now : null),
      // Ready and served times follow recalls: cleared if the order goes back to the pass
      readyAt: reached("ready") ? (order.readyAt ?? now) : null,
      servedAt: reached("served") ? (order.servedAt ?? now) : null,
      cancelledAt: status === "cancelled" ? (order.cancelledAt ?? now) : null,
    })
    .where(and(eq(s.orders.tenantId, tenantId), eq(s.orders.id, orderId)));
  return status;
}

/** Closes tickets whose station has nothing left to cook (recall reopens them explicitly) */
export async function syncTickets(tx: Tx, tenantId: string, orderId: string, now: Date) {
  const [tickets, lines] = await Promise.all([
    tx.select().from(s.tickets).where(and(eq(s.tickets.tenantId, tenantId), eq(s.tickets.orderId, orderId))),
    tx
      .select({ station: s.orderLines.station, status: s.orderLines.status })
      .from(s.orderLines)
      .where(and(eq(s.orderLines.tenantId, tenantId), eq(s.orderLines.orderId, orderId))),
  ]);
  for (const ticket of tickets) {
    const pending = lines.filter(
      (l) => l.station === ticket.station && ["placed", "accepted", "preparing"].includes(l.status),
    );
    const done = pending.length === 0;
    if (done && ticket.status !== "done") {
      await tx
        .update(s.tickets)
        .set({ status: "done", bumpedAt: now })
        .where(and(eq(s.tickets.tenantId, tenantId), eq(s.tickets.id, ticket.id)));
    }
  }
}
