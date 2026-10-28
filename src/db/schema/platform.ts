import {
  boolean,
  char,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import type { Features } from "../../lib/plan-features";
import { at, createdAt, id, updatedAt } from "./_columns";

// Platform level: owned by the Tableeqr operator, not by any restaurant (PS 11).
// Nothing here carries a tenant_id.

/**
 * What a plan includes, as stored. Rows saved before a switch existed may lack it; read them with
 * readFeatures (src/lib/plan-features.ts), never field by field.
 */
export type PlanFeatures = Partial<Features> & {
  /** Older rows: "full" meant reservations plus waitlist */
  bookings?: "reservations_only" | "full";
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

/** Durable throttle buckets for platform-admin password attempts (keyed by an HMAC, not email). */
export const platformAdminLoginBuckets = mysqlTable("platform_admin_login_buckets", {
  adminKeyHash: char("admin_key_hash", { length: 64 }).primaryKey(),
  attempts: int("attempts").notNull().default(0),
  windowStartedAt: at("window_started_at").notNull(),
  lockedUntil: at("locked_until"),
});

/** Versions of Tableeqr's own apps (the rider app) that the platform admin uploads; the newest is downloaded */
export const appReleases = mysqlTable("app_releases", {
  id: id(),
  app: mysqlEnum("app", ["rider"]).notNull(),
  version: varchar("version", { length: 20 }).notNull(),
  url: varchar("url", { length: 500 }).notNull(),
  sizeBytes: int("size_bytes").notNull(),
  notes: varchar("notes", { length: 300 }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("app_releases_app_version_uq").on(t.app, t.version)]);
