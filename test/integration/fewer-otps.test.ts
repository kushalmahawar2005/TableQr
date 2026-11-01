import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { DEFAULT_DELIVERY_POLICY } from "@/domain/delivery";
import { createDeliveryCheckout, deliveryCheckout, placeDeliveryOrder, prepaidCheckoutContact } from "@/server/delivery/checkout";
import { reconcileDeliveryPayment, startDeliveryPayment } from "@/server/delivery/payment";
import { sendDeliveryOtp, verifyDeliveryOtp } from "@/server/delivery/otp";
import { customerFor, renewCustomerSession, startCustomerSession } from "@/server/guest/customer-account";
import { tableHasVerifiedDiner } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { isRecentlyVerified, sendCode, verifyCode } from "@/server/guest/verify";
import { mockGateway } from "@/server/payments/gateway";
import { resetTestDb } from "./setup-db";

// Every SMS costs money: a phone that already proved itself, or paid online, must not be asked again.

let env: Awaited<ReturnType<typeof resetTestDb>>;
const address = { line: "12 Main Road", locality: "Jaipur", pincode: "302001", instructions: "" };
const lines = () => [{ itemId: env.demo.itemIds["Dal Makhani"], qty: 1, modifierIds: [] }];
const NOON = new Date("2026-10-01T10:00:00Z");
const policy = (paymentMode: "cod" | "gateway") => env.db.update(s.outlets).set({ deliveryPolicy: { ...DEFAULT_DELIVERY_POLICY, acceptingOrders: true, pincodes: ["302001"], deliveryFeePaise: 3000, paymentMode } }).where(eq(s.outlets.id, env.demo.outletId));

beforeAll(async () => {
  env = await resetTestDb();
  await env.db.update(s.tenants).set({ customFeatures: { delivery: true } }).where(eq(s.tenants.id, env.demo.tenantId));
  await policy("cod");
});
afterAll(async () => { await env.conn.end(); await appDb.$client.end(); });

describe("online payment replaces the code", () => {
  it("places a paid order with no SMS and links it to no guest account", async () => {
    await policy("gateway");
    const device = "prepaid-device";
    const created = await createDeliveryCheckout("SRJ01", device, { lines: lines(), address });
    await expect(prepaidCheckoutContact("SRJ01", created.token, device, "", "9876501001")).rejects.toMatchObject({ code: "invalid_name" });
    expect(await prepaidCheckoutContact("SRJ01", created.token, device, "Kiran", "9876501001")).toBe(true);

    const started = await startDeliveryPayment("SRJ01", created.token, device, "https://tableeqr.test/api/delivery/payments/return?c={checkoutId}");
    mockGateway.settle(started.checkout.kind === "form" ? started.checkout.fields.ref : "", "success");
    expect(await reconcileDeliveryPayment("SRJ01", created.token, device)).toBe("paid");

    const { row } = await deliveryCheckout("SRJ01", created.token, device);
    expect(row).toMatchObject({ status: "placed", guestId: null, verifiedAt: null, name: "Kiran", phone: "+919876501001" });
    expect(await env.db.select().from(s.deliveryOtpChallenges).where(eq(s.deliveryOtpChallenges.deviceId, device))).toHaveLength(0);
    await policy("cod");
  });

  it("still asks for a code before cash on delivery", async () => {
    const device = "cod-device";
    const created = await createDeliveryCheckout("SRJ01", device, { lines: lines(), address });
    expect(await prepaidCheckoutContact("SRJ01", created.token, device, "Kiran", "9876501002")).toBe(false);
    await expect(placeDeliveryOrder("SRJ01", created.token, device, created.quote.totalPaise)).rejects.toMatchObject({ code: "verification_required" });
  });
});

describe("editing the cart", () => {
  it("moves the live code to the new checkout instead of sending another", async () => {
    const device = "edit-cart-device";
    const first = await createDeliveryCheckout("SRJ01", device, { lines: lines(), address });
    const sent = await sendDeliveryOtp("SRJ01", first.token, device, "9876501003", new Date(), { reuseLiveCode: true });
    const second = await createDeliveryCheckout("SRJ01", device, { lines: lines(), address });
    const reused = await sendDeliveryOtp("SRJ01", second.token, device, "9876501003", new Date(), { reuseLiveCode: true });
    expect(reused.challengeId).toBe(sent.challengeId);
    expect(await env.db.select().from(s.deliveryOtpChallenges).where(eq(s.deliveryOtpChallenges.deviceId, device))).toHaveLength(1);

    const verified = await verifyDeliveryOtp("SRJ01", second.token, device, sent.challengeId, sent.devCode!, "Ravi");
    expect(verified.guestId).toBeTruthy();
    expect((await deliveryCheckout("SRJ01", second.token, device)).row.guestId).toBe(verified.guestId);
  });
});

describe("a verified phone stays signed in", () => {
  it("keeps the customer for 180 days and restarts the period on each visit", async () => {
    const [guest] = await env.db.insert(s.guests).values({ tenantId: env.demo.tenantId, phone: "+919876501004", name: "Meena" }).$returningId();
    const guestId = guest?.id ?? (await env.db.select({ id: s.guests.id }).from(s.guests).where(and(eq(s.guests.tenantId, env.demo.tenantId), eq(s.guests.phone, "+919876501004"))))[0].id;
    const now = new Date();
    const token = await startCustomerSession(env.demo.tenantId, guestId, now);
    const later = (days: number) => new Date(now.getTime() + days * 86_400_000);
    expect(await customerFor("SRJ01", token, later(179))).toMatchObject({ id: guestId });
    expect(await customerFor("SRJ01", token, later(181))).toBeNull();
    expect(await renewCustomerSession("SRJ01", token, later(100))).toBe(true);
    expect(await customerFor("SRJ01", token, later(279))).toMatchObject({ id: guestId });
  });
});

describe("at a table", () => {
  it("seats a signed-in customer with their identity and lets the table order on one verified phone", async () => {
    const [guest] = await env.db.select({ id: s.guests.id }).from(s.guests).where(and(eq(s.guests.tenantId, env.demo.tenantId), eq(s.guests.phone, "+919876501004")));
    const shortCode = env.demo.tableQr.T1;
    const first = await startOrJoinTable({ outletCode: "SRJ01", shortCode, deviceId: "table-phone-a", now: NOON });
    const ctx = { tenantId: env.demo.tenantId, sessionId: first.sessionId };
    expect(await appDb.transaction((tx) => tableHasVerifiedDiner(tx, ctx))).toBe(false);

    await startOrJoinTable({ outletCode: "SRJ01", shortCode, deviceId: "table-phone-a", customer: { guestId: guest.id, name: "Meena" }, now: NOON });
    const [me] = await env.db.select({ guestId: s.participants.guestId }).from(s.participants).where(eq(s.participants.id, first.participantId));
    expect(me.guestId).toBe(guest.id);
    expect(await appDb.transaction((tx) => tableHasVerifiedDiner(tx, ctx))).toBe(true);
  });

  it("skips the code at every table of the restaurant once this phone verified", async () => {
    const device = "moving-phone";
    const sent = await sendCode({ outletCode: "SRJ01", shortCode: env.demo.tableQr.T2, deviceId: device, country: "IN", phone: "9876501005", now: NOON });
    if (!sent.ok) throw new Error(sent.error);
    const verified = await verifyCode({ outletCode: "SRJ01", shortCode: env.demo.tableQr.T2, deviceId: device, challengeId: sent.challengeId, code: (sent as typeof sent & { devCode: string }).devCode, name: "Aarav", consent: false, now: NOON });
    expect(verified.ok).toBe(true);
    expect(await isRecentlyVerified("SRJ01", env.demo.tableQr.T3, device, NOON)).toBe(true);
  });
});
