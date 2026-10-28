import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { currencyAccepted, platformGateway } from "../payments/gateway";
import { AppError } from "../errors";
import { requireFeature } from "../plan";
import type { StaffSession } from "../staff/auth";

type Verdict = { status: "success" | "failed"; amountPaise: number; currency?: string; gatewayPaymentId?: string; reason?: string };
export async function messageCreditPrice() {
  const [row] = await db.select().from(s.messageCreditPricing).where(eq(s.messageCreditPricing.id, "default"));
  return row ? { pricePerCreditPaise: row.pricePerCreditPaise, packSizes: row.packSizes, lowBalanceThreshold: row.lowBalanceThreshold } : null;
}

export async function saveMessageCreditPrice(input: { pricePerCreditPaise: number; packSizes: number[]; lowBalanceThreshold: number }) {
  if (!Number.isSafeInteger(input.pricePerCreditPaise) || input.pricePerCreditPaise < 1 || input.pricePerCreditPaise > 100_000_000) throw new AppError("invalid_state", "Price per credit must be at least ₹0.01.");
  if (!Array.isArray(input.packSizes) || input.packSizes.length < 1 || input.packSizes.length > 8 || input.packSizes.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 100_000) || new Set(input.packSizes).size !== input.packSizes.length) throw new AppError("invalid_state", "Add 1–8 unique credit packs, each up to 100,000 credits.");
  if (input.packSizes.some((n) => n * input.pricePerCreditPaise > 2_147_483_647)) throw new AppError("invalid_state", "A pack total is too large.");
  if (!Number.isSafeInteger(input.lowBalanceThreshold) || input.lowBalanceThreshold < 0 || input.lowBalanceThreshold > 100_000) throw new AppError("invalid_state", "Low-balance threshold must be between 0 and 100,000 credits.");
  await db.insert(s.messageCreditPricing).values({ id: "default", ...input }).onDuplicateKeyUpdate({ set: { pricePerCreditPaise: input.pricePerCreditPaise, packSizes: input.packSizes, lowBalanceThreshold: input.lowBalanceThreshold, updatedAt: new Date() } });
}

async function settlePurchase(id: string, verdict: Verdict, now = new Date()) {
  // isolation-exempt: verified Cashfree callbacks carry the random opaque purchase ID to resolve the tenant before mutation.
  const [known] = await db.select({ tenantId: s.messageCreditPurchases.tenantId }).from(s.messageCreditPurchases).where(eq(s.messageCreditPurchases.id, id));
  if (!known) return null;
  return db.transaction(async (tx) => {
    await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.id, known.tenantId)).for("update");
    const [purchase] = await tx.select().from(s.messageCreditPurchases).where(and(eq(s.messageCreditPurchases.tenantId, known.tenantId), eq(s.messageCreditPurchases.id, id))).for("update");
    if (!purchase) return null;
    if (purchase.status === "confirmed") return { status: purchase.status, alreadyFinal: true } as const;
    const paid = verdict.status === "success" && verdict.amountPaise === purchase.amountPaise && currencyAccepted(verdict.currency);
    if (!paid) {
      const reason = verdict.status === "failed" ? verdict.reason ?? "Payment failed" : !currencyAccepted(verdict.currency) ? "Cashfree currency was not INR" : `Amount mismatch: expected ${purchase.amountPaise}, got ${verdict.amountPaise}`;
      await tx.update(s.messageCreditPurchases).set({ status: "rejected", gatewayPaymentId: verdict.gatewayPaymentId ?? null, failureReason: reason.slice(0, 200), settledAt: now }).where(and(eq(s.messageCreditPurchases.tenantId, purchase.tenantId), eq(s.messageCreditPurchases.id, purchase.id)));
      return { status: "rejected" as const, alreadyFinal: purchase.status === "rejected" };
    }
    const [tenant] = await tx.select({ balance: s.tenants.messageCredits }).from(s.tenants).where(eq(s.tenants.id, purchase.tenantId)).for("update");
    const balance = tenant.balance + purchase.credits;
    if (!Number.isSafeInteger(balance) || balance > 2_147_483_647) throw new AppError("invalid_state", "Credit balance reached its maximum; contact Tableeqr support.");
    await tx.update(s.tenants).set({ messageCredits: balance }).where(eq(s.tenants.id, purchase.tenantId));
    await tx.insert(s.messageCreditLedger).values({ tenantId: purchase.tenantId, delta: purchase.credits, balanceAfter: balance, reason: "purchase", actorLabel: "cashfree", note: `Cashfree credit pack ${purchase.credits} (${purchase.id})`, createdAt: now });
    await tx.update(s.messageCreditPurchases).set({ status: "confirmed", gatewayPaymentId: verdict.gatewayPaymentId ?? null, failureReason: null, settledAt: now }).where(and(eq(s.messageCreditPurchases.tenantId, purchase.tenantId), eq(s.messageCreditPurchases.id, purchase.id)));
    return { status: "confirmed" as const, alreadyFinal: false, tenantId: purchase.tenantId, credits: purchase.credits };
  });
}

export async function settleMessageCreditPurchaseByGatewayRef(gatewayRef: string, verdict: Verdict, now = new Date()) {
  // isolation-exempt: Cashfree supplies its globally unique platform order reference.
  const [purchase] = await db.select({ id: s.messageCreditPurchases.id }).from(s.messageCreditPurchases).where(eq(s.messageCreditPurchases.gatewayRef, gatewayRef));
  return purchase ? settlePurchase(purchase.id, verdict, now) : null;
}

export async function reconcileMessageCreditPurchase(id: string, now = new Date(), tenantId?: string) {
  // isolation-exempt: the Cashfree return URL uses the random opaque purchase ID to resolve its tenant before any mutation.
  const [purchase] = await db.select().from(s.messageCreditPurchases).where(and(eq(s.messageCreditPurchases.id, id), tenantId ? eq(s.messageCreditPurchases.tenantId, tenantId) : undefined));
  if (!purchase) throw new AppError("not_found", "Credit purchase not found.");
  if (purchase.status !== "claimed" || !purchase.gatewayRef) return purchase.status;
  const gateway = platformGateway();
  if (!gateway) return purchase.status;
  const result = await gateway.fetchStatus(purchase.gatewayRef);
  if (result.status === "success" || result.status === "failed") return (await settlePurchase(id, { status: result.status, amountPaise: result.amountPaise, currency: result.currency, gatewayPaymentId: result.gatewayPaymentId, reason: result.reason }, now))?.status ?? null;
  return purchase.status;
}

export async function startMessageCreditPurchase(staff: Pick<StaffSession, "tenantId" | "roles" | "name">, input: { credits: number; requestId: string; callbackUrl: string }) {
  if (!staff.roles.some((role) => role === "owner" || role === "manager")) throw new AppError("forbidden", "Ask the owner or manager to buy credits.");
  await requireFeature(staff.tenantId, "broadcast");
  const gateway = platformGateway();
  if (!gateway) throw new AppError("invalid_state", "Online credit purchases are not configured yet.");
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(input.requestId)) throw new AppError("invalid_state", "This purchase request is invalid.");
  const pricing = await messageCreditPrice();
  if (!pricing || !pricing.packSizes.includes(input.credits)) throw new AppError("invalid_state", "Choose one of the available credit packs.");
  const id = uuidv7();
  const amountPaise = input.credits * pricing.pricePerCreditPaise;
  const purchase = await db.transaction(async (tx) => {
    await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.id, staff.tenantId)).for("update");
    const [existing] = await tx.select().from(s.messageCreditPurchases).where(and(eq(s.messageCreditPurchases.tenantId, staff.tenantId), eq(s.messageCreditPurchases.requestId, input.requestId)));
    if (existing) {
      if (existing.credits !== input.credits) throw new AppError("conflict", "This checkout request already belongs to a different pack. Refresh and try again.");
      if (existing.status !== "claimed") throw new AppError("invalid_state", "This purchase attempt has ended. Start a new checkout.");
      return existing;
    }
    const [created] = await tx.insert(s.messageCreditPurchases).values({ id, tenantId: staff.tenantId, credits: input.credits, amountPaise, requestId: input.requestId, status: "claimed", createdAt: new Date() }).$returningId();
    const [row] = await tx.select().from(s.messageCreditPurchases).where(and(eq(s.messageCreditPurchases.tenantId, staff.tenantId), eq(s.messageCreditPurchases.id, created.id)));
    return row;
  });
  let gatewayRef = purchase.gatewayRef;
  if (!gatewayRef) {
    const [tenant] = await db.select({ name: s.tenants.name, phone: s.tenants.contactPhone }).from(s.tenants).where(eq(s.tenants.id, staff.tenantId));
    const callbackUrl = input.callbackUrl.replace("PLACEHOLDER", purchase.id);
    gatewayRef = (await gateway.createOrder({ paymentId: purchase.id, amountPaise: purchase.amountPaise, receipt: `Broadcast ${purchase.credits} credits`, callbackUrl, notifyUrl: `${new URL(callbackUrl).origin}/api/fees/cashfree/webhook`, customer: { id: staff.tenantId, phone: tenant?.phone, name: tenant?.name } })).gatewayRef;
    await db.update(s.messageCreditPurchases).set({ gatewayRef }).where(and(eq(s.messageCreditPurchases.tenantId, staff.tenantId), eq(s.messageCreditPurchases.id, purchase.id), eq(s.messageCreditPurchases.status, "claimed")));
  }
  const callbackUrl = input.callbackUrl.replace("PLACEHOLDER", purchase.id);
  const checkout = await gateway.checkout({ gatewayRef, paymentId: purchase.id, amountPaise: purchase.amountPaise, method: "upi", outletName: "Tableeqr message credits", callbackUrl });
  return { id: purchase.id, credits: purchase.credits, amountPaise: purchase.amountPaise, checkout };
}

export async function messageCreditPurchaseHistory(tenantId: string) {
  return db.select({ id: s.messageCreditPurchases.id, credits: s.messageCreditPurchases.credits, amountPaise: s.messageCreditPurchases.amountPaise, status: s.messageCreditPurchases.status, createdAt: s.messageCreditPurchases.createdAt }).from(s.messageCreditPurchases).where(eq(s.messageCreditPurchases.tenantId, tenantId)).orderBy(desc(s.messageCreditPurchases.createdAt)).limit(5);
}

export async function settleMessageCreditPurchaseById(tenantId: string, id: string, now = new Date()) {
  const [purchase] = await db.select({ status: s.messageCreditPurchases.status }).from(s.messageCreditPurchases).where(and(eq(s.messageCreditPurchases.tenantId, tenantId), eq(s.messageCreditPurchases.id, id)));
  if (!purchase) throw new AppError("not_found", "Credit purchase not found.");
  return reconcileMessageCreditPurchase(id, now, tenantId);
}
