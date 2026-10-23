import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { LOCK_THEN_READ } from "../db-types";
import { AppError } from "../errors";
import { audit } from "../staff/audit";
import type { StaffSession } from "../staff/auth";
import { requireStaffRole } from "../staff/waiter";

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
