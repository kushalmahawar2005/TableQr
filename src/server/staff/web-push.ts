import "server-only";
import { createECDH, createHash } from "node:crypto";
import webpush, { type PushSubscription as WebPushSubscription } from "web-push";
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { uuidv7 } from "@/db/id";
import { rebalanceWaiterVisit, sessionOwner } from "./waiter-coverage";
import type { StaffSession } from "./auth";
import { tenantFeatures } from "../plan";
import { pushNotificationDestination } from "@/lib/staff-push-audience";

export type PushSubscriptionInput = s.StaffPushSubscription;

export function staffPushConfig() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = process.env.VAPID_SUBJECT?.trim() ?? "";
  if (!publicKey || !privateKey || !subject) return { enabled: false, publicKey: "", error: "Push notifications are not configured on the server yet." };
  try {
    if (!subject.startsWith("mailto:") && !/^https:\/\//i.test(subject)) throw new Error("Set VAPID_SUBJECT to a mailto: address or HTTPS contact URL.");
    const publicBytes = Buffer.from(publicKey, "base64url");
    const privateBytes = Buffer.from(privateKey, "base64url");
    if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) throw new Error("VAPID keys have an invalid format. Generate a matching P-256 key pair.");
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(privateBytes);
    const derivedBytes = ecdh.getPublicKey(undefined, "uncompressed");
    if (!derivedBytes.equals(publicBytes)) throw new Error("The VAPID public and private keys do not match. Generate and install both keys from the same key pair.");
    return { enabled: true, publicKey, error: "" };
  } catch (error) {
    return { enabled: false, publicKey: "", error: error instanceof Error ? error.message : "The VAPID keys are invalid." };
  }
}

export function validateSubscription(value: PushSubscriptionInput): PushSubscriptionInput {
  if (!value || typeof value !== "object" || typeof value.endpoint !== "string" || value.endpoint.length > 2048) throw new Error("Invalid push subscription.");
  let endpoint: URL;
  try { endpoint = new URL(value.endpoint); } catch { throw new Error("Invalid push endpoint."); }
  const allowedHost = endpoint.hostname === "fcm.googleapis.com"
    || endpoint.hostname.endsWith(".fcm.googleapis.com")
    || (/^jmt[0-9]+\.google\.com$/.test(endpoint.hostname) && endpoint.pathname.startsWith("/fcm/send/"))
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
    id: uuidv7(), tenantId: staff.tenantId, outletId: staff.outletId, userId: staff.userId, sessionId: staff.sessionId, endpointHash, subscription,
  }).onDuplicateKeyUpdate({ set: { tenantId: staff.tenantId, outletId: staff.outletId, userId: staff.userId, sessionId: staff.sessionId, subscription, updatedAt: new Date() } });
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
import type { PushAudience } from "@/lib/staff-push-audience";

/** Send after the business transaction commits; push failures never undo an order or request. */
export async function sendOutletPush(scope: { tenantId: string; outletId: string }, message: StaffPushMessage, audience?: PushAudience) {
  const config = staffPushConfig();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  try {
    const features = await tenantFeatures(scope.tenantId, scope.outletId);
    if (audience && "kind" in audience && (audience.kind === "service" || audience.kind === "ready") && !features.waiterApp) return;
    if (features.waiterApp && audience && "sessionId" in audience) await rebalanceWaiterVisit(scope, audience.sessionId);
    if (!config.enabled || !privateKey || !subject) return;
    const owner = audience && "sessionId" in audience ? await sessionOwner(scope, audience.sessionId) : null;
    const roles = await db.select({ id: s.users.id, duty: s.users.dutyStatus, role: s.staffRoles.role }).from(s.users).innerJoin(s.staffRoles, and(eq(s.staffRoles.tenantId, s.users.tenantId), eq(s.staffRoles.userId, s.users.id))).where(and(eq(s.users.tenantId, scope.tenantId), eq(s.users.isActive, true), or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, scope.outletId))));
    const [tenant] = await db.select({ access: s.tenants.roleAccess }).from(s.tenants).where(eq(s.tenants.id, scope.tenantId));
    const users = new Map<string, { roles: StaffSession["roles"]; duty: string }>();
    for (const row of roles) {
      const user = users.get(row.id) ?? { roles: [], duty: row.duty };
      user.roles.push(row.role);
      users.set(row.id, user);
    }
    const destinations = new Map<string, string>();
    for (const [id, user] of users) {
      const url = pushNotificationDestination({ ...user, id, access: tenant?.access }, features, message.url, audience, owner);
      if (url) destinations.set(id, url);
    }
    const appFor = (role: string) => (role === "waiter" ? features.waiterApp : role === "kitchen" ? features.kitchenDisplay : true);
    const devices = await db.select({ userId: s.staffPushSubscriptions.userId, id: s.staffPushSubscriptions.id, sessionId: s.staffPushSubscriptions.sessionId, subscription: s.staffPushSubscriptions.subscription })
      .from(s.staffPushSubscriptions)
      .innerJoin(s.staffSessions, and(
        eq(s.staffSessions.tenantId, s.staffPushSubscriptions.tenantId),
        eq(s.staffSessions.id, s.staffPushSubscriptions.sessionId),
        eq(s.staffSessions.userId, s.staffPushSubscriptions.userId),
        eq(s.staffSessions.outletId, s.staffPushSubscriptions.outletId),
        isNull(s.staffSessions.revokedAt),
        gt(s.staffSessions.expiresAt, new Date()),
      ))
      .where(and(eq(s.staffPushSubscriptions.tenantId, scope.tenantId), eq(s.staffPushSubscriptions.outletId, scope.outletId)));
    // Phones of people whose every role lost its app on this plan are forgotten for good
    const usable = new Set(roles.filter(r => appFor(r.role)).map(r => r.id));
    const orphaned = devices.filter(d => !usable.has(d.userId)).map(d => d.id);
    if (orphaned.length) await db.delete(s.staffPushSubscriptions).where(and(eq(s.staffPushSubscriptions.tenantId, scope.tenantId), inArray(s.staffPushSubscriptions.id, orphaned)));
    const recipients = devices.filter(device => !!device.sessionId && destinations.has(device.userId));
    if (!recipients.length) return;

    const [outlet] = await db.select({ code: s.outlets.code }).from(s.outlets).where(and(eq(s.outlets.tenantId, scope.tenantId), eq(s.outlets.id, scope.outletId)));
    const icon = outlet ? `/staff-icon/192?outlet=${encodeURIComponent(outlet.code)}` : "/staff-icon/192";
    const badge = outlet ? `/staff-icon/180?outlet=${encodeURIComponent(outlet.code)}` : "/staff-icon/180";

    const payload = {
      title: message.title.slice(0, 120),
      body: message.body.slice(0, 240),
      tag: (message.tag ?? "tableeqr-staff").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "tableeqr-staff",
      icon,
      badge,
    };
    await Promise.allSettled(recipients.map(async (device) => {
      try {
      await webpush.sendNotification(device.subscription as WebPushSubscription, JSON.stringify({ ...payload, url: destinations.get(device.userId), sessionId: device.sessionId }), {
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
