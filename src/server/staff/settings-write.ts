import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "../errors";
import { audit } from "./audit";
import type { StaffSession } from "./auth";

// Outlet settings the owner may change. Name, code, time zone, table mode and plan stay with TableQR.

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "roles" | "userId" | "name">;
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export type SettingsPatch = {
  city: string; address: string; gstin: string; fssai: string;
  serviceChargeBp: number; tipPresetsBp: number[] | null; autoAcceptOrders: boolean; reviewUrl: string;
  openingHours: Record<string, [string, string][]> | null;
};

const bad = (message: string) => new AppError("invalid_state", message, { reason: "settings" });

export async function updateOutletSettings(staff: Staff, input: SettingsPatch, now = new Date()) {
  if (!staff.roles.includes("owner")) throw new AppError("forbidden", "Only the owner can change settings.");
  const city = String(input.city ?? "").trim();
  const address = String(input.address ?? "").trim();
  if (!city || city.length > 80) throw bad("Enter the city.");
  if (!address || address.length > 300) throw bad("Enter the full address.");
  const gstin = String(input.gstin ?? "").trim().toUpperCase();
  if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(gstin)) throw bad("GSTIN looks wrong. It has 15 letters and numbers, like 08ABCDE1234F1Z5.");
  const fssai = String(input.fssai ?? "").trim();
  if (fssai && !/^\d{14}$/.test(fssai)) throw bad("FSSAI number must be 14 digits.");
  const sc = Number(input.serviceChargeBp);
  if (!Number.isInteger(sc) || sc < 0 || sc > 2000) throw bad("Service charge must be between 0% and 20%.");
  let tips: number[] | null = null;
  if (input.tipPresetsBp) {
    tips = [...new Set(input.tipPresetsBp.map(Number))].sort((a, b) => a - b);
    if (tips.length > 4 || tips.some((t) => !Number.isInteger(t) || t < 100 || t > 3000)) throw bad("Tip choices must be 1% to 30%, up to 4 of them.");
    if (!tips.length) tips = null;
  }
  const reviewUrl = String(input.reviewUrl ?? "").trim();
  if (reviewUrl && (!/^https:\/\//i.test(reviewUrl) || reviewUrl.length > 500)) throw bad("Review link must start with https://");
  let hours: Record<string, [string, string][]> | null = null;
  if (input.openingHours) {
    hours = {};
    for (const d of DAYS) {
      const ranges = (input.openingHours[d] ?? []).map(([a, b]) => [String(a), String(b)] as [string, string]);
      if (ranges.length > 3) throw bad("At most 3 time slots per day.");
      for (const [a, b] of ranges) if (!TIME.test(a) || !TIME.test(b) || a >= b) throw bad("Each opening time must be before its closing time (up to 11:59 pm).");
      hours[d] = ranges.sort((x, y) => x[0].localeCompare(y[0]));
    }
  }
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId))).for("update");
    if (!before) throw new AppError("not_found", "Outlet not found.");
    const next = { city, address, gstin: gstin || null, fssai: fssai || null, serviceChargeBp: sc, tipPresetsBp: tips, autoAcceptOrders: !!input.autoAcceptOrders, reviewUrl: reviewUrl || null, openingHours: hours };
    await tx.update(s.outlets).set(next).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId)));
    await audit(tx, staff, {
      action: "outlet.settings_changed", entity: "outlet", entityId: staff.outletId, now,
      before: { city: before.city, address: before.address, gstin: before.gstin, fssai: before.fssai, serviceChargeBp: before.serviceChargeBp, tipPresetsBp: before.tipPresetsBp, autoAcceptOrders: before.autoAcceptOrders, reviewUrl: before.reviewUrl, openingHours: before.openingHours },
      after: next,
    });
  });
}

/** Change the logo for this tenant's shared brand. Guest pages read it from the brand record. */
export async function updateBrandLogo(staff: Staff, logoUrl: string | null, now = new Date()) {
  if (!staff.roles.includes("owner")) throw new AppError("forbidden", "Only the owner can change the restaurant logo.");
  if (logoUrl !== null && (!/^https:\/\//i.test(logoUrl) && !logoUrl.startsWith("/uploads/"))) {
    throw bad("Upload a logo image before saving it.");
  }
  if (logoUrl && logoUrl.length > 500) throw bad("The logo address is too long.");

  return db.transaction(async (tx) => {
    const [outlet] = await tx.select({ brandId: s.outlets.brandId }).from(s.outlets)
      .where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId))).for("update");
    if (!outlet) throw new AppError("not_found", "Outlet not found.");
    const [brand] = await tx.select({ logoUrl: s.brands.logoUrl }).from(s.brands)
      .where(and(eq(s.brands.tenantId, staff.tenantId), eq(s.brands.id, outlet.brandId))).for("update");
    if (!brand) throw new AppError("not_found", "Restaurant brand not found.");
    await tx.update(s.brands).set({ logoUrl }).where(and(eq(s.brands.tenantId, staff.tenantId), eq(s.brands.id, outlet.brandId)));
    await audit(tx, staff, {
      action: "brand.logo_changed", entity: "brand", entityId: outlet.brandId, now,
      before: { logoUrl: brand.logoUrl }, after: { logoUrl },
    });
  });
}
