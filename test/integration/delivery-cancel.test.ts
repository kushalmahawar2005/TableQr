import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { DEFAULT_DELIVERY_POLICY } from "@/domain/delivery";
import { settleAtCounter } from "@/server/billing/payments";
import { claimManualQrDeliveryPayment, confirmManualQrDeliveryPayment, createDeliveryCheckout, deliveryCheckout, deliveryStatus, placeDeliveryOrder } from "@/server/delivery/checkout";
import { sendDeliveryOtp, verifyDeliveryOtp } from "@/server/delivery/otp";
import { advanceDelivery, cancelDeliveryOrder, deliveryQueue } from "@/server/delivery/staff";
import { processRefund } from "@/server/billing/refunds";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { resetTestDb } from "./setup-db";

// The restaurant cancels a placed delivery: items stop, the counter closes, paid money goes back.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let owner: StaffSession;
let cashier: StaffSession;
const address = { line: "12 Main Road", locality: "Jaipur", pincode: "302001", instructions: "" };
const staffAs = async (phone: string, pin: string) => (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone, pin })).token))!;

async function placed(device: string, phone: string) {
  const created = await createDeliveryCheckout("SRJ01", device, { lines: [{ itemId: env.demo.itemIds["Dal Makhani"], qty: 1, modifierIds: [] }], address });
  const sent = await sendDeliveryOtp("SRJ01", created.token, device, phone);
  await verifyDeliveryOtp("SRJ01", created.token, device, sent.challengeId, sent.devCode!, "Ravi");
  const order = await placeDeliveryOrder("SRJ01", created.token, device, created.quote.totalPaise);
  const { row } = await deliveryCheckout("SRJ01", created.token, device);
  return { ...created, sessionId: order.sessionId, id: row.id, device };
}

beforeAll(async () => {
  env = await resetTestDb();
  owner = await staffAs("9000000001", "1111");
  cashier = await staffAs("9000000003", "3333");
  await env.db.update(s.tenants).set({ customFeatures: { delivery: true } }).where(eq(s.tenants.id, env.demo.tenantId));
  await env.db.update(s.outlets).set({ deliveryPolicy: { ...DEFAULT_DELIVERY_POLICY, acceptingOrders: true, pincodes: ["302001"], deliveryFeePaise: 3000 } }).where(eq(s.outlets.id, env.demo.outletId));
});
afterAll(async () => { await env.conn.end(); await appDb.$client.end(); });

describe("cancelling a delivery order", () => {
  it("cancels an unpaid order: items stop, the counter closes, it leaves the queue, a repeat is harmless", async () => {
    const o = await placed("dc-a", "9876500001");
    await expect(cancelDeliveryOrder(cashier, o.id, "Customer unreachable")).rejects.toThrow(/cannot use/);
    await expect(cancelDeliveryOrder(owner, o.id, "")).rejects.toMatchObject({ code: "invalid_state" });
    await cancelDeliveryOrder(owner, o.id, "Customer unreachable");
    expect((await deliveryStatus("SRJ01", o.token, o.device)).status).toBe("cancelled");
    const lines = await env.db.select({ status: s.orderLines.status }).from(s.orderLines).where(eq(s.orderLines.sessionId, o.sessionId));
    expect(lines.every((l) => l.status === "cancelled")).toBe(true);
    const [session] = await env.db.select({ status: s.tableSessions.status }).from(s.tableSessions).where(eq(s.tableSessions.id, o.sessionId));
    expect(session.status).toBe("closed");
    expect((await deliveryQueue(owner)).some((r) => r.id === o.id && r.status === "cancelled")).toBe(false);
    expect((await cancelDeliveryOrder(owner, o.id, "Customer unreachable")).replayed).toBe(true);
    expect(await env.db.select().from(s.refunds)).toHaveLength(0);
  });

  it("sends back what was already paid, once, and never cancels a delivered order", async () => {
    const o = await placed("dc-b", "9876500002");
    await settleAtCounter(owner, { sessionId: o.sessionId, method: "cash", receivedPaise: o.quote.totalPaise });
    const first = await cancelDeliveryOrder(owner, o.id, "Kitchen out of stock");
    expect(first.refunds).toHaveLength(1);
    expect(await deliveryStatus("SRJ01", o.token, o.device)).toMatchObject({
      status: "cancelled", paid: false, paymentStatus: "refunded", refundStatus: "success",
    });
    await cancelDeliveryOrder(owner, o.id, "Kitchen out of stock");
    const refunds = await env.db.select().from(s.refunds);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amountPaise: o.quote.totalPaise, status: "success" });

    const d = await placed("dc-c", "9876500003");
    await env.db.update(s.orderLines).set({ status: "ready" }).where(eq(s.orderLines.sessionId, d.sessionId));
    await advanceDelivery(owner, d.id, "dispatched");
    await settleAtCounter(owner, { sessionId: d.sessionId, method: "cash", receivedPaise: d.quote.totalPaise });
    await advanceDelivery(owner, d.id, "delivered");
    await expect(cancelDeliveryOrder(owner, d.id, "Too late")).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("keeps a restaurant QR refund pending until staff confirms the money was returned", async () => {
    const device = "dc-manual-qr";
    await env.db.update(s.outlets).set({
      bookingPaymentQrUrl: "https://assets.tableeqr.test/restaurant-qr.png",
      deliveryPolicy: { ...DEFAULT_DELIVERY_POLICY, acceptingOrders: true, pincodes: ["302001"], paymentMode: "manual_qr" },
    }).where(eq(s.outlets.id, env.demo.outletId));
    const created = await createDeliveryCheckout("SRJ01", device, { lines: [{ itemId: env.demo.itemIds["Dal Makhani"], qty: 1, modifierIds: [] }], address });
    const otp = await sendDeliveryOtp("SRJ01", created.token, device, "9876500004");
    await verifyDeliveryOtp("SRJ01", created.token, device, otp.challengeId, otp.devCode!, "Ravi");
    await claimManualQrDeliveryPayment("SRJ01", created.token, device, created.quote.totalPaise, "UPI202611010004");
    const checkout = await deliveryCheckout("SRJ01", created.token, device);
    await confirmManualQrDeliveryPayment(owner, checkout.row.id);

    const result = await cancelDeliveryOrder(owner, checkout.row.id, "Customer unreachable");
    expect(result.refunds).toHaveLength(1);
    expect(result.refunds[0].status).toBe("pending");
    expect(await deliveryStatus("SRJ01", created.token, device)).toMatchObject({
      status: "cancelled", paid: false, paymentStatus: "refund_pending", refundStatus: "pending",
    });

    const [refund] = await env.db.select().from(s.refunds);
    expect((await processRefund(owner, refund.id)).status).toBe("success");
    expect(await deliveryStatus("SRJ01", created.token, device)).toMatchObject({
      status: "cancelled", paid: false, paymentStatus: "refunded", refundStatus: "success",
    });
  });
});
