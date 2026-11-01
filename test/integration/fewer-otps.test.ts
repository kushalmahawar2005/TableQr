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
import { addConfiguredLine } from "@/server/guest/cart";
import { getGuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import { completeServiceRequest } from "@/server/guest/service-requests";
import { rejectTableOrder, requestTableConfirmation } from "@/server/guest/table-confirmation";
import { AppError } from "@/server/errors";
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

describe("a returning guest at a table", () => {
  const staff = () => ({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, userId: env.demo.staffIds.owner });
  const guestId = async () => (await env.db.select({ id: s.guests.id }).from(s.guests).where(and(eq(s.guests.tenantId, env.demo.tenantId), eq(s.guests.phone, "+919876501004"))))[0].id;

  async function seated(table: string, device: string) {
    const shortCode = env.demo.tableQr[table];
    const seat = await startOrJoinTable({ outletCode: "SRJ01", shortCode, deviceId: device, customer: { guestId: await guestId(), name: "Meena" } });
    const ctx = await getGuestContext("SRJ01", shortCode, seat.participantId, device);
    await addConfiguredLine(ctx, { itemId: env.demo.itemIds.Cola, qty: 1, modifierIds: [] });
    return { ctx, seat };
  }
  const refused = (ctx: Awaited<ReturnType<typeof getGuestContext>>) => placeOrder(ctx, {}).then(() => null, (error: AppError) => error.code);
  const orders = (sessionId: string) => env.db.select({ id: s.orders.id }).from(s.orders).where(eq(s.orders.sessionId, sessionId));
  const confirmation = async (sessionId: string) => (await env.db.select().from(s.serviceRequests).where(and(eq(s.serviceRequests.sessionId, sessionId), eq(s.serviceRequests.kind, "confirm_order"))))[0];

  it("holds the first order for staff, then accepting sends it to the kitchen and trusts the table", async () => {
    const { ctx, seat } = await seated("T4", "returning-a");
    expect(await refused(ctx)).toBe("needs_table_confirmation");
    await requestTableConfirmation(ctx, { requestId: "returning-a-1" });
    await requestTableConfirmation(ctx, { requestId: "returning-a-2" });
    expect(await orders(seat.sessionId)).toHaveLength(0);

    await completeServiceRequest(staff(), (await confirmation(seat.sessionId)).id);
    expect(await orders(seat.sessionId)).toHaveLength(1);

    await addConfiguredLine(ctx, { itemId: env.demo.itemIds.Cola, qty: 1, modifierIds: [] });
    await placeOrder(ctx, {});
    expect(await orders(seat.sessionId)).toHaveLength(2);
  });

  it("frees an empty table when staff reject, and can block the number", async () => {
    const { ctx, seat } = await seated("T5", "returning-b");
    await requestTableConfirmation(ctx, { requestId: "returning-b-1" });
    await rejectTableOrder(staff(), (await confirmation(seat.sessionId)).id, { block: true });
    const [visit] = await env.db.select({ status: s.tableSessions.status }).from(s.tableSessions).where(eq(s.tableSessions.id, seat.sessionId));
    const [table] = await env.db.select({ state: s.diningTables.state }).from(s.diningTables).where(eq(s.diningTables.id, env.demo.tableIds.T5));
    expect(visit.status).toBe("closed");
    expect(table.state).toBe("available");
    expect(await orders(seat.sessionId)).toHaveLength(0);

    const again = await seated("T6", "returning-c");
    expect(await refused(again.ctx)).toBe("guest_blocked");
    await env.db.update(s.guests).set({ blockedAt: null }).where(eq(s.guests.id, await guestId()));
  });

  it("lets a phone that just verified at the table order straight away", async () => {
    const device = "first-timer";
    const shortCode = env.demo.tableQr.T7;
    const sent = await sendCode({ outletCode: "SRJ01", shortCode, deviceId: device, country: "IN", phone: "9876501006" });
    if (!sent.ok) throw new Error(sent.error);
    await verifyCode({ outletCode: "SRJ01", shortCode, deviceId: device, challengeId: sent.challengeId, code: (sent as typeof sent & { devCode: string }).devCode, name: "Aarav", consent: false });
    const seat = await startOrJoinTable({ outletCode: "SRJ01", shortCode, deviceId: device });
    const ctx = await getGuestContext("SRJ01", shortCode, seat.participantId, device);
    await addConfiguredLine(ctx, { itemId: env.demo.itemIds.Cola, qty: 1, modifierIds: [] });
    await placeOrder(ctx, {});
    expect(await orders(seat.sessionId)).toHaveLength(1);
  });
});

describe("the first order of every guest-opened table", () => {
  it("waits for staff after a fresh code, and then the rest of the table orders freely", async () => {
    await env.db.update(s.outlets).set({ confirmFirstTableOrder: true }).where(eq(s.outlets.id, env.demo.outletId));
    const device = "checked-first-timer", shortCode = env.demo.tableQr.T8;
    const sent = await sendCode({ outletCode: "SRJ01", shortCode, deviceId: device, country: "IN", phone: "9876501008" });
    if (!sent.ok) throw new Error(sent.error);
    await verifyCode({ outletCode: "SRJ01", shortCode, deviceId: device, challengeId: sent.challengeId, code: (sent as typeof sent & { devCode: string }).devCode, name: "Aarav", consent: false });
    const seat = await startOrJoinTable({ outletCode: "SRJ01", shortCode, deviceId: device });
    const ctx = await getGuestContext("SRJ01", shortCode, seat.participantId, device);
    await addConfiguredLine(ctx, { itemId: env.demo.itemIds.Cola, qty: 1, modifierIds: [] });
    await expect(placeOrder(ctx, {})).rejects.toMatchObject({ code: "needs_table_confirmation" });
    await requestTableConfirmation(ctx, { requestId: "checked-1" });

    const [request] = await env.db.select().from(s.serviceRequests).where(and(eq(s.serviceRequests.sessionId, seat.sessionId), eq(s.serviceRequests.kind, "confirm_order")));
    await completeServiceRequest({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, userId: env.demo.staffIds.owner }, request.id);
    expect(await env.db.select({ id: s.orders.id }).from(s.orders).where(eq(s.orders.sessionId, seat.sessionId))).toHaveLength(1);

    await startOrJoinTable({ outletCode: "SRJ01", shortCode, deviceId: device });
    await addConfiguredLine(ctx, { itemId: env.demo.itemIds.Cola, qty: 1, modifierIds: [] });
    await placeOrder(ctx, {});
    expect(await env.db.select({ id: s.orders.id }).from(s.orders).where(eq(s.orders.sessionId, seat.sessionId))).toHaveLength(2);
    await env.db.update(s.outlets).set({ confirmFirstTableOrder: false }).where(eq(s.outlets.id, env.demo.outletId));
  });
});

describe("cash limits", () => {
  it("limits a new customer's first cash order and refuses a blocked number", async () => {
    const device = "cash-limit-device";
    await env.db.update(s.outlets).set({ deliveryPolicy: { ...DEFAULT_DELIVERY_POLICY, acceptingOrders: true, pincodes: ["302001"], deliveryFeePaise: 3000, firstCashLimitPaise: 1000 } }).where(eq(s.outlets.id, env.demo.outletId));
    const created = await createDeliveryCheckout("SRJ01", device, { lines: lines(), address });
    const sent = await sendDeliveryOtp("SRJ01", created.token, device, "9876501007");
    const verified = await verifyDeliveryOtp("SRJ01", created.token, device, sent.challengeId, sent.devCode!, "Ravi");
    await expect(placeDeliveryOrder("SRJ01", created.token, device, created.quote.totalPaise)).rejects.toMatchObject({ details: { reason: "first_cash_limit" } });
    await env.db.update(s.guests).set({ blockedAt: new Date() }).where(eq(s.guests.id, verified.guestId));
    await expect(placeDeliveryOrder("SRJ01", created.token, device, created.quote.totalPaise)).rejects.toMatchObject({ code: "guest_blocked" });
    await policy("cod");
  });
});
