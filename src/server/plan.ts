import { BUSINESS_PACKAGE_PROFILES, type BusinessType, type CommercialSettings } from "@/lib/subscription-pricing";
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { FEATURE_KEYS, notInPlanMessage, readFeatures, type FeatureKey, type Features } from "@/lib/plan-features";
import { AppError } from "./errors";

// What a restaurant gets. Plans are data (admin > Plans). On top of its plan the platform admin
// can give one restaurant a custom package (its own feature list), turn the kitchen screen on or
// off, or set its table limit.

/** The kitchen display (KDS) is included unless the plan switches it off */
export const hasKitchenDisplay = (features: s.PlanFeatures | null | undefined) => readFeatures(features).kitchenDisplay;

/** The admin's choice for this restaurant when there is one, else what its plan includes */
export const kitchenFor = (override: boolean | null | undefined, features: s.PlanFeatures | null | undefined) => override ?? hasKitchenDisplay(features);

/** One restaurant's features from its plan or custom package, with the admin's kitchen and table choices */
export function effectiveFeatures(row: { features: unknown; customFeatures: unknown; kitchenOverride: boolean | null; tableLimit: number | null; businessType?: BusinessType | null; commercial?: CommercialSettings | null; outletId?: string }): Features {
  const f = readFeatures(row.customFeatures ?? row.features);
  if (row.kitchenOverride !== null) f.kitchenDisplay = row.kitchenOverride;
  if (row.tableLimit !== null) f.maxTables = row.tableLimit;
  if (row.businessType) {
    const profile = BUSINESS_PACKAGE_PROFILES[row.businessType];
    f.dineIn = profile.floor && (row.customFeatures ? f.dineIn : true);
    f.rooms = profile.rooms && (row.customFeatures ? f.rooms : true);
    f.delivery = profile.delivery && (row.customFeatures ? f.delivery : true);
  }
  for (const key of ["waiterApp", "reservations", "riderTracking"] as const) {
    const enabled = row.commercial?.addons[key] ?? [];
    if (enabled.length && (!row.outletId || enabled.includes(row.outletId))) f[key] = true;
  }
  // Reservations are table/party bookings. Keep them available in the agreed base package for
  // food businesses that support tables, while preventing a plan or add-on from exposing them
  // for a delivery-only kitchen or a room-only hotel.
  if (row.businessType) {
    const profile = BUSINESS_PACKAGE_PROFILES[row.businessType];
    f.reservations = profile.reservations && (row.customFeatures ? f.reservations : true);
  }
  return f;
}

const NOTHING = { ...Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])), maxTables: 1, maxStaff: 1, poweredBy: true } as Features;

/** Everything this restaurant may use; an unknown tenant gets nothing */
export async function tenantFeatures(tenantId: string, outletId?: string): Promise<Features> {
  const [row] = await db
    .select({ businessType: s.tenants.businessType, commercial: s.tenants.commercial, features: s.plans.features, customFeatures: s.tenants.customFeatures, kitchenOverride: s.tenants.kitchenDisplay, tableLimit: s.tenants.tableLimit })
    .from(s.tenants)
    .innerJoin(s.plans, eq(s.plans.code, s.tenants.planCode))
    .where(eq(s.tenants.id, tenantId));
  return row ? effectiveFeatures({ ...row, outletId }) : { ...NOTHING };
}

/** The plan's name as staff see it, e.g. "Lite" */
export async function tenantPlanName(tenantId: string): Promise<string | null> {
  const [row] = await db.select({ name: s.plans.name }).from(s.tenants).innerJoin(s.plans, eq(s.plans.code, s.tenants.planCode)).where(eq(s.tenants.id, tenantId));
  return row?.name ?? null;
}

/** Stops a server action the restaurant's plan does not include */
export async function requireFeature(tenantId: string, key: FeatureKey, outletId?: string) {
  if (!(await tenantFeatures(tenantId, outletId))[key]) throw new AppError("forbidden", notInPlanMessage(key));
}

/** Whether this restaurant has the kitchen screen and the Kitchen staff role */
export async function tenantHasKitchen(tenantId: string): Promise<boolean> {
  return (await tenantFeatures(tenantId)).kitchenDisplay;
}

/** How many tables this restaurant may have: its own limit, else its plan's; null means no limit */
export async function tenantTableLimit(tenantId: string): Promise<number | null> {
  return (await tenantFeatures(tenantId)).maxTables;
}

export const tableLimitMessage = (limit: number) =>
  `Your plan includes ${limit} table${limit === 1 ? "" : "s"}. To add more, ask Tableeqr to upgrade your plan.`;

export const staffLimitMessage = (limit: number) =>
  `Your plan includes ${limit} staff login${limit === 1 ? "" : "s"}. To add more, ask Tableeqr to upgrade your plan.`;

export const KITCHEN_NOT_IN_PLAN = "The kitchen screen is not switched on for this restaurant. Ask Tableeqr to turn it on.";
