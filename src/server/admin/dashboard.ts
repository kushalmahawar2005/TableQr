import "server-only";

import { and, asc, count, desc, eq, gte, lte, sql, type AnyColumn } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import type { AdminActivity, AdminData, AdminGrowthPoint } from "@/app/admin/admin-types";
import { requirePlatformAdmin } from "./auth";
import { readFeatures } from "@/lib/plan-features";
import { effectiveFeatures, hasKitchenDisplay } from "../plan";
import { accessFrom } from "../access";

const DAY = 86_400_000;

function percentageChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

function periodCount(column: AnyColumn, start: Date, end: Date) {
  return sql<number>`coalesce(sum(case when ${column} >= ${start} and ${column} < ${end} then 1 else 0 end), 0)`.mapWith(Number);
}

/** Only platform administrators may read this intentionally cross-tenant overview. */
export async function getAdminData(): Promise<AdminData> {
  await requirePlatformAdmin();

  const now = new Date();
  const recentStart = new Date(now.getTime() - 30 * DAY);
  const previousStart = new Date(now.getTime() - 60 * DAY);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const growthStart = new Date(today.getTime() - 89 * DAY);
  const outletDay = sql<string>`date_format(${s.outlets.createdAt}, '%Y-%m-%d')`;
  const orderDay = sql<string>`date_format(${s.orders.placedAt}, '%Y-%m-%d')`;
  const paidAt = sql`coalesce(${s.bills.closedAt}, ${s.bills.updatedAt})`;

  // Rank in SQL so historical subscription periods are not downloaded to the client.
  const rankedSubscriptions = db.select({
    id: s.subscriptions.id,
    periodStart: s.subscriptions.periodStart,
    tenantId: s.subscriptions.tenantId,
    pricePerOutletPaise: s.subscriptions.pricePerOutletPaise,
    billingCycle: s.subscriptions.billingCycle,
    periodEnd: s.subscriptions.periodEnd,
    status: s.subscriptions.status,
    rank: sql<number>`row_number() over (partition by ${s.subscriptions.tenantId} order by ${s.subscriptions.periodStart} desc, ${s.subscriptions.createdAt} desc, ${s.subscriptions.id} desc)`.as("period_rank"),
    // isolation-exempt: authenticated platform admins inspect each tenant's latest subscription, including months paid in advance.
  }).from(s.subscriptions).as("ranked_subscriptions");

  // isolation-exempt: authenticated platform admins see every restaurant's open plan requests
  const requestRows = await db.select({ id: s.planRequests.id, tenantId: s.planRequests.tenantId, feature: s.planRequests.feature, note: s.planRequests.note, requestedBy: s.planRequests.requestedBy, createdAt: s.planRequests.createdAt })
    .from(s.planRequests).where(eq(s.planRequests.status, "open")).orderBy(desc(s.planRequests.createdAt));
  // isolation-exempt: authenticated platform admins see plan payments still being confirmed.
  const claimRows = await db.select({ tenantId: s.feePayments.tenantId, amountPaise: s.feePayments.amountPaise, createdAt: s.feePayments.createdAt, method: s.feePayments.method }).from(s.feePayments).where(eq(s.feePayments.status, "claimed"));
  const claimByTenant = new Map(claimRows.map((c) => [c.tenantId, { amountPaise: c.amountPaise, createdAt: c.createdAt.toISOString(), method: c.method }]));
  const requestsByTenant = new Map<string, { id: string; feature: string | null; note: string | null; requestedBy: string; createdAt: string }[]>();
  for (const r of requestRows) requestsByTenant.set(r.tenantId, [...(requestsByTenant.get(r.tenantId) ?? []), { id: r.id, feature: r.feature, note: r.note, requestedBy: r.requestedBy, createdAt: r.createdAt.toISOString() }]);

  const [tenantRows, planRows, outletGroups, outletDays, [orderStats], orderDays, [revenueStats], subscriptionRows, recentOutlets, recentOrders, recentSubscriptions, tenantOrderRows, tenantBillRows, [tableStats]] = await Promise.all([
    db.select({
      id: s.tenants.id,
      name: s.tenants.name,
      contactName: s.tenants.contactName,
      contactEmail: s.tenants.contactEmail,
      contactPhone: s.tenants.contactPhone,
      planCode: s.tenants.planCode,
      status: s.tenants.status,
      createdAt: s.tenants.createdAt,
      trialEndsAt: s.tenants.trialEndsAt,
      kitchenOverride: s.tenants.kitchenDisplay,
      tableLimit: s.tenants.tableLimit,
      customFeatures: s.tenants.customFeatures,
      customPricePaise: s.tenants.customPricePaise,
    }).from(s.tenants).orderBy(desc(s.tenants.createdAt)),
    db.select({
      code: s.plans.code,
      name: s.plans.name,
      monthlyPricePaise: s.plans.monthlyPricePaise,
      isPublic: s.plans.isPublic,
      features: s.plans.features,
      sortOrder: s.plans.sortOrder,
    }).from(s.plans).orderBy(asc(s.plans.sortOrder)),
    db.select({
      tenantId: s.outlets.tenantId,
      city: s.outlets.city,
      total: count(),
      current: periodCount(s.outlets.createdAt, recentStart, now),
      previous: periodCount(s.outlets.createdAt, previousStart, recentStart),
      // isolation-exempt: authenticated platform admins need platform-wide outlet counts and city filters.
    }).from(s.outlets).groupBy(s.outlets.tenantId, s.outlets.city),
    db.select({ date: outletDay, total: count() })
      // isolation-exempt: authenticated platform admins read aggregate daily outlet growth across tenants.
      .from(s.outlets).where(and(gte(s.outlets.createdAt, growthStart), lte(s.outlets.createdAt, now))).groupBy(outletDay),
    db.select({
      total: count(),
      current: periodCount(s.orders.placedAt, recentStart, now),
      previous: periodCount(s.orders.placedAt, previousStart, recentStart),
      // isolation-exempt: authenticated platform admins read aggregate platform order counts.
    }).from(s.orders),
    db.select({ date: orderDay, total: count() })
      // isolation-exempt: authenticated platform admins read aggregate daily orders across tenants.
      .from(s.orders).where(and(gte(s.orders.placedAt, growthStart), lte(s.orders.placedAt, now))).groupBy(orderDay),
    db.select({
      total: sql<number>`coalesce(sum(${s.bills.totalPaise}), 0)`.mapWith(Number),
      current: sql<number>`coalesce(sum(case when ${paidAt} >= ${recentStart} and ${paidAt} < ${now} then ${s.bills.totalPaise} else 0 end), 0)`.mapWith(Number),
      previous: sql<number>`coalesce(sum(case when ${paidAt} >= ${previousStart} and ${paidAt} < ${recentStart} then ${s.bills.totalPaise} else 0 end), 0)`.mapWith(Number),
      // isolation-exempt: authenticated platform admins see restaurant sales, never private bill details.
    }).from(s.bills).where(eq(s.bills.status, "paid")),
    db.select({
      id: rankedSubscriptions.id,
      periodStart: rankedSubscriptions.periodStart,
      tenantId: rankedSubscriptions.tenantId,
      pricePerOutletPaise: rankedSubscriptions.pricePerOutletPaise,
      billingCycle: rankedSubscriptions.billingCycle,
      periodEnd: rankedSubscriptions.periodEnd,
      status: rankedSubscriptions.status,
    }).from(rankedSubscriptions).where(eq(rankedSubscriptions.rank, 1)),
    db.select({ id: s.outlets.id, name: s.outlets.name, tenantName: s.tenants.name, createdAt: s.outlets.createdAt })
      // isolation-exempt: authenticated platform admins see the latest ten outlet creation events.
      .from(s.outlets).innerJoin(s.tenants, eq(s.outlets.tenantId, s.tenants.id)).orderBy(desc(s.outlets.createdAt)).limit(10),
    db.select({ id: s.orders.id, tenantName: s.tenants.name, outletName: s.outlets.name, createdAt: s.orders.placedAt })
      // isolation-exempt: authenticated platform admins see the latest ten order events, without guest data.
      .from(s.orders).innerJoin(s.tenants, eq(s.orders.tenantId, s.tenants.id))
      .innerJoin(s.outlets, and(eq(s.orders.outletId, s.outlets.id), eq(s.orders.tenantId, s.outlets.tenantId)))
      .orderBy(desc(s.orders.placedAt)).limit(10),
    db.select({ id: s.subscriptions.id, tenantName: s.tenants.name, planName: s.plans.name, createdAt: s.subscriptions.createdAt })
      // isolation-exempt: authenticated platform admins see the latest ten subscription creation events.
      .from(s.subscriptions).innerJoin(s.tenants, eq(s.subscriptions.tenantId, s.tenants.id))
      .innerJoin(s.plans, eq(s.subscriptions.planCode, s.plans.code))
      .orderBy(desc(s.subscriptions.createdAt)).limit(10),
    db.select({
      tenantId: s.orders.tenantId,
      recent: periodCount(s.orders.placedAt, recentStart, now),
      last: sql<Date | string | null>`max(${s.orders.placedAt})`,
      // isolation-exempt: authenticated platform admins read per-tenant order counts to spot inactive tenants.
    }).from(s.orders).groupBy(s.orders.tenantId),
    db.select({
      tenantId: s.bills.tenantId,
      recent: sql<number>`coalesce(sum(case when ${paidAt} >= ${recentStart} and ${paidAt} < ${now} then ${s.bills.totalPaise} else 0 end), 0)`.mapWith(Number),
      // isolation-exempt: authenticated platform admins rank tenants by paid sales, never reading bill details.
    }).from(s.bills).where(eq(s.bills.status, "paid")).groupBy(s.bills.tenantId),
    // isolation-exempt: authenticated platform admins read the platform-wide table count.
    db.select({ total: count() }).from(s.diningTables),
  ]);
  const billsByTenant = new Map(tenantBillRows.map((row) => [row.tenantId, Number(row.recent)]));
  const ordersByTenant = new Map(tenantOrderRows.map((row) => [row.tenantId, { recent: Number(row.recent), last: row.last ? new Date(row.last).toISOString() : null }]));

  const planByCode = new Map(planRows.map((plan) => [plan.code, plan]));
  const subscriptionByTenant = new Map(subscriptionRows.map((subscription) => [subscription.tenantId, subscription]));
  const outletsByTenant = new Map<string, { count: number; cities: string[] }>();
  let restaurantTotal = 0;
  let currentRestaurants = 0;
  let previousRestaurants = 0;
  for (const group of outletGroups) {
    const entry = outletsByTenant.get(group.tenantId) ?? { count: 0, cities: [] };
    entry.count += Number(group.total);
    if (group.city.trim()) entry.cities.push(group.city);
    outletsByTenant.set(group.tenantId, entry);
    restaurantTotal += Number(group.total);
    currentRestaurants += Number(group.current);
    previousRestaurants += Number(group.previous);
  }

  const growthByDay = new Map<string, AdminGrowthPoint>();
  for (let index = 0; index < 90; index++) {
    const date = new Date(growthStart.getTime() + index * DAY).toISOString().slice(0, 10);
    growthByDay.set(date, { date, tenants: 0, restaurants: 0, orders: 0 });
  }
  let currentTenants = 0;
  let previousTenants = 0;
  const activePlanCounts = new Map<string, number>();
  for (const tenant of tenantRows) {
    const point = growthByDay.get(tenant.createdAt.toISOString().slice(0, 10));
    if (point && tenant.createdAt <= now) point.tenants++;
    if (tenant.createdAt >= recentStart && tenant.createdAt < now) currentTenants++;
    else if (tenant.createdAt >= previousStart && tenant.createdAt < recentStart) previousTenants++;
    if (tenant.status === "active") activePlanCounts.set(tenant.planCode, (activePlanCounts.get(tenant.planCode) ?? 0) + 1);
  }
  for (const row of outletDays) {
    const point = growthByDay.get(row.date);
    if (point) point.restaurants = Number(row.total);
  }
  for (const row of orderDays) {
    const point = growthByDay.get(row.date);
    if (point) point.orders = Number(row.total);
  }

  const activity: AdminActivity[] = [
    ...tenantRows.slice(0, 10).map((tenant): AdminActivity => ({
      id: `tenant-${tenant.id}`, kind: "tenant", title: "New tenant added", description: tenant.name, createdAt: tenant.createdAt.toISOString(),
    })),
    ...recentOutlets.map((outlet): AdminActivity => ({
      id: `restaurant-${outlet.id}`, kind: "restaurant", title: "New restaurant added", description: `${outlet.tenantName} · ${outlet.name}`, createdAt: outlet.createdAt.toISOString(),
    })),
    ...recentOrders.map((order): AdminActivity => ({
      id: `order-${order.id}`, kind: "order", title: "New order placed", description: `${order.tenantName} · ${order.outletName}`, createdAt: order.createdAt.toISOString(),
    })),
    ...recentSubscriptions.map((subscription): AdminActivity => ({
      id: `subscription-${subscription.id}`, kind: "subscription", title: "Subscription created", description: `${subscription.tenantName} · ${subscription.planName}`, createdAt: subscription.createdAt.toISOString(),
    })),
  ];
  activity.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    tenants: tenantRows.map((tenant) => {
      const plan = planByCode.get(tenant.planCode);
      const subscription = subscriptionByTenant.get(tenant.id);
      const outlets = outletsByTenant.get(tenant.id);
      const { customFeatures, ...row } = tenant;
      const features = effectiveFeatures({ features: plan?.features, customFeatures, kitchenOverride: tenant.kitchenOverride, tableLimit: tenant.tableLimit });
      return {
        ...row,
        features,
        planName: plan?.name ?? tenant.planCode,
        kitchenDisplay: features.kitchenDisplay,
        kitchenFromPlan: hasKitchenDisplay(plan?.features),
        tableLimit: features.maxTables,
        tableLimitOverride: tenant.tableLimit,
        requests: requestsByTenant.get(tenant.id) ?? [],
        feeClaim: claimByTenant.get(tenant.id) ?? null,
        access: (() => {
          const a = accessFrom({ status: tenant.status, trialEndsAt: tenant.trialEndsAt, paidUntil: subscription && subscription.status !== "cancelled" ? subscription.periodEnd : null }, now);
          return { state: a.state, reason: a.reason, endsAt: a.endsAt === null ? null : new Date(a.endsAt).toISOString(), stopsAt: a.state === "grace" ? new Date(a.stopsAt).toISOString() : null };
        })(),
        createdAt: tenant.createdAt.toISOString(),
        trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
        outletCount: outlets?.count ?? 0,
        cities: outlets?.cities.sort((a, b) => a.localeCompare(b)) ?? [],
        monthlyPricePaise: tenant.customPricePaise ?? subscription?.pricePerOutletPaise ?? plan?.monthlyPricePaise ?? null,
        billingCycle: subscription?.billingCycle ?? null,
        renewalAt: subscription?.status === "cancelled" ? null : subscription?.periodEnd.toISOString() ?? tenant.trialEndsAt?.toISOString() ?? null,
        subscriptionStatus: subscription?.status ?? null,
        subscriptionId: subscription?.id ?? null,
        subscriptionStart: subscription?.periodStart.toISOString() ?? null,
        orders30d: ordersByTenant.get(tenant.id)?.recent ?? 0,
        lastOrderAt: ordersByTenant.get(tenant.id)?.last ?? null,
        paidBills30dPaise: billsByTenant.get(tenant.id) ?? 0,
      };
    }),
    plans: planRows.map((plan) => ({ ...plan, features: readFeatures(plan.features), tenantCount: activePlanCounts.get(plan.code) ?? 0 })),
    totals: { tenants: tenantRows.length, restaurants: restaurantTotal, tables: Number(tableStats.total), orders: Number(orderStats.total), revenuePaise: Number(revenueStats.total) },
    changes: {
      tenants: percentageChange(currentTenants, previousTenants),
      restaurants: percentageChange(currentRestaurants, previousRestaurants),
      orders: percentageChange(Number(orderStats.current), Number(orderStats.previous)),
      revenue: percentageChange(Number(revenueStats.current), Number(revenueStats.previous)),
    },
    growth: [...growthByDay.values()],
    activity: activity.slice(0, 20),
    asOf: now.toISOString(),
  };
}
