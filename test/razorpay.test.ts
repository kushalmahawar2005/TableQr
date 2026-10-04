import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RazorpayConfigError, RazorpayGateway, gatewayFor, parseRazorpayConfig } from "@/server/payments/gateway";

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
  it("refuses a key that is not a Razorpay test or live key", () => {
    for (const bad of ["rzp_live_xyz", "key_abc123456", "", "rzp_test_", "rzp_prod_abc123456"]) expect(() => new RazorpayGateway(bad, SECRET, HOOK)).toThrow(RazorpayConfigError);
    expect(() => new RazorpayGateway("rzp_live_abc123XYZ", SECRET, HOOK)).not.toThrow();
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

describe("Razorpay configuration", () => {
  const TEST = { RAZORPAY_KEY_ID: "rzp_test_abc123", RAZORPAY_KEY_SECRET: "test_secret", RAZORPAY_WEBHOOK_SECRET: "hook_secret" };
  const LIVE = { RAZORPAY_KEY_ID: "rzp_live_abc123", RAZORPAY_KEY_SECRET: "live_secret_value", RAZORPAY_WEBHOOK_SECRET: "live_hook_secret" };
  const bad = (env: Record<string, string | undefined>, why: RegExp) => expect(() => parseRazorpayConfig(env)).toThrow(why);

  it("not configured at all means online payment is simply off", () => {
    expect(parseRazorpayConfig({ NODE_ENV: "production" })).toBeNull();
    expect(parseRazorpayConfig({ RAZORPAY_KEY_ID: " ", RAZORPAY_KEY_SECRET: "" })).toBeNull();
  });

  it("test keys are accepted outside production, with or without naming the mode", () => {
    expect(parseRazorpayConfig({ ...TEST, NODE_ENV: "development" })?.mode).toBe("test");
    expect(parseRazorpayConfig({ ...TEST, NODE_ENV: "test", RAZORPAY_MODE: "test" })?.mode).toBe("test");
    expect(parseRazorpayConfig({ ...TEST, NODE_ENV: "development", RAZORPAY_API_BASE: "https://rzp.example" })?.apiBase).toBe("https://rzp.example");
  });

  it("production must say which mode it is: a staging site on test keys, or live", () => {
    bad({ ...TEST, NODE_ENV: "production" }, /RAZORPAY_MODE must be set/);
    expect(parseRazorpayConfig({ ...TEST, NODE_ENV: "production", RAZORPAY_MODE: "test" })?.mode).toBe("test");
    bad({ ...LIVE, NODE_ENV: "production" }, /RAZORPAY_MODE must be set/);
    expect(parseRazorpayConfig({ ...LIVE, NODE_ENV: "production", RAZORPAY_MODE: "live" })).toMatchObject({ mode: "live", keyId: "rzp_live_abc123", webhookSecret: "live_hook_secret" });
  });

  it("a test key is never run as live and a live key never as test", () => {
    bad({ ...TEST, NODE_ENV: "production", RAZORPAY_MODE: "live" }, /"live" but the key is a test key/);
    bad({ ...LIVE, NODE_ENV: "production", RAZORPAY_MODE: "test" }, /"test" but the key is a live key/);
    bad({ ...LIVE, NODE_ENV: "development" }, /live keys are only allowed/);
    bad({ ...LIVE, NODE_ENV: "development", RAZORPAY_MODE: "live" }, /live keys are only allowed/);
    bad({ ...LIVE, NODE_ENV: "test" }, /live keys are only allowed/);
  });

  it("malformed or incomplete settings fail fast with a clear error", () => {
    bad({ ...TEST, RAZORPAY_KEY_ID: "abc" }, /must look like rzp_test_/);
    bad({ ...TEST, RAZORPAY_KEY_ID: "rzp_live_" }, /must look like/);
    bad({ ...TEST, RAZORPAY_KEY_SECRET: "" }, /must be set together/);
    bad({ RAZORPAY_KEY_SECRET: "test_secret" }, /must be set together/);
    bad({ ...TEST, RAZORPAY_KEY_SECRET: "short" }, /too short/);
    bad({ ...TEST, RAZORPAY_MODE: "sandbox" }, /must be "test" or "live"/);
    bad({ ...LIVE, NODE_ENV: "production", RAZORPAY_MODE: "live", RAZORPAY_WEBHOOK_SECRET: "" }, /RAZORPAY_WEBHOOK_SECRET is required/);
    bad({ ...LIVE, NODE_ENV: "production", RAZORPAY_MODE: "live", RAZORPAY_API_BASE: "https://evil.example" }, /cannot be changed for live keys/);
  });

  it("gatewayFor throws the configuration error instead of silently falling back", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RAZORPAY_KEY_ID", LIVE.RAZORPAY_KEY_ID);
    vi.stubEnv("RAZORPAY_KEY_SECRET", LIVE.RAZORPAY_KEY_SECRET);
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", LIVE.RAZORPAY_WEBHOOK_SECRET);
    vi.stubEnv("RAZORPAY_MODE", "test");
    expect(() => gatewayFor()).toThrow(RazorpayConfigError);
    vi.stubEnv("RAZORPAY_MODE", "live");
    expect(gatewayFor()?.name).toBe("razorpay");
    vi.unstubAllEnvs();
  });

  it("the live gateway keeps webhook verification, and the checkout form carries only the key id", () => {
    const live = new RazorpayGateway(LIVE.RAZORPAY_KEY_ID, LIVE.RAZORPAY_KEY_SECRET, LIVE.RAZORPAY_WEBHOOK_SECRET);
    const body = JSON.stringify({ event: "refund.processed", payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_1", amount: 5000, status: "processed" } } } });
    const sign = (secret: string) => createHmac("sha256", secret).update(body).digest("hex");
    expect(live.verifyWebhook(body, sign(LIVE.RAZORPAY_WEBHOOK_SECRET))).toBe(true);
    expect(live.verifyWebhook(body, sign("another_secret"))).toBe(false);
    expect(live.verifyWebhook(body + " ", sign(LIVE.RAZORPAY_WEBHOOK_SECRET))).toBe(false);
    expect(live.verifyWebhook(body, null)).toBe(false);
    expect(new RazorpayGateway(LIVE.RAZORPAY_KEY_ID, LIVE.RAZORPAY_KEY_SECRET, "").verifyWebhook(body, sign(""))).toBe(false);
    const fields = JSON.stringify(live.checkout({ gatewayRef: "order_1", paymentId: "p1", amountPaise: 1000, method: "upi", outletName: "Spice Route", callbackUrl: "https://t.example/r" }));
    expect(fields).toContain(LIVE.RAZORPAY_KEY_ID);
    expect(fields).not.toContain(LIVE.RAZORPAY_KEY_SECRET);
    expect(fields).not.toContain(LIVE.RAZORPAY_WEBHOOK_SECRET);
  });

  it("fetches a refund's state from the gateway", async () => {
    stubFetch({ status: "processed" });
    expect(await gw().fetchRefund("rfnd_1")).toEqual({ status: "success" });
    stubFetch({ status: "failed" });
    expect(await gw().fetchRefund("rfnd_1")).toEqual({ status: "failed" });
    stubFetch({ status: "created" });
    expect(await gw().fetchRefund("rfnd_1")).toEqual({ status: "pending" });
  });
});
