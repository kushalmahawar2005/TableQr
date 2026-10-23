import "server-only";
import { createHash } from "node:crypto";
import webpush, { type PushSubscription as WebPushSubscription } from "web-push";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { uuidv7 } from "@/db/id";
import type { StaffSession } from "./auth";

export type PushSubscriptionInput = s.StaffPushSubscription;

export function staffPushConfig() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = process.env.VAPID_SUBJECT?.trim() ?? "";
  return { enabled: !!(publicKey && privateKey && subject), publicKey };
}

function validateSubscription(value: PushSubscriptionInput): PushSubscriptionInput {
  if (!value || typeof value !== "object" || typeof value.endpoint !== "string" || value.endpoint.length > 2048) throw new Error("Invalid push subscription.");
  let endpoint: URL;
  try { endpoint = new URL(value.endpoint); } catch { throw new Error("Invalid push endpoint."); }
  const allowedHost = endpoint.hostname === "fcm.googleapis.com"
    || endpoint.hostname.endsWith(".fcm.googleapis.com")
    || endpoint.hostname === "web.push.apple.com"
    || endpoint.hostname.endsWith(".push.apple.com")
    || endpoint.hostname === "updates.push.services.mozilla.com"
    || endpoint.hostname === "push.services.mozilla.com";
  if (endpoint.protocol !== "https:" || !allowedHost || !value.keys || typeof value.keys.p256dh !== "string" || typeof value.keys.auth !== "string" || !value.keys.p256dh.length || !value.keys.auth.length || value.keys.p256dh.length > 256 || value.keys.auth.length > 256) throw new Error("Invalid push subscription keys.");
  return { endpoint: endpoint.toString(), expirationTime: value.expirationTime ?? null, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
}

export async function saveStaffPushSubscription(staff: StaffSession, input: PushSubscriptionInput) {
  if (!staffPushConfig().enabled) throw new Error("Push notifications are not configured on the server yet.");
  const subscription = validateSubscription(input);
  const endpointHash = createHash("sha256").update(subscription.endpoint).digest("hex");
  await db.insert(s.staffPushSubscriptions).values({
    id: uuidv7(), tenantId: staff.tenantId, outletId: staff.outletId, userId: staff.userId, endpointHash, subscription,
  }).onDuplicateKeyUpdate({ set: { tenantId: staff.tenantId, outletId: staff.outletId, userId: staff.userId, subscription, updatedAt: new Date() } });
}

export async function removeStaffPushSubscription(staff: StaffSession, rawEndpoint: string) {
  if (typeof rawEndpoint !== "string" || rawEndpoint.length > 2048) return;
  const endpointHash = createHash("sha256").update(rawEndpoint).digest("hex");
  await db.delete(s.staffPushSubscriptions).where(and(
    eq(s.staffPushSubscriptions.tenantId, staff.tenantId),
    eq(s.staffPushSubscriptions.outletId, staff.outletId),
    eq(s.staffPushSubscriptions.userId, staff.userId),
    eq(s.staffPushSubscriptions.endpointHash, endpointHash),
  ));
}

export type StaffPushMessage = { title: string; body: string; url?: string; tag?: string };

/** Send after the business transaction commits; push failures never undo an order or request. */
export async function sendOutletPush(scope: { tenantId: string; outletId: string }, message: StaffPushMessage) {
  const config = staffPushConfig();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!config.enabled || !privateKey || !subject) return;

  try {
    const devices = await db.select({ id: s.staffPushSubscriptions.id, subscription: s.staffPushSubscriptions.subscription })
      .from(s.staffPushSubscriptions)
      .where(and(eq(s.staffPushSubscriptions.tenantId, scope.tenantId), eq(s.staffPushSubscriptions.outletId, scope.outletId)));
    if (!devices.length) return;

    const payload = JSON.stringify({
      title: message.title.slice(0, 120),
      body: message.body.slice(0, 240),
      url: message.url?.startsWith("/") ? message.url : "/console",
      tag: (message.tag ?? "tableqr-staff").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "tableqr-staff",
      icon: "/staff-icon/192",
    });
    await Promise.allSettled(devices.map(async (device) => {
      try {
      await webpush.sendNotification(device.subscription as WebPushSubscription, payload, {
        vapidDetails: { subject, publicKey: config.publicKey, privateKey },
        TTL: 120,
        urgency: "high",
        timeout: 4_000,
      });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.delete(s.staffPushSubscriptions).where(and(eq(s.staffPushSubscriptions.tenantId, scope.tenantId), eq(s.staffPushSubscriptions.id, device.id)));
        } else {
          console.warn(`[web-push] delivery failed (${status ?? "network"})`);
        }
      }
    }));
  } catch (error) {
    console.warn(`[web-push] dispatch unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}
