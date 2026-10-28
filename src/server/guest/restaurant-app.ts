import "server-only";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import * as s from "@/db/schema";
import { staffAppIconUrl } from "@/lib/staff-app";
import { tenantFeatures } from "../plan";
import { staffAppBrandForOutletCode } from "../staff/pwa-branding";

// The restaurant's own installable app: its name, logo and colour on the guest's home screen.
// Only for plans with delivery or reservations; a dine-in-only restaurant has no app.

export const restaurantApp = cache(async (code: string) => {
  const brand = await staffAppBrandForOutletCode(code);
  if (!brand) return null;
  // isolation-exempt: the outlet code is public and globally unique; this resolves its tenant
  const [outlet] = await db.select({ tenantId: s.outlets.tenantId, guestPwaInstallEnabled: s.outlets.guestPwaInstallEnabled }).from(s.outlets).where(eq(s.outlets.code, brand.code));
  if (!outlet) return null;
  const f = await tenantFeatures(outlet.tenantId);
  return outlet.guestPwaInstallEnabled && f.guestPwaCustomization && (f.delivery || f.reservations) ? brand : null;
});

export function restaurantAppMetadata(app: NonNullable<Awaited<ReturnType<typeof restaurantApp>>> | null): Pick<Metadata, "manifest" | "appleWebApp" | "icons"> {
  if (!app) return {};
  return {
    manifest: `/r/${encodeURIComponent(app.code)}/app.webmanifest`,
    appleWebApp: { capable: true, title: app.name.slice(0, 30), statusBarStyle: "default" },
    icons: { apple: app.logoUrl || staffAppIconUrl(180, app.code) },
  };
}
