import {
  boolean,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { at, createdAt, id, updatedAt } from "./_columns";

// Platform level: owned by the TableQR operator, not by any restaurant (PS 11).
// Nothing here carries a tenant_id.

export type PlanFeatures = {
  /** null means no limit */
  maxTables: number | null;
  maxStaff: number | null;
  bookings: "reservations_only" | "full";
  groupSplit: boolean;
  pricingRules: boolean;
  suggestions: boolean;
  guestCampaigns: boolean;
  multiOutlet: boolean;
  /** Small "powered by TableQR" line on the guest page (lower plans) */
  poweredBy: boolean;
  /** Kitchen display screen (KDS). Missing on older plan rows means included. */
  kitchenDisplay?: boolean;
};

/** Plans and prices are data, so the operator can change them without a release */
export const plans = mysqlTable("plans", {
  code: varchar("code", { length: 20 }).primaryKey(),
  name: varchar("name", { length: 40 }).notNull(),
  /** Per outlet per month, excluding GST. Null for custom-priced plans. */
  monthlyPricePaise: int("monthly_price_paise"),
  features: json("features").$type<PlanFeatures>().notNull(),
  /** Hidden plans stay valid for existing tenants but cannot be chosen for new ones */
  isPublic: boolean("is_public").notNull().default(true),
  sortOrder: int("sort_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** The operator's own team. Separate from restaurant staff so no tenant login can reach the admin console. */
export const platformAdmins = mysqlTable(
  "platform_admins",
  {
    id: id(),
    email: varchar("email", { length: 160 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }),
    role: mysqlEnum("role", ["super_admin", "support"]).notNull().default("support"),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: at("last_login_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("platform_admins_email_uq").on(t.email)],
);
