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
import { announceDelivery } from "./events";
import { notifyDeliveryCustomer } from "../guest/push";
import { readDeliveryPolicy } from "@/domain/delivery";
import { BUSINESS_PACKAGE_PROFILES, type BusinessType } from "@/lib/subscription-pricing";
import { tenantFeatures } from "../plan";
import { outletGatewayFromConfig } from "../payments/outlet-gateway";

export const deliveryStaffRoles = ["owner", "manager", "cashier"] as const;

/** The order desk only offers guest-order modes the current outlet can actually accept. */
export async function availableGuestOrderModes(staff: StaffSession) {
  const [outlet] = await db.select({ businessType: s.tenants.businessType, policy: s.outlets.deliveryPolicy, paymentQrUrl: s.outlets.bookingPaymentQrUrl, gatewayConfig: s.outlets.paymentGatewayConfig })
    .from(s.outlets).innerJoin(s.tenants, eq(s.tenants.id, s.outlets.tenantId))
    .where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId)));
  if (!outlet) return { pickup: false, delivery: false };
  const profile = BUSINESS_PACKAGE_PROFILES[(outlet.businessType ?? "restaurant") as BusinessType];
  const policy = readDeliveryPolicy(outlet.policy);
  const features = await tenantFeatures(staff.tenantId, staff.outletId);
  let gatewayAvailable = false;
  try { gatewayAvailable = !!outletGatewayFromConfig(outlet.gatewayConfig); } catch { /* a broken merchant key must not break the order desk */ }
  const deliveryPaymentReady = policy.paymentMode === "cod" || (policy.paymentMode === "manual_qr" && !!outlet.paymentQrUrl) || (policy.paymentMode === "gateway" && gatewayAvailable);
  const pickupPaymentReady = policy.pickupCodEnabled || !!outlet.paymentQrUrl || gatewayAvailable;
  return {
    pickup: profile.pickup && features.delivery && policy.acceptingPickupOrders && pickupPaymentReady,
    delivery: profile.delivery && features.delivery && policy.acceptingOrders && deliveryPaymentReady,
  };
}

export async function deliveryQueue(staff: StaffSession) {
  await requireStaffRole(staff, deliveryStaffRoles);
  // Historical orders remain manageable if the package is downgraded or delivery is paused.
  const rows = await db.select({ id: s.deliveryCheckouts.id, status: s.deliveryCheckouts.status, serviceMode: s.deliveryCheckouts.serviceMode, sessionId: s.deliveryCheckouts.sessionId, name: s.deliveryCheckouts.name, phone: s.deliveryCheckouts.phone, address: s.deliveryCheckouts.address, courierName: s.deliveryCheckouts.courierName, courierPhone: s.deliveryCheckouts.courierPhone, courierUserId: s.deliveryCheckouts.courierUserId, paymentIssue: s.deliveryCheckouts.paymentIssue, riderRating: s.deliveryCheckouts.riderRating, riderRatingNote: s.deliveryCheckouts.riderRatingNote, deliveryPin: s.deliveryCheckouts.deliveryPin, totalPaise: s.bills.totalPaise, paid: s.bills.status, placedAt: s.deliveryCheckouts.placedAt })
    .from(s.deliveryCheckouts).innerJoin(s.bills, and(eq(s.bills.tenantId, s.deliveryCheckouts.tenantId), eq(s.bills.sessionId, s.deliveryCheckouts.sessionId)))
    .where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.outletId, staff.outletId), inArray(s.deliveryCheckouts.status, ["placed", "dispatched", "delivered", "collected"])))
    .orderBy(desc(s.deliveryCheckouts.placedAt)).limit(100);
  // What was ordered and where the kitchen is with it, for the delivery desk
  const sessionIds = rows.map(r => r.sessionId).filter((id): id is string => !!id);
  const [orders, lines] = sessionIds.length ? await Promise.all([
    db.select({ sessionId: s.orders.sessionId, status: s.orders.status }).from(s.orders)
      .where(and(eq(s.orders.tenantId, staff.tenantId), inArray(s.orders.sessionId, sessionIds))),
    db.select({ sessionId: s.orderLines.sessionId, name: s.orderLines.nameEn, qty: s.orderLines.qty, status: s.orderLines.status }).from(s.orderLines)
      .where(and(eq(s.orderLines.tenantId, staff.tenantId), inArray(s.orderLines.sessionId, sessionIds))),
  ]) : [[], []];
  const kitchen = new Map(orders.map(o => [o.sessionId, o.status]));
  return rows.map(r => ({
    ...r,
    kitchenStatus: (r.sessionId && kitchen.get(r.sessionId)) || null,
    items: lines.filter(l => l.sessionId === r.sessionId && l.status !== "cancelled" && l.status !== "voided").map(l => ({ name: l.name, qty: l.qty })),
  }));
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
  let sessionId: string | null = null;
  await db.transaction(async tx => {
    const [row] = await tx.select({ id: s.deliveryCheckouts.id, status: s.deliveryCheckouts.status, serviceMode: s.deliveryCheckouts.serviceMode, sessionId: s.deliveryCheckouts.sessionId, courierName: s.deliveryCheckouts.courierName, courierPhone: s.deliveryCheckouts.courierPhone }).from(s.deliveryCheckouts)
      .where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.outletId, staff.outletId), eq(s.deliveryCheckouts.id, String(id)))).for("update");
    if (row?.serviceMode !== "delivery") throw new AppError("invalid_state", "Pickup orders are collected at the counter and cannot be assigned to a rider.");
    if (!row || !["placed", "dispatched"].includes(row.status)) throw new AppError("not_found", "This delivery order can no longer be assigned.");
    if (row.courierName === courier.name && row.courierPhone === courier.phone) return;
    sessionId = row.sessionId;
    // A typed-in rider replaces any team rider on this order
    await tx.update(s.deliveryCheckouts).set({ courierName: courier.name, courierPhone: courier.phone, courierUserId: null, courierAssignedAt: courier.name ? now : null })
      .where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.outletId, staff.outletId), eq(s.deliveryCheckouts.id, row.id)));
    await audit(tx, staff, { action: courier.name ? "delivery.courier_assigned" : "delivery.courier_unassigned", entity: "delivery", entityId: row.id, before: { name: row.courierName, phone: row.courierPhone }, after: courier, now });
  }, LOCK_THEN_READ);
  if (sessionId) await announceDelivery(staff, sessionId);
}

export async function pendingManualDeliveryPayments(staff: StaffSession) {
  await requireStaffRole(staff, deliveryStaffRoles);
  return db.select({
    id: s.deliveryCheckouts.id, name: s.deliveryCheckouts.name, phone: s.deliveryCheckouts.phone,
    serviceMode: s.deliveryCheckouts.serviceMode,
    address: s.deliveryCheckouts.address, totalPaise: s.deliveryCheckouts.totalPaise,
    reference: s.deliveryCheckouts.manualPaymentReference, claimedAt: s.deliveryCheckouts.manualPaymentClaimedAt,
  }).from(s.deliveryCheckouts)
    .where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.outletId, staff.outletId), eq(s.deliveryCheckouts.status, "draft"), eq(s.deliveryCheckouts.paymentMode, "manual_qr"), eq(s.deliveryCheckouts.paymentStatus, "pending")))
    .orderBy(desc(s.deliveryCheckouts.manualPaymentClaimedAt)).limit(100);
}

export async function advanceDelivery(staff: StaffSession, id: string, next: "dispatched" | "delivered" | "collected", now = new Date()) {
  await requireStaffRole(staff, deliveryStaffRoles);
  if (!["dispatched", "delivered", "collected"].includes(next)) throw new AppError("invalid_state", "Choose a valid order status.");
  let changed: string | null = null, rider: string | null = null;
  await db.transaction(async tx => {
    const [row] = await tx.select().from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.outletId, staff.outletId), eq(s.deliveryCheckouts.id, String(id)))).for("update");
    if (!row?.sessionId) throw new AppError("not_found", "Delivery order not found.");
    if (row.status === next) return;
    if (next === "collected" && row.serviceMode !== "pickup") throw new AppError("invalid_state", "Only a pickup order can be marked collected.");
    if (next === "dispatched" && row.serviceMode !== "delivery") throw new AppError("invalid_state", "Pickup orders are collected at the counter.");
    if (next === "dispatched" || next === "collected") {
      if (row.status !== "placed") throw new AppError("invalid_state", row.serviceMode === "pickup" ? "Only a ready pickup order can be marked collected." : "Only a packed order can be dispatched.");
      const lines = await tx.select({ status: s.orderLines.status }).from(s.orderLines).where(and(eq(s.orderLines.tenantId, staff.tenantId), eq(s.orderLines.sessionId, row.sessionId)));
      const live = lines.filter(line => !["voided", "cancelled"].includes(line.status));
      if (!live.length || live.some(line => !["ready", "served"].includes(line.status))) throw new AppError("invalid_state", "Wait until the kitchen has packed every item.");
      if (next === "collected") {
        const [bill] = await tx.select({ status: s.bills.status }).from(s.bills).where(and(eq(s.bills.tenantId, staff.tenantId), eq(s.bills.sessionId, row.sessionId)));
        if (bill?.status !== "paid") throw new AppError("invalid_state", "Record the pickup payment in Billing before marking it collected.");
      }
    } else {
      if (row.status !== "dispatched") throw new AppError("invalid_state", "Dispatch this order before marking it delivered.");
      const [bill] = await tx.select({ status: s.bills.status }).from(s.bills).where(and(eq(s.bills.tenantId, staff.tenantId), eq(s.bills.sessionId, row.sessionId)));
      if (bill?.status !== "paid") throw new AppError("invalid_state", "Record the payment in Billing before completing delivery.");
    }
    await tx.update(s.deliveryCheckouts).set({ status: next, ...(next === "dispatched" ? { pickedUpAt: now } : next === "collected" ? { collectedAt: now } : { deliveredAt: now }) }).where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.id, row.id)));
    await audit(tx, staff, { action: `delivery.${next}`, entity: "delivery", entityId: row.id, before: { status: row.status }, after: { status: next }, now });
    changed = row.sessionId;
    rider = row.courierUserId;
  }, LOCK_THEN_READ);
  if (changed) await announceDelivery(staff, changed, "delivery.updated", [rider], next === "dispatched" ? "dispatched" : next === "collected" ? "collected" : "delivered");
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
    await tx.update(s.deliveryCheckouts).set({
      status: "cancelled",
      ...(row.paymentStatus === "paid" ? { paymentStatus: "refund_pending", refundStatus: "pending" } : {}),
    })
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
  await publish(scope, [{ topic: topics.floor, type: "delivery.cancelled", data: { sessionId: found.sessionId } }, { topic: topics.kitchen, type: "ticket.updated", data: { sessionId: found.sessionId } }, ...(found.sessionId ? [{ topic: topics.session(found.sessionId), type: "delivery.cancelled" }] : [])]);
  if (found.sessionId) void notifyDeliveryCustomer(scope, found.sessionId, "cancelled");
  return { sessionId: found.sessionId, refunds, replayed: found.replayed };
}
