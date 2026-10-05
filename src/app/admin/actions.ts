"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import * as s from "@/db/schema";
import { uuidv7 } from "@/db/id";
import { hashPin, isPin } from "@/server/staff/pin";
import { getTenantDetail } from "@/server/admin/tenant-detail";
import { getPaymentsData } from "@/server/admin/payments";
import { getAnalyticsData } from "@/server/admin/analytics";
import { getAuditData } from "@/server/admin/audit";
import { getSettingsData } from "@/server/admin/settings";
import type { AnalyticsData, AnalyticsRange, AuditData, PaymentsData, SettingsData, TenantDetail } from "./admin-types";
import { requirePlatformAdmin, signInPlatformAdmin, signOutPlatformAdmin } from "@/server/admin/auth";
import { randomInt } from "node:crypto";

export type AdminLoginState = { error: string | null };
export type TenantState = { error: string | null; success: string | null; outletCode?: string };

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
    const typedCode = text(form, "outletCode").toUpperCase();
    const outletName = text(form, "outletName");
    const city = text(form, "city");
    const address = text(form, "address");
    const ownerPhone = text(form, "ownerPhone");
    const ownerName = text(form, "ownerName");
    const ownerPin = text(form, "ownerPin");
    const tableCount = Math.min(100, Math.max(1, Number(text(form, "tableCount") || 4)));
    if (!tenantName || !contactName || !contactPhone || !planCode || !outletName || !city || !address || !ownerPhone || !ownerName || !isPin(ownerPin)) {
      return { error: "Please fill every required field. Owner PIN must be exactly 4 digits.", success: null };
    }
    if (typedCode && !/^[A-Z0-9]{2,12}$/.test(typedCode)) return { error: "Outlet code must be 2-12 letters or numbers.", success: null };

    const result = await db.transaction(async (tx) => {
      const [plan] = await tx.select({ code: s.plans.code }).from(s.plans).where(and(eq(s.plans.code, planCode), eq(s.plans.isPublic, true)));
      if (!plan) throw new Error("Selected plan does not exist.");
      const taken = async (code: string) => (await tx.select({ id: s.outlets.id }).from(s.outlets).where(eq(s.outlets.code, code))).length > 0;
      let outletCode = typedCode;
      if (outletCode) {
        if (await taken(outletCode)) throw new Error("That outlet code is already in use.");
      } else {
        // First letters of the outlet name plus two digits, e.g. "Spice Route" -> SPI42.
        const prefix = outletName.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3).padEnd(3, "X");
        for (let attempt = 0; attempt < 30 && !outletCode; attempt++) {
          const candidate = `${prefix}${String(randomInt(100)).padStart(2, "0")}`;
          if (!(await taken(candidate))) outletCode = candidate;
        }
        if (!outletCode) throw new Error("Could not generate an outlet code. Please type one.");
      }
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
    await logAdminAction(admin, result.tenantId, "admin.tenant_created", null, { name: tenantName, planCode, outlet: result.outletCode });
    return { error: null, success: `Restaurant created. Owner can sign in at /console/login using outlet ${result.outletCode}.`, outletCode: result.outletCode };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Restaurant could not be created.", success: null };
  }
}

export type TenantActionState = { error: string | null };

async function requireSuperAdmin() {
  const admin = await requirePlatformAdmin();
  if (admin.role !== "super_admin") throw new Error("Only a super admin can change tenants.");
  return admin;
}

/** Records a platform-admin change in the tenant's audit trail. Never pass secrets such as PINs. */
async function logAdminAction(admin: { email: string }, tenantId: string, action: string, before: unknown, after: unknown, reason?: string) {
  await db.insert(s.auditLog).values({ id: uuidv7(), tenantId, actorLabel: `admin:${admin.email}`.slice(0, 80), action, entity: "tenant", entityId: tenantId, before: before ?? null, after: after ?? null, reason: reason ?? null });
}

export async function setTenantStatusAction(tenantId: string, status: "active" | "suspended"): Promise<TenantActionState> {
  try {
    const admin = await requireSuperAdmin();
    if (status !== "active" && status !== "suspended") return { error: "Invalid status." };
    const [tenant] = await db.select({ id: s.tenants.id, status: s.tenants.status }).from(s.tenants).where(eq(s.tenants.id, tenantId));
    if (!tenant) return { error: "Tenant not found." };
    await db.update(s.tenants).set({ status }).where(eq(s.tenants.id, tenantId));
    await logAdminAction(admin, tenantId, status === "suspended" ? "admin.tenant_suspended" : "admin.tenant_activated", { status: tenant.status }, { status });
    revalidatePath("/admin");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Tenant could not be updated." };
  }
}

export async function extendTrialAction(tenantId: string, days: number): Promise<TenantActionState> {
  try {
    const admin = await requireSuperAdmin();
    const extra = Math.min(90, Math.max(1, Math.floor(days)));
    const [tenant] = await db.select({ status: s.tenants.status, trialEndsAt: s.tenants.trialEndsAt }).from(s.tenants).where(eq(s.tenants.id, tenantId));
    if (!tenant) return { error: "Tenant not found." };
    if (tenant.status !== "trial") return { error: "Only tenants on trial can be extended." };
    const base = Math.max(Date.now(), tenant.trialEndsAt?.getTime() ?? 0);
    const next = new Date(base + extra * 86_400_000);
    await db.update(s.tenants).set({ trialEndsAt: next }).where(eq(s.tenants.id, tenantId));
    await logAdminAction(admin, tenantId, "admin.trial_extended", { trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null }, { trialEndsAt: next.toISOString() }, `Extended by ${extra} days`);
    revalidatePath("/admin");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Trial could not be extended." };
  }
}

export async function updateTenantAction(tenantId: string, form: { name: string; contactName: string; contactPhone: string; contactEmail: string }): Promise<TenantActionState> {
  try {
    const admin = await requireSuperAdmin();
    const name = form.name.trim();
    const contactName = form.contactName.trim();
    const contactPhone = form.contactPhone.trim();
    const contactEmail = form.contactEmail.trim().toLowerCase();
    if (!name || !contactName || !contactPhone) return { error: "Name, contact person and phone are required." };
    if (contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) return { error: "Enter a valid email." };
    const [before] = await db.select({ name: s.tenants.name, contactName: s.tenants.contactName, contactPhone: s.tenants.contactPhone, contactEmail: s.tenants.contactEmail }).from(s.tenants).where(eq(s.tenants.id, tenantId));
    if (!before) return { error: "Tenant not found." };
    await db.update(s.tenants).set({ name, contactName, contactPhone, contactEmail: contactEmail || null }).where(eq(s.tenants.id, tenantId));
    await logAdminAction(admin, tenantId, "admin.tenant_edited", before, { name, contactName, contactPhone, contactEmail: contactEmail || null });
    revalidatePath("/admin");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Tenant could not be updated." };
  }
}

export async function changeTenantPlanAction(tenantId: string, planCode: string): Promise<TenantActionState> {
  try {
    const admin = await requireSuperAdmin();
    const [plan] = await db.select({ code: s.plans.code }).from(s.plans).where(eq(s.plans.code, planCode));
    if (!plan) return { error: "Selected plan does not exist." };
    const [tenant] = await db.select({ planCode: s.tenants.planCode }).from(s.tenants).where(eq(s.tenants.id, tenantId));
    if (!tenant) return { error: "Tenant not found." };
    await db.update(s.tenants).set({ planCode }).where(eq(s.tenants.id, tenantId));
    await logAdminAction(admin, tenantId, "admin.plan_changed", { planCode: tenant.planCode }, { planCode });
    revalidatePath("/admin");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Plan could not be changed." };
  }
}

export async function resetOwnerPinAction(tenantId: string, pin: string): Promise<TenantActionState> {
  try {
    const admin = await requireSuperAdmin();
    if (!isPin(pin)) return { error: "PIN must be exactly 4 digits." };
    const owners = await db.select({ userId: s.staffRoles.userId }).from(s.staffRoles).where(and(eq(s.staffRoles.tenantId, tenantId), eq(s.staffRoles.role, "owner")));
    if (!owners.length) return { error: "This tenant has no owner account." };
    const pinHash = await hashPin(pin);
    for (const owner of owners) await db.update(s.users).set({ pinHash }).where(and(eq(s.users.id, owner.userId), eq(s.users.tenantId, tenantId)));
    await logAdminAction(admin, tenantId, "admin.owner_pin_reset", null, { owners: owners.length });
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "PIN could not be reset." };
  }
}

export async function getTenantDetailAction(tenantId: string): Promise<{ detail: TenantDetail | null; error: string | null }> {
  try {
    return { detail: await getTenantDetail(tenantId), error: null };
  } catch (error) {
    return { detail: null, error: error instanceof Error ? error.message : "Tenant details could not be loaded." };
  }
}

export type PlanInput = {
  code: string;
  name: string;
  /** Rupees per outlet per month; null for custom-priced plans */
  priceRupees: number | null;
  isPublic: boolean;
  features: {
    maxTables: number | null;
    maxStaff: number | null;
    bookings: "reservations_only" | "full";
    groupSplit: boolean;
    pricingRules: boolean;
    suggestions: boolean;
    guestCampaigns: boolean;
    multiOutlet: boolean;
    poweredBy: boolean;
  };
};

const limit = (value: number | null) => (value === null ? null : Math.max(1, Math.floor(value)));

export async function savePlanAction(input: PlanInput, mode: "create" | "edit"): Promise<TenantActionState> {
  try {
    await requireSuperAdmin();
    const code = input.code.trim().toLowerCase();
    const name = input.name.trim();
    if (!/^[a-z0-9_]{2,20}$/.test(code)) return { error: "Plan code must be 2-20 lowercase letters, numbers or underscores." };
    if (!name || name.length > 40) return { error: "Plan name is required (up to 40 characters)." };
    if (input.priceRupees !== null && (!Number.isFinite(input.priceRupees) || input.priceRupees < 0 || input.priceRupees > 1_000_000)) return { error: "Enter a valid price." };
    const values = {
      name,
      monthlyPricePaise: input.priceRupees === null ? null : Math.round(input.priceRupees * 100),
      isPublic: input.isPublic,
      features: { ...input.features, maxTables: limit(input.features.maxTables), maxStaff: limit(input.features.maxStaff) },
    };
    const [existing] = await db.select({ code: s.plans.code }).from(s.plans).where(eq(s.plans.code, code));
    if (mode === "create") {
      if (existing) return { error: "A plan with this code already exists." };
      const all = await db.select({ sortOrder: s.plans.sortOrder }).from(s.plans);
      await db.insert(s.plans).values({ code, ...values, sortOrder: Math.max(0, ...all.map((p) => p.sortOrder)) + 1 });
    } else {
      if (!existing) return { error: "Plan not found." };
      await db.update(s.plans).set(values).where(eq(s.plans.code, code));
    }
    revalidatePath("/admin");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Plan could not be saved." };
  }
}

export async function getPaymentsAction(): Promise<{ data: PaymentsData | null; error: string | null }> {
  try {
    return { data: await getPaymentsData(), error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : "Payments could not be loaded." };
  }
}

export async function getAnalyticsAction(range: AnalyticsRange): Promise<{ data: AnalyticsData | null; error: string | null }> {
  try {
    return { data: await getAnalyticsData(range), error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : "Analytics could not be loaded." };
  }
}

export async function getAuditAction(): Promise<{ data: AuditData | null; error: string | null }> {
  try {
    return { data: await getAuditData(), error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : "Audit log could not be loaded." };
  }
}

export async function getSettingsAction(): Promise<{ data: SettingsData | null; error: string | null }> {
  try {
    return { data: await getSettingsData(), error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : "Settings could not be loaded." };
  }
}
