"use server";

import { and, count, desc, eq } from "drizzle-orm";
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
import { effectiveFeatures, hasKitchenDisplay } from "@/server/plan";
import { FEATURE_KEYS, readFeatures, type Features } from "@/lib/plan-features";

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
    // One name is asked for, the brand guests see; it also names the business account
    const brandName = text(form, "brandName") || text(form, "tenantName");
    const tenantName = text(form, "tenantName") || brandName;
    const contactName = text(form, "contactName");
    const contactPhone = text(form, "contactPhone");
    const contactEmail = text(form, "contactEmail").toLowerCase();
    const planCode = text(form, "planCode");
    const typedCode = text(form, "outletCode").toUpperCase();
    const outletName = text(form, "outletName");
    const city = text(form, "city");
    const address = text(form, "address");
    const ownerPhone = text(form, "ownerPhone");
    const ownerName = text(form, "ownerName");
    const ownerPin = text(form, "ownerPin");
    const tableCount = Math.min(100, Math.max(1, Number(text(form, "tableCount") || 4)));
    // Kitchen screen chosen at onboarding: stored only when it differs from the plan
    const kitchenChoice = form.get("kitchenDisplay") === null ? null : text(form, "kitchenDisplay") === "on";
    if (!tenantName || !contactName || !contactPhone || !planCode || !outletName || !city || !address || !ownerPhone || !ownerName || !isPin(ownerPin)) {
      return { error: "Please fill every required field. Owner PIN must be exactly 4 digits.", success: null };
    }
    if (typedCode && !/^[A-Z0-9]{2,12}$/.test(typedCode)) return { error: "Outlet code must be 2-12 letters or numbers.", success: null };

    const result = await db.transaction(async (tx) => {
      const [plan] = await tx.select({ code: s.plans.code, features: s.plans.features }).from(s.plans).where(and(eq(s.plans.code, planCode), eq(s.plans.isPublic, true)));
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
      const kitchenDisplay = kitchenChoice === null || kitchenChoice === hasKitchenDisplay(plan.features) ? null : kitchenChoice;
      await tx.insert(s.tenants).values({ id: tenantId, name: tenantName, planCode, contactName, contactPhone, contactEmail: contactEmail || null, createdByAdminId: admin.id, kitchenDisplay, tableLimit: tableCount });
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

const FEE_METHODS = { upi: "UPI", cash: "Cash", bank: "Bank transfer" } as const;
export type FeeMethod = keyof typeof FEE_METHODS;

/**
 * The restaurant paid its TableQR fee by hand (UPI, cash or bank): start the paid months right
 * after the current period or trial ends (or today, if that has passed) and mark the tenant active.
 * What was received is kept in the audit log.
 */
export async function recordFeePaymentAction(tenantId: string, input: { months: number; amountRupees: number; method: FeeMethod; reference: string }): Promise<TenantActionState> {
  try {
    const admin = await requireSuperAdmin();
    const months = Math.floor(Number(input.months));
    if (![1, 3, 6, 12].includes(months)) return { error: "Choose 1, 3, 6 or 12 months." };
    const amountRupees = Math.floor(Number(input.amountRupees));
    if (!Number.isFinite(amountRupees) || amountRupees < 0 || amountRupees > 10_000_000) return { error: "Enter the amount you received." };
    if (!(input.method in FEE_METHODS)) return { error: "Choose how they paid." };
    const reference = input.reference.trim().slice(0, 60);
    const [tenant] = await db.select({ status: s.tenants.status, planCode: s.tenants.planCode, trialEndsAt: s.tenants.trialEndsAt, customPricePaise: s.tenants.customPricePaise }).from(s.tenants).where(eq(s.tenants.id, tenantId));
    if (!tenant) return { error: "Tenant not found." };
    if (tenant.status === "cancelled") return { error: "This tenant is cancelled." };
    const [plan] = await db.select({ monthlyPricePaise: s.plans.monthlyPricePaise }).from(s.plans).where(eq(s.plans.code, tenant.planCode));
    const [latest] = await db.select({ periodEnd: s.subscriptions.periodEnd, pricePerOutletPaise: s.subscriptions.pricePerOutletPaise, status: s.subscriptions.status })
      .from(s.subscriptions).where(eq(s.subscriptions.tenantId, tenantId)).orderBy(desc(s.subscriptions.periodEnd)).limit(1);
    const [outlets] = await db.select({ total: count() }).from(s.outlets).where(eq(s.outlets.tenantId, tenantId));
    const runningEnd = latest && latest.status !== "cancelled" ? latest.periodEnd.getTime() : tenant.status === "trial" ? tenant.trialEndsAt?.getTime() ?? 0 : 0;
    const periodStart = new Date(Math.max(Date.now(), runningEnd));
    const periodEnd = new Date(periodStart);
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + months);
    await db.transaction(async (tx) => {
      await tx.insert(s.subscriptions).values({
        id: uuidv7(), tenantId, planCode: tenant.planCode, billingCycle: months === 12 ? "annual" : "monthly",
        pricePerOutletPaise: tenant.customPricePaise ?? latest?.pricePerOutletPaise ?? plan?.monthlyPricePaise ?? 0, outletCount: Math.max(1, Number(outlets?.total ?? 1)),
        status: "active", periodStart, periodEnd,
      });
      if (tenant.status !== "active") await tx.update(s.tenants).set({ status: "active", statusReason: null }).where(eq(s.tenants.id, tenantId));
    });
    await logAdminAction(admin, tenantId, "admin.fee_received", { status: tenant.status }, { status: "active", months, amountPaise: amountRupees * 100, method: input.method, reference: reference || null, paidUntil: periodEnd.toISOString() },
      `₹${amountRupees.toLocaleString("en-IN")} by ${FEE_METHODS[input.method]}${reference ? ` (${reference})` : ""} for ${months} ${months === 1 ? "month" : "months"}`);
    revalidatePath("/admin");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Payment could not be saved." };
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
    const [tenant] = await db.select({ planCode: s.tenants.planCode, features: s.plans.features, customFeatures: s.tenants.customFeatures, kitchenOverride: s.tenants.kitchenDisplay, tableLimit: s.tenants.tableLimit, customPricePaise: s.tenants.customPricePaise, planPricePaise: s.plans.monthlyPricePaise })
      .from(s.tenants).innerJoin(s.plans, eq(s.plans.code, s.tenants.planCode)).where(eq(s.tenants.id, tenantId));
    if (!tenant) return { error: "Tenant not found." };
    // Moving to Custom starts from what the restaurant has today, so nothing is lost; leaving it
    // hands everything back to the new plan
    await db.update(s.tenants).set(planCode === CUSTOM_PLAN
      ? { planCode, customFeatures: effectiveFeatures(tenant), customPricePaise: tenant.customPricePaise ?? tenant.planPricePaise, kitchenDisplay: null, tableLimit: null }
      : { planCode, customFeatures: null, customPricePaise: null }).where(eq(s.tenants.id, tenantId));
    await logAdminAction(admin, tenantId, "admin.plan_changed", { planCode: tenant.planCode }, { planCode });
    revalidatePath("/admin");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Plan could not be changed." };
  }
}

const CUSTOM_PLAN = "custom";

/** Custom package: the platform admin picks this restaurant's features, limits and price by hand */
export async function setCustomPackageAction(tenantId: string, input: { features: Features; priceRupees: number }): Promise<TenantActionState> {
  try {
    const admin = await requireSuperAdmin();
    const price = Math.floor(Number(input.priceRupees));
    if (!Number.isFinite(price) || price < 0 || price > 1_000_000) return { error: "Enter the price per month in rupees." };
    if (input.features.maxTables !== null && !(input.features.maxTables >= 1 && input.features.maxTables <= 500)) return { error: "Tables must be from 1 to 500, or empty for no limit." };
    if (input.features.maxStaff !== null && !(input.features.maxStaff >= 1 && input.features.maxStaff <= 500)) return { error: "Staff must be from 1 to 500, or empty for no limit." };
    const [tenant] = await db.select({ planCode: s.tenants.planCode, customFeatures: s.tenants.customFeatures, customPricePaise: s.tenants.customPricePaise }).from(s.tenants).where(eq(s.tenants.id, tenantId));
    if (!tenant) return { error: "Tenant not found." };
    if (tenant.planCode !== CUSTOM_PLAN) return { error: "Put this restaurant on the Custom plan first." };
    const features = cleanFeatures(input.features);
    await db.update(s.tenants).set({ customFeatures: features, customPricePaise: price * 100, kitchenDisplay: null, tableLimit: null }).where(eq(s.tenants.id, tenantId));
    await logAdminAction(admin, tenantId, "admin.custom_package_saved", { features: tenant.customFeatures ? readFeatures(tenant.customFeatures) : null, pricePaise: tenant.customPricePaise }, { features, pricePaise: price * 100 });
    revalidatePath("/admin");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Custom package could not be saved." };
  }
}

/** How many tables this restaurant may have on its floor (what it pays for) */
export async function setTenantTableLimitAction(tenantId: string, limit: number): Promise<TenantActionState> {
  try {
    const admin = await requireSuperAdmin();
    const next = Math.floor(Number(limit));
    if (!Number.isFinite(next) || next < 1 || next > 500) return { error: "Enter a table limit from 1 to 500." };
    const [tenant] = await db.select({ tableLimit: s.tenants.tableLimit }).from(s.tenants).where(eq(s.tenants.id, tenantId));
    if (!tenant) return { error: "Tenant not found." };
    await db.update(s.tenants).set({ tableLimit: next }).where(eq(s.tenants.id, tenantId));
    await logAdminAction(admin, tenantId, "admin.table_limit_changed", { tableLimit: tenant.tableLimit }, { tableLimit: next });
    revalidatePath("/admin");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Table limit could not be saved." };
  }
}

/** Turns this restaurant's kitchen screen (and Kitchen staff role) on or off; null goes back to its plan */
export async function setTenantKitchenAction(tenantId: string, on: boolean | null): Promise<TenantActionState> {
  try {
    const admin = await requireSuperAdmin();
    const [tenant] = await db.select({ kitchenDisplay: s.tenants.kitchenDisplay }).from(s.tenants).where(eq(s.tenants.id, tenantId));
    if (!tenant) return { error: "Tenant not found." };
    const next = on === null ? null : on === true;
    await db.update(s.tenants).set({ kitchenDisplay: next }).where(eq(s.tenants.id, tenantId));
    await logAdminAction(admin, tenantId, "admin.kitchen_changed", { kitchenDisplay: tenant.kitchenDisplay }, { kitchenDisplay: next });
    revalidatePath("/admin");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Kitchen setting could not be saved." };
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
  features: Features;

};

const limit = (value: number | null) => (value === null ? null : Math.max(1, Math.floor(value)));
/** Only the switches TableQR knows, as true/false, with whole-number limits */
const cleanFeatures = (f: Features): Features => ({
  ...(Object.fromEntries(FEATURE_KEYS.map((k) => [k, f[k] === true])) as Record<(typeof FEATURE_KEYS)[number], boolean>),
  maxTables: limit(f.maxTables), maxStaff: limit(f.maxStaff), poweredBy: f.poweredBy === true,
});

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
      features: cleanFeatures(input.features),
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
