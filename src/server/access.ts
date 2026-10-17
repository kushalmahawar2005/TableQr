import "server-only";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";

// Whether a restaurant may use TableQR right now. A free trial or a paid period ends on its date;
// then there are GRACE_DAYS with a warning, then staff screens and guest ordering stop until the
// platform admin extends the trial or records the fees. Suspended or cancelled stops at once.
// Nothing is deleted.

export const GRACE_DAYS = 3;
/** The warning strip starts a week before the end, matching "we will remind you a week before" on My plan */
export const WARN_DAYS = 7;
const DAY = 86_400_000;

export type Access =
  | { state: "ok"; reason: "trial" | "paid" | "open"; endsAt: number | null; warn: boolean }
  | { state: "grace"; reason: "trial" | "paid"; endsAt: number; stopsAt: number }
  | { state: "blocked"; reason: "trial" | "paid" | "suspended" | "cancelled"; endsAt: number | null };

/** Works out access from the tenant's status, trial end and latest paid period */
export function accessFrom(input: { status: string; trialEndsAt: Date | null; paidUntil: Date | null }, now = new Date()): Access {
  if (input.status === "suspended" || input.status === "cancelled") return { state: "blocked", reason: input.status, endsAt: null };
  const reason = input.status === "trial" ? "trial" : "paid";
  const end = reason === "trial" ? input.trialEndsAt : input.paidUntil;
  // Active with no paid period on record, or a trial with no end date: left open for the admin
  if (!end) return { state: "ok", reason: "open", endsAt: null, warn: false };
  const t = now.getTime();
  const endsAt = end.getTime();
  if (t <= endsAt) return { state: "ok", reason, endsAt, warn: endsAt - t <= WARN_DAYS * DAY };
  const stopsAt = endsAt + GRACE_DAYS * DAY;
  if (t <= stopsAt) return { state: "grace", reason, endsAt, stopsAt };
  return { state: "blocked", reason, endsAt };
}

export async function tenantAccess(tenantId: string, now = new Date()): Promise<Access> {
  const [tenant] = await db.select({ status: s.tenants.status, trialEndsAt: s.tenants.trialEndsAt }).from(s.tenants).where(eq(s.tenants.id, tenantId));
  if (!tenant) return { state: "blocked", reason: "cancelled", endsAt: null };
  const [paid] = await db
    .select({ periodEnd: s.subscriptions.periodEnd })
    .from(s.subscriptions)
    .where(and(eq(s.subscriptions.tenantId, tenantId), ne(s.subscriptions.status, "cancelled")))
    .orderBy(desc(s.subscriptions.periodEnd))
    .limit(1);
  return accessFrom({ status: tenant.status, trialEndsAt: tenant.trialEndsAt, paidUntil: paid?.periodEnd ?? null }, now);
}

export const ACCESS_STOPPED = "TableQR is paused for this restaurant. The owner can ask TableQR to renew the plan.";
