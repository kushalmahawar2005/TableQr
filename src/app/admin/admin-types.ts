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

export type AdminPlanFeatures = {
  maxTables: number | null;
  maxStaff: number | null;
  bookings: "reservations_only" | "full";
  groupSplit: boolean;
  pricingRules: boolean;
  suggestions: boolean;
  guestCampaigns: boolean;
  multiOutlet: boolean;
  kitchenDisplay?: boolean;
  poweredBy: boolean;
};
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

export type AdminPayment = {
  id: string;
  createdAt: string;
  tenantName: string;
  outletName: string;
  method: "upi" | "card" | "wallet" | "cash";
  channel: string;
  amountPaise: number;
  tipPaise: number;
  status: "initiated" | "pending" | "success" | "failed" | "refunded";
  failureReason: string | null;
  gatewayPaymentId: string | null;
};
export type AdminRefund = { id: string; createdAt: string; tenantName: string; amountPaise: number; reason: string; status: "pending" | "success" | "failed" };
export type PaymentsData = {
  collectedPaise: number;
  previousCollectedPaise: number;
  counts: { success: number; failed: number; pending: number; refunded: number };
  refundedPaise: number;
  pendingRefunds: number;
  daily: { date: string; collectedPaise: number }[];
  byMethod: { method: string; paise: number; count: number }[];
  payments: AdminPayment[];
  refunds: AdminRefund[];
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
