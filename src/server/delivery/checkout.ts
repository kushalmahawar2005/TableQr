import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { checkFirstName } from "@/domain/guest-name";
import { LOCK_THEN_READ } from "../db-types";
import { AppError } from "../errors";
import { placeOrderInTransaction } from "../guest/order";
import { quoteKey } from "@/domain/pricing";
import { syncBill } from "../billing/bill";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import { TAKEAWAY_CLASS } from "../floor/takeaway-class";
import { deliveryOutlet, cleanDeliveryCart, priceDeliveryCart } from "./catalog";

export const deliveryTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const deliveryScope = (outlet: { tenantId: string; id: string }) => ({ tenantId: outlet.tenantId, outletId: outlet.id });

function cleanAddress(raw: s.DeliveryAddress): s.DeliveryAddress {
  if (!raw || typeof raw !== "object") throw new AppError("invalid_state", "Enter your delivery address.");
  const line = String(raw.line ?? "").trim(), locality = String(raw.locality ?? "").trim(), pincode = String(raw.pincode ?? "").trim(), instructions = String(raw.instructions ?? "").trim();
  if (line.length < 5 || line.length > 200 || locality.length < 2 || locality.length > 100 || !/^[1-9]\d{5}$/.test(pincode) || instructions.length > 200) throw new AppError("invalid_state", "Enter a complete address, locality and six-digit pincode.");
  return { line, locality, pincode, instructions };
}

export async function createDeliveryCheckout(code: string, deviceId: string, input: { lines: s.DeliveryCartLine[]; address: s.DeliveryAddress }, now = new Date()) {
  if (!deviceId || deviceId.length > 64) throw new AppError("forbidden", "Reopen the delivery page.");
  const outlet = await deliveryOutlet(code, true, now);
  const address = cleanAddress(input.address), lines = cleanDeliveryCart(input.lines);
  const quote = await priceDeliveryCart(db, outlet, lines, address.pincode, now);
  const token = randomBytes(32).toString("base64url"), id = uuidv7();
  await db.transaction(async tx => {
    await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.id, outlet.tenantId)).for("update");
    const [recent] = await tx.select({ n: count() }).from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.tenantId, outlet.tenantId), eq(s.deliveryCheckouts.deviceId, deviceId), gte(s.deliveryCheckouts.createdAt, new Date(now.getTime() - 3600_000))));
    if (Number(recent.n) >= 10) throw new AppError("rate_limited", "Too many checkout attempts. Please try again later.");
    await tx.insert(s.deliveryCheckouts).values({ id, tenantId: outlet.tenantId, outletId: outlet.id, deviceId, tokenHash: deliveryTokenHash(token), lines, address, totalPaise: quote.totalPaise, deliveryFeePaise: quote.deliveryFeePaise, expiresAt: new Date(now.getTime() + 30 * 60_000), createdAt: now });
  }, LOCK_THEN_READ);
  return { token, quote };
}

/** Both a random bearer cookie and the device cookie are required. No sequential ids grant access. */
export async function deliveryCheckout(code: string, token: string, deviceId: string, now = new Date()) {
  const outlet = await deliveryOutlet(code, false, now);
  if (!token || token.length > 100 || !deviceId) throw new AppError("not_found", "Delivery checkout not found.");
  const [row] = await db.select().from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.tenantId, outlet.tenantId), eq(s.deliveryCheckouts.outletId, outlet.id), eq(s.deliveryCheckouts.tokenHash, deliveryTokenHash(token)), eq(s.deliveryCheckouts.deviceId, deviceId))).limit(1);
  if (!row) throw new AppError("not_found", "Delivery checkout not found.");
  if (row.status === "draft" && row.expiresAt <= now) throw new AppError("expired", "Your checkout expired. Please review your cart again.");
  return { outlet, row };
}

export async function placeDeliveryOrder(code: string, token: string, deviceId: string, expectedTotalPaise: number, now = new Date()) {
  const { outlet: found, row } = await deliveryCheckout(code, token, deviceId, now);
  // A lost response can be retried even after delivery has been paused.
  if (row.sessionId) return { sessionId: row.sessionId, replayed: true };
  const outlet = await deliveryOutlet(code, true, now);
  const placed = await db.transaction(async tx => {
    const [checkout] = await tx.select().from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.tenantId, outlet.tenantId), eq(s.deliveryCheckouts.id, row.id))).for("update");
    if (checkout.sessionId) return { sessionId: checkout.sessionId, replayed: true as const };
    if (checkout.expiresAt <= now || checkout.status !== "draft") throw new AppError("expired", "Your checkout expired.");
    if (!checkout.guestId || !checkout.verifiedAt || !checkFirstName(checkout.name ?? "").ok) throw new AppError("verification_required", "Verify your phone before placing this delivery order.");
    const itemIds = [...new Set(checkout.lines.map(line => line.itemId))];
    await tx.select({ id: s.outletItemOverrides.id }).from(s.outletItemOverrides).where(and(eq(s.outletItemOverrides.tenantId, outlet.tenantId), eq(s.outletItemOverrides.outletId, outlet.id), inArray(s.outletItemOverrides.itemId, itemIds))).orderBy(s.outletItemOverrides.id).for("update");
    const quote = await priceDeliveryCart(tx, outlet, checkout.lines, checkout.address.pincode, now);
    if (!Number.isSafeInteger(expectedTotalPaise) || quote.totalPaise !== expectedTotalPaise) throw new AppError("price_changed", "Prices or delivery charges changed. Review the cart before placing your order.");
    const [zone] = await tx.select({ id: s.zones.id }).from(s.zones).where(and(eq(s.zones.tenantId, outlet.tenantId), eq(s.zones.outletId, outlet.id))).orderBy(s.zones.sortOrder).limit(1);
    if (!zone) throw new AppError("outlet_unavailable", "Please contact the restaurant to order.");
    const tableId = uuidv7(), sessionId = uuidv7(), participantId = uuidv7();
    // Hidden counters reuse the kitchen and payment infrastructure without occupying a dining table.
    await tx.insert(s.diningTables).values({ id: tableId, tenantId: outlet.tenantId, outletId: outlet.id, zoneId: zone.id, code: `DL-${randomBytes(7).toString("base64url").slice(0, 9)}`, tableClass: TAKEAWAY_CLASS, minSeats: 1, maxSeats: 1, joinCode: "0000", isActive: false, isBookableOnline: false, state: "seated", stateChangedAt: now });
    await tx.insert(s.tableSessions).values({ id: sessionId, tenantId: outlet.tenantId, outletId: outlet.id, tableId, mode: "verified", source: "walk_in", partySize: 1, guestName: checkout.name, hostParticipantId: participantId, openKey: tableId, deliveryFeePaise: quote.deliveryFeePaise, openedAt: now, lastActivityAt: now });
    await tx.insert(s.participants).values({ id: participantId, tenantId: outlet.tenantId, sessionId, guestId: checkout.guestId, displayName: checkout.name!, deviceId, joinedAt: now });
    await tx.insert(s.cartLines).values(checkout.lines.map(line => ({ tenantId: outlet.tenantId, sessionId, participantId, itemId: line.itemId, qty: line.qty, modifiers: line.modifierIds.map(modifierId => ({ modifierId, groupId: "" })), personalForPickup: true })));
    const ctx = { tenantId: outlet.tenantId, outletId: outlet.id, brandId: outlet.brandId, timezone: outlet.timezone, tableId, sessionId, participantId };
    const order = await placeOrderInTransaction(tx, ctx, { requestId: checkout.id, note: "DELIVERY · Pack all items", quote: Object.fromEntries(quote.lines.map(line => [quoteKey(line.itemId, line.modifierIds), line.unitPricePaise])) }, now);
    // Delivery never inherits optional dine-in service charges.
    await syncBill(tx, ctx, now, { serviceChargeWaived: true, requestedAt: now });
    await tx.update(s.tableSessions).set({ status: "bill_requested", orderingLocked: true }).where(and(eq(s.tableSessions.tenantId, outlet.tenantId), eq(s.tableSessions.id, sessionId)));
    await tx.update(s.deliveryCheckouts).set({ status: "placed", sessionId, deliveryFeePaise: quote.deliveryFeePaise, totalPaise: quote.totalPaise, placedAt: now }).where(and(eq(s.deliveryCheckouts.tenantId, outlet.tenantId), eq(s.deliveryCheckouts.id, row.id)));
    return { sessionId, order, replayed: false as const };
  }, LOCK_THEN_READ);
  if (!placed.replayed) await publish(deliveryScope(found), [{ topic: topics.kitchen, type: "ticket.created", data: { orderId: placed.order!.orderId, stations: placed.order!.stations } }, { topic: topics.floor, type: "delivery.placed", data: { sessionId: placed.sessionId } }]);
  return { sessionId: placed.sessionId, replayed: placed.replayed };
}

export async function deliveryStatus(code: string, token: string, deviceId: string, now = new Date()) {
  const { outlet, row } = await deliveryCheckout(code, token, deviceId, now);
  const orders = row.sessionId ? await db.select({ status: s.orders.status }).from(s.orders).where(and(eq(s.orders.tenantId, outlet.tenantId), eq(s.orders.sessionId, row.sessionId))) : [];
  const [bill] = row.sessionId ? await db.select({ totalPaise: s.bills.totalPaise, status: s.bills.status }).from(s.bills).where(and(eq(s.bills.tenantId, outlet.tenantId), eq(s.bills.sessionId, row.sessionId))) : [];
  return { status: row.status, name: row.name, address: row.address, totalPaise: bill?.totalPaise ?? row.totalPaise, deliveryFeePaise: row.deliveryFeePaise, paid: bill?.status === "paid", kitchenStatus: orders[0]?.status ?? null };
}
