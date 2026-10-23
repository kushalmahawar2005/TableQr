import "server-only";
import { readDeliveryPolicy } from "@/domain/delivery";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { readFeatures } from "@/lib/plan-features";
import { tenantAccess } from "@/server/access";
import { AppError } from "@/server/errors";
import { configuredGuestServices } from "@/domain/guest-services";

/** Public restaurant entry point. Resolve the tenant from the public outlet code, then scope all
 * other reads to that tenant so an untrusted URL cannot reveal another restaurant's details. */
export async function getRestaurantHome(outletCode: string) {
  const [row] = await db.select({
    tenantId: s.outlets.tenantId,
    tenantStatus: s.tenants.status,
    planFeatures: s.plans.features,
    customFeatures: s.tenants.customFeatures,
    name: s.outlets.name,
    city: s.outlets.city,
    code: s.outlets.code,
    logoUrl: s.brands.logoUrl,
    accentColor: s.outlets.accentColor,
    guestServices: s.outlets.guestServices,
    deliveryPolicy: s.outlets.deliveryPolicy,
  }).from(s.outlets)
    .innerJoin(s.tenants, eq(s.tenants.id, s.outlets.tenantId))
    .innerJoin(s.plans, eq(s.plans.code, s.tenants.planCode))
    .innerJoin(s.brands, and(eq(s.brands.id, s.outlets.brandId), eq(s.brands.tenantId, s.outlets.tenantId)))
    .where(eq(s.outlets.code, String(outletCode).trim().toUpperCase()))
    .limit(1);
  if (!row) throw new AppError("not_found", "We could not find this restaurant.");
  if (row.tenantStatus === "suspended" || row.tenantStatus === "cancelled" || (await tenantAccess(row.tenantId)).state === "blocked") {
    throw new AppError("outlet_unavailable", "This restaurant is not available right now.");
  }
  const features = readFeatures(row.customFeatures ?? row.planFeatures);
  const selected = configuredGuestServices(row.guestServices);
  return {
    outlet: { code: row.code, name: row.name, city: row.city, logoUrl: row.logoUrl, accentColor: row.accentColor },
    services: { delivery: features.delivery && readDeliveryPolicy(row.deliveryPolicy).acceptingOrders && readDeliveryPolicy(row.deliveryPolicy).paymentMode === "cod", dineIn: features.dineIn && selected.includes("dineIn"), reservations: features.reservations && selected.includes("reservations"), rooms: features.rooms && selected.includes("rooms") },
  };
}
