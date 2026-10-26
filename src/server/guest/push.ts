import "server-only";
import { createHash } from "node:crypto";
import webpush from "web-push";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { staffAppIconUrl } from "@/lib/staff-app";
import { deliveryCheckout } from "../delivery/checkout";
import { staffPushConfig, validateSubscription, type PushSubscriptionInput } from "../staff/web-push";

// Push updates to a customer's phone about their own delivery. Same VAPID keys and service
// worker as the staff app; a phone follows only its latest order.

export type DeliveryNotice = "placed" | "dispatched" | "delivered" | "cancelled";

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
  cancelled: (o) => ({ title: `${o}: order cancelled`, body: "Your delivery was cancelled. Anything you paid is refunded." }),
};

/** Tells the customer's phone(s) what happened to their delivery. Never throws. */
export async function notifyDeliveryCustomer(scope: { tenantId: string; outletId: string }, sessionId: string, notice: DeliveryNotice) {
  try {
    const config = staffPushConfig();
    const privateKey = process.env.VAPID_PRIVATE_KEY?.trim(), subject = process.env.VAPID_SUBJECT?.trim();
    if (!config.enabled || !privateKey || !subject) return;
    const [row] = await db.select({ id: s.deliveryCheckouts.id, courierName: s.deliveryCheckouts.courierName, code: s.outlets.code, name: s.outlets.name })
      .from(s.deliveryCheckouts)
      .innerJoin(s.outlets, and(eq(s.outlets.tenantId, s.deliveryCheckouts.tenantId), eq(s.outlets.id, s.deliveryCheckouts.outletId)))
      .where(and(eq(s.deliveryCheckouts.tenantId, scope.tenantId), eq(s.deliveryCheckouts.sessionId, sessionId)));
    if (!row) return;
    const subs = await db.select().from(s.guestPushSubscriptions).where(and(eq(s.guestPushSubscriptions.tenantId, scope.tenantId), eq(s.guestPushSubscriptions.deliveryCheckoutId, row.id)));
    if (!subs.length) return;
    const text = TEXT[notice](row.name, row.courierName);
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
