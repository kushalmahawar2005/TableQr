"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import * as s from "@/db/schema";
import { uuidv7 } from "@/db/id";
import { hashPin, isPin } from "@/server/staff/pin";
import { requirePlatformAdmin, signInPlatformAdmin, signOutPlatformAdmin } from "@/server/admin/auth";
import { randomInt } from "node:crypto";

export type AdminLoginState = { error: string | null };
export type TenantState = { error: string | null; success: string | null };

export async function adminLoginAction(_prev: AdminLoginState, form: FormData): Promise<AdminLoginState> {
  try {
    const ok = await signInPlatformAdmin(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
    if (!ok) return { error: "Email or password is not correct." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Admin sign-in failed." };
  }
  redirect("/admin");
}

export async function adminLogoutAction() {
  await signOutPlatformAdmin();
  redirect("/admin");
}

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const BASE62 = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const shortCode = () => Array.from({ length: 4 }, () => BASE62[randomInt(BASE62.length)]).join("");
const joinCode = () => String(randomInt(1000, 10000));

export async function createTenantAction(_prev: TenantState, form: FormData): Promise<TenantState> {
  try {
    const admin = await requirePlatformAdmin();
    if (admin.role !== "super_admin") return { error: "Only a super admin can create restaurants.", success: null };
    const tenantName = text(form, "tenantName");
    const contactName = text(form, "contactName");
    const contactPhone = text(form, "contactPhone");
    const contactEmail = text(form, "contactEmail").toLowerCase();
    const planCode = text(form, "planCode");
    const brandName = text(form, "brandName") || tenantName;
    const outletCode = text(form, "outletCode").toUpperCase();
    const outletName = text(form, "outletName");
    const city = text(form, "city");
    const address = text(form, "address");
    const ownerPhone = text(form, "ownerPhone");
    const ownerName = text(form, "ownerName");
    const ownerPin = text(form, "ownerPin");
    const tableCount = Math.min(100, Math.max(1, Number(text(form, "tableCount") || 4)));
    if (!tenantName || !contactName || !contactPhone || !planCode || !outletCode || !outletName || !city || !address || !ownerPhone || !ownerName || !isPin(ownerPin)) {
      return { error: "Please fill every required field. Owner PIN must be exactly 4 digits.", success: null };
    }
    if (!/^[A-Z0-9]{2,12}$/.test(outletCode)) return { error: "Outlet code must be 2-12 letters or numbers.", success: null };

    const result = await db.transaction(async (tx) => {
      const [plan] = await tx.select({ code: s.plans.code }).from(s.plans).where(and(eq(s.plans.code, planCode), eq(s.plans.isPublic, true)));
      if (!plan) throw new Error("Selected plan does not exist.");
      const [existingOutlet] = await tx.select({ id: s.outlets.id }).from(s.outlets).where(eq(s.outlets.code, outletCode));
      if (existingOutlet) throw new Error("That outlet code is already in use.");
      const tenantId = uuidv7();
      const brandId = uuidv7();
      const outletId = uuidv7();
      const zoneId = uuidv7();
      const userId = uuidv7();
      await tx.insert(s.tenants).values({ id: tenantId, name: tenantName, planCode, contactName, contactPhone, contactEmail: contactEmail || null, createdByAdminId: admin.id });
      await tx.insert(s.brands).values({ id: brandId, tenantId, name: brandName });
      await tx.insert(s.outlets).values({ id: outletId, tenantId, brandId, code: outletCode, name: outletName, city, address });
      await tx.insert(s.users).values({ id: userId, tenantId, phone: ownerPhone, name: ownerName, pinHash: await hashPin(ownerPin) });
      await tx.insert(s.staffRoles).values({ id: uuidv7(), tenantId, userId, outletId, role: "owner" });
      await tx.insert(s.zones).values({ id: zoneId, tenantId, outletId, name: "Main Hall" });
      for (let i = 1; i <= tableCount; i++) {
        const tableId = uuidv7();
        await tx.insert(s.diningTables).values({ id: tableId, tenantId, outletId, zoneId, code: `T${i}`, maxSeats: 4, tableClass: "4-top", joinCode: joinCode() });
        await tx.insert(s.qrCodes).values({ id: uuidv7(), tenantId, outletId, tableId, type: "table", shortCode: shortCode() });
      }
      return { tenantId, outletCode };
    });
    return { error: null, success: `Restaurant created. Owner can sign in at /console/login using outlet ${result.outletCode}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Restaurant could not be created.", success: null };
  }
}
