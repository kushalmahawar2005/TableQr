import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RazorpayGateway } from "@/server/payments/gateway";

// The Razorpay adapter (test mode). No network: fetch is replaced by a recorder.

const KEY = "rzp_test_abc123";
const SECRET = "test_secret";
const HOOK = "hook_secret";
const gw = () => new RazorpayGateway(KEY, SECRET, HOOK, "https://rzp.example");

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return calls;
}

describe("Razorpay adapter", () => {
  it("refuses live keys", () => {
    expect(() => new RazorpayGateway("rzp_live_xyz", SECRET, HOOK)).toThrow(/test keys/);
  });

  it("creates the order server to server with the key pair", async () => {
    const calls = stubFetch({ id: "order_1" });
    expect(await gw().createOrder({ paymentId: "p1", amountPaise: 54100, receipt: "p1" })).toEqual({ gatewayRef: "order_1" });
    expect(calls[0].url).toBe("https://rzp.example/v1/orders");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from(`${KEY}:${SECRET}`).toString("base64")}`);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ amount: 54100, currency: "INR", notes: { payment_id: "p1" } });
  });

  it("sends the guest to Razorpay's hosted checkout; no card field ever touches our page", () => {
    const c = gw().checkout({ gatewayRef: "order_1", paymentId: "p1", amountPaise: 54100, method: "card", outletName: "Spice Route", callbackUrl: "https://t.example/api/payments/return?p=p1" });
    expect(c).toMatchObject({ method: "POST", action: "https://rzp.example/v1/checkout/embedded" });
    expect(c.fields).toMatchObject({ key_id: KEY, order_id: "order_1", callback_url: "https://t.example/api/payments/return?p=p1" });
    expect(Object.keys(c.fields).join(" ")).not.toMatch(/card\[|cvv|number|expiry/i);
    expect(JSON.stringify(c)).not.toContain(SECRET);
  });

  it("maps the order's payments to a status, never guessing failure", async () => {
    stubFetch({ items: [{ id: "pay_1", status: "captured", amount: 54100 }] });
    expect(await gw().fetchStatus("order_1")).toEqual({ status: "success", amountPaise: 54100, gatewayPaymentId: "pay_1" });
    stubFetch({ items: [{ id: "pay_1", status: "authorized", amount: 54100 }] });
    expect((await gw().fetchStatus("order_1")).status).toBe("pending");
    stubFetch({ items: [] });
    expect((await gw().fetchStatus("order_1")).status).toBe("none");
    stubFetch({ items: [{ id: "pay_1", status: "failed", amount: 54100, error_description: "Declined" }] });
    expect(await gw().fetchStatus("order_1")).toMatchObject({ status: "failed", reason: "Declined" });
  });

  it("verifies webhook signatures over the raw body", () => {
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", order_id: "order_1", amount: 54100, status: "captured" } } } });
    const good = createHmac("sha256", HOOK).update(body).digest("hex");
    expect(gw().verifyWebhook(body, good)).toBe(true);
    expect(gw().verifyWebhook(body + " ", good)).toBe(false);
    expect(gw().verifyWebhook(body, null)).toBe(false);
    expect(gw().verifyWebhook(body, createHmac("sha256", "other").update(body).digest("hex"))).toBe(false);
    expect(gw().parseWebhook(body)).toEqual({ kind: "payment", gatewayRef: "order_1", gatewayPaymentId: "pay_1", status: "success", amountPaise: 54100, reason: undefined });
    const refund = JSON.stringify({ event: "refund.processed", payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_1", amount: 27300, status: "processed" } } } });
    expect(gw().parseWebhook(refund)).toEqual({ kind: "refund", gatewayRefundId: "rfnd_1", gatewayPaymentId: "pay_1", status: "success", amountPaise: 27300 });
    expect(gw().parseWebhook(JSON.stringify({ event: "order.paid", payload: {} }))).toEqual({ kind: "ignored" });
  });

  it("asks for refunds through the gateway and reports them pending until processed", async () => {
    const calls = stubFetch({ id: "rfnd_1", status: "pending" });
    expect(await gw().refund({ gatewayPaymentId: "pay_1", amountPaise: 27300, refundId: "r1" })).toEqual({ gatewayRefundId: "rfnd_1", status: "pending" });
    expect(calls[0].url).toBe("https://rzp.example/v1/payments/pay_1/refund");
  });
});
