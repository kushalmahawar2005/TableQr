import "server-only";

import { and, count, countDistinct, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import type { AnalyticsData, AnalyticsRange } from "@/app/admin/admin-types";
import { requirePlatformAdmin } from "./auth";

const DAY = 86_400_000;

/** Platform-wide usage analytics for one period. Aggregates only; no guest data is read. */
export async function getAnalyticsData(range: AnalyticsRange): Promise<AnalyticsData> {
  await requirePlatformAdmin();
  if (![7, 30, 90].includes(range)) range = 30;
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(today.getTime() - (range - 1) * DAY);
  const previousStart = new Date(start.getTime() - range * DAY);

  const paidAt = sql`coalesce(${s.bills.closedAt}, ${s.bills.updatedAt})`;
  const sales = sql<number>`coalesce(sum(${s.bills.totalPaise}), 0)`.mapWith(Number);
  const paid = and(eq(s.bills.status, "paid"), sql`${paidAt} >= ${start}`);
  const orderDay = sql<string>`date_format(${s.orders.placedAt}, '%Y-%m-%d')`;
  const billDay = sql<string>`date_format(${paidAt}, '%Y-%m-%d')`;
  const local = sql`date_add(${s.orders.placedAt}, interval 330 minute)`;
  const hour = sql<number>`hour(${local})`.mapWith(Number);
  const weekday = sql<number>`dayofweek(${local}) - 1`.mapWith(Number);

  // isolation-exempt: authenticated platform admins read cross-tenant aggregates for analytics.
  const [
    [orderTotals], [prevOrderTotals], [salesTotals], [prevSalesTotals],
    orderDays, billDays, hourRows, weekdayRows, topOrderRows, topSalesRows, cityOrderRows, citySalesRows,
    [tenantTotal], [withOutlet], [withTables], [withMenu], [withOrders], [withPaid],
  ] = await Promise.all([
    db.select({ orders: count(), tenants: countDistinct(s.orders.tenantId) }).from(s.orders).where(gte(s.orders.placedAt, start)),
    db.select({ orders: count(), tenants: countDistinct(s.orders.tenantId) }).from(s.orders).where(and(gte(s.orders.placedAt, previousStart), lt(s.orders.placedAt, start))),
    db.select({ sales, bills: count() }).from(s.bills).where(paid),
    db.select({ sales, bills: count() }).from(s.bills).where(and(eq(s.bills.status, "paid"), sql`${paidAt} >= ${previousStart}`, sql`${paidAt} < ${start}`)),
    db.select({ date: orderDay, total: count() }).from(s.orders).where(gte(s.orders.placedAt, start)).groupBy(orderDay),
    db.select({ date: billDay, total: sales }).from(s.bills).where(paid).groupBy(billDay),
    db.select({ h: hour, total: count() }).from(s.orders).where(gte(s.orders.placedAt, start)).groupBy(hour),
    db.select({ d: weekday, total: count() }).from(s.orders).where(gte(s.orders.placedAt, start)).groupBy(weekday),
    db.select({ id: s.orders.tenantId, name: s.tenants.name, total: count() }).from(s.orders).innerJoin(s.tenants, eq(s.orders.tenantId, s.tenants.id))
      .where(gte(s.orders.placedAt, start)).groupBy(s.orders.tenantId, s.tenants.name),
    db.select({ id: s.bills.tenantId, total: sales }).from(s.bills).where(paid).groupBy(s.bills.tenantId),
    db.select({ city: s.outlets.city, total: count() }).from(s.orders).innerJoin(s.outlets, and(eq(s.orders.outletId, s.outlets.id), eq(s.orders.tenantId, s.outlets.tenantId)))
      .where(gte(s.orders.placedAt, start)).groupBy(s.outlets.city),
    db.select({ city: s.outlets.city, total: sales }).from(s.bills).innerJoin(s.outlets, and(eq(s.bills.outletId, s.outlets.id), eq(s.bills.tenantId, s.outlets.tenantId)))
      .where(paid).groupBy(s.outlets.city),
    db.select({ total: count() }).from(s.tenants),
    db.select({ total: countDistinct(s.outlets.tenantId) }).from(s.outlets),
    db.select({ total: countDistinct(s.diningTables.tenantId) }).from(s.diningTables),
    db.select({ total: countDistinct(s.menuItems.tenantId) }).from(s.menuItems),
    db.select({ total: countDistinct(s.orders.tenantId) }).from(s.orders),
    // isolation-exempt: platform admin platform-wide count of restaurants with a paid bill
    db.select({ total: countDistinct(s.bills.tenantId) }).from(s.bills).where(eq(s.bills.status, "paid")),
  ]);

  const ordersByDay = new Map(orderDays.map((r) => [r.date, Number(r.total)]));
  const salesByDay = new Map(billDays.map((r) => [r.date, Number(r.total)]));
  const daily = Array.from({ length: range }, (_, i) => {
    const date = new Date(start.getTime() + i * DAY).toISOString().slice(0, 10);
    return { date, orders: ordersByDay.get(date) ?? 0, salesPaise: salesByDay.get(date) ?? 0 };
  });
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const r of hourRows) if (r.h >= 0 && r.h < 24) byHour[r.h] = Number(r.total);
  const byWeekday = Array.from({ length: 7 }, () => 0);
  for (const r of weekdayRows) if (r.d >= 0 && r.d < 7) byWeekday[r.d] = Number(r.total);

  const salesByTenant = new Map(topSalesRows.map((r) => [r.id, Number(r.total)]));
  const topTenants = topOrderRows.map((r) => ({ id: r.id, name: r.name, orders: Number(r.total), salesPaise: salesByTenant.get(r.id) ?? 0 }))
    .sort((a, b) => b.salesPaise - a.salesPaise || b.orders - a.orders).slice(0, 8);
  const citySales = new Map(citySalesRows.map((r) => [r.city, Number(r.total)]));
  const topCities = cityOrderRows.map((r) => ({ city: r.city, orders: Number(r.total), salesPaise: citySales.get(r.city) ?? 0 }))
    .sort((a, b) => b.salesPaise - a.salesPaise || b.orders - a.orders).slice(0, 8);

  return {
    range,
    totals: {
      salesPaise: Number(salesTotals.sales), previousSalesPaise: Number(prevSalesTotals.sales),
      orders: Number(orderTotals.orders), previousOrders: Number(prevOrderTotals.orders),
      activeTenants: Number(orderTotals.tenants), previousActiveTenants: Number(prevOrderTotals.tenants),
      paidBills: Number(salesTotals.bills), previousPaidBills: Number(prevSalesTotals.bills),
    },
    daily, byHour, byWeekday, topTenants, topCities,
    funnel: {
      tenants: Number(tenantTotal.total), withOutlet: Number(withOutlet.total), withTables: Number(withTables.total),
      withMenu: Number(withMenu.total), withOrders: Number(withOrders.total), withPaidBill: Number(withPaid.total),
    },
  };
}
