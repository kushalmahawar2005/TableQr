import "server-only";
import { and, count, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { canSee } from "@/lib/staff-permissions";
import { AppError } from "../errors";
import type { StaffSession } from "./auth";
import { outletDayCutoff } from "./business-day";

// Day close: everything one business day at this outlet adds up to, for counting the cash drawer
// and sending the owner a summary. A day is the outlet's business day in India time (IST), the same
// day boundary the dashboard and reports use: midnight to midnight, or for an outlet open past
// midnight, up to its cutoff (e.g. 3 am) so the night's bills stay on the day they began.
// Money from bills is counted when the bill was paid.

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "roles">;
const DAY = 86_400_000;
const IST = 330 * 60_000;

/** Today's business date; `cutoffMinutes` after midnight still belongs to the day before */
export const istToday = (now = new Date(), cutoffMinutes = 0) => new Date(now.getTime() + IST - cutoffMinutes * 60_000).toISOString().slice(0, 10);
/** Start of a business date as a UTC instant */
export const istDayStart = (date: string, cutoffMinutes = 0) => new Date(Date.parse(`${date}T00:00:00Z`) - IST + cutoffMinutes * 60_000);

export type DayClose = Awaited<ReturnType<typeof getDayClose>>;

export async function getDayClose(staff: Staff, date: string, now = new Date()) {
  if (!canSee(staff.roles, "reports")) throw new AppError("forbidden", "Your role cannot see the day close.");
  const cutoff = await outletDayCutoff(staff.tenantId, staff.outletId);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : istToday(now, cutoff);
  const from = istDayStart(day, cutoff);
  const to = new Date(from.getTime() + DAY);

  const [[bills], methods, [refunds], [orders], lines, [visits], top, open] = await Promise.all([
    db
      .select({
        n: count(),
        subtotal: sql<number>`coalesce(sum(${s.bills.subtotalPaise}), 0)`.mapWith(Number),
        discount: sql<number>`coalesce(sum(${s.bills.discountPaise}), 0)`.mapWith(Number),
        service: sql<number>`coalesce(sum(${s.bills.serviceChargePaise}), 0)`.mapWith(Number),
        tax: sql<number>`coalesce(sum(${s.bills.taxPaise}), 0)`.mapWith(Number),
        tips: sql<number>`coalesce(sum(${s.bills.tipPaise}), 0)`.mapWith(Number),
        roundOff: sql<number>`coalesce(sum(${s.bills.roundOffPaise}), 0)`.mapWith(Number),
        total: sql<number>`coalesce(sum(${s.bills.totalPaise}), 0)`.mapWith(Number),
      })
      .from(s.bills)
      .where(and(eq(s.bills.tenantId, staff.tenantId), eq(s.bills.outletId, staff.outletId), eq(s.bills.status, "paid"), gte(s.bills.closedAt, from), lt(s.bills.closedAt, to))),
    db
      .select({ method: s.payments.method, paise: sql<number>`sum(${s.payments.amountPaise} + ${s.payments.tipPaise})`.mapWith(Number), n: count() })
      .from(s.payments)
      .where(and(eq(s.payments.tenantId, staff.tenantId), eq(s.payments.outletId, staff.outletId), eq(s.payments.status, "success"), gte(s.payments.createdAt, from), lt(s.payments.createdAt, to)))
      .groupBy(s.payments.method),
    db
      .select({ n: count(), paise: sql<number>`coalesce(sum(${s.refunds.amountPaise}), 0)`.mapWith(Number) })
      .from(s.refunds)
      .innerJoin(s.payments, and(eq(s.payments.tenantId, s.refunds.tenantId), eq(s.payments.id, s.refunds.paymentId)))
      .where(and(eq(s.refunds.tenantId, staff.tenantId), eq(s.payments.outletId, staff.outletId), eq(s.refunds.status, "success"), gte(s.refunds.createdAt, from), lt(s.refunds.createdAt, to))),
    db.select({ n: count() }).from(s.orders).where(and(eq(s.orders.tenantId, staff.tenantId), eq(s.orders.outletId, staff.outletId), gte(s.orders.placedAt, from), lt(s.orders.placedAt, to))),
    db
      .select({ status: s.orderLines.status, qty: sql<number>`sum(${s.orderLines.qty})`.mapWith(Number), paise: sql<number>`sum(${s.orderLines.qty} * ${s.orderLines.unitPricePaise})`.mapWith(Number) })
      .from(s.orderLines)
      .innerJoin(s.orders, and(eq(s.orders.tenantId, s.orderLines.tenantId), eq(s.orders.id, s.orderLines.orderId)))
      .where(and(eq(s.orders.tenantId, staff.tenantId), eq(s.orders.outletId, staff.outletId), gte(s.orders.placedAt, from), lt(s.orders.placedAt, to)))
      .groupBy(s.orderLines.status),
    db
      .select({ n: count(), covers: sql<number>`coalesce(sum(${s.tableSessions.partySize}), 0)`.mapWith(Number) })
      .from(s.tableSessions)
      .where(and(eq(s.tableSessions.tenantId, staff.tenantId), eq(s.tableSessions.outletId, staff.outletId), gte(s.tableSessions.openedAt, from), lt(s.tableSessions.openedAt, to))),
    db
      .select({ name: s.orderLines.nameEn, qty: sql<number>`sum(${s.orderLines.qty})`.mapWith(Number), paise: sql<number>`sum(${s.orderLines.qty} * ${s.orderLines.unitPricePaise})`.mapWith(Number) })
      .from(s.orderLines)
      .innerJoin(s.orders, and(eq(s.orders.tenantId, s.orderLines.tenantId), eq(s.orders.id, s.orderLines.orderId)))
      .where(and(eq(s.orders.tenantId, staff.tenantId), eq(s.orders.outletId, staff.outletId), gte(s.orders.placedAt, from), lt(s.orders.placedAt, to), inArray(s.orderLines.status, ["placed", "accepted", "preparing", "ready", "served"])))
      .groupBy(s.orderLines.nameEn)
      .orderBy(desc(sql`sum(${s.orderLines.qty})`))
      .limit(5),
    // Tables still open right now, with what they owe: settle these before closing the day
    db
      .select({ table: s.diningTables.code, total: s.bills.totalPaise })
      .from(s.tableSessions)
      .innerJoin(s.diningTables, and(eq(s.diningTables.tenantId, s.tableSessions.tenantId), eq(s.diningTables.id, s.tableSessions.tableId)))
      .leftJoin(s.bills, and(eq(s.bills.tenantId, s.tableSessions.tenantId), eq(s.bills.sessionId, s.tableSessions.id)))
      .where(and(eq(s.tableSessions.tenantId, staff.tenantId), eq(s.tableSessions.outletId, staff.outletId), ne(s.tableSessions.status, "closed"))),
  ]);

  const served = lines.filter((l) => l.status !== "voided" && l.status !== "cancelled");
  const removed = lines.filter((l) => l.status === "voided" || l.status === "cancelled");
  const collected = methods.reduce((n, m) => n + m.paise, 0);
  return {
    date: day,
    isToday: day === istToday(now, cutoff),
    /** Business day ends this many minutes after midnight (0 = midnight) */
    cutoffMinutes: cutoff,
    bills: { count: bills.n, subtotalPaise: bills.subtotal, discountPaise: bills.discount, serviceChargePaise: bills.service, taxPaise: bills.tax, tipsPaise: bills.tips, roundOffPaise: bills.roundOff, totalPaise: bills.total },
    methods: methods.map((m) => ({ method: m.method, paise: m.paise, count: m.n })).sort((a, b) => b.paise - a.paise),
    collectedPaise: collected,
    refunds: { count: refunds.n, paise: refunds.paise },
    netPaise: collected - refunds.paise,
    orders: orders.n,
    itemsSold: served.reduce((n, l) => n + l.qty, 0),
    removed: { qty: removed.reduce((n, l) => n + l.qty, 0), paise: removed.reduce((n, l) => n + l.paise, 0) },
    visits: { count: visits.n, covers: visits.covers },
    averageBillPaise: bills.n ? Math.round(bills.total / bills.n) : 0,
    topItems: top,
    openTables: open.map((o) => ({ table: o.table, totalPaise: o.total ?? 0 })),
  };
}
