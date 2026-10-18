import "server-only";

import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import type { TenantDetail } from "@/app/admin/admin-types";
import { requirePlatformAdmin } from "./auth";

const DAY = 86_400_000;

/** One tenant's drill-down for the platform admin panel. Every query is pinned to the given tenant. */
export async function getTenantDetail(tenantId: string): Promise<TenantDetail | null> {
  await requirePlatformAdmin();
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(today.getTime() - 29 * DAY);
  const orderDay = sql<string>`date_format(${s.orders.placedAt}, '%Y-%m-%d')`;
  const paidAt = sql`coalesce(${s.bills.closedAt}, ${s.bills.updatedAt})`;
  const billDay = sql<string>`date_format(${paidAt}, '%Y-%m-%d')`;

  // isolation-exempt: authenticated platform admins inspect a single tenant; each query filters on tenantId.
  const [[tenant], planRow, orderDays, billDays, outletRows, staffRows, [qr], [menu], [orderTotal], recentOrders, recentUsers, [roomCount]] = await Promise.all([
    db.select({ planCode: s.tenants.planCode }).from(s.tenants).where(eq(s.tenants.id, tenantId)),
    db.select({ features: s.plans.features }).from(s.tenants).innerJoin(s.plans, eq(s.tenants.planCode, s.plans.code)).where(eq(s.tenants.id, tenantId)),
    db.select({ date: orderDay, total: count() }).from(s.orders).where(and(eq(s.orders.tenantId, tenantId), gte(s.orders.placedAt, start))).groupBy(orderDay),
    db.select({ date: billDay, total: sql<number>`coalesce(sum(${s.bills.totalPaise}), 0)`.mapWith(Number) }).from(s.bills)
      .where(and(eq(s.bills.tenantId, tenantId), eq(s.bills.status, "paid"), sql`${paidAt} >= ${start}`)).groupBy(billDay),
    db.select({ id: s.outlets.id, name: s.outlets.name, code: s.outlets.code, city: s.outlets.city, tables: count(s.diningTables.id) })
      .from(s.outlets).leftJoin(s.diningTables, and(eq(s.diningTables.outletId, s.outlets.id), eq(s.diningTables.tenantId, s.outlets.tenantId), eq(s.diningTables.isActive, true)))
      .where(eq(s.outlets.tenantId, tenantId)).groupBy(s.outlets.id, s.outlets.name, s.outlets.code, s.outlets.city),
    db.select({ id: s.users.id, name: s.users.name, phone: s.users.phone, isActive: s.users.isActive, role: s.staffRoles.role })
      .from(s.staffRoles).innerJoin(s.users, and(eq(s.staffRoles.userId, s.users.id), eq(s.users.tenantId, s.staffRoles.tenantId)))
      .where(eq(s.staffRoles.tenantId, tenantId)),
    db.select({ total: count() }).from(s.qrCodes).where(eq(s.qrCodes.tenantId, tenantId)),
    db.select({ total: count() }).from(s.menuItems).where(and(eq(s.menuItems.tenantId, tenantId), eq(s.menuItems.isActive, true))),
    db.select({ total: count() }).from(s.orders).where(eq(s.orders.tenantId, tenantId)),
    db.select({ id: s.orders.id, outletName: s.outlets.name, createdAt: s.orders.placedAt }).from(s.orders)
      .innerJoin(s.outlets, and(eq(s.orders.outletId, s.outlets.id), eq(s.orders.tenantId, s.outlets.tenantId)))
      .where(eq(s.orders.tenantId, tenantId)).orderBy(desc(s.orders.placedAt)).limit(4),
    db.select({ id: s.users.id, name: s.users.name, createdAt: s.users.createdAt }).from(s.users).where(eq(s.users.tenantId, tenantId)).orderBy(desc(s.users.createdAt)).limit(3),
    db.select({ total: count() }).from(s.rooms).where(and(eq(s.rooms.tenantId, tenantId), eq(s.rooms.isActive, true))),
  ]);
  if (!tenant) return null;

  const ordersByDay = new Map(orderDays.map((r) => [r.date, Number(r.total)]));
  const billsByDay = new Map(billDays.map((r) => [r.date, Number(r.total)]));
  const daily = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(start.getTime() + i * DAY).toISOString().slice(0, 10);
    return { date, orders: ordersByDay.get(date) ?? 0, revenuePaise: billsByDay.get(date) ?? 0 };
  });

  const tables = outletRows.reduce((sum, o) => sum + Number(o.tables), 0);
  const staffUsers = new Set(staffRows.map((r) => r.id)).size;
  const features = planRow[0]?.features;
  const steps = [
    { label: "Outlet created", done: outletRows.length > 0 },
    { label: "Tables added", done: tables > 0 },
    { label: "Menu items added", done: Number(menu.total) > 0 },
    { label: "Team members added", done: staffUsers > 1 },
    { label: "First order received", done: Number(orderTotal.total) > 0 },
  ];

  return {
    daily,
    usage: { outlets: outletRows.length, tables, maxTables: features?.maxTables ?? null, staff: staffUsers, maxStaff: features?.maxStaff ?? null, rooms: Number(roomCount.total), maxRooms: features?.maxRooms ?? null, qrCodes: Number(qr.total), menuItems: Number(menu.total) },
    outlets: outletRows.map((o) => ({ ...o, tables: Number(o.tables) })),
    staff: staffRows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, role: r.role, isActive: r.isActive })),
    activity: [
      ...recentOrders.map((o) => ({ id: `o-${o.id}`, title: "Order placed", description: o.outletName, createdAt: o.createdAt.toISOString() })),
      ...recentUsers.map((u) => ({ id: `u-${u.id}`, title: "Team member added", description: u.name, createdAt: u.createdAt.toISOString() })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6),
    setup: { steps, percent: Math.round((steps.filter((x) => x.done).length / steps.length) * 100) },
  };
}
