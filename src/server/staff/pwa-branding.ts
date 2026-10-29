import "server-only";
import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import type { StaffAppBrand } from "@/lib/staff-app";

/** Public branding only; outlet codes are already printed on the restaurant's guest QR. */
export const staffAppBrandForOutletCode = cache(async (value: string | null | undefined): Promise<StaffAppBrand | null> => {
  const code = value?.trim().toUpperCase() ?? "";
  if (!/^[A-Z0-9]{2,12}$/.test(code)) return null;
  const [row] = await db.select({
    code: s.outlets.code,
    name: s.brands.name,
    logoUrl: s.brands.logoUrl,
    accentColor: s.outlets.accentColor,
  })
    .from(s.outlets)
    .innerJoin(s.brands, and(eq(s.brands.tenantId, s.outlets.tenantId), eq(s.brands.id, s.outlets.brandId)))
    .where(eq(s.outlets.code, code));
  return row ?? null;
});
