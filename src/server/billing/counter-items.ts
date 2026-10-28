import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { LOCK_THEN_READ } from "../db-types";
import { AppError } from "../errors";
import { syncOrderStatus, syncTickets } from "../kitchen/order-state";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import { audit } from "../staff/audit";
import type { StaffSession } from "../staff/auth";
import { posRoles } from "../staff/pos-read";
import type { AnyDraftLine } from "../guest/order";
import type { PriceQuote } from "@/domain/pricing";
import { staffPlaceOrder, waiterRequestBill } from "../staff/waiter-mutations";
import { requireStaffRole } from "../staff/waiter";
import { lockSession, syncBill } from "./bill";
import { reopenBill } from "./payments";

// Items added at the counter while the guest is paying: ordinary counter goods are handed over
// directly; lines marked for pickup remain open on the kitchen ticket so they can be packed.
// Once anyone has paid part of the bill, add them as a takeaway instead.

export async function addItemsAtBilling(staff: StaffSession, input: { sessionId: string; tableId: string; participantId: string; clientRequestId: string; lines: AnyDraftLine[]; quote?: PriceQuote }, now = new Date()) {
  const roles = [...posRoles, "waiter"] as const;
  await requireStaffRole(staff, roles);
  const [session] = await db
    .select({ status: s.tableSessions.status })
    .from(s.tableSessions)
    .where(and(eq(s.tableSessions.tenantId, staff.tenantId), eq(s.tableSessions.outletId, staff.outletId), eq(s.tableSessions.id, String(input.sessionId))));
  if (!session) throw new AppError("not_found", "That table is not open here.");
  if (session.status === "closed") throw new AppError("invalid_state", "This bill is closed. Add the items as a new takeaway.", { reason: "closed" });
  if (session.status === "open") return { ...(await staffPlaceOrder(staff, input, now, roles)), atCounter: false };

  // The bill was asked for: only while nothing is paid yet
  const paid = await db
    .select({ id: s.payments.id })
    .from(s.payments)
    .innerJoin(s.bills, and(eq(s.bills.tenantId, s.payments.tenantId), eq(s.bills.id, s.payments.billId)))
    .where(and(eq(s.payments.tenantId, staff.tenantId), eq(s.bills.sessionId, String(input.sessionId)), inArray(s.payments.status, ["success", "pending", "initiated"])))
    .limit(1);
  if (paid.length) throw new AppError("invalid_state", "Part of this bill is already paid. Add these items as a new takeaway.", { reason: "part_paid" });

  await reopenBill({ kind: "staff", ctx: staff, sessionId: String(input.sessionId) }, now);
  let placed;
  try {
    placed = await staffPlaceOrder(staff, input, now, roles);
  } finally {
    // Whatever happened, the bill goes back to "asked for" so the counter can take the money
    await waiterRequestBill(staff, String(input.sessionId), now, roles);
  }
  const scope = { tenantId: staff.tenantId, outletId: staff.outletId, sessionId: String(input.sessionId) };
  await db.transaction(async (tx) => {
    // Session lock first, as every bill change takes it
    await lockSession(tx, scope);
    await tx.update(s.orders).set({ atCounter: true }).where(and(eq(s.orders.tenantId, staff.tenantId), eq(s.orders.id, placed.orderId)));
    await tx
      .update(s.orderLines)
      .set({ status: "served", servedAt: now })
      .where(and(eq(s.orderLines.tenantId, staff.tenantId), eq(s.orderLines.orderId, placed.orderId), eq(s.orderLines.personalForPickup, false), inArray(s.orderLines.status, ["placed", "accepted", "preparing", "ready"])));
    await syncTickets(tx, staff.tenantId, placed.orderId, now);
    await syncOrderStatus(tx, staff.tenantId, placed.orderId, now);
    await audit(tx, staff, { action: "billing.counter_items", entity: "order", entityId: placed.orderId, after: { sessionId: input.sessionId, lines: input.lines.length }, now });
    // The bill was written before the order was marked as counter items: work the shares out again
    await syncBill(tx, scope, now);
  }, LOCK_THEN_READ);
  await publish(staff, [{ topic: topics.kitchen, type: "ticket.updated", data: { orderId: placed.orderId } }]);
  return { ...placed, atCounter: true };
}
