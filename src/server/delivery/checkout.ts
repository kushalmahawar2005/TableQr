import "server-only";
import { billToken } from "@/server/billing/bill-link";
import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { checkFirstName } from "@/domain/guest-name";
import { isValidIndianMobile, normaliseIndianMobile, toE164 } from "@/domain/phone";
import { LOCK_THEN_READ, type Tx } from "../db-types";
import { AppError } from "../errors";
import { placeOrderInTransaction } from "../guest/order";
import { quoteKey } from "@/domain/pricing";
import { syncBill } from "../billing/bill";
import { announceBill, settleExternalGatewayInTransaction, settleManualQrInTransaction } from "../billing/payments";
import { publish } from "../realtime/publish";
import { signRealtimeToken, topics } from "../realtime/token";
import { DELIVERY_TABLE_PREFIX, freshLocation } from "@/domain/delivery";
import type { OrderServiceMode } from "@/domain/delivery";
import { notifyDeliveryCustomer } from "../guest/push";
import { sendOutletPush } from "../staff/web-push";
import { verifiedRiders } from "./rider-docs";
import { riderStats } from "./riders";
import { TAKEAWAY_CLASS } from "../floor/takeaway-class";
import { deliveryOutlet, cleanDeliveryCart, priceDeliveryCart } from "./catalog";
import { audit } from "../staff/audit";
import { requireStaffRole } from "../staff/waiter";
import type { StaffSession } from "../staff/auth";
import { outletGatewayReady } from "../payments/outlet-gateway";

export function cleanManualPaymentReference(value: unknown) {
  const reference = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9-]{6,40}$/.test(reference)) throw new AppError("invalid_state", "Enter the UPI transaction reference (6–40 letters or numbers).");
  return reference;
}

export const deliveryTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const deliveryScope = (outlet: { tenantId: string; id: string }) => ({ tenantId: outlet.tenantId, outletId: outlet.id });

function cleanAddress(raw: s.DeliveryAddress): s.DeliveryAddress {
  if (!raw || typeof raw !== "object") throw new AppError("invalid_state", "Enter your delivery address.");
  const line = String(raw.line ?? "").trim(), locality = String(raw.locality ?? "").trim(), pincode = String(raw.pincode ?? "").trim(), instructions = String(raw.instructions ?? "").trim();
  if (line.length < 5 || line.length > 200 || locality.length < 2 || locality.length > 100 || !/^[1-9]\d{5}$/.test(pincode) || instructions.length > 200) throw new AppError("invalid_state", "Enter a complete address, locality and six-digit pincode.");
  // A pin is optional; one outside India or not a number is dropped, never trusted
  const lat = Number(raw.lat), lng = Number(raw.lng);
  const pin = Number.isFinite(lat) && Number.isFinite(lng) && lat > 6 && lat < 38 && lng > 68 && lng < 98 ? { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 } : {};
  return { line, locality, pincode, instructions, ...pin };
}

function checkoutPincode(serviceMode: OrderServiceMode, address: s.DeliveryAddress | null) {
  if (serviceMode === "pickup") return undefined;
  if (!address?.pincode) throw new AppError("invalid_state", "Enter your delivery address and pincode.");
  return address.pincode;
}

export async function createDeliveryCheckout(code: string, deviceId: string, input: { lines: s.DeliveryCartLine[]; address?: s.DeliveryAddress; serviceMode?: OrderServiceMode; paymentMode?: "cod" | "gateway" | "manual_qr" }, now = new Date()) {
  if (!deviceId || deviceId.length > 64) throw new AppError("forbidden", "Reopen the delivery page.");
  const serviceMode = input.serviceMode === "pickup" ? "pickup" : "delivery";
  const outlet = await deliveryOutlet(code, true, now, serviceMode);
  const address = serviceMode === "delivery" ? cleanAddress(input.address!) : null;
  const lines = cleanDeliveryCart(input.lines);
  const paymentMode = serviceMode === "delivery" ? outlet.policy.paymentMode : input.paymentMode;
  if (!paymentMode || !paymentAllowed(outlet, paymentMode, serviceMode)) throw new AppError("invalid_state", `Choose a payment method available for ${serviceMode}.`);
  const quote = await priceDeliveryCart(db, outlet, lines, checkoutPincode(serviceMode, address), now, serviceMode);
  const token = randomBytes(32).toString("base64url"), id = uuidv7();
  await db.transaction(async tx => {
    await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.id, outlet.tenantId)).for("update");
    const [recent] = await tx.select({ n: count() }).from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.tenantId, outlet.tenantId), eq(s.deliveryCheckouts.deviceId, deviceId), gte(s.deliveryCheckouts.createdAt, new Date(now.getTime() - 3600_000))));
    if (Number(recent.n) >= 10) throw new AppError("rate_limited", "Too many checkout attempts. Please try again later.");
    await tx.insert(s.deliveryCheckouts).values({ id, tenantId: outlet.tenantId, outletId: outlet.id, deviceId, tokenHash: deliveryTokenHash(token), lines, address, serviceMode, paymentMode, manualPaymentQrUrl: paymentMode === "manual_qr" ? outlet.bookingPaymentQrUrl : null, totalPaise: quote.totalPaise, deliveryFeePaise: quote.deliveryFeePaise, expiresAt: new Date(now.getTime() + 30 * 60_000), createdAt: now });
  }, LOCK_THEN_READ);
  return { token, quote };
}

function paymentAllowed(outlet: Awaited<ReturnType<typeof deliveryOutlet>>, mode: "cod" | "gateway" | "manual_qr", serviceMode: OrderServiceMode) {
  if (mode === "cod") return serviceMode === "pickup" ? outlet.policy.pickupCodEnabled : outlet.policy.paymentMode === "cod";
  if (mode === "manual_qr") return !!outlet.bookingPaymentQrUrl;
  return outletGatewayReady(outlet.paymentGatewayConfig);
}

/** Cash is a promise: a blocked number cannot use it, and a new customer's first one has a limit. */
async function assertCashAllowed(tx: Tx, outlet: Awaited<ReturnType<typeof deliveryOutlet>>, guestId: string, totalPaise: number) {
  const [guest] = await tx.select({ blockedAt: s.guests.blockedAt }).from(s.guests).where(and(eq(s.guests.tenantId, outlet.tenantId), eq(s.guests.id, guestId)));
  if (guest?.blockedAt) throw new AppError("guest_blocked", "Cash orders are not available for this number. Please pay online.");
  const limit = outlet.policy.firstCashLimitPaise;
  if (!limit || totalPaise <= limit) return;
  const [earlier] = await tx.select({ id: s.deliveryCheckouts.id }).from(s.deliveryCheckouts)
    .where(and(eq(s.deliveryCheckouts.tenantId, outlet.tenantId), eq(s.deliveryCheckouts.guestId, guestId), inArray(s.deliveryCheckouts.status, ["delivered", "collected"]))).limit(1);
  if (!earlier) throw new AppError("invalid_state", `A first cash order can be up to ₹${limit / 100}. Pay online or reduce your cart.`, { reason: "first_cash_limit" });
}

/**
 * Online payment already stops fake orders, so a prepaid checkout costs no SMS. The number stays
 * unverified: it reaches the kitchen and rider, but is never linked to a guest account.
 */
export async function prepaidCheckoutContact(code: string, token: string, deviceId: string, nameInput: string, phoneInput: string, now = new Date()) {
  const { outlet, row } = await deliveryCheckout(code, token, deviceId, now);
  if (row.paymentMode !== "gateway") return false;
  const name = checkFirstName(nameInput), digits = normaliseIndianMobile(phoneInput);
  if (!name.ok) throw new AppError("invalid_name", "Enter your name using letters, up to 40 characters.");
  if (!isValidIndianMobile(digits)) throw new AppError("invalid_phone", "Enter a valid Indian mobile number.");
  await db.update(s.deliveryCheckouts).set({ name: name.name, phone: toE164("+91", digits) }).where(and(eq(s.deliveryCheckouts.tenantId, outlet.tenantId), eq(s.deliveryCheckouts.id, row.id), eq(s.deliveryCheckouts.status, "draft")));
  return true;
}

/** Both a random bearer cookie and the device cookie are required. No sequential ids grant access. */
export async function deliveryCheckout(code: string, token: string, deviceId: string, now = new Date()) {
  const outlet = await deliveryOutlet(code, false, now);
  if (!token || token.length > 100 || !deviceId) throw new AppError("not_found", "Order checkout not found.");
  const [row] = await db.select().from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.tenantId, outlet.tenantId), eq(s.deliveryCheckouts.outletId, outlet.id), eq(s.deliveryCheckouts.tokenHash, deliveryTokenHash(token)), eq(s.deliveryCheckouts.deviceId, deviceId))).limit(1);
  if (!row) throw new AppError("not_found", "Order checkout not found.");
  if (row.status === "draft" && row.expiresAt <= now && !(row.paymentMode === "manual_qr" && row.paymentStatus === "pending" && row.manualPaymentReference)) throw new AppError("expired", "Your checkout expired. Please review your cart again.");
  return { outlet, row };
}

export async function placeDeliveryOrder(code: string, token: string, deviceId: string, expectedTotalPaise: number, now = new Date()) {
  const { outlet: found, row } = await deliveryCheckout(code, token, deviceId, now);
  return placeKnownDeliveryOrder(code, found, row, deviceId, expectedTotalPaise, now);
}

/** A guest can submit a reference, but only an authorized staff confirmation records payment
 * and creates the kitchen order. Submission is idempotent for the same checkout/reference. */
export async function claimManualQrDeliveryPayment(code: string, token: string, deviceId: string, expectedTotalPaise: number, rawReference: unknown, now = new Date()) {
  const reference = cleanManualPaymentReference(rawReference);
  const { outlet, row } = await deliveryCheckout(code, token, deviceId, now);
  if (row.status !== "draft" || row.paymentMode !== "manual_qr" || !row.manualPaymentQrUrl) throw new AppError("invalid_state", "This checkout does not use business QR payment.");
  if (!row.guestId || !row.verifiedAt || !row.name || !row.phone) throw new AppError("verification_required", "Verify your mobile number before submitting a payment reference.");
  if (row.paymentStatus === "pending" && row.manualPaymentReference === reference) return { submitted: true as const };
  if (row.paymentStatus !== "none" || row.manualPaymentReference) throw new AppError("conflict", "A payment reference is already submitted. Contact the business if you need help.");
  if (row.expiresAt <= now) throw new AppError("expired", "Your checkout expired. Please review your cart again.");
  const quote = await priceDeliveryCart(db, outlet, row.lines, checkoutPincode(row.serviceMode, row.address), now, row.serviceMode);
  if (!Number.isSafeInteger(expectedTotalPaise) || quote.totalPaise !== expectedTotalPaise || quote.totalPaise !== row.totalPaise) throw new AppError("price_changed", "Prices or delivery charges changed. Start a new checkout and review the total.");
  await db.transaction(async tx => {
    const [checkout] = await tx.select().from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.tenantId, outlet.tenantId), eq(s.deliveryCheckouts.outletId, outlet.id), eq(s.deliveryCheckouts.id, row.id))).for("update");
    if (checkout.paymentStatus === "pending" && checkout.manualPaymentReference === reference) return;
    if (checkout.status !== "draft" || checkout.expiresAt <= now || checkout.paymentMode !== "manual_qr" || checkout.paymentStatus !== "none" || checkout.manualPaymentReference) throw new AppError("conflict", "This checkout has changed. Refresh and try again.");
    await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.id, outlet.tenantId)).for("update");
    const [used] = await tx.select({ id: s.deliveryCheckouts.id }).from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.tenantId, outlet.tenantId), ne(s.deliveryCheckouts.id, row.id), eq(s.deliveryCheckouts.manualPaymentReference, reference))).limit(1);
    if (used) throw new AppError("conflict", "That UPI reference was already submitted. Check the reference and try again.");
    await tx.update(s.deliveryCheckouts).set({ manualPaymentReference: reference, manualPaymentClaimedAt: now, paymentStatus: "pending", expiresAt: new Date(now.getTime() + 24 * 60 * 60_000) }).where(and(eq(s.deliveryCheckouts.tenantId, outlet.tenantId), eq(s.deliveryCheckouts.id, row.id)));
  }, LOCK_THEN_READ);
  const pickup = row.serviceMode === "pickup";
  void sendOutletPush({ tenantId: outlet.tenantId, outletId: outlet.id }, { title: `${pickup ? "Pickup" : "Delivery"} payment needs checking`, body: `A guest submitted a ${pickup ? "pickup" : "delivery"} payment reference. Verify it to accept the order.`, url: "/console/orders?view=delivery", tag: `verify-${row.id}` }, { kind: "management" });
  return { submitted: true as const };
}

/** Server-only continuation used after the restaurant's gateway confirms a delivery payment. */
export async function placePaidDeliveryOrder(checkoutId: string, now = new Date()) {
  // isolation-exempt: checkout id is an opaque UUID from a server-verified payment; resolve tenant from row.
  const [row] = await db.select().from(s.deliveryCheckouts).where(eq(s.deliveryCheckouts.id, checkoutId)).limit(1);
  if (!row || row.paymentMode !== "gateway" || row.paymentStatus !== "paid") throw new AppError("forbidden", "The delivery payment has not been confirmed.");
  const [outlet] = await db.select().from(s.outlets).where(and(eq(s.outlets.tenantId, row.tenantId), eq(s.outlets.id, row.outletId))).limit(1);
  if (!outlet) throw new AppError("not_found", "Business not found.");
  const found = await deliveryOutlet(outlet.code, false, now, row.serviceMode);
  return placeKnownDeliveryOrder(outlet.code, found, row, row.deviceId, row.totalPaise, now);
}

async function placeKnownDeliveryOrder(code: string, found: Awaited<ReturnType<typeof deliveryOutlet>>, row: typeof s.deliveryCheckouts.$inferSelect, deviceId: string, expectedTotalPaise: number, now: Date, manualVerification?: { reference: string; staff: StaffSession }) {
  // A lost response can be retried even after delivery has been paused.
  if (row.sessionId) return { sessionId: row.sessionId, replayed: true };
  const outlet = await deliveryOutlet(code, !manualVerification, now, row.serviceMode);
  if (outlet.id !== row.outletId || outlet.tenantId !== row.tenantId || row.deviceId !== deviceId) throw new AppError("not_found", "Order checkout not found.");
  const placed = await db.transaction(async tx => {
    const [checkout] = await tx.select().from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.tenantId, outlet.tenantId), eq(s.deliveryCheckouts.id, row.id))).for("update");
    if (checkout.sessionId) return { sessionId: checkout.sessionId, replayed: true as const };
    const claimedManualPayment = checkout.paymentMode === "manual_qr" && checkout.paymentStatus === "pending" && !!checkout.manualPaymentReference && !!checkout.manualPaymentClaimedAt;
    if ((checkout.expiresAt <= now && !(manualVerification && claimedManualPayment)) || checkout.status !== "draft") throw new AppError("expired", "Your checkout expired.");
    const prepaid = checkout.paymentMode === "gateway";
    if ((prepaid ? !checkout.phone : !checkout.guestId || !checkout.verifiedAt) || !checkFirstName(checkout.name ?? "").ok) throw new AppError("verification_required", "Verify your phone before placing this order.");
    if (checkout.paymentMode === "gateway" && (checkout.paymentStatus !== "paid" || !checkout.gatewayPaymentId)) throw new AppError("invalid_state", "Complete the secure online payment before placing your order.", { reason: "payment_required" });
    if (checkout.paymentMode === "manual_qr" && (!manualVerification || !claimedManualPayment || checkout.manualPaymentReference !== manualVerification.reference || !checkout.manualPaymentQrUrl)) throw new AppError("invalid_state", "The business must verify the submitted QR payment before placing this order.");
    if (checkout.paymentMode === "cod" && checkout.paymentStatus !== "none") throw new AppError("invalid_state", "This delivery checkout has an unexpected payment state.");
    if (checkout.paymentMode === "cod" && checkout.guestId) await assertCashAllowed(tx, outlet, checkout.guestId, checkout.totalPaise);
    const itemIds = [...new Set(checkout.lines.map(line => line.itemId))];
    await tx.select({ id: s.outletItemOverrides.id }).from(s.outletItemOverrides).where(and(eq(s.outletItemOverrides.tenantId, outlet.tenantId), eq(s.outletItemOverrides.outletId, outlet.id), inArray(s.outletItemOverrides.itemId, itemIds))).orderBy(s.outletItemOverrides.id).for("update");
    const quote = await priceDeliveryCart(tx, outlet, checkout.lines, checkoutPincode(checkout.serviceMode, checkout.address), now, checkout.serviceMode);
    if (!Number.isSafeInteger(expectedTotalPaise) || quote.totalPaise !== expectedTotalPaise) throw new AppError("price_changed", "Prices or delivery charges changed. Review the cart before placing your order.");
    let [zone] = await tx.select({ id: s.zones.id }).from(s.zones).where(and(eq(s.zones.tenantId, outlet.tenantId), eq(s.zones.outletId, outlet.id), eq(s.zones.isActive, true))).orderBy(s.zones.sortOrder).limit(1);
    // A business with no zones keeps one hidden zone for all its online orders
    if (!zone) [zone] = await tx.select({ id: s.zones.id }).from(s.zones).where(and(eq(s.zones.tenantId, outlet.tenantId), eq(s.zones.outletId, outlet.id), eq(s.zones.name, "Online orders"))).limit(1);
    if (!zone) {
      const zoneId = uuidv7();
      await tx.insert(s.zones).values({ id: zoneId, tenantId: outlet.tenantId, outletId: outlet.id, name: "Online orders", sortOrder: 10000, isActive: false });
      zone = { id: zoneId };
    }
    const tableId = uuidv7(), sessionId = uuidv7(), participantId = uuidv7();
    // Hidden counters reuse the kitchen and payment infrastructure without occupying a dining table.
    await tx.insert(s.diningTables).values({ id: tableId, tenantId: outlet.tenantId, outletId: outlet.id, zoneId: zone.id, code: `${DELIVERY_TABLE_PREFIX}${randomBytes(7).toString("base64url").slice(0, 9)}`, tableClass: TAKEAWAY_CLASS, minSeats: 1, maxSeats: 1, joinCode: "0000", isActive: false, isBookableOnline: false, state: "seated", stateChangedAt: now });
    await tx.insert(s.tableSessions).values({ id: sessionId, tenantId: outlet.tenantId, outletId: outlet.id, tableId, mode: "verified", source: "walk_in", partySize: 1, guestName: checkout.name, hostParticipantId: participantId, openKey: tableId, deliveryFeePaise: quote.deliveryFeePaise, openedAt: now, lastActivityAt: now });
    await tx.insert(s.participants).values({ id: participantId, tenantId: outlet.tenantId, sessionId, guestId: checkout.guestId, displayName: checkout.name!, deviceId, joinedAt: now });
    await tx.insert(s.cartLines).values(checkout.lines.map(line => ({ tenantId: outlet.tenantId, sessionId, participantId, itemId: line.itemId, qty: line.qty, modifiers: line.modifierIds.map(modifierId => ({ modifierId, groupId: "" })), personalForPickup: true })));
    const ctx = { tenantId: outlet.tenantId, outletId: outlet.id, brandId: outlet.brandId, timezone: outlet.timezone, tableId, sessionId, participantId };
    const order = await placeOrderInTransaction(tx, ctx, { requestId: checkout.id, note: `${checkout.serviceMode === "pickup" ? "PICKUP" : "DELIVERY"} · Pack all items`, quote: Object.fromEntries(quote.lines.map(line => [quoteKey(line.itemId, line.modifierIds), line.unitPricePaise])) }, now, undefined, { paidOnline: prepaid });
    // Delivery never inherits optional dine-in service charges.
    await syncBill(tx, ctx, now, { serviceChargeWaived: true, requestedAt: now });
    await tx.update(s.tableSessions).set({ status: "bill_requested", orderingLocked: true }).where(and(eq(s.tableSessions.tenantId, outlet.tenantId), eq(s.tableSessions.id, sessionId)));
    const billPayment = checkout.paymentMode === "gateway"
      ? await settleExternalGatewayInTransaction(tx, { paymentId: checkout.id, tenantId: outlet.tenantId, outletId: outlet.id, sessionId, participantId, provider: checkout.paymentProvider ?? "", gatewayRef: checkout.gatewayRef ?? "", gatewayPaymentId: checkout.gatewayPaymentId ?? "", amountPaise: checkout.totalPaise }, now)
      : manualVerification
        ? await settleManualQrInTransaction(tx, { paymentId: checkout.id, tenantId: outlet.tenantId, outletId: outlet.id, sessionId, participantId, reference: manualVerification.reference, amountPaise: checkout.totalPaise, takenByUserId: manualVerification.staff.userId }, now)
        : null;
    await tx.update(s.deliveryCheckouts).set({ status: "placed", sessionId, deliveryFeePaise: quote.deliveryFeePaise, totalPaise: quote.totalPaise, placedAt: now, ...(manualVerification ? { paymentStatus: "paid" as const, manualPaymentConfirmedAt: now } : {}) }).where(and(eq(s.deliveryCheckouts.tenantId, outlet.tenantId), eq(s.deliveryCheckouts.id, row.id)));
    if (manualVerification) await audit(tx, manualVerification.staff, { action: "delivery.manual_payment_confirmed", entity: "delivery", entityId: checkout.id, before: { paymentStatus: checkout.paymentStatus, reference: checkout.manualPaymentReference }, after: { paymentStatus: "paid", amountPaise: checkout.totalPaise }, now });
    return { sessionId, order, billPayment, replayed: false as const };
  }, LOCK_THEN_READ);
  if (!placed.replayed) {
    await publish(deliveryScope(found), [{ topic: topics.kitchen, type: "ticket.created", data: { orderId: placed.order!.orderId, stations: placed.order!.stations } }, { topic: topics.floor, type: "delivery.placed", data: { sessionId: placed.sessionId } }, { topic: topics.session(placed.sessionId), type: "delivery.placed" }]);
    void sendOutletPush(deliveryScope(found), {
      title: row.serviceMode === "pickup" ? "New pickup order" : "New delivery order",
      body: row.serviceMode === "pickup" ? "A guest placed a pickup order. Open the order desk to review it." : "A guest placed a delivery order. Open the order desk to review it.",
      url: "/console/orders?view=delivery",
      tag: `delivery-${row.id}`,
    }, { kind: "delivery" });
    void notifyDeliveryCustomer(deliveryScope(found), placed.sessionId, "placed");
    if (placed.billPayment) announceBill(placed.billPayment.scope, placed.billPayment.closedTableIds ? { tableIds: placed.billPayment.closedTableIds, state: "needs_cleaning" } : undefined, [{ topic: topics.session(placed.sessionId), type: "payment.updated", data: { paymentId: placed.billPayment.paymentId } }, { topic: topics.session(placed.sessionId), type: "session.closed" }]);
  }
  return { sessionId: placed.sessionId, replayed: placed.replayed };
}

/** Owner/manager/cashier endpoint used by the staff queue after checking the payment in their own
 * UPI/bank app. The payment ledger and kitchen ticket are created together and retries are safe. */
export async function confirmManualQrDeliveryPayment(staff: StaffSession, checkoutId: string, now = new Date()) {
  await requireStaffRole(staff, ["owner", "manager", "cashier"]);
  const [row] = await db.select().from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.outletId, staff.outletId), eq(s.deliveryCheckouts.id, String(checkoutId)))).limit(1);
  if (!row) throw new AppError("not_found", "Delivery payment claim not found.");
  if (row.sessionId && row.paymentStatus === "paid") return { sessionId: row.sessionId, replayed: true };
  if (row.status !== "draft" || row.paymentMode !== "manual_qr" || row.paymentStatus !== "pending" || !row.manualPaymentReference || !row.manualPaymentClaimedAt || !row.guestId || !row.verifiedAt) throw new AppError("invalid_state", "This delivery payment is not awaiting verification.");
  const [outletRow] = await db.select({ code: s.outlets.code }).from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId)));
  if (!outletRow) throw new AppError("not_found", "Business not found.");
  const outlet = await deliveryOutlet(outletRow.code, false, now, row.serviceMode);
  return placeKnownDeliveryOrder(outlet.code, outlet, row, row.deviceId, row.totalPaise, now, { reference: row.manualPaymentReference, staff });
}

export async function deliveryStatus(code: string, token: string, deviceId: string, now = new Date()) {
  const { outlet, row } = await deliveryCheckout(code, token, deviceId, now);
  return deliveryView(outlet,row,now);
}

async function deliveryView(outlet: {tenantId:string}, row: typeof s.deliveryCheckouts.$inferSelect, now:Date) {
  const orders = row.sessionId ? await db.select({ status: s.orders.status }).from(s.orders).where(and(eq(s.orders.tenantId, outlet.tenantId), eq(s.orders.sessionId, row.sessionId))) : [];
  const [bill] = row.sessionId ? await db.select({ id: s.bills.id, deliveryFeePaise: s.bills.deliveryFeePaise, subtotalPaise: s.bills.subtotalPaise, serviceChargePaise: s.bills.serviceChargePaise, roundOffPaise: s.bills.roundOffPaise, totalPaise: s.bills.totalPaise, taxPaise: s.bills.taxPaise, discountPaise: s.bills.discountPaise, status: s.bills.status }).from(s.bills).where(and(eq(s.bills.tenantId, outlet.tenantId), eq(s.bills.sessionId, row.sessionId))) : [];
  const payments = bill ? await db.select({ id: s.payments.id, status: s.payments.status }).from(s.payments)
    .where(and(eq(s.payments.tenantId, outlet.tenantId), eq(s.payments.billId, bill.id))) : [];
  const refundRows = payments.length ? await db.select({ status: s.refunds.status }).from(s.refunds)
    .where(and(eq(s.refunds.tenantId, outlet.tenantId), inArray(s.refunds.paymentId, payments.map(payment => payment.id)))) : [];
  const hasPaidPayment = payments.some(payment => payment.status === "success");
  const refundStatus = refundRows.some(refund => refund.status === "pending") ? "pending"
    : refundRows.some(refund => refund.status === "failed") ? "failed"
      : refundRows.some(refund => refund.status === "success") ? "success"
        : row.status === "cancelled" && hasPaidPayment && row.refundStatus === "none" ? "failed" : row.refundStatus;
  const paymentStatus = row.status !== "cancelled" ? row.paymentStatus
    : refundStatus === "pending" ? "refund_pending"
      : refundStatus === "success" ? "refunded"
        : refundStatus === "failed" ? "refund_failed" : row.paymentStatus;
  const [rider] = row.courierUserId ? await db.select({ photoUrl: s.users.photoUrl, vehicleNo: s.users.vehicleNo, lastLat: s.users.lastLat, lastLng: s.users.lastLng, lastLocAt: s.users.lastLocAt }).from(s.users).where(and(eq(s.users.tenantId, outlet.tenantId), eq(s.users.id, row.courierUserId))) : [];
  const lines = row.sessionId ? await db.select({ name: s.orderLines.nameEn, nameHi: s.orderLines.nameHi, qty: s.orderLines.qty, unitPricePaise: s.orderLines.unitPricePaise, modifiers: s.orderLines.modifiers, imageUrl: s.menuItems.imageUrl, status: s.orderLines.status }).from(s.orderLines).leftJoin(s.menuItems, and(eq(s.menuItems.tenantId, s.orderLines.tenantId), eq(s.menuItems.id, s.orderLines.itemId))).where(and(eq(s.orderLines.tenantId, outlet.tenantId), eq(s.orderLines.sessionId, row.sessionId))) : [];
  return { id: row.id, billPdfUrl: bill ? `/b/${billToken(bill.id)}/pdf` : null, billBreakdown: bill ? { subtotalPaise: bill.subtotalPaise, serviceChargePaise: bill.serviceChargePaise, roundOffPaise: bill.roundOffPaise, taxPaise: bill.taxPaise, discountPaise: bill.discountPaise } : null, createdAt: row.createdAt.getTime(), status: row.status, serviceMode: row.serviceMode, placedAt: row.placedAt?.getTime() ?? null, items: lines.filter(l => l.status !== "cancelled" && l.status !== "voided").map(({ name, nameHi, qty, unitPricePaise, imageUrl, modifiers }) => ({ name, nameHi, qty, unitPricePaise, imageUrl, modifiers })), name: row.name, address: row.address ?? { line: "", locality: "", pincode: "", instructions: "" }, totalPaise: bill?.totalPaise ?? row.totalPaise, deliveryFeePaise: bill?.deliveryFeePaise ?? row.deliveryFeePaise, paid: row.status !== "cancelled" && (bill?.status === "paid" || row.paymentStatus === "paid"), paymentMode: row.paymentMode, paymentStatus, paymentFailureReason: row.paymentFailureReason, refundStatus, manualPaymentQrUrl: row.manualPaymentQrUrl, manualPaymentReference: row.manualPaymentReference, manualPaymentClaimedAt: row.manualPaymentClaimedAt, courierName: row.courierName, courierPhone: row.courierPhone, courierPhotoUrl: rider?.photoUrl ?? null, courierVehicleNo: rider?.vehicleNo ?? null, courierVerified: row.courierUserId ? (await verifiedRiders(outlet.tenantId, [row.courierUserId])).has(row.courierUserId) : false, riderLocation: row.serviceMode === "delivery" && row.status === "dispatched" && rider ? freshLocation(rider.lastLat, rider.lastLng, rider.lastLocAt, now.getTime()) : null, kitchenStatus: orders[0]?.status ?? null,
    // Shown to the customer only while the food is on its way; they read it out to the rider at the door
    deliveryPin: row.status === "dispatched" ? row.deliveryPin : null,
    courierRating: row.courierUserId ? await riderStats(outlet.tenantId, row.courierUserId, now).then((st) => ({ rating: st.rating, ratings: st.ratings, rides: st.rides })) : null,
    myRating: row.riderRating ?? null, canRate: row.status === "delivered" && !!row.courierUserId && row.riderRating === null };
}

export async function customerDeliveryView(code:string,token:string|undefined,id:string,now=new Date()) {
 const { customerFor } = await import("../guest/customer-account");
 const who=await customerFor(code,token,now);
 if(!who)throw new AppError("verification_required","Sign in to track your order.");
 const [row]=await db.select().from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.tenantId,who.tenantId),eq(s.deliveryCheckouts.outletId,who.outletId),eq(s.deliveryCheckouts.guestId,who.id),eq(s.deliveryCheckouts.id,id)));
 if(!row)throw new AppError("not_found","Order not found.");
 return deliveryView(who,row,now);
}

/** The customer's stars for the rider, once, after delivery */
export async function rateDeliveryRider(code: string, token: string, deviceId: string, input: { stars: number; note?: string }, now = new Date()) {
  const { outlet, row } = await deliveryCheckout(code, token, deviceId, now);
  const stars = Number(input.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new AppError("invalid_state", "Choose 1 to 5 stars.");
  if (row.status !== "delivered" || !row.courierUserId) throw new AppError("invalid_state", "You can rate the rider after delivery.");
  const note = String(input.note ?? "").trim().replace(/\s+/g, " ").slice(0, 200) || null;
  await db.update(s.deliveryCheckouts).set({ riderRating: stars, riderRatingNote: note, riderRatedAt: now })
    .where(and(eq(s.deliveryCheckouts.tenantId, outlet.tenantId), eq(s.deliveryCheckouts.id, row.id), isNull(s.deliveryCheckouts.riderRating)));
  return { stars };
}

/** The customer's phone hears only this delivery's updates (its session topic) */
export async function deliveryRealtimeToken(code: string, token: string, deviceId: string, now = new Date()) {
  const { outlet, row } = await deliveryCheckout(code, token, deviceId, now);
  if (!row.sessionId) return null;
  return signRealtimeToken({ tenantId: outlet.tenantId, outletId: outlet.id, topics: [topics.session(row.sessionId)], sub: deviceId }, 6 * 60 * 60);
}

