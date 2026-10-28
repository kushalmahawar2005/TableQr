import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "../errors";
import { CashfreeGateway, mockAllowed, mockGateway, type CashfreeMode, type PaymentGateway } from "./gateway";

type MerchantConfig = { version: 1; provider: "cashfree"; mode: CashfreeMode; clientId: string; clientSecret: string };
const fail = (message: string) => new AppError("invalid_state", message, { reason: "payment_gateway_setup" });

function encryptionKey() {
  const raw = process.env.PAYMENT_CREDENTIALS_KEY?.trim() ?? "";
  if (!/^[\da-fA-F]{64}$/.test(raw)) throw fail("Payment credential encryption is not configured on the server yet. Ask your Tableeqr administrator to finish the setup.");
  return Buffer.from(raw, "hex");
}

export function encryptMerchantCredentials(input: { mode: unknown; clientId: unknown; clientSecret: unknown }) {
  const mode = String(input.mode ?? "");
  const clientId = String(input.clientId ?? "").trim();
  const clientSecret = String(input.clientSecret ?? "").trim();
  if (mode !== "sandbox" && mode !== "production") throw fail("Choose Cashfree test or live mode.");
  if (mode === "production" && process.env.NODE_ENV !== "production") throw fail("Live Cashfree credentials can only be saved on the production app.");
  if (clientId.length < 6 || clientId.length > 200 || clientSecret.length < 8 || clientSecret.length > 400) throw fail("Enter the Cashfree App ID and Secret Key from this restaurant’s own merchant account.");
  const plaintext = Buffer.from(JSON.stringify({ version: 1, provider: "cashfree", mode, clientId, clientSecret } satisfies MerchantConfig));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return `v1.${iv.toString("hex")}.${cipher.getAuthTag().toString("hex")}.${ciphertext.toString("hex")}`;
}

function decryptMerchantCredentials(encrypted: string): MerchantConfig {
  try {
    const [version, ivHex, tagHex, ciphertextHex] = encrypted.split(".");
    if (version !== "v1" || !/^[\da-f]{24}$/.test(ivHex ?? "") || !/^[\da-f]{32}$/.test(tagHex ?? "") || !/^(?:[\da-f]{2})+$/.test(ciphertextHex ?? "")) throw new Error("bad format");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const plain = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, "hex")), decipher.final()]).toString("utf8");
    const config = JSON.parse(plain) as MerchantConfig;
    if (config.version !== 1 || config.provider !== "cashfree" || !["sandbox", "production"].includes(config.mode) || typeof config.clientId !== "string" || typeof config.clientSecret !== "string") throw new Error("bad config");
    return config;
  } catch {
    throw fail("Could not unlock the saved payment credentials. Check that PAYMENT_CREDENTIALS_KEY has not changed.");
  }
}

function makeGateway(config: MerchantConfig) {
  return new CashfreeGateway(config.clientId, config.clientSecret, config.mode);
}

export function outletGatewayFromConfig(encrypted: string | null | undefined): PaymentGateway | null {
  if (encrypted) {
    const config = decryptMerchantCredentials(encrypted);
    if (process.env.NODE_ENV === "production" && config.mode !== "production") return null;
    return makeGateway(config);
  }
  return mockAllowed() ? mockGateway : null;
}

export async function outletPaymentGateway(tenantId: string, outletId: string): Promise<PaymentGateway | null> {
  const [outlet] = await db.select({ encrypted: s.outlets.paymentGatewayConfig }).from(s.outlets)
    .where(and(eq(s.outlets.tenantId, tenantId), eq(s.outlets.id, outletId)));
  return outletGatewayFromConfig(outlet?.encrypted);
}

export async function outletPaymentGatewayStatus(tenantId: string, outletId: string) {
  const [outlet] = await db.select({ encrypted: s.outlets.paymentGatewayConfig }).from(s.outlets)
    .where(and(eq(s.outlets.tenantId, tenantId), eq(s.outlets.id, outletId)));
  if (!outlet?.encrypted) return { configured: false as const, available: false, mode: null, appIdHint: null };
  const config = decryptMerchantCredentials(outlet.encrypted);
  return { configured: true as const, available: process.env.NODE_ENV !== "production" || config.mode === "production", mode: config.mode, appIdHint: `••••${config.clientId.slice(-4)}` };
}

/** Gateways for legacy payment rows are always resolved from the row's own outlet. */
export async function gatewayForOutletPayment(tenantId: string, outletId: string, provider: string): Promise<PaymentGateway | null> {
  if (provider === "mock") return mockAllowed() ? mockGateway : null;
  if (provider !== "cashfree") return null;
  const gateway = await outletPaymentGateway(tenantId, outletId);
  return gateway?.name === provider ? gateway : null;
}

export async function saveOutletPaymentGateway(tenantId: string, outletId: string, encrypted: string | null) {
  await db.update(s.outlets).set({ paymentGatewayConfig: encrypted })
    .where(and(eq(s.outlets.tenantId, tenantId), eq(s.outlets.id, outletId)));
}

/** Look up only a gateway order/payment tied to an existing tenant row before verifying its webhook signature. */
export async function outletGatewayForWebhook(provider: string, rawBody: string): Promise<PaymentGateway | null> {
  if (provider === "mock") return mockAllowed() ? mockGateway : null;
  if (provider !== "cashfree") return null;
  let orderId = "";
  let paymentId = "";
  let refundId = "";
  try {
    const body = JSON.parse(rawBody) as { data?: { order?: { order_id?: string }; payment?: { cf_payment_id?: string | number }; refund?: { refund_id?: string; cf_refund_id?: string | number; cf_payment_id?: string | number } } };
    orderId = String(body.data?.order?.order_id ?? "").slice(0, 100);
    paymentId = String(body.data?.payment?.cf_payment_id ?? body.data?.refund?.cf_payment_id ?? "").slice(0, 100);
    refundId = String(body.data?.refund?.refund_id ?? body.data?.refund?.cf_refund_id ?? "").slice(0, 100);
  } catch { return null; }
  // Every reference in the body must belong to one outlet. Otherwise a merchant could sign an event
  // with its own secret that names another outlet's order and settle that outlet's bill.
  const scopes = new Map<string, { tenantId: string; outletId: string }>();
  const collect = (rows: { tenantId: string; outletId: string }[]) => { for (const row of rows) scopes.set(`${row.tenantId}:${row.outletId}`, row); };
  const present = <T,>(conditions: (T | undefined)[]) => conditions.filter((x): x is T => !!x);
  const paymentMatch = present([orderId ? eq(s.payments.gatewayRef, orderId) : undefined, paymentId ? eq(s.payments.gatewayPaymentId, paymentId) : undefined]);
  if (paymentMatch.length) {
    // isolation-exempt: signed payment gateway reference is needed to resolve its tenant and outlet.
    collect(await db.select({ tenantId: s.payments.tenantId, outletId: s.payments.outletId })
      .from(s.payments).where(and(eq(s.payments.channel, "cashfree"), or(...paymentMatch))).limit(10));
  }
  if (refundId) {
    // isolation-exempt: signed refund reference is needed to resolve its tenant and outlet.
    collect(await db.select({ tenantId: s.payments.tenantId, outletId: s.payments.outletId })
      .from(s.refunds)
      .innerJoin(s.payments, and(eq(s.payments.tenantId, s.refunds.tenantId), eq(s.payments.id, s.refunds.paymentId)))
      .where(and(eq(s.payments.channel, "cashfree"), eq(s.refunds.gatewayRef, refundId))).limit(10));
  }
  const creditMatch = present([orderId ? eq(s.reservationCredits.gatewayRef, orderId) : undefined, paymentId ? eq(s.reservationCredits.gatewayPaymentId, paymentId) : undefined, refundId ? eq(s.reservationCredits.refundGatewayRef, refundId) : undefined]);
  if (creditMatch.length) {
    // isolation-exempt: signed payment gateway reference is needed to resolve its tenant and outlet.
    collect(await db.select({ tenantId: s.reservationCredits.tenantId, outletId: s.reservationCredits.outletId })
      .from(s.reservationCredits).where(and(eq(s.reservationCredits.provider, "cashfree"), or(...creditMatch))).limit(10));
  }
  const deliveryMatch = present([orderId ? eq(s.deliveryCheckouts.gatewayRef, orderId) : undefined, paymentId ? eq(s.deliveryCheckouts.gatewayPaymentId, paymentId) : undefined, refundId ? eq(s.deliveryCheckouts.refundGatewayRef, refundId) : undefined]);
  if (deliveryMatch.length) {
    // isolation-exempt: signed payment gateway reference is needed to resolve its tenant and outlet.
    collect(await db.select({ tenantId: s.deliveryCheckouts.tenantId, outletId: s.deliveryCheckouts.outletId })
      .from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.paymentProvider, "cashfree"), or(...deliveryMatch))).limit(10));
  }
  if (scopes.size !== 1) return null;
  const [scope] = scopes.values();
  const [outlet] = await db.select({ encrypted: s.outlets.paymentGatewayConfig }).from(s.outlets)
    .where(and(eq(s.outlets.tenantId, scope.tenantId), eq(s.outlets.id, scope.outletId)));
  return outlet?.encrypted ? makeGateway(decryptMerchantCredentials(outlet.encrypted)) : null;
}
