import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";

// What a restaurant gets. Plans are data (admin > Plans), and the platform admin can turn the
// kitchen screen on or off for one restaurant on top of its plan.

/** The kitchen display (KDS) is included unless the plan switches it off */
export const hasKitchenDisplay = (features: s.PlanFeatures | null | undefined) => features?.kitchenDisplay !== false;

/** The admin's choice for this restaurant when there is one, else what its plan includes */
export const kitchenFor = (override: boolean | null | undefined, features: s.PlanFeatures | null | undefined) => override ?? hasKitchenDisplay(features);

/** Whether this restaurant has the kitchen screen and the Kitchen staff role */
export async function tenantHasKitchen(tenantId: string): Promise<boolean> {
  const [row] = await db
    .select({ override: s.tenants.kitchenDisplay, features: s.plans.features })
    .from(s.tenants)
    .innerJoin(s.plans, eq(s.plans.code, s.tenants.planCode))
    .where(eq(s.tenants.id, tenantId));
  return !!row && kitchenFor(row.override, row.features);
}

/** How many tables this restaurant may have: its own limit, else its plan's; null means no limit */
export async function tenantTableLimit(tenantId: string): Promise<number | null> {
  const [row] = await db
    .select({ limit: s.tenants.tableLimit, features: s.plans.features })
    .from(s.tenants)
    .innerJoin(s.plans, eq(s.plans.code, s.tenants.planCode))
    .where(eq(s.tenants.id, tenantId));
  return row?.limit ?? row?.features.maxTables ?? null;
}

export const tableLimitMessage = (limit: number) =>
  `Your plan includes ${limit} table${limit === 1 ? "" : "s"}. To add more, ask TableQR to upgrade your plan.`;

export const KITCHEN_NOT_IN_PLAN = "The kitchen screen is not switched on for this restaurant. Ask TableQR to turn it on.";
