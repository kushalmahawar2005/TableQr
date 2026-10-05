import "server-only";
import { and, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { canSee } from "@/lib/staff-permissions";
import { AppError } from "../errors";
import type { StaffSession } from "./auth";

// Reports (read-only): the signed-in outlet over 7, 30 or 90 days. Revenue is net sales from paid
// bills (bills.total_paise, tips excluded), the same definition as the dashboard. Days are IST.

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "roles">;
export type ReportRange = 7 | 30 | 90;
const DAY = 86_400_000;
const IST = 330 * 60_000;

export type Report = {
  range: ReportRange;
  days: { date: string; revenuePaise: number; bills: number; orders: number }[];
  totals: { revenuePaise: number; bills: number; orders: number; tipsPaise: number; taxPaise: number };
  topItems: { name: string; qty: number; grossPaise: number }[];
  methods: { method: string; paise: number; count: number }[];
  byHour: number[];
  /** Same measures for the equally long period just before this one, for "vs previous" arrows */
  prev: { revenuePaise: number; bills: number; orders: number };
  /** Sunday = 0 */
  weekday: { revenuePaise: number; bills: number }[];
  /** orders by weekday (Sunday = 0) and hour */
  heat: number[][];
  categories: { name: string; qty: number; grossPaise: number }[];
  extras: {
    discountPaise: number; serviceChargePaise: number; itemsSold: number; voidedLines: number; voidedPaise: number;
    avgPrepMin: number | null; avgStayMin: number | null; covers: number; visits: number;
    bySource: { source: string; count: number }[];
  };
};

const istDay = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);

export async function getReport(staff: Staff, range: ReportRange, now: Date): Promise<Report> {
  if (!canSee(staff.roles, "reports")) throw new AppError("forbidden", "Your role cannot view reports.");
  if (![7, 30, 90].includes(range)) range = 30;
  const todayStartUtc = new Date(Math.floor((now.getTime() + IST) / DAY) * DAY - IST);
  const from = new Date(todayStartUtc.getTime() - (range - 1) * DAY);
  const scopeBill = and(eq(s.bills.tenantId, staff.tenantId), eq(s.bills.outletId, staff.outletId));
  const scopeOrder = and(eq(s.orders.tenantId, staff.tenantId), eq(s.orders.outletId, staff.outletId));

    const prevFrom = new Date(from.getTime() - range * DAY);
  const [bills, orders, items, payRows, prevBills, prevOrders, sessions, voids, cats] = await Promise.all([
    db.select({ closedAt: s.bills.closedAt, total: s.bills.totalPaise, tax: s.bills.taxPaise, tip: s.bills.tipPaise, discount: s.bills.discountPaise, service: s.bills.serviceChargePaise })
      .from(s.bills).where(and(scopeBill, eq(s.bills.status, "paid"), gte(s.bills.closedAt, from))),
    db.select({ id: s.orders.id, placedAt: s.orders.placedAt, readyAt: s.orders.readyAt }).from(s.orders).where(and(scopeOrder, gte(s.orders.placedAt, from))),
    db.select({ name: s.orderLines.nameEn, qty: sql<number>`sum(${s.orderLines.qty})`.mapWith(Number), gross: sql<number>`sum(${s.orderLines.qty} * ${s.orderLines.unitPricePaise})`.mapWith(Number) })
      .from(s.orderLines).innerJoin(s.orders, and(eq(s.orderLines.orderId, s.orders.id), eq(s.orderLines.tenantId, s.orders.tenantId)))
      .where(and(scopeOrder, gte(s.orders.placedAt, from), inArray(s.orderLines.status, ["placed", "accepted", "preparing", "ready", "served"])))
      .groupBy(s.orderLines.nameEn).orderBy(desc(sql`sum(${s.orderLines.qty})`)).limit(10),
    db.select({ method: s.payments.method, paise: sql<number>`sum(${s.payments.amountPaise} + ${s.payments.tipPaise})`.mapWith(Number), n: count() })
      .from(s.payments).where(and(eq(s.payments.tenantId, staff.tenantId), eq(s.payments.outletId, staff.outletId), eq(s.payments.status, "success"), gte(s.payments.createdAt, from)))
      .groupBy(s.payments.method),
    db.select({ n: count(), total: sql<number>`coalesce(sum(${s.bills.totalPaise}), 0)`.mapWith(Number) })
      .from(s.bills).where(and(scopeBill, eq(s.bills.status, "paid"), gte(s.bills.closedAt, prevFrom), lt(s.bills.closedAt, from))),
    db.select({ n: count() }).from(s.orders).where(and(scopeOrder, gte(s.orders.placedAt, prevFrom), lt(s.orders.placedAt, from))),
    db.select({ openedAt: s.tableSessions.openedAt, closedAt: s.tableSessions.closedAt, party: s.tableSessions.partySize, source: s.tableSessions.source })
      .from(s.tableSessions).where(and(eq(s.tableSessions.tenantId, staff.tenantId), eq(s.tableSessions.outletId, staff.outletId), eq(s.tableSessions.status, "closed"), gte(s.tableSessions.openedAt, from))),
    db.select({ n: sql<number>`coalesce(sum(${s.orderLines.qty}), 0)`.mapWith(Number), gross: sql<number>`coalesce(sum(${s.orderLines.qty} * ${s.orderLines.unitPricePaise}), 0)`.mapWith(Number) })
      .from(s.orderLines).innerJoin(s.orders, and(eq(s.orderLines.orderId, s.orders.id), eq(s.orderLines.tenantId, s.orders.tenantId)))
      .where(and(scopeOrder, gte(s.orders.placedAt, from), eq(s.orderLines.status, "voided"))),
    db.select({ name: s.menuCategories.nameEn, qty: sql<number>`sum(${s.orderLines.qty})`.mapWith(Number), gross: sql<number>`sum(${s.orderLines.qty} * ${s.orderLines.unitPricePaise})`.mapWith(Number) })
      .from(s.orderLines)
      .innerJoin(s.orders, and(eq(s.orderLines.orderId, s.orders.id), eq(s.orderLines.tenantId, s.orders.tenantId)))
      .innerJoin(s.menuItems, and(eq(s.orderLines.itemId, s.menuItems.id), eq(s.orderLines.tenantId, s.menuItems.tenantId)))
      .innerJoin(s.menuCategories, and(eq(s.menuItems.categoryId, s.menuCategories.id), eq(s.menuItems.tenantId, s.menuCategories.tenantId)))
      .where(and(scopeOrder, gte(s.orders.placedAt, from), inArray(s.orderLines.status, ["placed", "accepted", "preparing", "ready", "served"])))
      .groupBy(s.menuCategories.nameEn).orderBy(desc(sql`sum(${s.orderLines.qty} * ${s.orderLines.unitPricePaise})`)).limit(8),
  ]);

  const days = Array.from({ length: range }, (_, i) => ({ date: istDay(new Date(from.getTime() + i * DAY)), revenuePaise: 0, bills: 0, orders: 0 }));
  const index = new Map(days.map((d, i) => [d.date, i]));
  const totals = { revenuePaise: 0, bills: 0, orders: orders.length, tipsPaise: 0, taxPaise: 0 };
  const weekday = Array.from({ length: 7 }, () => ({ revenuePaise: 0, bills: 0 }));
  const extra = { discountPaise: 0, serviceChargePaise: 0 };
  for (const b of bills) {
    if (!b.closedAt) continue;
    const i = index.get(istDay(b.closedAt));
    if (i === undefined) continue;
    days[i].revenuePaise += b.total; days[i].bills += 1;
    totals.revenuePaise += b.total; totals.bills += 1; totals.tipsPaise += b.tip; totals.taxPaise += b.tax;
    extra.discountPaise += b.discount; extra.serviceChargePaise += b.service;
    const w = new Date(b.closedAt.getTime() + IST).getUTCDay();
    weekday[w].revenuePaise += b.total; weekday[w].bills += 1;
  }
  const byHour = Array.from({ length: 24 }, () => 0);
  const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  let prepTotal = 0, prepN = 0;
  for (const o of orders) {
    const ist = new Date(o.placedAt.getTime() + IST);
    heat[ist.getUTCDay()][ist.getUTCHours()] += 1;
    if (o.readyAt) { const m = (o.readyAt.getTime() - o.placedAt.getTime()) / 60_000; if (m >= 0 && m < 240) { prepTotal += m; prepN += 1; } }
    const i = index.get(istDay(o.placedAt));
    if (i !== undefined) days[i].orders += 1;
    byHour[new Date(o.placedAt.getTime() + IST).getUTCHours()] += 1;
  }
  let stayTotal = 0, stayN = 0, covers = 0;
  const sources = new Map<string, number>();
  for (const v of sessions) {
    covers += v.party ?? 0;
    sources.set(v.source, (sources.get(v.source) ?? 0) + 1);
    if (v.closedAt) { const m = (v.closedAt.getTime() - v.openedAt.getTime()) / 60_000; if (m > 0 && m < 480) { stayTotal += m; stayN += 1; } }
  }
  const itemsSold = items.reduce((n, r) => n + r.qty, 0);
  return {
    range, days, totals, weekday, heat,
    prev: { revenuePaise: prevBills[0]?.total ?? 0, bills: Number(prevBills[0]?.n ?? 0), orders: Number(prevOrders[0]?.n ?? 0) },
    categories: cats.map((r) => ({ name: r.name, qty: r.qty, grossPaise: r.gross })),
    extras: {
      ...extra, itemsSold, voidedLines: voids[0]?.n ?? 0, voidedPaise: voids[0]?.gross ?? 0,
      avgPrepMin: prepN ? Math.round(prepTotal / prepN) : null, avgStayMin: stayN ? Math.round(stayTotal / stayN) : null,
      covers, visits: sessions.length, bySource: [...sources].map(([source, n]) => ({ source, count: n })).sort((a, b) => b.count - a.count),
    },
     topItems: items.map((r) => ({ name: r.name, qty: r.qty, grossPaise: r.gross })), methods: payRows.map((r) => ({ method: r.method, paise: r.paise, count: Number(r.n) })).sort((a, b) => b.paise - a.paise), byHour };
}
