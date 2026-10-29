import "server-only";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import * as s from "@/db/schema";
import { staffAppIconUrl } from "@/lib/staff-app";
import { tenantFeatures } from "../plan";
import { staffAppBrandForOutletCode } from "../staff/pwa-branding";
import { getRestaurantHome } from "./restaurant-home";

// The outlet's own installable app: its name, logo and colour on the guest's home screen.
// Only show it when the owner enabled installation and at least one matching public service is live.

export const restaurantApp = cache(async (code: string) => {
  const [brand, home] = await Promise.all([
    staffAppBrandForOutletCode(code),
    getRestaurantHome(code).catch(() => null),
  ]);
  if (!brand || !home) return null;
  // isolation-exempt: the outlet code is public and globally unique; this resolves its tenant
  const [outlet] = await db.select({ id: s.outlets.id, tenantId: s.outlets.tenantId, guestPwaInstallEnabled: s.outlets.guestPwaInstallEnabled }).from(s.outlets).where(eq(s.outlets.code, brand.code));
  if (!outlet) return null;
  const f = await tenantFeatures(outlet.tenantId,outlet.id);
  const serviceEnabled = home.services.delivery || home.services.pickup || home.services.reservations;
  return outlet.guestPwaInstallEnabled && f.guestPwaCustomization && serviceEnabled ? brand : null;
});

export function restaurantAppMetadata(app: NonNullable<Awaited<ReturnType<typeof restaurantApp>>> | null): Pick<Metadata, "manifest" | "appleWebApp" | "icons"> {
  if (!app) return {};
  return {
    manifest: `/r/${encodeURIComponent(app.code)}/app.webmanifest`,
    appleWebApp: { capable: true, title: app.name.slice(0, 30), statusBarStyle: "default" },
    icons: { apple: app.logoUrl || staffAppIconUrl(180, app.code) },
  };
}
