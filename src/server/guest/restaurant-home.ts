import "server-only";
import { cache } from "react";
import { readDeliveryPolicy } from "@/domain/delivery";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { tenantFeatures } from "../plan";
import { tenantAccess } from "@/server/access";
import { AppError } from "@/server/errors";
import { configuredGuestServices } from "@/domain/guest-services";
import { outletGatewayReady } from "@/server/payments/outlet-gateway";
import { BUSINESS_PACKAGE_PROFILES } from "@/lib/subscription-pricing";

/** Public business entry point. Resolve the tenant from the public outlet code, then scope all
 * other reads to that tenant so an untrusted URL cannot reveal another outlet's details. */
async function loadRestaurantHome(outletCode: string) {
  const [row] = await db.select({
    id: s.outlets.id,
    tenantId: s.outlets.tenantId,
    tenantStatus: s.tenants.status,
    businessType: s.tenants.businessType,
    planFeatures: s.plans.features,
    customFeatures: s.tenants.customFeatures,
    name: s.brands.name,
    city: s.outlets.city,
    address: s.outlets.address,
    phone: s.tenants.contactPhone,
    openingHours: s.outlets.openingHours,
    code: s.outlets.code,
    announcementActive: s.outlets.announcementActive,
    announcementTitle: s.outlets.announcementTitle,
    announcementBody: s.outlets.announcementBody,
    logoUrl: s.brands.logoUrl,
    accentColor: s.outlets.accentColor,
    guestServices: s.outlets.guestServices,
    deliveryPolicy: s.outlets.deliveryPolicy,
    paymentGatewayConfig: s.outlets.paymentGatewayConfig,
    paymentQrUrl: s.outlets.bookingPaymentQrUrl,
  }).from(s.outlets)
    .innerJoin(s.tenants, eq(s.tenants.id, s.outlets.tenantId))
    .innerJoin(s.plans, eq(s.plans.code, s.tenants.planCode))
    .innerJoin(s.brands, and(eq(s.brands.id, s.outlets.brandId), eq(s.brands.tenantId, s.outlets.tenantId)))
    .where(eq(s.outlets.code, String(outletCode).trim().toUpperCase()))
    .limit(1);
  if (!row) throw new AppError("not_found", "We could not find this business.");
  if (row.tenantStatus === "suspended" || row.tenantStatus === "cancelled" || (await tenantAccess(row.tenantId)).state === "blocked") {
    throw new AppError("outlet_unavailable", "This business is not available right now.");
  }
  const features = await tenantFeatures(row.tenantId,row.id);
  const profile = BUSINESS_PACKAGE_PROFILES[row.businessType ?? "restaurant"];
  const selected = configuredGuestServices(row.guestServices);
  const deliveryPolicy = readDeliveryPolicy(row.deliveryPolicy);
  const deliveryPaymentReady = deliveryPolicy.paymentMode === "cod" || (deliveryPolicy.paymentMode === "manual_qr" && !!row.paymentQrUrl) || (deliveryPolicy.paymentMode === "gateway" && outletGatewayReady(row.paymentGatewayConfig));
  const pickupPaymentReady = deliveryPolicy.pickupCodEnabled || !!row.paymentQrUrl || outletGatewayReady(row.paymentGatewayConfig);
  return {
    outlet: { code: row.code, name: row.name, city: row.city, address: row.address, phone: row.phone, openingHours: row.openingHours, businessType: row.businessType, logoUrl: row.logoUrl, accentColor: row.accentColor, announcement: row.announcementActive && row.announcementTitle && row.announcementBody ? { title: row.announcementTitle, body: row.announcementBody } : null },
    services: {
      delivery: profile.delivery && features.delivery && deliveryPolicy.acceptingOrders && deliveryPaymentReady,
      pickup: profile.pickup && features.delivery && deliveryPolicy.acceptingPickupOrders && pickupPaymentReady,
      dineIn: profile.floor && features.dineIn && selected.includes("dineIn"),
      reservations: features.reservations && selected.includes("reservations"),
      rooms: profile.rooms && features.rooms && selected.includes("rooms"),
    },
  };
}

/** The layout, page and app manifest all ask for this; one guest page load reads it once. */
export const getRestaurantHome = cache(loadRestaurantHome);
