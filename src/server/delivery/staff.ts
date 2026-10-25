import "server-only";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { LOCK_THEN_READ } from "../db-types";
import { AppError } from "../errors";
import { audit } from "../staff/audit";
import type { StaffSession } from "../staff/auth";
import { requireStaffRole } from "../staff/waiter";
import { requestRefund } from "../billing/refunds";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import { releaseVisitTables } from "../floor/assignments";

export const deliveryStaffRoles = ["owner", "manager", "cashier"] as const;
export async function deliveryQueue(staff: StaffSession) {
  await requireStaffRole(staff, deliveryStaffRoles);
  // Historical orders remain manageable if the package is downgraded or delivery is paused.
  return db.select({ id: s.deliveryCheckouts.id, status: s.deliveryCheckouts.status, sessionId: s.deliveryCheckouts.sessionId, name: s.deliveryCheckouts.name, phone: s.deliveryCheckouts.phone, address: s.deliveryCheckouts.address, courierName: s.deliveryCheckouts.courierName, courierPhone: s.deliveryCheckouts.courierPhone, totalPaise: s.bills.totalPaise, paid: s.bills.status, placedAt: s.deliveryCheckouts.placedAt })
    .from(s.deliveryCheckouts).innerJoin(s.bills, and(eq(s.bills.tenantId, s.deliveryCheckouts.tenantId), eq(s.bills.sessionId, s.deliveryCheckouts.sessionId)))
    .where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.outletId, staff.outletId), inArray(s.deliveryCheckouts.status, ["placed", "dispatched", "delivered"])))
    .orderBy(desc(s.deliveryCheckouts.placedAt)).limit(100);
}

function cleanCourier(input: { name?: unknown; phone?: unknown }) {
  const name = String(input?.name ?? "").trim().replace(/\s+/g, " ");
  const rawPhone = String(input?.phone ?? "").trim();
  if (!name && !rawPhone) return { name: null, phone: null };
  const digits = rawPhone.replace(/\D/g, "");
  const phone = digits.length === 10 ? `+91${digits}` : `+${digits}`;
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’-]{1,79}$/u.test(name) || digits.length < 10 || digits.length > 15) {
    throw new AppError("invalid_state", "Enter the rider’s name and a valid phone number, or clear both fields to remove the assignment.");
  }
  return { name, phone };
}

/** Assign or clear the manually dispatched rider. Provider integrations can later update this same tracking record. */
export async function assignDeliveryCourier(staff: StaffSession, id: string, input: { name?: unknown; phone?: unknown }, now = new Date()) {
  await requireStaffRole(staff, ["owner", "manager"]);
  const courier = cleanCourier(input);
  await db.transaction(async tx => {
    const [row] = await tx.select({ id: s.deliveryCheckouts.id, status: s.deliveryCheckouts.status, courierName: s.deliveryCheckouts.courierName, courierPhone: s.deliveryCheckouts.courierPhone }).from(s.deliveryCheckouts)
      .where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.outletId, staff.outletId), eq(s.deliveryCheckouts.id, String(id)))).for("update");
    if (!row || !["placed", "dispatched"].includes(row.status)) throw new AppError("not_found", "This delivery order can no longer be assigned.");
    if (row.courierName === courier.name && row.courierPhone === courier.phone) return;
    await tx.update(s.deliveryCheckouts).set({ courierName: courier.name, courierPhone: courier.phone, courierAssignedAt: courier.name ? now : null })
      .where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.outletId, staff.outletId), eq(s.deliveryCheckouts.id, row.id)));
    await audit(tx, staff, { action: courier.name ? "delivery.courier_assigned" : "delivery.courier_unassigned", entity: "delivery", entityId: row.id, before: { name: row.courierName, phone: row.courierPhone }, after: courier, now });
  }, LOCK_THEN_READ);
}

export async function pendingManualDeliveryPayments(staff: StaffSession) {
  await requireStaffRole(staff, deliveryStaffRoles);
  return db.select({
    id: s.deliveryCheckouts.id, name: s.deliveryCheckouts.name, phone: s.deliveryCheckouts.phone,
    address: s.deliveryCheckouts.address, totalPaise: s.deliveryCheckouts.totalPaise,
    reference: s.deliveryCheckouts.manualPaymentReference, claimedAt: s.deliveryCheckouts.manualPaymentClaimedAt,
  }).from(s.deliveryCheckouts)
    .where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.outletId, staff.outletId), eq(s.deliveryCheckouts.status, "draft"), eq(s.deliveryCheckouts.paymentMode, "manual_qr"), eq(s.deliveryCheckouts.paymentStatus, "pending")))
    .orderBy(desc(s.deliveryCheckouts.manualPaymentClaimedAt)).limit(100);
}

export async function advanceDelivery(staff: StaffSession, id: string, next: "dispatched" | "delivered", now = new Date()) {
  await requireStaffRole(staff, deliveryStaffRoles);
  if (!["dispatched", "delivered"].includes(next)) throw new AppError("invalid_state", "Choose a valid delivery status.");
  await db.transaction(async tx => {
    const [row] = await tx.select().from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.outletId, staff.outletId), eq(s.deliveryCheckouts.id, String(id)))).for("update");
    if (!row?.sessionId) throw new AppError("not_found", "Delivery order not found.");
    if (row.status === next) return;
    if (next === "dispatched") {
      if (row.status !== "placed") throw new AppError("invalid_state", "Only a packed order can be dispatched.");
      const lines = await tx.select({ status: s.orderLines.status }).from(s.orderLines).where(and(eq(s.orderLines.tenantId, staff.tenantId), eq(s.orderLines.sessionId, row.sessionId)));
      const live = lines.filter(line => !["voided", "cancelled"].includes(line.status));
      if (!live.length || live.some(line => !["ready", "served"].includes(line.status))) throw new AppError("invalid_state", "Wait until the kitchen has packed every item.");
    } else {
      if (row.status !== "dispatched") throw new AppError("invalid_state", "Dispatch this order before marking it delivered.");
      const [bill] = await tx.select({ status: s.bills.status }).from(s.bills).where(and(eq(s.bills.tenantId, staff.tenantId), eq(s.bills.sessionId, row.sessionId)));
      if (bill?.status !== "paid") throw new AppError("invalid_state", "Record the payment in Billing before completing delivery.");
    }
    await tx.update(s.deliveryCheckouts).set({ status: next }).where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.id, row.id)));
    await audit(tx, staff, { action: `delivery.${next}`, entity: "delivery", entityId: row.id, before: { status: row.status }, after: { status: next }, now });
  }, LOCK_THEN_READ);
}

/**
 * The restaurant cannot deliver (customer unreachable, kitchen out of stock): cancels the order,
 * stops its kitchen items, closes its hidden counter, and sends back whatever was already paid
 * through the normal refund path. Owner or manager only; safe to repeat.
 */
export async function cancelDeliveryOrder(staff: StaffSession, id: string, rawReason: unknown, now = new Date()) {
  await requireStaffRole(staff, ["owner", "manager"]);
  const reason = String(rawReason ?? "").trim().slice(0, 200);
  if (reason.length < 3) throw new AppError("invalid_state", "Write why this delivery is cancelled.", { reason: "reason" });
  const scope = { tenantId: staff.tenantId, outletId: staff.outletId };
  const found = await db.transaction(async tx => {
    const [row] = await tx.select().from(s.deliveryCheckouts)
      .where(and(eq(s.deliveryCheckouts.tenantId, scope.tenantId), eq(s.deliveryCheckouts.outletId, scope.outletId), eq(s.deliveryCheckouts.id, String(id)))).for("update");
    if (!row?.sessionId) throw new AppError("not_found", "Delivery order not found.");
    if (row.status === "cancelled") return { sessionId: row.sessionId, tableId: null as string | null, replayed: true };
    if (row.status === "delivered") throw new AppError("invalid_state", "This order was already delivered. Refund it from Billing instead.", { reason: "delivered" });
    if (row.status !== "placed" && row.status !== "dispatched") throw new AppError("invalid_state", "This delivery order cannot be cancelled.");
    const [session] = await tx.select({ tableId: s.tableSessions.tableId }).from(s.tableSessions)
      .where(and(eq(s.tableSessions.tenantId, scope.tenantId), eq(s.tableSessions.id, row.sessionId))).for("update");
    await tx.update(s.orderLines).set({ status: "cancelled" })
      .where(and(eq(s.orderLines.tenantId, scope.tenantId), eq(s.orderLines.sessionId, row.sessionId), notInArray(s.orderLines.status, ["cancelled", "voided"])));
    await tx.update(s.deliveryCheckouts).set({ status: "cancelled" })
      .where(and(eq(s.deliveryCheckouts.tenantId, scope.tenantId), eq(s.deliveryCheckouts.id, row.id)));
    if (session) {
      await tx.update(s.tableSessions).set({ status: "closed", openKey: null, closedAt: now })
        .where(and(eq(s.tableSessions.tenantId, scope.tenantId), eq(s.tableSessions.id, row.sessionId)));
      await releaseVisitTables(tx, scope.tenantId, row.sessionId, now);
      await tx.update(s.diningTables).set({ state: "available", stateChangedAt: now })
        .where(and(eq(s.diningTables.tenantId, scope.tenantId), eq(s.diningTables.id, session.tableId)));
    }
    await audit(tx, staff, { action: "delivery.cancelled", entity: "delivery", entityId: row.id, before: { status: row.status }, after: { status: "cancelled" }, reason, now });
    return { sessionId: row.sessionId, tableId: session?.tableId ?? null, replayed: false };
  }, LOCK_THEN_READ);

  // Everything paid goes back through the ordinary refund flow: one refund per payment, repeatable
  const payments = await db.select({ id: s.payments.id, amountPaise: s.payments.amountPaise, tipPaise: s.payments.tipPaise })
    .from(s.payments).innerJoin(s.bills, and(eq(s.bills.tenantId, s.payments.tenantId), eq(s.bills.id, s.payments.billId)))
    .where(and(eq(s.payments.tenantId, scope.tenantId), eq(s.bills.sessionId, found.sessionId), eq(s.payments.status, "success")));
  const refunds: { paymentId: string; status: string }[] = [];
  for (const p of payments) {
    const r = await requestRefund(staff, { paymentId: p.id, amountPaise: p.amountPaise + p.tipPaise, reason: `Delivery cancelled: ${reason}`, requestId: `dc-${p.id}` }, now);
    refunds.push({ paymentId: p.id, status: r.status });
  }
  await publish(scope, [{ topic: topics.floor, type: "delivery.cancelled", data: { sessionId: found.sessionId } }, { topic: topics.kitchen, type: "ticket.updated", data: { sessionId: found.sessionId } }]);
  return { sessionId: found.sessionId, refunds, replayed: found.replayed };
}
