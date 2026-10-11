import "server-only";

import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import type { PaymentsData } from "@/app/admin/admin-types";
import { requirePlatformAdmin } from "./auth";

const DAY = 86_400_000;

/**
 * Restaurant guests' payments across all tenants, last 30 days. Platform admins see amounts, tenant
 * and outlet only; no guest or participant details are read.
 */
export async function getPaymentsData(): Promise<PaymentsData> {
  await requirePlatformAdmin();
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(today.getTime() - 29 * DAY);
  const previousStart = new Date(start.getTime() - 30 * DAY);
  const day = sql<string>`date_format(${s.payments.createdAt}, '%Y-%m-%d')`;
  const money = sql<number>`coalesce(sum(${s.payments.amountPaise} + ${s.payments.tipPaise}), 0)`.mapWith(Number);

  // isolation-exempt: authenticated platform admins read cross-tenant payment health (amounts only).
  const [rows, statusRows, [previous], dailyRows, methodRows, refundRows, [refundTotals]] = await Promise.all([
    db.select({
      id: s.payments.id, createdAt: s.payments.createdAt, tenantName: s.tenants.name, outletName: s.outlets.name, method: s.payments.method, channel: s.payments.channel,
      amountPaise: s.payments.amountPaise, tipPaise: s.payments.tipPaise, status: s.payments.status, failureReason: s.payments.failureReason, gatewayPaymentId: s.payments.gatewayPaymentId,
    }).from(s.payments).innerJoin(s.tenants, eq(s.payments.tenantId, s.tenants.id))
      .innerJoin(s.outlets, and(eq(s.payments.outletId, s.outlets.id), eq(s.payments.tenantId, s.outlets.tenantId)))
      .where(gte(s.payments.createdAt, start)).orderBy(desc(s.payments.createdAt)).limit(300),
    db.select({ status: s.payments.status, total: count(), paise: money }).from(s.payments).where(gte(s.payments.createdAt, start)).groupBy(s.payments.status),
    db.select({ paise: money }).from(s.payments).where(and(eq(s.payments.status, "success"), gte(s.payments.createdAt, previousStart), lt(s.payments.createdAt, start))),
    db.select({ date: day, paise: money }).from(s.payments).where(and(eq(s.payments.status, "success"), gte(s.payments.createdAt, start))).groupBy(day),
    db.select({ method: s.payments.method, total: count(), paise: money }).from(s.payments).where(and(eq(s.payments.status, "success"), gte(s.payments.createdAt, start))).groupBy(s.payments.method),
    db.select({ id: s.refunds.id, createdAt: s.refunds.createdAt, tenantName: s.tenants.name, amountPaise: s.refunds.amountPaise, reason: s.refunds.reason, status: s.refunds.status })
      .from(s.refunds).innerJoin(s.tenants, eq(s.refunds.tenantId, s.tenants.id)).orderBy(desc(s.refunds.createdAt)).limit(10),
    db.select({
      paise: sql<number>`coalesce(sum(case when ${s.refunds.status} = 'success' and ${s.refunds.createdAt} >= ${start} then ${s.refunds.amountPaise} else 0 end), 0)`.mapWith(Number),
      pending: sql<number>`coalesce(sum(case when ${s.refunds.status} = 'pending' then 1 else 0 end), 0)`.mapWith(Number),
    // isolation-exempt: platform admin platform-wide refund totals
    }).from(s.refunds),
  ]);

  const byStatus = new Map(statusRows.map((r) => [r.status, r]));
  const dailyMap = new Map(dailyRows.map((r) => [r.date, Number(r.paise)]));
  const n = (k: "success" | "failed" | "pending" | "refunded") => Number(byStatus.get(k)?.total ?? 0);

  return {
    collectedPaise: Number(byStatus.get("success")?.paise ?? 0),
    previousCollectedPaise: Number(previous?.paise ?? 0),
    counts: { success: n("success"), failed: n("failed"), pending: n("pending") + Number(byStatus.get("initiated")?.total ?? 0), refunded: n("refunded") },
    refundedPaise: Number(refundTotals?.paise ?? 0),
    pendingRefunds: Number(refundTotals?.pending ?? 0),
    daily: Array.from({ length: 30 }, (_, i) => {
      const date = new Date(start.getTime() + i * DAY).toISOString().slice(0, 10);
      return { date, collectedPaise: dailyMap.get(date) ?? 0 };
    }),
    byMethod: methodRows.map((r) => ({ method: r.method, paise: Number(r.paise), count: Number(r.total) })).sort((a, b) => b.paise - a.paise),
    payments: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    refunds: refundRows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
  };
}
