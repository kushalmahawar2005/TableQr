import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { DEFAULT_DELIVERY_POLICY } from "@/domain/delivery";
import { settleAtCounter } from "@/server/billing/payments";
import { createDeliveryCheckout, deliveryCheckout, deliveryStatus, placeDeliveryOrder } from "@/server/delivery/checkout";
import { reconcileDeliveryPayment, startDeliveryPayment } from "@/server/delivery/payment";
import { sendDeliveryOtp, verifyDeliveryOtp } from "@/server/delivery/otp";
import { mockGateway } from "@/server/payments/gateway";
import { advanceDelivery, deliveryQueue } from "@/server/delivery/staff";
import { getFloor } from "@/server/floor/read";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { resetTestDb } from "./setup-db";

let env: Awaited<ReturnType<typeof resetTestDb>>;
let owner: StaffSession;
const device = "delivery-test-device";
const address = { line: "12 Main Road", locality: "Jaipur", pincode: "302001", instructions: "" };
let token: string;
let total: number;
let checkoutId: string;

beforeAll(async () => {
  env = await resetTestDb();
  owner = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000001", pin: "1111" })).token))!;
  await env.db.update(s.tenants).set({ customFeatures: { delivery: true } }).where(eq(s.tenants.id, env.demo.tenantId));
  await env.db.update(s.outlets).set({ deliveryPolicy: { ...DEFAULT_DELIVERY_POLICY, acceptingOrders: true, pincodes: ["302001"], deliveryFeePaise: 3000 } }).where(eq(s.outlets.id, env.demo.outletId));
});
afterAll(async () => { await env.conn.end(); await appDb.$client.end(); });

describe("verified delivery checkout", () => {
  it("quotes from the server and binds checkout to outlet and device", async () => {
    const created = await createDeliveryCheckout("SRJ01", device, { lines: [{ itemId: env.demo.itemIds["Dal Makhani"], qty: 1, modifierIds: [] }], address });
    token = created.token;
    total = created.quote.totalPaise;
    expect(created.quote.deliveryFeePaise).toBe(3000);
    expect(total).toBeGreaterThan(3000);
    const scoped = await deliveryCheckout("SRJ01", token, device);
    checkoutId = scoped.row.id;
    await expect(deliveryCheckout("SRJ01", token, "other-device")).rejects.toMatchObject({ code: "not_found" });
    await expect(deliveryCheckout("CNJ01", token, device)).rejects.toMatchObject({ code: "not_found" });
    await expect(placeDeliveryOrder("SRJ01", token, device, total)).rejects.toMatchObject({ code: "verification_required" });
  });

  it("requires the correct one-time code and blocks a changed checkout total", async () => {
    const sent = await sendDeliveryOtp("SRJ01", token, device, "9876543210");
    expect(sent.devCode).toMatch(/^\d{4}$/);
    await expect(verifyDeliveryOtp("SRJ01", token, device, sent.challengeId, "-1", "Ravi")).rejects.toMatchObject({ code: "wrong" });
    await verifyDeliveryOtp("SRJ01", token, device, sent.challengeId, sent.devCode!, "Ravi");
    await expect(verifyDeliveryOtp("SRJ01", token, device, sent.challengeId, sent.devCode!, "Ravi")).rejects.toMatchObject({ code: "expired" });
    await expect(placeDeliveryOrder("SRJ01", token, device, total - 100)).rejects.toMatchObject({ code: "price_changed" });
    expect((await deliveryCheckout("SRJ01", token, device)).row.sessionId).toBeNull();
  });

  it("places only once, bills the fee, and keeps the hidden counter off the floor", async () => {
    const floorCount = (await getFloor(owner)).tables.length;
    const [a, b] = await Promise.all([placeDeliveryOrder("SRJ01", token, device, total), placeDeliveryOrder("SRJ01", token, device, total)]);
    expect(a.sessionId).toBe(b.sessionId);
    const [bill] = await env.db.select().from(s.bills).where(eq(s.bills.sessionId, a.sessionId));
    expect(bill.totalPaise).toBe(total);
    expect(bill.deliveryFeePaise).toBe(3000);
    expect((await getFloor(owner)).tables.length).toBe(floorCount);
    expect((await env.db.select().from(s.orders).where(eq(s.orders.sessionId, a.sessionId))).length).toBe(1);
    expect((await deliveryStatus("SRJ01", token, device)).status).toBe("placed");
    expect((await deliveryQueue(owner)).find(row => row.id === checkoutId)?.phone).toBe("+919876543210");
    await expect(advanceDelivery(owner, checkoutId, "dispatched")).rejects.toMatchObject({ code: "invalid_state" });
    await env.db.update(s.orderLines).set({ status: "ready" }).where(and(eq(s.orderLines.tenantId, env.demo.tenantId), eq(s.orderLines.sessionId, a.sessionId)));
    await advanceDelivery(owner, checkoutId, "dispatched");
    await expect(advanceDelivery(owner, checkoutId, "delivered")).rejects.toMatchObject({ code: "invalid_state" });
    await settleAtCounter(owner, { sessionId: a.sessionId, method: "cash", receivedPaise: bill.totalPaise });
    await advanceDelivery(owner, checkoutId, "delivered");
    expect((await deliveryStatus("SRJ01", token, device)).status).toBe("delivered");
  });

  it("does not place a prepaid delivery until the restaurant gateway confirms payment, then settles its bill", async () => {
    const gatewayDevice = "delivery-gateway-device";
    await env.db.update(s.outlets).set({ deliveryPolicy: { ...DEFAULT_DELIVERY_POLICY, acceptingOrders: true, pincodes: ["302001"], deliveryFeePaise: 3000, paymentMode: "gateway" } }).where(eq(s.outlets.id, env.demo.outletId));
    const created = await createDeliveryCheckout("SRJ01", gatewayDevice, { lines: [{ itemId: env.demo.itemIds["Dal Makhani"], qty: 1, modifierIds: [] }], address });
    const scoped = await deliveryCheckout("SRJ01", created.token, gatewayDevice);
    const otp = await sendDeliveryOtp("SRJ01", created.token, gatewayDevice, "9876543211");
    await verifyDeliveryOtp("SRJ01", created.token, gatewayDevice, otp.challengeId, otp.devCode!, "Kiran");
    await expect(placeDeliveryOrder("SRJ01", created.token, gatewayDevice, created.quote.totalPaise)).rejects.toMatchObject({ code: "invalid_state" });

    const started = await startDeliveryPayment("SRJ01", created.token, gatewayDevice, "https://tableqr.test/api/delivery/payments/return?c={checkoutId}");
    const gatewayRef = started.checkout.kind === "form" ? started.checkout.fields.ref : "";
    expect(gatewayRef).toMatch(/^mock_/);
    expect((await deliveryCheckout("SRJ01", created.token, gatewayDevice)).row.sessionId).toBeNull();

    mockGateway.settle(gatewayRef, "success");
    expect(await reconcileDeliveryPayment("SRJ01", created.token, gatewayDevice)).toBe("paid");
    const completed = await deliveryCheckout("SRJ01", created.token, gatewayDevice);
    expect(completed.row.sessionId).toBeTruthy();
    expect(completed.row.paymentStatus).toBe("paid");
    const [bill] = await env.db.select().from(s.bills).where(eq(s.bills.sessionId, completed.row.sessionId!));
    const [payment] = await env.db.select().from(s.payments).where(eq(s.payments.id, scoped.row.id));
    expect(bill.status).toBe("paid");
    expect(bill.totalPaise).toBe(created.quote.totalPaise);
    expect(payment).toMatchObject({ status: "success", channel: "mock", gatewayRef, amountPaise: created.quote.totalPaise });
    expect((await deliveryStatus("SRJ01", created.token, gatewayDevice)).paid).toBe(true);
  });
});
