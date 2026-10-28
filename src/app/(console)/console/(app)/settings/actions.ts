"use server";
import { AppError } from "@/server/errors";
import { clearMenuCache } from "@/server/guest/menu";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { storeMenuImage, storePaymentQr } from "@/server/menu-storage";
import { consoleSectionRoles } from "@/lib/staff-permissions";
import { saveRestaurantCashfree, updateBookingPaymentQr, updateBrandLogo, updateOutletSettings, type SettingsPatch } from "@/server/staff/settings-write";
import { staffFor } from "@/server/staff/request";
import { archivePrinter, assignPrinters, printSetup, savePrinter, type PrinterInput, type PrintSetup } from "@/server/print/printers";
import { recentPrintJobs, type JobRow } from "@/server/print/jobs";
import { saveCustomDomain, setCustomDomainLive, verifyCustomDomain } from "@/server/staff/custom-domain";

export type SettingsResult = { ok: true } | { ok: false; message: string };

export async function saveSettingsAction(input: SettingsPatch): Promise<SettingsResult> {
  try {
    const staff = await staffFor(consoleSectionRoles.settings, "settings");
    await updateOutletSettings(staff, input);
    // GST and other outlet settings change what a dish costs the guest
    clearMenuCache(staff.tenantId);
    return { ok: true };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    console.error("[settings] save failed", err);
    return { ok: false, message: "That didn't go through. Try again." };
  }
}

export async function saveCustomDomainAction(domain: string): Promise<SettingsResult & { domain?: string | null; token?: string | null; verified?: boolean }> {
  try {
    const result = await saveCustomDomain(await staffFor(consoleSectionRoles.settings, "settings"), domain);
    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    console.error("[settings] custom domain save failed", err);
    return { ok: false, message: "Could not save the domain. Try again." };
  }
}

export async function verifyCustomDomainAction(): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await verifyCustomDomain(await staffFor(consoleSectionRoles.settings, "settings"));
    return { ...result };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    console.error("[settings] custom domain verify failed", err);
    return { ok: false, message: "Could not verify the domain. Try again." };
  }
}

export async function setCustomDomainLiveAction(live: boolean, confirmedHttps = false): Promise<{ ok: boolean; live: boolean; message: string }> {
  try {
    const result = await setCustomDomainLive(await staffFor(consoleSectionRoles.settings, "settings"), live, confirmedHttps);
    return { ok: true, ...result, message: live ? "Custom domain is now used for guest links." : "Guest links now use your Tableeqr address." };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, live: false, message: err.message };
    console.error("[settings] custom domain activation failed", err);
    return { ok: false, live: false, message: "Could not update the guest link domain. Try again." };
  }
}

export async function saveRestaurantCashfreeAction(input: { mode: "sandbox" | "production"; clientId: string; clientSecret: string } | null) {
  try {
    const status = await saveRestaurantCashfree(await staffFor(consoleSectionRoles.settings, "settings"), input);
    return { ok: true as const, status };
  } catch (err) {
    if (err instanceof AppError) return { ok: false as const, message: err.message };
    console.error("[settings] restaurant gateway save failed", err);
    return { ok: false as const, message: "Could not update the restaurant payment account. Try again." };
  }
}

export async function uploadRestaurantLogoAction(filename: string, contentType: string, base64: string): Promise<SettingsResult & { url?: string }> {
  try {
    const staff = await staffFor(consoleSectionRoles.settings, "settings");
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
    await updateBrandLogo(await staffFor(consoleSectionRoles.settings, "settings"), null);
    return { ok: true };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    console.error("[settings] logo removal failed", err);
    return { ok: false, message: "That didn't go through. Try again." };
  }
}

export async function uploadBookingPaymentQrAction(filename: string, contentType: string, base64: string): Promise<SettingsResult & { url?: string }> {
  try {
    const staff = await staffFor(consoleSectionRoles.settings, "settings");
    if (!staff.roles.includes("owner")) throw new AppError("forbidden", "Only the owner can change the payment QR.");
    if (typeof base64 !== "string" || base64.length > 2_800_000) throw new AppError("invalid_state", "Choose a payment QR image up to 2 MB.");
    const [outlet] = await db.select({ brandId: schema.outlets.brandId }).from(schema.outlets).where(and(eq(schema.outlets.tenantId, staff.tenantId), eq(schema.outlets.id, staff.outletId)));
    if (!outlet) throw new AppError("not_found", "Outlet not found.");
    const image = await storePaymentQr({ tenantId: staff.tenantId, brandId: outlet.brandId, filename, contentType, bytes: Buffer.from(base64, "base64") });
    await updateBookingPaymentQr(staff, image.url);
    return { ok: true, url: image.url };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, message: error.message };
    console.error("[settings] payment QR upload failed", error);
    return { ok: false, message: "Could not save the payment QR. Try again." };
  }
}

type PrintersResult = { ok: true; setup: PrintSetup } | { ok: false; message: string };

async function printerWork(work: (staff: Awaited<ReturnType<typeof staffFor>>) => Promise<unknown>): Promise<PrintersResult> {
  try {
    const staff = await staffFor(consoleSectionRoles.settings, "settings");
    await work(staff);
    return { ok: true, setup: await printSetup(staff) };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    console.error("[settings] printers failed", err);
    return { ok: false, message: "That didn't go through. Try again." };
  }
}

export async function savePrinterAction(input: PrinterInput) { return printerWork((s) => savePrinter(s, input)); }
export async function removePrinterAction(printerId: string) { return printerWork((s) => archivePrinter(s, String(printerId))); }
export async function assignPrintersAction(input: { receiptPrinterId: string | null; kitchenPrinterId: string | null }) { return printerWork((s) => assignPrinters(s, input)); }

export async function recentPrintsAction(): Promise<{ ok: true; jobs: JobRow[] } | { ok: false; message: string }> {
  try {
    return { ok: true, jobs: await recentPrintJobs(await staffFor(consoleSectionRoles.settings, "settings")) };
  } catch (err) {
    return { ok: false, message: err instanceof AppError ? err.message : "Print history could not be loaded." };
  }
}
