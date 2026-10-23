import {
  boolean,
  char,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { at, createdAt, id, ref, sameTenant, tenantId, tenantKey, updatedAt } from "./_columns";
import { plans, platformAdmins, type PlanFeatures } from "./platform";
import type { RoomRequestKind } from "../../domain/rooms";
import type { GuestService } from "../../domain/guest-services";

// Tenant > Brand > Outlet (PS 7.2), plus staff and their roles (PS 7.5).

/** A paying restaurant customer of the platform */
export const tenants = mysqlTable(
  "tenants",
  {
    id: id(),
    /** Legal or trading name, e.g. Sharma Hospitality Pvt Ltd */
    name: varchar("name", { length: 120 }).notNull(),
    planCode: varchar("plan_code", { length: 20 })
      .notNull()
      .references(() => plans.code),
    /** suspended blocks every login and guest page of this tenant */
    status: mysqlEnum("status", ["trial", "active", "suspended", "cancelled"])
      .notNull()
      .default("trial"),
    statusReason: varchar("status_reason", { length: 200 }),
    trialEndsAt: at("trial_ends_at"),
    // Who the operator deals with for billing and support
    contactName: varchar("contact_name", { length: 80 }).notNull(),
    contactPhone: varchar("contact_phone", { length: 15 }).notNull(),
    contactEmail: varchar("contact_email", { length: 160 }),
    /** GSTIN the operator bills this tenant against */
    billingGstin: varchar("billing_gstin", { length: 15 }),
    billingAddress: varchar("billing_address", { length: 300 }),
    createdByAdminId: ref("created_by_admin_id").references(() => platformAdmins.id),
    /** Platform admin's choice for the kitchen screen; null follows the plan */
    kitchenDisplay: boolean("kitchen_display"),
    /** Tables this restaurant pays for (set at onboarding, changed by the platform admin); null uses the plan's limit */
    tableLimit: int("table_limit"),
    /** Custom package: the features picked for this restaurant alone; null follows the plan */
    customFeatures: json("custom_features").$type<PlanFeatures>(),
    /** The price agreed with this restaurant per outlet per month, on any plan; null uses the plan's price */
    customPricePaise: int("custom_price_paise"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tenants_status_idx").on(t.status)],
);

/** What the operator charges a tenant; one row per plan period */
export const subscriptions = mysqlTable(
  "subscriptions",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    planCode: varchar("plan_code", { length: 20 })
      .notNull()
      .references(() => plans.code),
    billingCycle: mysqlEnum("billing_cycle", ["monthly", "annual"]).notNull().default("monthly"),
    /** Agreed price per outlet per month; may differ from the plan list price */
    pricePerOutletPaise: int("price_per_outlet_paise").notNull(),
    outletCount: int("outlet_count").notNull().default(1),
    status: mysqlEnum("status", ["trial", "active", "past_due", "cancelled"])
      .notNull()
      .default("trial"),
    periodStart: at("period_start").notNull(),
    periodEnd: at("period_end").notNull(),
    cancelledAt: at("cancelled_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("subscriptions_tenant_idx").on(t.tenantId, t.periodStart)],
);

/** A restaurant asks TableQR for a feature or a plan change; the platform admin handles it by hand */
export const planRequests = mysqlTable(
  "plan_requests",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    outletId: ref("outlet_id"),
    /** Who asked, as shown to the admin */
    requestedBy: varchar("requested_by", { length: 80 }).notNull(),
    /** The locked feature they tapped, or null for a general request */
    feature: varchar("feature", { length: 30 }),
    note: varchar("note", { length: 300 }),
    status: mysqlEnum("status", ["open", "done"]).notNull().default("open"),
    createdAt: createdAt(),
    doneAt: at("done_at"),
  },
  (t) => [index("plan_requests_tenant_status_idx").on(t.tenantId, t.status)],
);

/** TableQR plan fees. Cashfree confirms online payments; admins can still record offline receipts. */
export const feePayments = mysqlTable(
  "fee_payments",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    months: int("months").notNull(),
    amountPaise: int("amount_paise").notNull(),
    method: mysqlEnum("method", ["cashfree", "upi", "cash", "bank"]).notNull().default("cashfree"),
    /** UPI reference (UTR), bank note, or Cashfree payment ID */
    reference: varchar("reference", { length: 60 }),
    /** Makes a retry/double tap return the same Cashfree order. */
    clientRequestId: varchar("client_request_id", { length: 64 }),
    gatewayRef: varchar("gateway_ref", { length: 100 }),
    gatewayPaymentId: varchar("gateway_payment_id", { length: 100 }),
    failureReason: varchar("failure_reason", { length: 200 }),
    checkedAt: at("checked_at"),
    /** The plan paid for when the owner upgrades from My plan; null keeps the current plan */
    planCode: varchar("plan_code", { length: 20 }),
    status: mysqlEnum("status", ["claimed", "confirmed", "rejected"]).notNull(),
    /** Who said it was paid, or who recorded it */
    claimedBy: varchar("claimed_by", { length: 80 }).notNull(),
    /** The subscription period it paid for, once confirmed */
    subscriptionId: ref("subscription_id"),
    paidUntil: at("paid_until"),
    createdAt: createdAt(),
    decidedAt: at("decided_at"),
  },
  (t) => [
    index("fee_payments_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("fee_payments_status_idx").on(t.status),
    uniqueIndex("fee_payments_request_uq").on(t.tenantId, t.clientRequestId),
    uniqueIndex("fee_payments_gateway_ref_uq").on(t.gatewayRef),
  ],
);

export const brands = mysqlTable(
  "brands",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    name: varchar("name", { length: 120 }).notNull(),
    /** Restaurant logo shown on guest pages; null falls back to the name's initial */
    logoUrl: varchar("logo_url", { length: 500 }),
    createdAt: createdAt(),
  },
  (t) => [tenantKey("brands", t)],
);

export const sessionModes = ["open", "verified", "host_confirmed"] as const;

export const outlets = mysqlTable(
  "outlets",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    brandId: ref("brand_id").notNull(),
    /** Short public code used in QR addresses and invoice numbers, e.g. SRJ01 */
    code: varchar("code", { length: 12 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    city: varchar("city", { length: 80 }).notNull(),
    address: varchar("address", { length: 300 }).notNull(),
    gstin: varchar("gstin", { length: 15 }),
    fssai: varchar("fssai", { length: 14 }),
    timezone: varchar("timezone", { length: 40 }).notNull().default("Asia/Kolkata"),
    /** Restaurant accent colour; contrast is checked before use on buttons */
    accentColor: varchar("accent_color", { length: 7 }),
    /** Weekly hours, e.g. { mon: [["12:00","23:30"]], ... } in outlet local time */
    openingHours: json("opening_hours").$type<Record<string, [string, string][]>>(),
    sessionMode: mysqlEnum("session_mode", sessionModes).notNull().default("open"),
    autoAcceptOrders: boolean("auto_accept_orders").notNull().default(false),
    /** Owner can disable guest gateway checkout and collect every bill at the counter instead. */
    guestOnlinePayments: boolean("guest_online_payments").notNull().default(true),
    /** Choices shown on the public restaurant entry link; null follows the tenant's package. */
    guestServices: json("guest_services").$type<GuestService[]>(),
    /** Open mode: first order of a new session above this needs staff confirmation */
    newSessionCapPaise: int("new_session_cap_paise").notNull().default(300000),
    soldOutDisplay: mysqlEnum("sold_out_display", ["hide", "grey"]).notNull().default("grey"),
    idleCloseMinutes: int("idle_close_minutes").notNull().default(240),
    /** Optional service charge in basis points of the discounted subtotal; 0 means off (PS 6.1) */
    serviceChargeBp: int("service_charge_bp").notNull().default(0),
    /** Tip presets offered at payment, basis points; null means the TableQR default (5%, 10%) */
    tipPresetsBp: json("tip_presets_bp").$type<number[]>(),
    /** Public review page shown to every guest after paying; null hides the link (PS 3.8) */
    reviewUrl: varchar("review_url", { length: 500 }),
    /** Owner-selected room QR service buttons; null keeps the full default set. */
    roomServices: json("room_services").$type<RoomRequestKind[]>(),
    /** Guest-facing Wi-Fi details, shown only to checked-in room guests. */
    wifiSsid: varchar("wifi_ssid", { length: 32 }),
    wifiPassword: varchar("wifi_password", { length: 63 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("outlets_code_uq").on(t.code),
    tenantKey("outlets", t),
    sameTenant("fk_outlets_brand", t, t.brandId, brands),
  ],
);

/** Staff and owners. Guests are a separate table. */
export const users = mysqlTable(
  "users",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    phone: varchar("phone", { length: 15 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    pinHash: varchar("pin_hash", { length: 255 }),
    isActive: boolean("is_active").notNull().default(true),
    /** Shift status the person sets in the staff app: on duty, on a break, or off duty */
    dutyStatus: mysqlEnum("duty_status", ["on", "break", "off"]).notNull().default("on"),
    dutyChangedAt: at("duty_changed_at"),
    /** Last time the staff app checked in, for "online now" */
    lastSeenAt: at("last_seen_at"),
    /** First-run guide: when this person saw the welcome, finished the tour, hid the setup list (epoch ms) */
    guide: json("guide").$type<{ welcome?: number; tour?: number; setupHidden?: number; qrPrinted?: number }>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_tenant_phone_uq").on(t.tenantId, t.phone), tenantKey("users", t)],
);

export const staffRoleNames = [
  "owner",
  "manager",
  "cashier",
  "host",
  "waiter",
  "kitchen",
  "accountant",
  /** Hotel front desk: rooms, check-in and check-out, room bills */
  "reception",
] as const;

export const staffRoles = mysqlTable(
  "staff_roles",
  {
    id: id(),
    tenantId: tenantId(),
    userId: ref("user_id").notNull(),
    /** Null means the role applies across every outlet of the tenant */
    outletId: ref("outlet_id"),
    role: mysqlEnum("role", staffRoleNames).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    sameTenant("fk_staff_roles_user", t, t.userId, users),
    sameTenant("fk_staff_roles_outlet", t, t.outletId, outlets),
  ],
);

/**
 * Signed-in staff devices (S1). The cookie holds a random token; only its SHA-256 is stored.
 * Role is never stored here: it is read from staff_roles on every request, so a change of role
 * or a deactivated user takes effect at once. outlet_id is the outlet this device works in.
 */
export const staffSessions = mysqlTable(
  "staff_sessions",
  {
    id: id(),
    tenantId: tenantId(),
    userId: ref("user_id").notNull(),
    outletId: ref("outlet_id").notNull(),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    createdAt: createdAt(),
    expiresAt: at("expires_at").notNull(),
    lastSeenAt: at("last_seen_at"),
    revokedAt: at("revoked_at"),
  },
  (t) => [
    uniqueIndex("staff_sessions_token_uq").on(t.tokenHash),
    index("staff_sessions_user_idx").on(t.tenantId, t.userId),
    sameTenant("fk_staff_sessions_user", t, t.userId, users),
    sameTenant("fk_staff_sessions_outlet", t, t.outletId, outlets),
  ],
);

/** Staff PIN attempts, for lock-out after repeated wrong PINs. The PIN itself is never stored. */
export const staffLoginAttempts = mysqlTable(
  "staff_login_attempts",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    phone: varchar("phone", { length: 15 }).notNull(),
    ok: boolean("ok").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("staff_login_attempts_phone_idx").on(t.tenantId, t.outletId, t.phone, t.createdAt)],
);
