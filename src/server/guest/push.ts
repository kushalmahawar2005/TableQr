import "server-only";
import { createHash } from "node:crypto";
import webpush from "web-push";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { staffAppIconUrl } from "@/lib/staff-app";
import { bookingByToken } from "../booking/core";
import { deliveryCheckout } from "../delivery/checkout";
import { staffPushConfig, validateSubscription, type PushSubscriptionInput } from "../staff/web-push";

// Push updates to a customer's phone about their own delivery. Same VAPID keys and service
// worker as the staff app; a phone follows only its latest order.

export type DeliveryNotice = "placed" | "dispatched" | "delivered" | "collected" | "cancelled";

/** Saves this phone for updates on the delivery its cookie belongs to */
export async function saveDeliveryPush(code: string, token: string, deviceId: string, raw: PushSubscriptionInput) {
  const { outlet, row } = await deliveryCheckout(code, token, deviceId);
  const sub = validateSubscription(raw);
  const endpointHash = createHash("sha256").update(sub.endpoint).digest("hex");
  await db.insert(s.guestPushSubscriptions)
    .values({ tenantId: outlet.tenantId, outletId: outlet.id, endpointHash, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, deliveryCheckoutId: row.id })
    .onDuplicateKeyUpdate({ set: { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, deliveryCheckoutId: row.id, outletId: outlet.id } });
  return { saved: true };
}

const TEXT: Record<DeliveryNotice, (outlet: string, rider: string | null) => { title: string; body: string }> = {
  placed: (o) => ({ title: `${o}: order confirmed`, body: "The kitchen has your order. We will tell you when it leaves." }),
  dispatched: (o, r) => ({ title: `${o}: on the way 🛵`, body: r ? `${r} is bringing your food. Tap to track.` : "Your food is on the way. Tap to track." }),
  delivered: (o) => ({ title: `${o}: delivered`, body: "Enjoy your meal! Thank you for ordering." }),
  collected: (o) => ({ title: `${o}: pickup complete`, body: "Your order has been collected. Enjoy your meal!" }),
  cancelled: (o) => ({ title: `${o}: order cancelled`, body: "Your delivery was cancelled. Open your order page for payment updates." }),
};

const PICKUP_TEXT: Record<DeliveryNotice, (outlet: string) => { title: string; body: string }> = {
  placed: (o) => ({ title: `${o}: pickup order confirmed`, body: "The kitchen has your order. We will let you know when it is ready." }),
  dispatched: (o) => ({ title: `${o}: pickup order update`, body: "Your pickup order is being prepared. We will let you know when it is ready." }),
  delivered: (o) => ({ title: `${o}: pickup complete`, body: "Your pickup order has been collected. Enjoy your meal!" }),
  collected: (o) => ({ title: `${o}: pickup complete`, body: "Your pickup order has been collected. Enjoy your meal!" }),
  cancelled: (o) => ({ title: `${o}: pickup order cancelled`, body: "Your pickup order was cancelled. Open your order page for payment updates." }),
};

/** Tells the customer's phone(s) what happened to their delivery. Never throws. */
export async function notifyDeliveryCustomer(scope: { tenantId: string; outletId: string }, sessionId: string, notice: DeliveryNotice) {
  try {
    const config = staffPushConfig();
    const privateKey = process.env.VAPID_PRIVATE_KEY?.trim(), subject = process.env.VAPID_SUBJECT?.trim();
    if (!config.enabled || !privateKey || !subject) return;
    const [row] = await db.select({ id: s.deliveryCheckouts.id, courierName: s.deliveryCheckouts.courierName, serviceMode: s.deliveryCheckouts.serviceMode, code: s.outlets.code, name: s.outlets.name })
      .from(s.deliveryCheckouts)
      .innerJoin(s.outlets, and(eq(s.outlets.tenantId, s.deliveryCheckouts.tenantId), eq(s.outlets.id, s.deliveryCheckouts.outletId)))
      .where(and(eq(s.deliveryCheckouts.tenantId, scope.tenantId), eq(s.deliveryCheckouts.sessionId, sessionId)));
    if (!row) return;
    const subs = await db.select().from(s.guestPushSubscriptions).where(and(eq(s.guestPushSubscriptions.tenantId, scope.tenantId), eq(s.guestPushSubscriptions.deliveryCheckoutId, row.id)));
    if (!subs.length) return;
    const text = row.serviceMode === "pickup" ? PICKUP_TEXT[notice](row.name) : TEXT[notice](row.name, row.courierName);
    const payload = JSON.stringify({ ...text, url: `/r/${encodeURIComponent(row.code)}/delivery`, tag: `delivery-${row.id.slice(0, 8)}`, icon: staffAppIconUrl(192, row.code), badge: staffAppIconUrl(180, row.code) });
    await Promise.allSettled(subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { vapidDetails: { subject, publicKey: config.publicKey, privateKey }, TTL: 600, urgency: "high", timeout: 4_000 });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db.delete(s.guestPushSubscriptions).where(and(eq(s.guestPushSubscriptions.tenantId, scope.tenantId), eq(s.guestPushSubscriptions.id, sub.id)));
      }
    }));
  } catch (error) {
    console.warn("[guest-push]", error instanceof Error ? error.message : error);
  }
}

/** Saves this phone for reminders about the booking its manage link belongs to */
export async function saveBookingPush(code: string, token: string, raw: PushSubscriptionInput) {
  const { row, scope } = await bookingByToken(code, token);
  const sub = validateSubscription(raw);
  const endpointHash = createHash("sha256").update(sub.endpoint).digest("hex");
  await db.insert(s.guestPushSubscriptions)
    .values({ tenantId: scope.tenantId, outletId: scope.outletId, endpointHash, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, reservationId: row.id })
    .onDuplicateKeyUpdate({ set: { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, reservationId: row.id, outletId: scope.outletId } });
  return { saved: true };
}

export type BookingNotice = "booking_confirmation" | "booking_reminder_24h" | "booking_reminder_2h";

/**
 * A booking message by push, to the phones that asked for it. Returns how many phones got it,
 * so the caller can record the message as sent or not.
 */
export async function sendBookingPush(tenantId: string, reservationId: string, type: BookingNotice) {
  const config = staffPushConfig();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim(), subject = process.env.VAPID_SUBJECT?.trim();
  if (!config.enabled || !privateKey || !subject) return 0;
  const subs = await db.select().from(s.guestPushSubscriptions).where(and(eq(s.guestPushSubscriptions.tenantId, tenantId), eq(s.guestPushSubscriptions.reservationId, reservationId)));
  if (!subs.length) return 0;
  const [row] = await db.select({ startAt: s.reservations.startAt, partySize: s.reservations.partySize, status: s.reservations.status, code: s.outlets.code, name: s.outlets.name, timezone: s.outlets.timezone })
    .from(s.reservations).innerJoin(s.outlets, and(eq(s.outlets.tenantId, s.reservations.tenantId), eq(s.outlets.id, s.reservations.outletId)))
    .where(and(eq(s.reservations.tenantId, tenantId), eq(s.reservations.id, reservationId)));
  if (!row || row.status === "cancelled") return 0;
  const when = new Intl.DateTimeFormat("en-IN", { timeZone: row.timezone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(row.startAt);
  const text = type === "booking_confirmation"
    ? { title: `${row.name}: table booked`, body: `${when} for ${row.partySize}. See you soon!` }
    : type === "booking_reminder_24h"
    ? { title: `${row.name}: see you tomorrow`, body: `Your table for ${row.partySize} is at ${when}.` }
    : { title: `${row.name}: in 2 hours`, body: `Your table for ${row.partySize} is at ${when}. Running late? Tell the restaurant from your booking.` };
  const payload = JSON.stringify({ ...text, url: `/r/${encodeURIComponent(row.code)}`, tag: `booking-${reservationId.slice(0, 8)}`, icon: staffAppIconUrl(192, row.code), badge: staffAppIconUrl(180, row.code) });
  let delivered = 0;
  await Promise.allSettled(subs.map(async (sub) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { vapidDetails: { subject, publicKey: config.publicKey, privateKey }, TTL: 3600, urgency: "normal", timeout: 4_000 });
      delivered++;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await db.delete(s.guestPushSubscriptions).where(and(eq(s.guestPushSubscriptions.tenantId, tenantId), eq(s.guestPushSubscriptions.id, sub.id)));
    }
  }));
  return delivered;
}
