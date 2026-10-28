import "server-only";
import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { readFeatures } from "@/lib/plan-features";
import { accessFrom, tenantAccess } from "./access";
import { AppError } from "./errors";
import { tenantFeatures } from "./plan";
import type { StaffSession } from "./staff/auth";
import { emailAdmin } from "./admin-alerts";
import { currencyAccepted, PAYMENT_CURRENCY, platformGateway } from "./payments/gateway";
import type { Checkout } from "@/lib/payments/checkout";

// Tableeqr's own fees. Cashfree confirms online payments; an admin can still record an offline
// receipt. Guest bill money never comes through here.

export const FEE_MONTHS = [1, 3, 6, 12] as const;
export type FeeMethod = "cashfree" | "upi" | "cash" | "bank";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const DAY = 86_400_000;

/** What the restaurant pays per month for all its outlets: its own price, else the latest period's, else the plan's */
export async function monthlyFee(run: Pick<typeof db, "select">, tenantId: string) {
  const [t] = await run
    .select({ customPricePaise: s.tenants.customPricePaise, planPricePaise: s.plans.monthlyPricePaise, planCode: s.tenants.planCode })
    .from(s.tenants)
    .innerJoin(s.plans, eq(s.plans.code, s.tenants.planCode))
    .where(eq(s.tenants.id, tenantId));
  if (!t) throw new AppError("not_found", "Restaurant not found.");
  const [latest] = await run.select({ price: s.subscriptions.pricePerOutletPaise, planCode: s.subscriptions.planCode }).from(s.subscriptions).where(eq(s.subscriptions.tenantId, tenantId)).orderBy(desc(s.subscriptions.periodEnd)).limit(1);
  const [outlets] = await run.select({ n: count() }).from(s.outlets).where(eq(s.outlets.tenantId, tenantId));
  // An agreed price from an earlier period counts only while the restaurant stays on that plan
  const earlier = latest && latest.planCode === t.planCode ? latest.price : null;
  const perOutletPaise = t.customPricePaise ?? earlier ?? t.planPricePaise ?? 0;
  const outletCount = Math.max(1, Number(outlets?.n ?? 1));
  return { perOutletPaise, outletCount, totalPaise: perOutletPaise * outletCount };
}

/**
 * Adds the paid months right after the current period or trial ends (or from today, if that has
 * passed) and makes the restaurant active.
 */
async function addPaidMonths(tx: Tx, tenantId: string, months: number, now: Date) {
  const [tenant] = await tx.select({ status: s.tenants.status, planCode: s.tenants.planCode, trialEndsAt: s.tenants.trialEndsAt }).from(s.tenants).where(eq(s.tenants.id, tenantId));
  if (!tenant) throw new AppError("not_found", "Restaurant not found.");
  if (tenant.status === "cancelled") throw new AppError("invalid_state", "This restaurant is cancelled.");
  const [latest] = await tx
    .select({ periodEnd: s.subscriptions.periodEnd })
    .from(s.subscriptions)
    .where(and(eq(s.subscriptions.tenantId, tenantId), ne(s.subscriptions.status, "cancelled")))
    .orderBy(desc(s.subscriptions.periodEnd))
    .limit(1);
  const runningEnd = latest ? latest.periodEnd.getTime() : tenant.status === "trial" ? tenant.trialEndsAt?.getTime() ?? 0 : 0;
  const periodStart = new Date(Math.max(now.getTime(), runningEnd));
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + months);
  const fee = await monthlyFee(tx, tenantId);
  const subscriptionId = uuidv7();
  await tx.insert(s.subscriptions).values({
    id: subscriptionId, tenantId, planCode: tenant.planCode, billingCycle: months === 12 ? "annual" : "monthly",
    pricePerOutletPaise: fee.perOutletPaise, outletCount: fee.outletCount, status: "active", periodStart, periodEnd,
  });
  if (tenant.status !== "active") await tx.update(s.tenants).set({ status: "active", statusReason: null }).where(eq(s.tenants.id, tenantId));
  return { subscriptionId, periodEnd, before: tenant.status };
}

function cleanInput(input: { months: number; amountRupees?: number; method?: string; reference?: string | null }) {
  const months = Math.floor(Number(input.months));
  if (!(FEE_MONTHS as readonly number[]).includes(months)) throw new AppError("invalid_state", "Choose 1, 3, 6 or 12 months.");
  const method: FeeMethod = input.method === "cash" || input.method === "bank" ? input.method : "upi";
  const reference = String(input.reference ?? "").trim().slice(0, 60) || null;
  return { months, method, reference };
}

/** The admin received the money and records it; the paid months start at once */
export async function recordFee(adminLabel: string, tenantId: string, input: { months: number; amountRupees: number; method: string; reference: string }, now = new Date()) {
  const { months, method, reference } = cleanInput(input);
  const amountRupees = Math.floor(Number(input.amountRupees));
  if (!Number.isFinite(amountRupees) || amountRupees < 0 || amountRupees > 10_000_000) throw new AppError("invalid_state", "Enter the amount you received.");
  return db.transaction(async (tx) => {
    const paid = await addPaidMonths(tx, tenantId, months, now);
    await tx.insert(s.feePayments).values({ id: uuidv7(), tenantId, months, amountPaise: amountRupees * 100, method, reference, status: "confirmed", claimedBy: adminLabel.slice(0, 80), subscriptionId: paid.subscriptionId, paidUntil: paid.periodEnd, createdAt: now, decidedAt: now });
    return { ...paid, months, amountPaise: amountRupees * 100, method, reference };
  });
}

/** Plans a restaurant can move to by itself: public, with a list price, and not Custom */
export async function upgradePlans() {
  const rows = await db.select({ code: s.plans.code, name: s.plans.name, monthlyPricePaise: s.plans.monthlyPricePaise, features: s.plans.features, sortOrder: s.plans.sortOrder }).from(s.plans).where(eq(s.plans.isPublic, true));
  return rows
    .filter((p) => p.code !== "custom")
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((p) => ({ code: p.code, name: p.name, monthlyPricePaise: p.monthlyPricePaise, features: readFeatures(p.features) }));
}

/** The plan an owner chose to upgrade to, checked; null when they are renewing */
async function upgradeTarget(tenantId: string, planCode: string | null | undefined) {
  if (!planCode) return null;
  const [t] = await db.select({ planCode: s.tenants.planCode }).from(s.tenants).where(eq(s.tenants.id, tenantId));
  if (!t || t.planCode === planCode) return null;
  const plan = (await upgradePlans()).find((p) => p.code === planCode);
  if (!plan || plan.monthlyPricePaise === null) throw new AppError("invalid_state", "This plan is set up by Tableeqr. Please call or WhatsApp us.");
  return { code: plan.code, name: plan.name, monthlyPricePaise: plan.monthlyPricePaise };
}

/** Owner or manager says they paid; one claim waits at a time */
export async function claimFee(staff: Pick<StaffSession, "tenantId" | "roles" | "name">, input: { months: number; reference: string; method?: string; planCode?: string | null }, now = new Date()) {
  if (!staff.roles.some((r) => r === "owner" || r === "manager")) throw new AppError("forbidden", "Ask the owner or a manager to do this.");
  const { months, method } = cleanInput(input);
  let { reference } = cleanInput(input);
  // A UPI payment is matched in the bank by its 12-digit reference (UTR), so it is required
  if (method === "upi") {
    const utr = (reference ?? "").replace(/\s/g, "");
    if (!/^\d{12}$/.test(utr)) throw new AppError("invalid_state", "Enter the 12-digit UPI reference (UTR). You find it in your UPI app under this payment.");
    reference = utr;
  }
  const [waiting] = await db.select({ id: s.feePayments.id }).from(s.feePayments).where(and(eq(s.feePayments.tenantId, staff.tenantId), eq(s.feePayments.status, "claimed")));
  if (waiting) throw new AppError("invalid_state", "Your last payment is still being checked by Tableeqr.");
  const fee = await monthlyFee(db, staff.tenantId);
  // Upgrading: the new plan's list price for every outlet
  const target = await upgradeTarget(staff.tenantId, input.planCode);
  const perMonth = target ? target.monthlyPricePaise * fee.outletCount : fee.totalPaise;
  const id = uuidv7();
  await db.insert(s.feePayments).values({ id, tenantId: staff.tenantId, months, amountPaise: perMonth * months, method, reference, planCode: target?.code ?? null, status: "claimed", claimedBy: staff.name.slice(0, 80), createdAt: now });
  const [t] = await db.select({ name: s.tenants.name, phone: s.tenants.contactPhone }).from(s.tenants).where(eq(s.tenants.id, staff.tenantId));
  const rupees = `₹${((perMonth * months) / 100).toLocaleString("en-IN")}`;
  emailAdmin(`${t?.name ?? "A restaurant"} says they paid ${rupees}${target ? ` to upgrade to ${target.name}` : ""}`, [
    `${t?.name ?? "A restaurant"} says they paid ${rupees} for ${months} ${months === 1 ? "month" : "months"} by ${method.toUpperCase()}${target ? `, to upgrade to the ${target.name} plan` : ""}.`,
    `Reference: ${reference ?? "not given"} · by ${staff.name} · phone ${t?.phone ?? "—"}`,
    "Check your bank or UPI app, then confirm it in Admin → Fees.",
  ]);
  return { id, amountPaise: perMonth * months };
}

export type StartedFeePayment = { id: string; amountPaise: number; checkout: Checkout; replayed: boolean };

/** Starts Tableeqr plan payment on the platform's Cashfree account. */
export async function startFeePayment(
  staff: Pick<StaffSession, "tenantId" | "roles" | "name">,
  input: { months: number; planCode?: string | null; requestId: string; callbackUrl: string },
  now = new Date(),
): Promise<StartedFeePayment> {
  if (!staff.roles.some((role) => role === "owner" || role === "manager")) throw new AppError("forbidden", "Ask the owner or a manager to do this.");
  const gateway = platformGateway();
  if (!gateway) throw new AppError("invalid_state", "Online plan payment is not configured yet.", { reason: "no_gateway" });
  const requestId = String(input.requestId ?? "").trim();
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(requestId)) throw new AppError("invalid_state", "This payment request is not valid.");
  const { months } = cleanInput({ months: input.months });

  const existing = await db.select().from(s.feePayments).where(and(eq(s.feePayments.tenantId, staff.tenantId), eq(s.feePayments.clientRequestId, requestId))).then((rows) => rows[0]);
  let payment = existing;
  let replayed = !!existing;
  if (!payment) {
    const [waiting] = await db.select({ id: s.feePayments.id }).from(s.feePayments).where(and(eq(s.feePayments.tenantId, staff.tenantId), eq(s.feePayments.status, "claimed")));
    if (waiting) {
      // Re-check where the pending payment stands at Cashfree before blocking the owner
      const updated = await reconcileCashfreeFee(waiting.id, now).catch(() => null);
      if (updated === "confirmed") throw new AppError("invalid_state", "This payment is already complete.");
      if (updated === "claimed") {
        throw new AppError("invalid_state", "Your previous payment is still being confirmed by Cashfree. Please refresh status or wait a moment.");
      }
    }
    const fee = await monthlyFee(db, staff.tenantId);
    const target = await upgradeTarget(staff.tenantId, input.planCode);
    const perMonth = target ? target.monthlyPricePaise * fee.outletCount : fee.totalPaise;
    const id = uuidv7();
    await db.insert(s.feePayments).values({
      id,
      tenantId: staff.tenantId,
      months,
      amountPaise: perMonth * months,
      method: "cashfree",
      clientRequestId: requestId,
      planCode: target?.code ?? null,
      status: "claimed",
      claimedBy: staff.name.slice(0, 80),
      createdAt: now,
    });
    payment = await db.select().from(s.feePayments).where(and(eq(s.feePayments.tenantId, staff.tenantId), eq(s.feePayments.id, id))).then((rows) => rows[0]);
    replayed = false;
  }
  if (!payment || payment.method !== "cashfree") throw new AppError("invalid_state", "This payment request cannot be resumed.");
  if (payment.status === "confirmed") throw new AppError("invalid_state", "This payment is already complete.");
  if (payment.status === "rejected") throw new AppError("invalid_state", "That payment attempt ended. Please try again.");

  const callbackUrl = input.callbackUrl.replace("PLACEHOLDER", payment.id);
  let gatewayRef = payment.gatewayRef;
  if (!gatewayRef) {
    const [tenant] = await db.select({ name: s.tenants.name, phone: s.tenants.contactPhone }).from(s.tenants).where(eq(s.tenants.id, staff.tenantId));
    try {
      gatewayRef = (await gateway.createOrder({
        paymentId: payment.id,
        amountPaise: payment.amountPaise,
        receipt: `Tableeqr ${payment.months}m`,
        callbackUrl,
        notifyUrl: `${new URL(callbackUrl).origin}/api/fees/cashfree/webhook`,
        customer: { id: staff.tenantId, phone: tenant?.phone, name: tenant?.name },
      })).gatewayRef;
    } catch (error) {
      await db.update(s.feePayments).set({ status: "rejected", failureReason: "Could not reach Cashfree", decidedAt: now }).where(and(eq(s.feePayments.tenantId, staff.tenantId), eq(s.feePayments.id, payment.id), eq(s.feePayments.status, "claimed")));
      throw new AppError("invalid_state", "Cashfree could not start the payment. No money was taken. Please try again.", { reason: "gateway_down", cause: String(error) });
    }
    await db.update(s.feePayments).set({ gatewayRef }).where(and(eq(s.feePayments.tenantId, staff.tenantId), eq(s.feePayments.id, payment.id)));
  }
  const checkout = await gateway.checkout({ gatewayRef, paymentId: payment.id, amountPaise: payment.amountPaise, method: "upi", outletName: "Tableeqr", callbackUrl });
  return { id: payment.id, amountPaise: payment.amountPaise, checkout, replayed };
}

type FeeVerdict = { status: "success" | "failed"; amountPaise: number; currency?: string; gatewayPaymentId?: string; reason?: string };

/** Applies a verified Cashfree result once. Success immediately activates/extends the plan. */
async function settleCashfreeFee(id: string, verdict: FeeVerdict, now = new Date()) {
  return db.transaction(async (tx) => {
    // isolation-exempt: the signed Cashfree webhook or authenticated owner return supplies the opaque payment id.
    const [payment] = await tx.select().from(s.feePayments).where(eq(s.feePayments.id, id)).for("update");
    if (!payment || payment.method !== "cashfree") return null;
    // One Cashfree order can take several attempts: an earlier failed or dropped attempt rejected
    // this payment, but a later capture of the full amount on the same order still counts
    const lateCapture = payment.status === "rejected" && verdict.status === "success" && verdict.amountPaise === payment.amountPaise && currencyAccepted(verdict.currency);
    if (payment.status !== "claimed" && !lateCapture) return { status: payment.status, alreadyFinal: true } as const;
    const wrongCurrency = verdict.status === "success" && !currencyAccepted(verdict.currency);
    if (verdict.status === "failed" || verdict.amountPaise !== payment.amountPaise || wrongCurrency) {
      const failureReason = verdict.status === "failed" ? verdict.reason ?? "Payment failed" : wrongCurrency ? `Currency mismatch: expected ${PAYMENT_CURRENCY}` : `Amount mismatch: expected ${payment.amountPaise}, got ${verdict.amountPaise}`;
      await tx.update(s.feePayments).set({
        status: "rejected",
        gatewayPaymentId: verdict.gatewayPaymentId ?? null,
        reference: verdict.gatewayPaymentId?.slice(0, 60) ?? null,
        failureReason: failureReason.slice(0, 200),
        checkedAt: now,
        decidedAt: now,
      }).where(and(eq(s.feePayments.tenantId, payment.tenantId), eq(s.feePayments.id, payment.id)));
      return { status: "rejected" as const, alreadyFinal: false };
    }
    if (payment.planCode) await tx.update(s.tenants).set({ planCode: payment.planCode, customFeatures: null, customPricePaise: null }).where(eq(s.tenants.id, payment.tenantId));
    const paid = await addPaidMonths(tx, payment.tenantId, payment.months, now);
    await tx.update(s.feePayments).set({
      status: "confirmed",
      gatewayPaymentId: verdict.gatewayPaymentId ?? null,
      reference: verdict.gatewayPaymentId?.slice(0, 60) ?? null,
      failureReason: null,
      subscriptionId: paid.subscriptionId,
      paidUntil: paid.periodEnd,
      checkedAt: now,
      decidedAt: now,
    }).where(and(eq(s.feePayments.tenantId, payment.tenantId), eq(s.feePayments.id, payment.id)));
    return { status: "confirmed" as const, alreadyFinal: false, tenantId: payment.tenantId, paidUntil: paid.periodEnd };
  });
}

/** Signed webhook path: Cashfree names the order, which is stored as gatewayRef. */
export async function settleCashfreeFeeByGatewayRef(gatewayRef: string, verdict: FeeVerdict, now = new Date()) {
  // isolation-exempt: Cashfree webhook payloads carry only the platform-wide gateway order reference.
  const [payment] = await db.select({ id: s.feePayments.id }).from(s.feePayments).where(and(eq(s.feePayments.method, "cashfree"), eq(s.feePayments.gatewayRef, gatewayRef)));
  return payment ? settleCashfreeFee(payment.id, verdict, now) : null;
}

/** Return-page/status fallback. The browser return never decides success; Cashfree's API does. */
export async function reconcileCashfreeFee(id: string, now = new Date()) {
  // isolation-exempt: the return URL contains the opaque payment id created for this checkout.
  const [payment] = await db.select().from(s.feePayments).where(eq(s.feePayments.id, id));
  if (!payment || payment.method !== "cashfree") return null;
  // A rejected attempt is asked again too: the owner may have paid on a retry of the same order
  if (!["claimed", "rejected"].includes(payment.status) || !payment.gatewayRef) return payment.status;
  const gateway = platformGateway();
  if (!gateway) return payment.status;
  const verdict = await gateway.fetchStatus(payment.gatewayRef);
  await db.update(s.feePayments).set({ checkedAt: now }).where(and(eq(s.feePayments.tenantId, payment.tenantId), eq(s.feePayments.id, payment.id)));
  if (verdict.status === "success" || verdict.status === "failed") {
    return (await settleCashfreeFee(payment.id, {
      status: verdict.status,
      amountPaise: verdict.amountPaise,
      currency: verdict.currency,
      gatewayPaymentId: verdict.gatewayPaymentId,
      reason: verdict.reason,
    }, now))?.status ?? null;
  }
  return payment.status === "rejected" ? ("rejected" as const) : ("claimed" as const);
}

/** The admin found the money in the bank: the claim adds its months */
export async function confirmFee(id: string, now = new Date()) {
  return db.transaction(async (tx) => {
    // isolation-exempt: only the platform admin confirms; the row it finds carries the tenant
    const [claim] = await tx.select().from(s.feePayments).where(eq(s.feePayments.id, id)).for("update");
    if (!claim) throw new AppError("not_found", "Payment not found.");
    if (claim.status !== "claimed") throw new AppError("invalid_state", "This payment was already handled.");
    if (claim.method === "cashfree") throw new AppError("invalid_state", "Cashfree payments are confirmed automatically.");
    // An upgrade: move to the plan they paid for, dropping any custom package or special price
    if (claim.planCode) await tx.update(s.tenants).set({ planCode: claim.planCode, customFeatures: null, customPricePaise: null }).where(eq(s.tenants.id, claim.tenantId));
    const paid = await addPaidMonths(tx, claim.tenantId, claim.months, now);
    await tx.update(s.feePayments).set({ status: "confirmed", subscriptionId: paid.subscriptionId, paidUntil: paid.periodEnd, decidedAt: now }).where(and(eq(s.feePayments.tenantId, claim.tenantId), eq(s.feePayments.id, id)));
    return { tenantId: claim.tenantId, months: claim.months, amountPaise: claim.amountPaise, paidUntil: paid.periodEnd, before: paid.before };
  });
}

/** The money never arrived: the owner can say "I have paid" again */
export async function rejectFee(id: string, now = new Date()) {
  // isolation-exempt: only the platform admin turns a payment down; the row it finds carries the tenant
  const [claim] = await db.select({ tenantId: s.feePayments.tenantId, status: s.feePayments.status, method: s.feePayments.method }).from(s.feePayments).where(eq(s.feePayments.id, id));
  if (!claim) throw new AppError("not_found", "Payment not found.");
  if (claim.status !== "claimed") throw new AppError("invalid_state", "This payment was already handled.");
  if (claim.method === "cashfree") throw new AppError("invalid_state", "Cashfree payments are settled automatically.");
  await db.update(s.feePayments).set({ status: "rejected", decidedAt: now }).where(and(eq(s.feePayments.tenantId, claim.tenantId), eq(s.feePayments.id, id)));
  return { tenantId: claim.tenantId };
}

export type FeeRow = { id: string; planCode: string | null; months: number; amountPaise: number; method: FeeMethod; reference: string | null; status: "claimed" | "confirmed" | "rejected"; claimedBy: string; createdAt: string; paidUntil: string | null };
const feeRow = (r: typeof s.feePayments.$inferSelect): FeeRow => ({
  id: r.id, planCode: r.planCode, months: r.months, amountPaise: r.amountPaise, method: r.method, reference: r.reference, status: r.status, claimedBy: r.claimedBy,
  createdAt: r.createdAt.toISOString(), paidUntil: r.paidUntil?.toISOString() ?? null,
});

/** The owner's "My plan" screen: what they pay, until when, and how to pay */
export async function ownerPlan(staff: Pick<StaffSession, "tenantId">, now = new Date()) {
  const [tenant] = await db.select({ planName: s.plans.name, planCode: s.tenants.planCode, status: s.tenants.status }).from(s.tenants).innerJoin(s.plans, eq(s.plans.code, s.tenants.planCode)).where(eq(s.tenants.id, staff.tenantId));
  if (!tenant) throw new AppError("not_found", "Restaurant not found.");
  const [fee, access, features, rows, plans] = await Promise.all([
    monthlyFee(db, staff.tenantId),
    tenantAccess(staff.tenantId, now),
    tenantFeatures(staff.tenantId),
    db.select().from(s.feePayments).where(eq(s.feePayments.tenantId, staff.tenantId)).orderBy(desc(s.feePayments.createdAt)).limit(24),
    upgradePlans(),
  ]);
  return { planName: tenant.planName, planCode: tenant.planCode, status: tenant.status, fee, access, features, plans, payments: rows.map(feeRow), waiting: rows.some((r) => r.status === "claimed") };
}

export type FeesTenant = { id: string; name: string; contactName: string; contactPhone: string; planName: string; monthlyPaise: number; access: { state: string; reason: string; endsAt: string | null } };
export type FeesData = {
  receivedThisMonthPaise: number;
  receivedLastMonthPaise: number;
  claims: (FeeRow & { tenant: FeesTenant })[];
  /** Open asks to unlock a feature or renew, newest first */
  requests: { id: string; tenant: FeesTenant; feature: string | null; note: string | null; requestedBy: string; createdAt: string }[];
  due: FeesTenant[];
  history: (FeeRow & { tenantName: string })[];
};

/** The admin's Fees screen: payments to check, restaurants due soon or overdue, and what came in */
export async function feesData(now = new Date()): Promise<FeesData> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  // isolation-exempt: authenticated platform admins see every restaurant's fees
  const [tenants, subs, claims, history, requests] = await Promise.all([
    db.select({ id: s.tenants.id, name: s.tenants.name, contactName: s.tenants.contactName, contactPhone: s.tenants.contactPhone, status: s.tenants.status, trialEndsAt: s.tenants.trialEndsAt, planName: s.plans.name, customPricePaise: s.tenants.customPricePaise, planPricePaise: s.plans.monthlyPricePaise })
      .from(s.tenants).innerJoin(s.plans, eq(s.plans.code, s.tenants.planCode)),
    db.select({ tenantId: s.subscriptions.tenantId, periodEnd: s.subscriptions.periodEnd, price: s.subscriptions.pricePerOutletPaise }).from(s.subscriptions).where(ne(s.subscriptions.status, "cancelled")).orderBy(desc(s.subscriptions.periodEnd)),
    db.select().from(s.feePayments).where(eq(s.feePayments.status, "claimed")).orderBy(desc(s.feePayments.createdAt)),
    db.select({ fee: s.feePayments, tenantName: s.tenants.name }).from(s.feePayments).innerJoin(s.tenants, eq(s.tenants.id, s.feePayments.tenantId)).where(inArray(s.feePayments.status, ["confirmed", "rejected"])).orderBy(desc(s.feePayments.createdAt)).limit(200),
    // isolation-exempt: authenticated platform admins see every restaurant's open requests
    db.select().from(s.planRequests).where(eq(s.planRequests.status, "open")).orderBy(desc(s.planRequests.createdAt)),
  ]);
  const outletRows = await db.select({ tenantId: s.outlets.tenantId, n: count() }).from(s.outlets).groupBy(s.outlets.tenantId);
  const outlets = new Map(outletRows.map((o) => [o.tenantId, Number(o.n)]));
  const latest = new Map<string, { periodEnd: Date; price: number }>();
  for (const sub of subs) if (!latest.has(sub.tenantId)) latest.set(sub.tenantId, sub);

  const view = new Map<string, FeesTenant>();
  for (const t of tenants) {
    const sub = latest.get(t.id);
    const a = accessFrom({ status: t.status, trialEndsAt: t.trialEndsAt, paidUntil: sub?.periodEnd ?? null }, now);
    const perOutlet = t.customPricePaise ?? sub?.price ?? t.planPricePaise ?? 0;
    view.set(t.id, {
      id: t.id, name: t.name, contactName: t.contactName, contactPhone: t.contactPhone, planName: t.planName,
      monthlyPaise: perOutlet * Math.max(1, outlets.get(t.id) ?? 1),
      access: { state: a.state, reason: a.reason, endsAt: a.endsAt === null ? null : new Date(a.endsAt).toISOString() },
    });
  }
  // Due: ends within a week, in its grace days, or paused for lack of fees (not suspended or cancelled)
  const due = [...view.values()]
    .filter((t) => t.access.reason !== "suspended" && t.access.reason !== "cancelled" && t.access.endsAt !== null && new Date(t.access.endsAt).getTime() - now.getTime() <= 7 * DAY)
    .sort((a, b) => new Date(a.access.endsAt!).getTime() - new Date(b.access.endsAt!).getTime());

  const confirmed = history.filter((h) => h.fee.status === "confirmed");
  const sum = (from: Date, to: Date) => confirmed.filter((h) => h.fee.decidedAt && h.fee.decidedAt >= from && h.fee.decidedAt < to).reduce((n, h) => n + h.fee.amountPaise, 0);
  return {
    receivedThisMonthPaise: sum(monthStart, new Date(8.64e15)),
    receivedLastMonthPaise: sum(lastMonthStart, monthStart),
    claims: claims.filter((c) => view.has(c.tenantId)).map((c) => ({ ...feeRow(c), tenant: view.get(c.tenantId)! })),
    requests: requests.filter((r) => view.has(r.tenantId)).map((r) => ({ id: r.id, tenant: view.get(r.tenantId)!, feature: r.feature, note: r.note, requestedBy: r.requestedBy, createdAt: r.createdAt.toISOString() })),
    due,
    history: history.map((h) => ({ ...feeRow(h.fee), tenantName: h.tenantName })),
  };
}
