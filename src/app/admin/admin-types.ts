import type { Features } from "@/lib/plan-features";
export type AdminTenant = {
  id: string;
  name: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string;
  planCode: string;
  planName: string;
  /** The admin's choice when set, else the plan's; null override means it follows the plan */
  kitchenDisplay: boolean;
  kitchenOverride: boolean | null;
  kitchenFromPlan: boolean;
  /** Tables the restaurant may have; null means no limit */
  tableLimit: number | null;
  /** The admin's own table limit for this restaurant; null follows the plan */
  tableLimitOverride: number | null;
  /** Open asks from the restaurant to unlock a feature or change the plan */
  /** Whether the restaurant can use TableQR now: trial or paid period, grace days, or paused */
  access: { state: "ok" | "grace" | "blocked"; reason: string; endsAt: string | null; stopsAt: string | null };
  /** The owner said they paid and it is waiting to be checked in Fees */
  feeClaim: { amountPaise: number; createdAt: string } | null;
  requests: { id: string; feature: string | null; note: string | null; requestedBy: string; createdAt: string }[];
  /** What this restaurant gets right now: its plan or custom package, with the admin's choices */
  features: Features;
  /** Price agreed with this restaurant per outlet per month, on any plan; null uses the plan's price */
  customPricePaise: number | null;
  status: "trial" | "active" | "suspended" | "cancelled";
  createdAt: string;
  trialEndsAt: string | null;
  outletCount: number;
  cities: string[];
  monthlyPricePaise: number | null;
  billingCycle: "monthly" | "annual" | null;
  renewalAt: string | null;
  subscriptionStatus: string | null;
  subscriptionId: string | null;
  subscriptionStart: string | null;
  orders30d: number;
  lastOrderAt: string | null;
  paidBills30dPaise: number;
};

export type AdminPlanFeatures = Features;
export type AdminPlan = { code: string; name: string; monthlyPricePaise: number | null; isPublic: boolean; tenantCount: number; features: AdminPlanFeatures; sortOrder: number };
export type AdminGrowthPoint = { date: string; tenants: number; restaurants: number; orders: number };
export type AdminActivity = { id: string; kind: "tenant" | "restaurant" | "subscription" | "order"; title: string; description: string; createdAt: string };
export type AdminData = {
  tenants: AdminTenant[];
  plans: AdminPlan[];
  totals: { tenants: number; restaurants: number; tables: number; orders: number; revenuePaise: number };
  changes: { tenants: number | null; restaurants: number | null; orders: number | null; revenue: number | null };
  growth: AdminGrowthPoint[];
  activity: AdminActivity[];
  asOf: string;
};

export type TenantDetail = {
  daily: { date: string; orders: number; revenuePaise: number }[];
  usage: { outlets: number; tables: number; maxTables: number | null; staff: number; maxStaff: number | null; qrCodes: number; menuItems: number };
  outlets: { id: string; name: string; code: string; city: string; tables: number }[];
  staff: { id: string; name: string; phone: string; role: string; isActive: boolean }[];
  activity: { id: string; title: string; description: string; createdAt: string }[];
  setup: { steps: { label: string; done: boolean }[]; percent: number };
};

export type AnalyticsRange = 7 | 30 | 90;
export type AnalyticsData = {
  range: AnalyticsRange;
  totals: {
    salesPaise: number; previousSalesPaise: number;
    orders: number; previousOrders: number;
    activeTenants: number; previousActiveTenants: number;
    paidBills: number; previousPaidBills: number;
  };
  daily: { date: string; orders: number; salesPaise: number }[];
  /** Orders by hour of day, India time */
  byHour: number[];
  /** Orders by weekday, Sunday first, India time */
  byWeekday: number[];
  topTenants: { id: string; name: string; orders: number; salesPaise: number }[];
  topCities: { city: string; orders: number; salesPaise: number }[];
  funnel: { tenants: number; withOutlet: number; withTables: number; withMenu: number; withOrders: number; withPaidBill: number };
};

export type AuditEntry = {
  id: string;
  createdAt: string;
  tenantName: string;
  actorLabel: string;
  action: string;
  entity: string;
  reason: string | null;
  before: unknown;
  after: unknown;
};
export type AuditData = { entries: AuditEntry[]; truncated: boolean };

export type SettingsData = {
  me: { name: string; email: string; role: "super_admin" | "support" };
  team: { id: string; name: string; email: string; role: "super_admin" | "support"; isActive: boolean; lastLoginAt: string | null }[];
  system: { label: string; ok: boolean; detail: string }[];
};
