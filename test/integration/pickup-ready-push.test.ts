import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import webpush from "web-push";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { DEFAULT_DELIVERY_POLICY } from "@/domain/delivery";
import { createDeliveryCheckout, deliveryCheckout, placeDeliveryOrder } from "@/server/delivery/checkout";
import { sendDeliveryOtp, verifyDeliveryOtp } from "@/server/delivery/otp";
import { bumpLine } from "@/server/kitchen/actions";
import { uuidv7 } from "@/db/id";
import { resetTestDb } from "./setup-db";

// The guest is told "we will let you know when it is ready", so the last finished dish must say so.

const sendNotification = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("web-push", async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof import("web-push") }>();
  return { ...actual, default: { ...actual.default, sendNotification } };
});

let env: Awaited<ReturnType<typeof resetTestDb>>;
const kitchen = () => ({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, userId: env.demo.staffIds.owner });
const address = { line: "12 Main Road", locality: "Jaipur", pincode: "302001", instructions: "" };
const titles = () => (sendNotification.mock.calls as unknown as [unknown, string][]).map(([, payload]) => JSON.parse(payload).title as string);

async function placed(device: string, phone: string, serviceMode: "delivery" | "pickup") {
  const lines = ["Dal Makhani", "Cola"].map((name) => ({ itemId: env.demo.itemIds[name], qty: 1, modifierIds: [] }));
  const created = await createDeliveryCheckout("SRJ01", device, serviceMode === "pickup" ? { lines, serviceMode, paymentMode: "cod" } : { lines, address });
  const sent = await sendDeliveryOtp("SRJ01", created.token, device, phone);
  await verifyDeliveryOtp("SRJ01", created.token, device, sent.challengeId, sent.devCode!, "Ravi");
  const order = await placeDeliveryOrder("SRJ01", created.token, device, created.quote.totalPaise);
  const { row } = await deliveryCheckout("SRJ01", created.token, device);
  await env.db.insert(s.guestPushSubscriptions).values({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, endpointHash: device.padEnd(64, "0"), endpoint: `https://push.example/${device}`, p256dh: "key", auth: "auth", deliveryCheckoutId: row.id });
  const orderLines = await env.db.select({ id: s.orderLines.id }).from(s.orderLines).where(and(eq(s.orderLines.tenantId, env.demo.tenantId), eq(s.orderLines.sessionId, order.sessionId)));
  return orderLines.map((line) => line.id);
}

beforeAll(async () => {
  env = await resetTestDb();
  const keys = webpush.generateVAPIDKeys();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", keys.publicKey);
  vi.stubEnv("VAPID_PRIVATE_KEY", keys.privateKey);
  vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.com");
  await env.db.update(s.tenants).set({ customFeatures: { delivery: true } }).where(eq(s.tenants.id, env.demo.tenantId));
  await env.db.update(s.outlets).set({ deliveryPolicy: { ...DEFAULT_DELIVERY_POLICY, acceptingOrders: true, acceptingPickupOrders: true, pickupCodEnabled: true, pincodes: ["302001"], deliveryFeePaise: 3000 } }).where(eq(s.outlets.id, env.demo.outletId));
});
afterAll(async () => { vi.unstubAllEnvs(); await env.conn.end(); await appDb.$client.end(); });
beforeEach(() => { sendNotification.mockClear(); });

describe("telling a pickup guest their order is ready", () => {
  it("waits for the last dish, then alerts the guest once", async () => {
    const [first, second] = await placed("pickup-ready-device", "9876500021", "pickup");
    await bumpLine(kitchen(), first);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(titles().some((title) => title.includes("ready for pickup"))).toBe(false);

    await bumpLine(kitchen(), second);
    await vi.waitFor(() => expect(titles().filter((title) => title.includes("ready for pickup"))).toHaveLength(1));
  });

  it("stays quiet for delivery, whose guest next hears when the rider leaves", async () => {
    const lines = await placed("delivery-ready-device", "9876500022", "delivery");
    sendNotification.mockClear();
    for (const line of lines) await bumpLine(kitchen(), line);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(titles()).toEqual([]);
  });

  it("tells the assigned rider when a delivery is packed, instead of a table alert", async () => {
    const { tenantId, outletId } = env.demo;
    const riderId = uuidv7(), sessionId = uuidv7(), now = new Date();
    await env.db.insert(s.users).values({ id: riderId, tenantId, name: "Test Rider", phone: "9000000099", pinHash: "not-used" });
    await env.db.insert(s.staffRoles).values({ tenantId, userId: riderId, outletId, role: "rider" });
    await env.db.insert(s.staffSessions).values({ id: sessionId, tenantId, userId: riderId, outletId, tokenHash: "r".repeat(64), createdAt: now, expiresAt: new Date(now.getTime() + 3_600_000), lastSeenAt: now });
    await env.db.insert(s.staffPushSubscriptions).values({ id: uuidv7(), tenantId, outletId, userId: riderId, sessionId, endpointHash: "q".repeat(64), subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/rider-test", keys: { p256dh: "key", auth: "auth" } } });
    const lines = await placed("rider-ready-device", "9876500023", "delivery");
    await env.db.update(s.deliveryCheckouts).set({ courierUserId: riderId }).where(and(eq(s.deliveryCheckouts.tenantId, tenantId), eq(s.deliveryCheckouts.deviceId, "rider-ready-device")));
    sendNotification.mockClear();
    for (const line of lines) await bumpLine(kitchen(), line);
    // The push goes out after the kitchen's transaction, so give a busy test machine time
    await vi.waitFor(() => expect(titles()).toContain("Order ready to pick up"), { timeout: 10_000, interval: 100 });
    expect(titles()).not.toContain("Food ready to serve");
    const toRider = (sendNotification.mock.calls as unknown as [{ endpoint: string }, string][]).filter(([sub]) => sub.endpoint.endsWith("rider-test"));
    expect(toRider).toHaveLength(1);
    expect(JSON.parse(toRider[0][1])).toMatchObject({ url: "/rider", sessionId });
  });
});
