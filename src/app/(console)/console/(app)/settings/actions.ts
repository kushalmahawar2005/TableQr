"use server";
import { AppError } from "@/server/errors";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { storeMenuImage } from "@/server/menu-storage";
import { consoleSectionRoles } from "@/lib/staff-permissions";
import { updateBrandLogo, updateOutletSettings, type SettingsPatch } from "@/server/staff/settings-write";
import { staffFor } from "@/server/staff/request";

export type SettingsResult = { ok: true } | { ok: false; message: string };

export async function saveSettingsAction(input: SettingsPatch): Promise<SettingsResult> {
  try {
    await updateOutletSettings(await staffFor(consoleSectionRoles.settings), input);
    return { ok: true };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    console.error("[settings] save failed", err);
    return { ok: false, message: "That didn't go through. Try again." };
  }
}

export async function uploadRestaurantLogoAction(filename: string, contentType: string, base64: string): Promise<SettingsResult & { url?: string }> {
  try {
    const staff = await staffFor(consoleSectionRoles.settings);
    if (!staff.roles.includes("owner")) throw new AppError("forbidden", "Only the owner can change the restaurant logo.");
    if (typeof base64 !== "string" || base64.length > 2_800_000) throw new AppError("invalid_state", "This image is still too large after compression. Choose a smaller logo image.");
    const [outlet] = await db.select({ brandId: schema.outlets.brandId }).from(schema.outlets)
      .where(and(eq(schema.outlets.tenantId, staff.tenantId), eq(schema.outlets.id, staff.outletId)));
    if (!outlet) throw new AppError("not_found", "Outlet not found.");
    const image = await storeMenuImage({ tenantId: staff.tenantId, brandId: outlet.brandId, filename, contentType, bytes: Buffer.from(base64, "base64") });
    await updateBrandLogo(staff, image.url);
    return { ok: true, url: image.url };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    console.error("[settings] logo upload failed", err);
    return { ok: false, message: "That didn't go through. Try another image." };
  }
}

export async function removeRestaurantLogoAction(): Promise<SettingsResult> {
  try {
    await updateBrandLogo(await staffFor(consoleSectionRoles.settings), null);
    return { ok: true };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    console.error("[settings] logo removal failed", err);
    return { ok: false, message: "That didn't go through. Try again." };
  }
}
