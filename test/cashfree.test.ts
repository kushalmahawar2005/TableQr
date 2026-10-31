import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CashfreeConfigError, CashfreeGateway, currencyAccepted, gatewayByName, gatewayFor, parseCashfreeConfig, platformGateway } from "@/server/payments/gateway";

const CLIENT_ID = "cashfree_client_123";
const CLIENT_SECRET = "cashfree_secret_123";
const gw = () => new CashfreeGateway(CLIENT_ID, CLIENT_SECRET, "sandbox", "https://cashfree.example/pg", "2026-01-01");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubFetch(...bodies: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(bodies.shift()), { status: 200 });
  });
  return calls;
}

describe("Cashfree platform gateway", () => {
  it("creates a rupee-denominated order server to server and returns only hosted-checkout data", async () => {
    const calls = stubFetch({ order_id: "fee_1" }, { payment_session_id: "session_1" });
    expect(await gw().createOrder({
      paymentId: "fee_1",
      amountPaise: 54100,
      receipt: "Tableeqr 3m",
      callbackUrl: "https://tableeqr.example/api/fees/return?p=fee_1",
      notifyUrl: "https://tableeqr.example/api/fees/cashfree/webhook",
      customer: { id: "tenant_1", phone: "+91 98765 43210", name: "Spice Route" },
    })).toEqual({ gatewayRef: "fee_1" });
    expect(calls[0].url).toBe("https://cashfree.example/pg/orders");
    expect(calls[0].init.headers).toMatchObject({ "x-client-id": CLIENT_ID, "x-client-secret": CLIENT_SECRET, "x-api-version": "2026-01-01", "x-idempotency-key": "fee_1" });
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      order_id: "fee_1",
      order_amount: 541,
      order_currency: "INR",
      customer_details: { customer_id: "tenant_1", customer_phone: "9876543210", customer_name: "Spice Route" },
      order_meta: { return_url: "https://tableeqr.example/api/fees/return?p=fee_1", notify_url: "https://tableeqr.example/api/fees/cashfree/webhook" },
    });

    const checkout = await gw().checkout({ gatewayRef: "fee_1", paymentId: "fee_1", amountPaise: 54100, method: "upi", outletName: "Tableeqr", callbackUrl: "https://tableeqr.example/return" });
    expect(checkout).toEqual({ provider: "cashfree", kind: "cashfree", mode: "sandbox", paymentSessionId: "session_1" });
    expect(JSON.stringify(checkout)).not.toContain(CLIENT_ID);
    expect(JSON.stringify(checkout)).not.toContain(CLIENT_SECRET);
  });

  it("maps Cashfree payment attempts without trusting a browser redirect", async () => {
    stubFetch([{ cf_payment_id: 123, payment_status: "SUCCESS", payment_amount: 541, payment_currency: "INR" }]);
    expect(await gw().fetchStatus("fee_1")).toEqual({ status: "success", amountPaise: 54100, currency: "INR", gatewayPaymentId: "123" });
    stubFetch([{ cf_payment_id: 124, payment_status: "PENDING", payment_amount: 541 }]);
    expect((await gw().fetchStatus("fee_1")).status).toBe("pending");
    stubFetch([]);
    expect((await gw().fetchStatus("fee_1")).status).toBe("none");
    stubFetch([{ cf_payment_id: 125, payment_status: "FAILED", payment_amount: 541, payment_message: "Declined" }]);
    expect(await gw().fetchStatus("fee_1")).toMatchObject({ status: "failed", gatewayPaymentId: "125", reason: "Declined" });
  });

  it("verifies Cashfree's timestamp-plus-raw-body signature and parses payment events", () => {
    const body = JSON.stringify({
      type: "PAYMENT_SUCCESS_WEBHOOK",
      data: { order: { order_id: "fee_1" }, payment: { cf_payment_id: 123, payment_status: "SUCCESS", payment_amount: 541, payment_currency: "INR" } },
    });
    const timestamp = "1792588800";
    const signature = createHmac("sha256", CLIENT_SECRET).update(`${timestamp}${body}`).digest("base64");
    expect(gw().verifyWebhook(body, signature, timestamp)).toBe(true);
    expect(gw().verifyWebhook(`${body} `, signature, timestamp)).toBe(false);
    expect(gw().verifyWebhook(body, signature, null)).toBe(false);
    expect(gw().parseWebhook(body)).toEqual({ kind: "payment", gatewayRef: "fee_1", gatewayPaymentId: "123", status: "success", amountPaise: 54100, currency: "INR", reason: undefined });
  });

  it("reports the currency of a success, and a success that names none is not taken for rupees", async () => {
    stubFetch([{ cf_payment_id: 7, payment_status: "SUCCESS", payment_amount: 541, payment_currency: "USD" }]);
    const usd = await gw().fetchStatus("fee_1");
    expect(usd).toMatchObject({ status: "success", currency: "USD" });
    expect(currencyAccepted(usd.currency)).toBe(false);
    stubFetch([{ cf_payment_id: 8, payment_status: "SUCCESS", payment_amount: 541 }]);
    const none = await gw().fetchStatus("fee_1");
    expect(none.currency).toBe("");
    expect(currencyAccepted(none.currency)).toBe(false);

    const hook = (currency?: string) => gw().parseWebhook(JSON.stringify({
      type: "PAYMENT_SUCCESS_WEBHOOK",
      data: { order: { order_id: "fee_1" }, payment: { cf_payment_id: 9, payment_status: "SUCCESS", payment_amount: 541, ...(currency ? { payment_currency: currency } : {}) } },
    }));
    expect(hook("inr")).toMatchObject({ currency: "inr" });
    expect(currencyAccepted((hook("inr") as { currency?: string }).currency)).toBe(true);
    expect(currencyAccepted((hook("USD") as { currency?: string }).currency)).toBe(false);
    expect(currencyAccepted((hook() as { currency?: string }).currency)).toBe(false);
    // The mock gateway names no currency and is not asked for one
    expect(currencyAccepted(undefined)).toBe(true);
  });

  it("keeps the Tableeqr Cashfree account out of restaurant guest payments", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CASHFREE_MODE", "sandbox");
    vi.stubEnv("CASHFREE_CLIENT_ID", CLIENT_ID);
    vi.stubEnv("CASHFREE_CLIENT_SECRET", CLIENT_SECRET);
    expect(gatewayFor()?.name).toBe("mock");
    expect(gatewayByName("cashfree")).toBeNull();
    expect(platformGateway()?.name).toBe("cashfree");
  });

  it("creates and reads refunds against the original order", async () => {
    stubFetch({ refund_id: "refund_1", refund_status: "PENDING" }, { refund_status: "SUCCESS", refund_amount: 541 });
    expect(await gw().refund({ gatewayRef: "fee_1", gatewayPaymentId: "123", amountPaise: 54100, refundId: "rf_1" })).toEqual({
      gatewayRefundId: "refund_1",
      status: "pending",
    });
    expect(await gw().fetchRefund({ gatewayRef: "fee_1", gatewayRefundId: "refund_1" })).toEqual({ status: "success", amountPaise: 54100 });
  });

  it("parses refund webhooks and ignores still-pending ones", () => {
    expect(gw().parseWebhook(JSON.stringify({
      type: "REFUND_STATUS_WEBHOOK",
      data: { refund: { refund_id: "refund_1", cf_payment_id: 123, refund_status: "SUCCESS", refund_amount: 541 } },
    }))).toEqual({ kind: "refund", gatewayRefundId: "refund_1", gatewayPaymentId: "123", status: "success", amountPaise: 54100 });
    expect(gw().parseWebhook(JSON.stringify({
      type: "REFUND_STATUS_WEBHOOK",
      data: { refund: { refund_id: "refund_1", refund_status: "PENDING", refund_amount: 541 } },
    }))).toEqual({ kind: "ignored" });
  });

  it("refuses a production return URL that is not HTTPS", async () => {
    const live = new CashfreeGateway(CLIENT_ID, CLIENT_SECRET, "production");
    await expect(live.createOrder({
      paymentId: "fee_1",
      amountPaise: 100,
      receipt: "Tableeqr 1m",
      callbackUrl: "http://tableeqr.example/api/fees/return?p=fee_1",
    })).rejects.toThrow(/HTTPS/);
  });
});

describe("Cashfree configuration", () => {
  it("is optional, validates pairs and defaults to sandbox outside production", () => {
    expect(parseCashfreeConfig({ NODE_ENV: "production" })).toBeNull();
    expect(parseCashfreeConfig({ NODE_ENV: "development", CASHFREE_CLIENT_ID: CLIENT_ID, CASHFREE_CLIENT_SECRET: CLIENT_SECRET })).toMatchObject({ mode: "sandbox", apiBase: "https://sandbox.cashfree.com/pg", apiVersion: "2026-01-01" });
    expect(() => parseCashfreeConfig({ CASHFREE_CLIENT_ID: CLIENT_ID })).toThrow(CashfreeConfigError);
  });

  it("requires an explicit mode in production and never accepts production mode locally", () => {
    expect(() => parseCashfreeConfig({ NODE_ENV: "production", CASHFREE_CLIENT_ID: CLIENT_ID, CASHFREE_CLIENT_SECRET: CLIENT_SECRET })).toThrow(/CASHFREE_MODE must be set/);
    expect(parseCashfreeConfig({ NODE_ENV: "production", CASHFREE_MODE: "production", CASHFREE_CLIENT_ID: CLIENT_ID, CASHFREE_CLIENT_SECRET: CLIENT_SECRET })?.apiBase).toBe("https://api.cashfree.com/pg");
    expect(() => parseCashfreeConfig({ NODE_ENV: "development", CASHFREE_MODE: "production", CASHFREE_CLIENT_ID: CLIENT_ID, CASHFREE_CLIENT_SECRET: CLIENT_SECRET })).toThrow(/only allowed when NODE_ENV is production/);
  });
});
