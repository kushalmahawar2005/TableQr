import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { uuidv7 } from "@/db/id";
import type { Checkout, FormCheckout } from "@/lib/payments/checkout";

// Payment gateway boundary (PS 6.4). Each restaurant connects its own gateway account and money
// settles straight to them; TableQR never holds guest funds or sees card numbers: the guest pays
// on the gateway's hosted page. A payment counts as paid only when the gateway itself says so,
// through a signed webhook or a server-to-server status check, never because a browser came back.

/** "none": the order exists but no payment was attempted on it (the guest cancelled or closed the page) */
export type GatewayStatus = "pending" | "success" | "failed" | "none";

export type CheckoutInput = {
  gatewayRef: string;
  paymentId: string;
  amountPaise: number;
  method: "upi" | "card" | "wallet";
  outletName: string;
  /** Absolute URL the gateway sends the guest back to */
  callbackUrl: string;
};

export type WebhookEvent =
  | { kind: "payment"; gatewayRef: string; gatewayPaymentId: string; status: "success" | "failed"; amountPaise: number; currency?: string; reason?: string }
  | { kind: "refund"; gatewayRefundId: string; gatewayPaymentId: string; status: "success" | "failed"; amountPaise: number }
  | { kind: "ignored" };

export interface PaymentGateway {
  readonly name: string;
  createOrder(input: {
    paymentId: string;
    amountPaise: number;
    receipt: string;
    callbackUrl?: string;
    notifyUrl?: string;
    customer?: { id?: string; phone?: string | null; name?: string | null; email?: string | null };
  }): Promise<{ gatewayRef: string }>;
  checkout(input: CheckoutInput): Checkout | Promise<Checkout>;
  fetchStatus(gatewayRef: string): Promise<{ status: GatewayStatus; amountPaise: number; currency?: string; gatewayPaymentId?: string; reason?: string }>;
  refund(input: { gatewayRef: string; gatewayPaymentId: string; amountPaise: number; refundId: string }): Promise<{ gatewayRefundId: string; status: "pending" | "success" | "failed" }>;
  /** Where a refund stands at the gateway; used to settle a refund whose webhook was missed */
  fetchRefund(input: { gatewayRef: string; gatewayRefundId: string }): Promise<{ status: "pending" | "success" | "failed" }>;
  /** Checks the webhook signature over the exact raw body */
  verifyWebhook(rawBody: string, signature: string | null, timestamp?: string | null): boolean;
  parseWebhook(rawBody: string): WebhookEvent;
}

/** Every order TableQR creates is in rupees, so a success in any other currency is never taken as paid */
export const PAYMENT_CURRENCY = "INR";
/** A gateway that reports a currency must report rupees; one that reports none (the mock) is not asked */
export const currencyAccepted = (currency?: string) => currency === undefined || currency.trim().toUpperCase() === PAYMENT_CURRENCY;

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
};

export type CashfreeMode = "sandbox" | "production";
export type CashfreeConfig = {
  mode: CashfreeMode;
  clientId: string;
  clientSecret: string;
  apiBase: string;
  apiVersion: string;
};

export class CashfreeConfigError extends Error {
  constructor(message: string) {
    super(`Cashfree configuration error: ${message}`);
    this.name = "CashfreeConfigError";
  }
}

/** Reads Cashfree credentials without ever exposing the secret to a Client Component. */
export function parseCashfreeConfig(env: Record<string, string | undefined>): CashfreeConfig | null {
  const clientId = env.CASHFREE_CLIENT_ID?.trim();
  const clientSecret = env.CASHFREE_CLIENT_SECRET?.trim();
  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret) throw new CashfreeConfigError("CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET must be set together");
  if (clientId.length < 6) throw new CashfreeConfigError("CASHFREE_CLIENT_ID is too short");
  if (clientSecret.length < 8) throw new CashfreeConfigError("CASHFREE_CLIENT_SECRET is too short");

  const production = env.NODE_ENV === "production";
  const declared = env.CASHFREE_MODE?.trim();
  if (declared && declared !== "sandbox" && declared !== "production") {
    throw new CashfreeConfigError('CASHFREE_MODE must be "sandbox" or "production"');
  }
  if (production && !declared) throw new CashfreeConfigError("CASHFREE_MODE must be set in production");
  const mode = (declared || "sandbox") as CashfreeMode;
  if (mode === "production" && !production) throw new CashfreeConfigError("production credentials are only allowed when NODE_ENV is production");

  const apiVersion = env.CASHFREE_API_VERSION?.trim() || "2026-01-01";
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(apiVersion)) throw new CashfreeConfigError("CASHFREE_API_VERSION must use YYYY-MM-DD format");
  const customBase = env.CASHFREE_API_BASE?.trim();
  if (mode === "production" && customBase) throw new CashfreeConfigError("CASHFREE_API_BASE cannot be changed in production mode");
  const apiBase = customBase || (mode === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg");
  return { mode, clientId, clientSecret, apiBase, apiVersion };
}

const paiseFromRupees = (rupees: number) => Math.round(rupees * 100);
const cashfreeRefundStatus = (status: string) =>
  status === "SUCCESS" ? ("success" as const) : ["CANCELLED", "REJECTED", "FAILED"].includes(status) ? ("failed" as const) : ("pending" as const);

/** Cashfree PG Orders API plus the hosted Cashfree JS checkout. */
export class CashfreeGateway implements PaymentGateway {
  readonly name = "cashfree";

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    readonly mode: CashfreeMode,
    private readonly apiBase = mode === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg",
    private readonly apiVersion = "2026-01-01",
  ) {
    if (clientId.length < 6 || clientSecret.length < 8) throw new CashfreeConfigError("client credentials are incomplete");
  }

  private async call<T>(path: string, init: { method: "GET" | "POST"; body?: unknown; idempotencyKey?: string }): Promise<T> {
    const res = await fetch(`${this.apiBase}${path}`, {
      method: init.method,
      headers: {
        "x-client-id": this.clientId,
        "x-client-secret": this.clientSecret,
        "x-api-version": this.apiVersion,
        Accept: "application/json",
        ...(init.idempotencyKey ? { "x-idempotency-key": init.idempotencyKey } : {}),
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    const raw = await res.text();
    if (!res.ok) {
      let detail = "";
      try { detail = String((JSON.parse(raw) as { message?: string }).message ?? ""); } catch { /* Cashfree sometimes returns an empty/non-JSON error. */ }
      throw new Error(`Cashfree ${init.method} ${path} failed: ${res.status}${detail ? ` ${detail.slice(0, 160)}` : ""}`);
    }
    return JSON.parse(raw) as T;
  }

  async createOrder(input: {
    paymentId: string;
    amountPaise: number;
    receipt: string;
    callbackUrl?: string;
    notifyUrl?: string;
    customer?: { id?: string; phone?: string | null; name?: string | null; email?: string | null };
  }) {
    if (!input.callbackUrl) throw new Error("Cashfree requires a payment return URL");
    const callback = new URL(input.callbackUrl);
    if (this.mode === "production" && callback.protocol !== "https:") throw new Error("Cashfree production return URLs must use HTTPS");
    const phone = input.customer?.phone?.replace(/\D/g, "").slice(-10);
    const order = await this.call<{ order_id: string }>("/orders", {
      method: "POST",
      idempotencyKey: input.paymentId,
      body: {
        order_id: input.paymentId,
        order_amount: input.amountPaise / 100,
        order_currency: "INR",
        customer_details: {
          customer_id: input.customer?.id?.slice(0, 50) || `tq_${input.paymentId.replace(/-/g, "")}`,
          customer_phone: phone && phone.length === 10 ? phone : "9999999999",
          ...(input.customer?.name ? { customer_name: input.customer.name.slice(0, 100) } : {}),
          ...(input.customer?.email ? { customer_email: input.customer.email.slice(0, 100) } : {}),
        },
        order_meta: {
          return_url: input.callbackUrl,
          notify_url: input.notifyUrl || `${callback.origin}/api/payments/cashfree/webhook`,
        },
        order_note: "TableQR payment",
        order_tags: { payment_id: input.paymentId, receipt: input.receipt.slice(0, 40) },
      },
    });
    return { gatewayRef: order.order_id };
  }

  async checkout(input: CheckoutInput): Promise<Checkout> {
    const order = await this.call<{ payment_session_id: string }>(`/orders/${encodeURIComponent(input.gatewayRef)}`, { method: "GET" });
    if (!order.payment_session_id) throw new Error("Cashfree did not return a payment session");
    return { provider: "cashfree", kind: "cashfree", mode: this.mode, paymentSessionId: order.payment_session_id };
  }

  async fetchStatus(gatewayRef: string) {
    const payments = await this.call<Array<{
      cf_payment_id: string | number;
      payment_status: string;
      payment_amount: number;
      payment_currency?: string;
      payment_message?: string;
      error_details?: { error_description?: string } | null;
    }>>(`/orders/${encodeURIComponent(gatewayRef)}/payments`, { method: "GET" });
    const success = payments.find((payment) => payment.payment_status === "SUCCESS");
    // A success without a stated currency is not trusted as rupees: "" fails the currency check
    if (success) return { status: "success" as const, amountPaise: paiseFromRupees(success.payment_amount), currency: success.payment_currency ?? "", gatewayPaymentId: String(success.cf_payment_id) };
    if (payments.some((payment) => payment.payment_status === "PENDING")) return { status: "pending" as const, amountPaise: 0 };
    const attempted = payments.filter((payment) => payment.payment_status !== "NOT_ATTEMPTED");
    if (attempted.length === 0) return { status: "none" as const, amountPaise: 0 };
    const last = attempted[attempted.length - 1];
    return {
      status: "failed" as const,
      amountPaise: 0,
      gatewayPaymentId: String(last.cf_payment_id),
      reason: last.error_details?.error_description ?? last.payment_message,
    };
  }

  async refund(input: { gatewayRef: string; gatewayPaymentId: string; amountPaise: number; refundId: string }) {
    const refund = await this.call<{ refund_id?: string; refund_status: string }>(`/orders/${encodeURIComponent(input.gatewayRef)}/refunds`, {
      method: "POST",
      idempotencyKey: input.refundId,
      body: {
        refund_amount: input.amountPaise / 100,
        refund_id: input.refundId,
        refund_note: "TableQR refund",
        refund_speed: "STANDARD",
      },
    });
    return { gatewayRefundId: refund.refund_id || input.refundId, status: cashfreeRefundStatus(refund.refund_status) };
  }

  async fetchRefund(input: { gatewayRef: string; gatewayRefundId: string }) {
    const refund = await this.call<{ refund_status: string }>(
      `/orders/${encodeURIComponent(input.gatewayRef)}/refunds/${encodeURIComponent(input.gatewayRefundId)}`,
      { method: "GET" },
    );
    return { status: cashfreeRefundStatus(refund.refund_status) };
  }

  verifyWebhook(rawBody: string, signature: string | null, timestamp?: string | null) {
    if (!signature || !timestamp) return false;
    const expected = createHmac("sha256", this.clientSecret).update(`${timestamp}${rawBody}`).digest("base64");
    return safeEqual(expected, signature);
  }

  parseWebhook(rawBody: string): WebhookEvent {
    const body = JSON.parse(rawBody) as {
      type?: string;
      data?: {
        order?: { order_id?: string };
        payment?: { cf_payment_id?: string | number; payment_status?: string; payment_amount?: number; payment_currency?: string; payment_message?: string };
        error_details?: { error_description?: string } | null;
        refund?: {
          refund_id?: string;
          cf_refund_id?: string | number;
          cf_payment_id?: string | number;
          refund_status?: string;
          refund_amount?: number;
        };
      };
    };
    const payment = body.data?.payment;
    const order = body.data?.order;
    if (["PAYMENT_SUCCESS_WEBHOOK", "PAYMENT_FAILED_WEBHOOK", "PAYMENT_USER_DROPPED_WEBHOOK"].includes(body.type ?? "") && order?.order_id && payment?.cf_payment_id !== undefined) {
      return {
        kind: "payment",
        gatewayRef: order.order_id,
        gatewayPaymentId: String(payment.cf_payment_id),
        status: body.type === "PAYMENT_SUCCESS_WEBHOOK" && payment.payment_status === "SUCCESS" ? "success" : "failed",
        amountPaise: paiseFromRupees(payment.payment_amount ?? 0),
        currency: payment.payment_currency ?? "",
        reason: body.data?.error_details?.error_description ?? payment.payment_message,
      };
    }
    const refund = body.data?.refund;
    if (["REFUND_STATUS_WEBHOOK", "AUTO_REFUND_STATUS_WEBHOOK"].includes(body.type ?? "") && refund?.refund_status) {
      const status = cashfreeRefundStatus(refund.refund_status);
      if (status === "pending") return { kind: "ignored" };
      return {
        kind: "refund",
        gatewayRefundId: refund.refund_id ?? String(refund.cf_refund_id ?? ""),
        gatewayPaymentId: String(refund.cf_payment_id ?? ""),
        status,
        amountPaise: paiseFromRupees(refund.refund_amount ?? 0),
      };
    }
    return { kind: "ignored" };
  }
}

/** Development and test gateway: a local hosted page settles orders by hand */
class MockGateway implements PaymentGateway {
  readonly name = "mock";
  private orders = new Map<string, { status: GatewayStatus; amountPaise: number; paymentRef?: string }>();
  private refunds = new Map<string, "pending" | "success" | "failed">();
  /** Set in tests to make the next refund calls fail */
  refundsFail = false;
  readonly webhookSecret = "mock-webhook-secret";

  async createOrder(input: { paymentId: string; amountPaise: number }) {
    const gatewayRef = `mock_${uuidv7()}`;
    this.orders.set(gatewayRef, { status: "none", amountPaise: input.amountPaise });
    return { gatewayRef };
  }

  checkout(input: CheckoutInput): FormCheckout {
    return {
      provider: this.name,
      kind: "form",
      method: "GET",
      action: "/pay/mock",
      fields: { ref: input.gatewayRef, amount: String(input.amountPaise), method: input.method, callback: input.callbackUrl },
    };
  }

  async fetchStatus(gatewayRef: string) {
    const o = this.orders.get(gatewayRef);
    if (!o) return { status: "pending" as const, amountPaise: 0 };
    return { status: o.status, amountPaise: o.status === "success" ? o.amountPaise : 0, gatewayPaymentId: o.paymentRef };
  }

  async refund() {
    if (this.refundsFail) throw new Error("Mock refund failed");
    const id = `mockrf_${uuidv7()}`;
    this.refunds.set(id, "pending");
    return { gatewayRefundId: id, status: "pending" as const };
  }

  async fetchRefund(input: { gatewayRefundId: string }) {
    return { status: this.refunds.get(input.gatewayRefundId) ?? ("pending" as const) };
  }

  settleRefund(ref: string, status: "success" | "failed") { if (this.refunds.has(ref)) this.refunds.set(ref, status); }
  refundStatus(ref: string) { return this.refunds.get(ref) ?? null; }

  verifyWebhook(rawBody: string, signature: string | null) {
    return !!signature && safeEqual(createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex"), signature);
  }

  parseWebhook(rawBody: string): WebhookEvent {
    return JSON.parse(rawBody) as WebhookEvent;
  }

  /** Simulates the guest finishing, failing or abandoning checkout; "pending" means still processing */
  settle(gatewayRef: string, status: GatewayStatus) {
    const order = this.orders.get(gatewayRef);
    if (!order) return;
    order.status = status;
    if (status === "success" || status === "failed") order.paymentRef ??= `mockpay_${uuidv7()}`;
  }

  /** Test helper: what a signed webhook from this gateway looks like */
  signedWebhook(event: WebhookEvent) {
    const body = JSON.stringify(event);
    return { body, signature: createHmac("sha256", this.webhookSecret).update(body).digest("hex") };
  }

  orderOf(gatewayRef: string) {
    return this.orders.get(gatewayRef) ?? null;
  }
}

export const mockGateway = new MockGateway();

let cashfree: { signature: string; gateway: CashfreeGateway } | null = null;

function configuredCashfree(): CashfreeGateway | null {
  const config = parseCashfreeConfig(process.env);
  if (!config) return null;
  const signature = [config.mode, config.clientId, config.clientSecret, config.apiBase, config.apiVersion].join("|");
  if (cashfree?.signature !== signature) {
    cashfree = {
      signature,
      gateway: new CashfreeGateway(config.clientId, config.clientSecret, config.mode, config.apiBase, config.apiVersion),
    };
  }
  return cashfree.gateway;
}

export const cashfreeMode = (): CashfreeMode | null => parseCashfreeConfig(process.env)?.mode ?? null;

/** The mock is for development and tests only; production must configure a real gateway. */
export const mockAllowed = () => process.env.NODE_ENV !== "production";

/** Development/test mock only. Production guest checkout resolves the outlet's merchant account. */
export function gatewayFor(): PaymentGateway | null {
  return mockAllowed() ? mockGateway : null;
}

/** TableQR's own Cashfree account, used only for restaurant plan fees. */
export function platformGateway(): CashfreeGateway | null {
  return configuredCashfree();
}

/** The gateway an existing payment went through, for status checks, webhooks and refunds */
export function gatewayByName(name: string): PaymentGateway | null {
  if (name === "mock") return mockAllowed() ? mockGateway : null;
  return null;
}
