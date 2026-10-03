import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { uuidv7 } from "@/db/id";

// Payment gateway boundary (PS 6.4). Each restaurant connects its own gateway account and money
// settles straight to them; TableQR never holds guest funds or sees card numbers: the guest pays
// on the gateway's hosted page. A payment counts as paid only when the gateway itself says so,
// through a signed webhook or a server-to-server status check, never because a browser came back.

/** "none": the order exists but no payment was attempted on it (the guest cancelled or closed the page) */
export type GatewayStatus = "pending" | "success" | "failed" | "none";

/** How the phone reaches the hosted checkout: a plain form submit, no gateway script in our pages */
export type Checkout = { provider: string; method: "GET" | "POST"; action: string; fields: Record<string, string> };

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
  | { kind: "payment"; gatewayRef: string; gatewayPaymentId: string; status: "success" | "failed"; amountPaise: number; reason?: string }
  | { kind: "refund"; gatewayRefundId: string; gatewayPaymentId: string; status: "success" | "failed"; amountPaise: number }
  | { kind: "ignored" };

export interface PaymentGateway {
  readonly name: string;
  createOrder(input: { paymentId: string; amountPaise: number; receipt: string }): Promise<{ gatewayRef: string }>;
  checkout(input: CheckoutInput): Checkout;
  fetchStatus(gatewayRef: string): Promise<{ status: GatewayStatus; amountPaise: number; gatewayPaymentId?: string; reason?: string }>;
  refund(input: { gatewayPaymentId: string; amountPaise: number; refundId: string }): Promise<{ gatewayRefundId: string; status: "pending" | "success" | "failed" }>;
  /** Checks the webhook signature over the exact raw body */
  verifyWebhook(rawBody: string, signature: string | null): boolean;
  parseWebhook(rawBody: string): WebhookEvent;
}

const safeEqualHex = (a: string, b: string) => {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Razorpay, TEST MODE ONLY for now: refuses live keys. Orders are created server to server; the
 * guest pays on Razorpay's hosted checkout; webhooks are verified with the webhook secret.
 */
export class RazorpayGateway implements PaymentGateway {
  readonly name = "razorpay";
  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string,
    private readonly apiBase = "https://api.razorpay.com",
  ) {
    if (!keyId.startsWith("rzp_test_")) throw new Error("Only Razorpay test keys are allowed");
  }

  private async call<T>(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<T> {
    const res = await fetch(`${this.apiBase}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Razorpay ${init.method} ${path} failed: ${res.status}`);
    return (await res.json()) as T;
  }

  async createOrder(input: { paymentId: string; amountPaise: number; receipt: string }) {
    const order = await this.call<{ id: string }>("/v1/orders", {
      method: "POST",
      body: { amount: input.amountPaise, currency: "INR", receipt: input.receipt.slice(0, 40), notes: { payment_id: input.paymentId } },
    });
    return { gatewayRef: order.id };
  }

  checkout(input: CheckoutInput): Checkout {
    return {
      provider: this.name,
      method: "POST",
      action: `${this.apiBase}/v1/checkout/embedded`,
      fields: {
        key_id: this.keyId,
        order_id: input.gatewayRef,
        amount: String(input.amountPaise),
        currency: "INR",
        name: input.outletName,
        callback_url: input.callbackUrl,
        cancel_url: `${input.callbackUrl}${input.callbackUrl.includes("?") ? "&" : "?"}cancelled=1`,
        "prefill[method]": input.method === "wallet" ? "wallet" : input.method,
        "notes[payment_id]": input.paymentId,
      },
    };
  }

  async fetchStatus(gatewayRef: string) {
    const list = await this.call<{ items: { id: string; status: string; amount: number; error_description?: string }[] }>(
      `/v1/orders/${encodeURIComponent(gatewayRef)}/payments`,
      { method: "GET" },
    );
    const captured = list.items.find((p) => p.status === "captured");
    if (captured) return { status: "success" as const, amountPaise: captured.amount, gatewayPaymentId: captured.id };
    if (list.items.some((p) => p.status === "authorized" || p.status === "created")) return { status: "pending" as const, amountPaise: 0 };
    if (list.items.length === 0) return { status: "none" as const, amountPaise: 0 };
    const last = list.items[list.items.length - 1];
    return { status: "failed" as const, amountPaise: 0, gatewayPaymentId: last.id, reason: last.error_description };
  }

  async refund(input: { gatewayPaymentId: string; amountPaise: number; refundId: string }) {
    const r = await this.call<{ id: string; status: string }>(`/v1/payments/${encodeURIComponent(input.gatewayPaymentId)}/refund`, {
      method: "POST",
      body: { amount: input.amountPaise, receipt: input.refundId.slice(0, 40), speed: "normal" },
    });
    return { gatewayRefundId: r.id, status: r.status === "processed" ? ("success" as const) : r.status === "failed" ? ("failed" as const) : ("pending" as const) };
  }

  verifyWebhook(rawBody: string, signature: string | null) {
    if (!signature || !this.webhookSecret) return false;
    return safeEqualHex(createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex"), signature);
  }

  parseWebhook(rawBody: string): WebhookEvent {
    const body = JSON.parse(rawBody) as {
      event: string;
      payload: {
        payment?: { entity: { id: string; order_id: string; amount: number; status: string; error_description?: string } };
        refund?: { entity: { id: string; payment_id: string; amount: number; status: string } };
      };
    };
    const payment = body.payload.payment?.entity;
    if ((body.event === "payment.captured" || body.event === "payment.failed") && payment?.order_id) {
      return {
        kind: "payment",
        gatewayRef: payment.order_id,
        gatewayPaymentId: payment.id,
        status: body.event === "payment.captured" ? "success" : "failed",
        amountPaise: payment.amount,
        reason: payment.error_description,
      };
    }
    const refund = body.payload.refund?.entity;
    if ((body.event === "refund.processed" || body.event === "refund.failed") && refund) {
      return { kind: "refund", gatewayRefundId: refund.id, gatewayPaymentId: refund.payment_id, status: body.event === "refund.processed" ? "success" : "failed", amountPaise: refund.amount };
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

  checkout(input: CheckoutInput): Checkout {
    return {
      provider: this.name,
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

  settleRefund(ref: string, status: "success" | "failed") { if (this.refunds.has(ref)) this.refunds.set(ref, status); }
  refundStatus(ref: string) { return this.refunds.get(ref) ?? null; }

  verifyWebhook(rawBody: string, signature: string | null) {
    return !!signature && safeEqualHex(createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex"), signature);
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

let razorpay: RazorpayGateway | null = null;

function configuredRazorpay(): RazorpayGateway | null {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, RAZORPAY_API_BASE } = process.env;
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) return null;
  razorpay ??= new RazorpayGateway(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET ?? "", RAZORPAY_API_BASE || undefined);
  return razorpay;
}

/** The mock is for development and tests; production must configure a real (test) gateway */
export const mockAllowed = () => process.env.NODE_ENV !== "production" || process.env.PAYMENTS_MOCK === "1";

/**
 * The gateway new payments use, or null when online payment is not set up (guests then pay at the
 * counter). The real adapter will take the outlet id and load that outlet's own keys.
 */
export function gatewayFor(): PaymentGateway | null {
  return configuredRazorpay() ?? (mockAllowed() ? mockGateway : null);
}

/** The gateway an existing payment went through, for status checks, webhooks and refunds */
export function gatewayByName(name: string): PaymentGateway | null {
  if (name === "razorpay") return configuredRazorpay();
  if (name === "mock") return mockAllowed() ? mockGateway : null;
  return null;
}
