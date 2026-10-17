import "server-only";
import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { accessFrom, tenantAccess } from "./access";
import { AppError } from "./errors";
import { tenantFeatures } from "./plan";
import type { StaffSession } from "./staff/auth";

// TableQR's own fees, paid by hand: the owner pays the operator's UPI (or cash, or bank) and says
// "I have paid"; the platform admin checks the bank and confirms, which adds the paid months.
// The admin can also record a payment directly. Guest bill money never comes through here.

export const FEE_MONTHS = [1, 3, 6, 12] as const;
export type FeeMethod = "upi" | "cash" | "bank";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const DAY = 86_400_000;

/** What the restaurant pays per month for all its outlets: its own price, else the latest period's, else the plan's */
export async function monthlyFee(run: Pick<typeof db, "select">, tenantId: string) {
  const [t] = await run
    .select({ customPricePaise: s.tenants.customPricePaise, planPricePaise: s.plans.monthlyPricePaise })
    .from(s.tenants)
    .innerJoin(s.plans, eq(s.plans.code, s.tenants.planCode))
    .where(eq(s.tenants.id, tenantId));
  if (!t) throw new AppError("not_found", "Restaurant not found.");
  const [latest] = await run.select({ price: s.subscriptions.pricePerOutletPaise }).from(s.subscriptions).where(eq(s.subscriptions.tenantId, tenantId)).orderBy(desc(s.subscriptions.periodEnd)).limit(1);
  const [outlets] = await run.select({ n: count() }).from(s.outlets).where(eq(s.outlets.tenantId, tenantId));
  const perOutletPaise = t.customPricePaise ?? latest?.price ?? t.planPricePaise ?? 0;
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

/** Owner or manager says they paid; one claim waits at a time */
export async function claimFee(staff: Pick<StaffSession, "tenantId" | "roles" | "name">, input: { months: number; reference: string; method?: string }, now = new Date()) {
  if (!staff.roles.some((r) => r === "owner" || r === "manager")) throw new AppError("forbidden", "Ask the owner or a manager to do this.");
  const { months, method, reference } = cleanInput(input);
  if (method === "upi" && !reference) throw new AppError("invalid_state", "Enter the UPI reference (UTR) from your payment app.");
  const [waiting] = await db.select({ id: s.feePayments.id }).from(s.feePayments).where(and(eq(s.feePayments.tenantId, staff.tenantId), eq(s.feePayments.status, "claimed")));
  if (waiting) throw new AppError("invalid_state", "Your last payment is still being checked by TableQR.");
  const fee = await monthlyFee(db, staff.tenantId);
  const id = uuidv7();
  await db.insert(s.feePayments).values({ id, tenantId: staff.tenantId, months, amountPaise: fee.totalPaise * months, method, reference, status: "claimed", claimedBy: staff.name.slice(0, 80), createdAt: now });
  return { id, amountPaise: fee.totalPaise * months };
}

/** The admin found the money in the bank: the claim adds its months */
export async function confirmFee(id: string, now = new Date()) {
  return db.transaction(async (tx) => {
    // isolation-exempt: only the platform admin confirms; the row it finds carries the tenant
    const [claim] = await tx.select().from(s.feePayments).where(eq(s.feePayments.id, id)).for("update");
    if (!claim) throw new AppError("not_found", "Payment not found.");
    if (claim.status !== "claimed") throw new AppError("invalid_state", "This payment was already handled.");
    const paid = await addPaidMonths(tx, claim.tenantId, claim.months, now);
    await tx.update(s.feePayments).set({ status: "confirmed", subscriptionId: paid.subscriptionId, paidUntil: paid.periodEnd, decidedAt: now }).where(and(eq(s.feePayments.tenantId, claim.tenantId), eq(s.feePayments.id, id)));
    return { tenantId: claim.tenantId, months: claim.months, amountPaise: claim.amountPaise, paidUntil: paid.periodEnd, before: paid.before };
  });
}

/** The money never arrived: the owner can say "I have paid" again */
export async function rejectFee(id: string, now = new Date()) {
  // isolation-exempt: only the platform admin turns a payment down; the row it finds carries the tenant
  const [claim] = await db.select({ tenantId: s.feePayments.tenantId, status: s.feePayments.status }).from(s.feePayments).where(eq(s.feePayments.id, id));
  if (!claim) throw new AppError("not_found", "Payment not found.");
  if (claim.status !== "claimed") throw new AppError("invalid_state", "This payment was already handled.");
  await db.update(s.feePayments).set({ status: "rejected", decidedAt: now }).where(and(eq(s.feePayments.tenantId, claim.tenantId), eq(s.feePayments.id, id)));
  return { tenantId: claim.tenantId };
}

export type FeeRow = { id: string; months: number; amountPaise: number; method: FeeMethod; reference: string | null; status: "claimed" | "confirmed" | "rejected"; claimedBy: string; createdAt: string; paidUntil: string | null };
const feeRow = (r: typeof s.feePayments.$inferSelect): FeeRow => ({
  id: r.id, months: r.months, amountPaise: r.amountPaise, method: r.method, reference: r.reference, status: r.status, claimedBy: r.claimedBy,
  createdAt: r.createdAt.toISOString(), paidUntil: r.paidUntil?.toISOString() ?? null,
});

/** The owner's "My plan" screen: what they pay, until when, and how to pay */
export async function ownerPlan(staff: Pick<StaffSession, "tenantId">, now = new Date()) {
  const [tenant] = await db.select({ planName: s.plans.name, status: s.tenants.status }).from(s.tenants).innerJoin(s.plans, eq(s.plans.code, s.tenants.planCode)).where(eq(s.tenants.id, staff.tenantId));
  if (!tenant) throw new AppError("not_found", "Restaurant not found.");
  const [fee, access, features, rows] = await Promise.all([
    monthlyFee(db, staff.tenantId),
    tenantAccess(staff.tenantId, now),
    tenantFeatures(staff.tenantId),
    db.select().from(s.feePayments).where(eq(s.feePayments.tenantId, staff.tenantId)).orderBy(desc(s.feePayments.createdAt)).limit(24),
  ]);
  return { planName: tenant.planName, status: tenant.status, fee, access, features, payments: rows.map(feeRow), waiting: rows.some((r) => r.status === "claimed") };
}

export type FeesTenant = { id: string; name: string; contactName: string; contactPhone: string; planName: string; monthlyPaise: number; access: { state: string; reason: string; endsAt: string | null } };
export type FeesData = {
  receivedThisMonthPaise: number;
  receivedLastMonthPaise: number;
  claims: (FeeRow & { tenant: FeesTenant })[];
  due: FeesTenant[];
  history: (FeeRow & { tenantName: string })[];
};

/** The admin's Fees screen: payments to check, restaurants due soon or overdue, and what came in */
export async function feesData(now = new Date()): Promise<FeesData> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  // isolation-exempt: authenticated platform admins see every restaurant's fees
  const [tenants, subs, claims, history] = await Promise.all([
    db.select({ id: s.tenants.id, name: s.tenants.name, contactName: s.tenants.contactName, contactPhone: s.tenants.contactPhone, status: s.tenants.status, trialEndsAt: s.tenants.trialEndsAt, planName: s.plans.name, customPricePaise: s.tenants.customPricePaise, planPricePaise: s.plans.monthlyPricePaise })
      .from(s.tenants).innerJoin(s.plans, eq(s.plans.code, s.tenants.planCode)),
    db.select({ tenantId: s.subscriptions.tenantId, periodEnd: s.subscriptions.periodEnd, price: s.subscriptions.pricePerOutletPaise }).from(s.subscriptions).where(ne(s.subscriptions.status, "cancelled")).orderBy(desc(s.subscriptions.periodEnd)),
    db.select().from(s.feePayments).where(eq(s.feePayments.status, "claimed")).orderBy(desc(s.feePayments.createdAt)),
    db.select({ fee: s.feePayments, tenantName: s.tenants.name }).from(s.feePayments).innerJoin(s.tenants, eq(s.tenants.id, s.feePayments.tenantId)).where(inArray(s.feePayments.status, ["confirmed", "rejected"])).orderBy(desc(s.feePayments.createdAt)).limit(200),
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
    due,
    history: history.map((h) => ({ ...feeRow(h.fee), tenantName: h.tenantName })),
  };
}

