import { notFound } from "next/navigation";
import { adminLogoutAction } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/admin-client";
import type { AdminData, AnalyticsData } from "@/app/admin/admin-types";
import { DashboardView } from "@/app/admin/dashboard-view";
import { AnalyticsView } from "@/app/admin/analytics-view";
import { AppsView } from "@/app/admin/apps-view";
import { FeesView } from "@/app/admin/fees-view";
import { PlansView } from "@/app/admin/plans-view";
import { SubscriptionsView } from "@/app/admin/subscriptions-view";
import { TenantsView } from "@/app/admin/tenants-view";
import { FEATURE_KEYS } from "@/lib/plan-features";
import type { FeesData } from "@/server/fees";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const now = Date.now();
const iso = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();

const sample = (id: string, over: Partial<AdminData["tenants"][number]>) => ({
  id, contactName: "Owner", contactEmail: null, contactPhone: "+919800000000", planCode: "growth", planName: "Growth", status: "active", createdAt: iso(120), trialEndsAt: null, outletCount: 1, cities: ["Ajmer"],
  businessType: "restaurant",
  access: { state: "ok", reason: over.status === "trial" ? "trial" : over.status === "suspended" ? "suspended" : "paid", endsAt: iso(-3), stopsAt: null },
  features: { ...Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])), maxTables: 20, maxStaff: 10, maxRooms: null, poweredBy: true },
  tableLimit: 20, tableLimitOverride: null, kitchenDisplay: true, kitchenOverride: null, kitchenFromPlan: true, customPricePaise: null, roleAccess: null,
  monthlyPricePaise: 99_900, billingCycle: "monthly", renewalAt: iso(-20), subscriptionStatus: "active", subscriptionId: null, subscriptionStart: iso(120), orders30d: 120, lastOrderAt: iso(1), paidBills30dPaise: 500_000, feeClaim: null, requests: [],
  ...over,
}) as AdminData["tenants"][number];

const planFeatures = (count: number, over: Record<string, unknown>) => ({ ...Object.fromEntries(FEATURE_KEYS.map((k, i) => [k, i < count])), maxTables: null, maxStaff: null, maxRooms: null, poweredBy: false, ...over });

// Sample data only: the real admin data needs a platform sign-in
const data = {
  asOf: new Date(now).toISOString(),
  totals: { tenants: 6, restaurants: 14, tables: 186, orders: 18_420, revenuePaise: 412_000_000 },
  changes: { tenants: 20, restaurants: 8, orders: 14, revenue: -3 },
  growth: [],
  activity: [],
  plans: [
    { code: "starter", name: "Starter", tenantCount: 2, monthlyPricePaise: 69_900, isPublic: true, sortOrder: 1, features: planFeatures(7, { maxTables: 10, maxStaff: 5 }) },
    { code: "growth", name: "Growth", tenantCount: 3, monthlyPricePaise: 129_900, isPublic: true, sortOrder: 2, features: planFeatures(12, {}) },
    { code: "pro", name: "Pro", tenantCount: 1, monthlyPricePaise: 220_000, isPublic: true, sortOrder: 3, features: planFeatures(19, {}) },
    { code: "hotel_plus", name: "Hotel + Restaurant", tenantCount: 0, monthlyPricePaise: 699_900, isPublic: false, sortOrder: 4, features: planFeatures(15, { maxTables: 20, maxStaff: 25, maxRooms: 30, rooms: true }) },
    { code: "custom", name: "Custom", tenantCount: 0, monthlyPricePaise: null, isPublic: false, sortOrder: 5, features: planFeatures(3, { maxTables: 5, maxStaff: 2 }) },
  ],
  tenants: [
    sample("s1", { name: "The Fit Bowl", businessType: "cloud_kitchen", planName: "Pro", monthlyPricePaise: 149_900, outletCount: 2, orders30d: 642, paidBills30dPaise: 28_400_000, createdAt: iso(160), feeClaim: { amountPaise: 149_900, createdAt: iso(1), method: "upi" } }),
    sample("s2", { name: "Spice Route Family Restaurant and Banquet", cities: ["Jaipur", "Ajmer"], monthlyPricePaise: 249_900, outletCount: 3, orders30d: 511, paidBills30dPaise: 19_200_000, createdAt: iso(90), requests: [{ id: "r1", feature: null, note: null, requestedBy: "Owner", createdAt: iso(2) }] }),
    sample("s3", { name: "Chai Point", businessType: "cafe", cities: ["Pune"], planName: "Starter", status: "trial", trialEndsAt: iso(-3), orders30d: 88, paidBills30dPaise: 1_250_000, createdAt: iso(11) }),
    sample("s4", { name: "Hotel Sagar", businessType: "hotel", cities: ["Udaipur"], status: "suspended", subscriptionStatus: "past_due", renewalAt: iso(9), orders30d: 4, paidBills30dPaise: 80_000, createdAt: iso(210) }),
    sample("s5", { name: "Dosa Corner", businessType: null, cities: [], planName: "Starter", orders30d: 0, lastOrderAt: null, paidBills30dPaise: 0, createdAt: iso(45) }),
    sample("s6", { name: "Green Leaf Cafe", cities: ["Kota"], orders30d: 240, paidBills30dPaise: 7_400_000, createdAt: iso(20) }),
  ],
} as unknown as AdminData;

const feeTenant = (id: string, name: string, days: number, state = "ok") => ({ id, name, contactName: "Owner", contactPhone: "9800000000", planName: "Growth", monthlyPaise: 129_900, access: { state, reason: "paid", endsAt: iso(days), stopsAt: null } });
const fees = {
  receivedThisMonthPaise: 2_499_00, receivedLastMonthPaise: 33_996_00,
  claims: [
    { id: "c1", tenant: feeTenant("s1", "The Fit Bowl", 0), amountPaise: 149_900, months: 1, method: "upi", reference: "UTR-448120", planCode: null, claimedBy: "Owner", createdAt: iso(0.1) },
    { id: "c2", tenant: feeTenant("s2", "Spice Route Family Restaurant and Banquet", 0), amountPaise: 2_499_00, months: 1, method: "cashfree", reference: null, planCode: "pro", claimedBy: "Owner", createdAt: iso(0.02) },
  ],
  requests: [{ id: "r1", tenant: feeTenant("s3", "Chai Point", 0), feature: null, note: "Need delivery", requestedBy: "Owner", createdAt: iso(2) }],
  due: [feeTenant("s4", "Hotel Sagar", 5, "grace"), feeTenant("s3", "Chai Point", -3)],
  history: [
    { id: "h1", tenantName: "The Fit Bowl", months: 1, method: "cashfree", reference: "1468500363972178944", amountPaise: 149_900, createdAt: iso(5), paidUntil: iso(-25), status: "confirmed" },
    { id: "h2", tenantName: "Green Leaf Cafe", months: 6, method: "cashfree", reference: null, amountPaise: 41_994_00, createdAt: iso(9), paidUntil: null, status: "rejected" },
    { id: "h3", tenantName: "Hotel Sagar", months: 12, method: "bank", reference: null, amountPaise: 12_000_00, createdAt: iso(300), paidUntil: iso(-65), status: "confirmed" },
  ],
} as unknown as FeesData;

const analytics: AnalyticsData = {
  range: 30,
  totals: { salesPaise: 535_400, previousSalesPaise: 60_900, orders: 77, previousOrders: 5, activeTenants: 5, previousActiveTenants: 1, paidBills: 42, previousPaidBills: 2 },
  daily: Array.from({ length: 30 }, (_, i) => ({ date: iso(29 - i), orders: i % 4 ? (i * 3) % 11 : 0, salesPaise: i % 4 ? ((i * 37) % 90) * 2000 : 0 })),
  byHour: Array.from({ length: 24 }, (_, h) => (h > 10 ? (h * 7) % 12 : h < 2 ? 8 : 0)),
  byWeekday: [11, 22, 27, 2, 0, 11, 5],
  topTenants: [{ id: "s1", name: "The Fit Bowl", orders: 35, salesPaise: 293_600 }, { id: "s2", name: "Spice Route Family Restaurant and Banquet", orders: 24, salesPaise: 150_500 }, { id: "s3", name: "Chai Point", orders: 7, salesPaise: 0 }],
  topCities: [{ city: "Jaipur", orders: 77, salesPaise: 535_400 }, { city: "Ajmer", orders: 12, salesPaise: 90_000 }],
  otp: { total: 26, previousTotal: 0, tableAndBooking: 15, delivery: 5, account: 2, staff: 4, topTenants: [{ id: "s1", name: "The Fit Bowl", codes: 13 }, { id: "s2", name: "Chai Point", codes: 10 }] },
  funnel: { tenants: 6, withOutlet: 6, withTables: 6, withMenu: 5, withOrders: 5, withPaidBill: 4 },
};
const releases = [{ id: "a1", version: "1.0.1", url: "#", sizeBytes: 4_600_000, notes: "Faster location updates", createdAt: iso(1) }, { id: "a2", version: "1.0.0", url: "#", sizeBytes: 4_500_000, notes: "First release: live deliveries, background location with the screen off", createdAt: iso(6) }];

// Development-only preview of the platform admin screens
export default async function AdminPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AdminShell email="owner@tableeqr.com" logout={adminLogoutAction} pages={{ Dashboard: <DashboardView data={data} name="Kushal" />, Tenants: <TenantsView data={data} canRemove />, Subscriptions: <SubscriptionsView data={data} />, "Plans & Pricing": <PlansView data={data} />, Fees: <FeesView data={data} preview={fees} />, Analytics: <AnalyticsView data={data} preview={analytics} />, Apps: <AppsView initial={releases} /> }} alerts={[{ id: "a1", title: "The Fit Bowl says they paid", detail: "₹1,499 · check it and confirm", page: "Fees" }]} />;
}
