import "server-only";
import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { canSee } from "@/lib/staff-permissions";
import { AppError } from "../errors";
import { requireFeature } from "../plan";
import type { StaffSession } from "./auth";
import { outletDayCutoff } from "./business-day";
import { istDayStart, istToday } from "./day-close";

// Item and staff report: every dish sold in a date range (and the ones that did not sell), sales by
// who put the order in, and the discounts and cancelled items each person is answerable for.
// Days are business days on India time, like Day close.

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "roles">;
const DAY = 86_400_000;
const SOLD = ["placed", "accepted", "preparing", "ready", "served"] as const;
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

export type SalesDetail = Awaited<ReturnType<typeof getSalesDetail>>;

export async function getSalesDetail(staff: Staff, input: { from?: string; to?: string }, now = new Date()) {
  if (!canSee(staff.roles, "reports")) throw new AppError("forbidden", "Your role cannot view reports.");
  await requireFeature(staff.tenantId, "fullReports");
  const cutoff = await outletDayCutoff(staff.tenantId, staff.outletId);
  const startOf = (date: string) => istDayStart(date, cutoff);
  const today = istToday(now, cutoff);
  let to = input.to && isDate(input.to) ? input.to : today;
  if (to > today) to = today;
  let from = input.from && isDate(input.from) ? input.from : to;
  if (from > to) from = to;
  // No more than a year at once
  if (Date.parse(to) - Date.parse(from) > 366 * DAY) from = new Date(Date.parse(to) - 366 * DAY).toISOString().slice(0, 10);
  const start = startOf(from);
  const end = new Date(startOf(to).getTime() + DAY);

  const orderScope = and(eq(s.orders.tenantId, staff.tenantId), eq(s.orders.outletId, staff.outletId), gte(s.orders.placedAt, start), lt(s.orders.placedAt, end));
  const lineJoin = and(eq(s.orderLines.tenantId, s.orders.tenantId), eq(s.orderLines.orderId, s.orders.id));
  const qty = sql<number>`coalesce(sum(${s.orderLines.qty}), 0)`.mapWith(Number);
  const gross = sql<number>`coalesce(sum(${s.orderLines.qty} * ${s.orderLines.unitPricePaise}), 0)`.mapWith(Number);

  const [[outlet], items, staffSales, voids, discounts] = await Promise.all([
    db.select({ brandId: s.outlets.brandId }).from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId))),
    db
      .select({ itemId: s.orderLines.itemId, name: s.orderLines.nameEn, qty, gross, orders: sql<number>`count(distinct ${s.orders.id})`.mapWith(Number) })
      .from(s.orderLines)
      .innerJoin(s.orders, lineJoin)
      .where(and(orderScope, inArray(s.orderLines.status, [...SOLD])))
      .groupBy(s.orderLines.itemId, s.orderLines.nameEn),
    db
      .select({ userId: s.orders.placedByUserId, orders: sql<number>`count(distinct ${s.orders.id})`.mapWith(Number), qty, gross })
      .from(s.orderLines)
      .innerJoin(s.orders, lineJoin)
      .where(and(orderScope, inArray(s.orderLines.status, [...SOLD])))
      .groupBy(s.orders.placedByUserId),
    db
      .select({ userId: s.orderLines.voidedByUserId, lines: sql<number>`count(*)`.mapWith(Number), qty, gross })
      .from(s.orderLines)
      .innerJoin(s.orders, lineJoin)
      .where(and(orderScope, eq(s.orderLines.status, "voided")))
      .groupBy(s.orderLines.voidedByUserId),
    db
      .select({ userId: s.discounts.appliedByUserId, n: sql<number>`count(*)`.mapWith(Number), paise: sql<number>`coalesce(sum(${s.discounts.amountPaise}), 0)`.mapWith(Number), reasons: sql<string>`group_concat(distinct ${s.discounts.reason} separator ' | ')` })
      .from(s.discounts)
      .innerJoin(s.bills, and(eq(s.bills.tenantId, s.discounts.tenantId), eq(s.bills.id, s.discounts.billId)))
      .where(and(eq(s.discounts.tenantId, staff.tenantId), eq(s.bills.outletId, staff.outletId), gte(s.discounts.createdAt, start), lt(s.discounts.createdAt, end)))
      .groupBy(s.discounts.appliedByUserId),
  ]);

  // The menu, for categories and for dishes that did not sell at all
  const menu = outlet
    ? await db
        .select({ id: s.menuItems.id, name: s.menuItems.nameEn, category: s.menuCategories.nameEn, active: s.menuItems.isActive })
        .from(s.menuItems)
        .innerJoin(s.menuCategories, and(eq(s.menuCategories.tenantId, s.menuItems.tenantId), eq(s.menuCategories.id, s.menuItems.categoryId)))
        .where(and(eq(s.menuItems.tenantId, staff.tenantId), eq(s.menuItems.brandId, outlet.brandId)))
    : [];
  const categoryOf = new Map(menu.map((m) => [m.id, m.category]));

  const userIds = [...new Set([...staffSales, ...voids, ...discounts].map((r) => r.userId).filter((id): id is string => !!id))];
  const people = userIds.length
    ? await db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(and(eq(s.users.tenantId, staff.tenantId), inArray(s.users.id, userIds), isNotNull(s.users.name)))
    : [];
  const nameOf = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name ?? "Former staff") : null);

  // The same dish can appear under two names if it was renamed; one row per dish, latest name
  const byItem = new Map<string, { itemId: string; name: string; category: string; qty: number; grossPaise: number; orders: number }>();
  for (const r of items) {
    const row = byItem.get(r.itemId) ?? { itemId: r.itemId, name: r.name, category: categoryOf.get(r.itemId) ?? "Other", qty: 0, grossPaise: 0, orders: 0 };
    row.qty += r.qty;
    row.grossPaise += r.gross;
    row.orders += r.orders;
    byItem.set(r.itemId, row);
  }
  const sold = [...byItem.values()].sort((a, b) => b.qty - a.qty || b.grossPaise - a.grossPaise);
  const totalGross = sold.reduce((n, r) => n + r.grossPaise, 0);

  return {
    from,
    to,
    today,
    totals: { grossPaise: totalGross, qty: sold.reduce((n, r) => n + r.qty, 0), dishes: sold.length },
    items: sold.map((r) => ({ ...r, sharePct: totalGross ? Math.round((r.grossPaise / totalGross) * 1000) / 10 : 0 })),
    notSold: menu.filter((m) => m.active && !byItem.has(m.id)).map((m) => ({ name: m.name, category: m.category })).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    staff: staffSales
      .map((r) => ({ name: nameOf(r.userId) ?? "Guests (QR orders)", guests: !r.userId, orders: r.orders, qty: r.qty, grossPaise: r.gross }))
      .sort((a, b) => b.grossPaise - a.grossPaise),
    voids: voids.map((r) => ({ name: nameOf(r.userId) ?? "Not recorded", lines: r.lines, qty: r.qty, grossPaise: r.gross })).sort((a, b) => b.grossPaise - a.grossPaise),
    discounts: discounts.map((r) => ({ name: nameOf(r.userId) ?? "Not recorded", count: r.n, paise: r.paise, reasons: r.reasons ?? "" })).sort((a, b) => b.paise - a.paise),
  };
}
