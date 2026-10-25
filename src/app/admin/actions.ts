"use server";
import { friendlyError } from "@/server/friendly-error";

import { insertRoom } from "@/server/staff/rooms";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import * as s from "@/db/schema";
import { uuidv7 } from "@/db/id";
import { hashPin, isPin } from "@/server/staff/pin";
import { getTenantDetail } from "@/server/admin/tenant-detail";
import { confirmFee, feesData, recordFee, rejectFee, type FeesData } from "@/server/fees";
import { getAnalyticsData } from "@/server/admin/analytics";
import { getAuditData } from "@/server/admin/audit";
import { getSettingsData } from "@/server/admin/settings";
import { checkRealtime, type RealtimeCheck } from "@/server/realtime/check";
import type { AnalyticsData, AnalyticsRange, AuditData, SettingsData, TenantDetail } from "./admin-types";
import { requirePlatformAdmin, signInPlatformAdmin, signOutPlatformAdmin } from "@/server/admin/auth";
import { randomInt } from "node:crypto";
import { effectiveFeatures, tenantFeatures } from "@/server/plan";
import { FEATURE_KEYS, readFeatures, type Features } from "@/lib/plan-features";
import { cleanRoleAccess } from "@/lib/staff-permissions";

export type AdminLoginState = { error: string | null };
export type TenantState = { error: string | null; success: string | null; outletCode?: string };

export async function adminLoginAction(_prev: AdminLoginState, form: FormData): Promise<AdminLoginState> {
  try {
    const ok = await signInPlatformAdmin(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
    if (!ok) return { error: "Email or password is not correct." };
  } catch {
    return { error: "Admin sign-in is temporarily unavailable. Please try again shortly." };
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The typed outlet code if free, else the outlet name's first letters plus two digits (Spice Route -> SPI42) */
async function pickOutletCode(tx: Tx, typed: string, outletName: string) {
  const taken = async (code: string) => (await tx.select({ id: s.outlets.id }).from(s.outlets).where(eq(s.outlets.code, code))).length > 0;
  if (typed) {
    if (await taken(typed)) throw new Error("That outlet code is already in use.");
    return typed;
  }
  const prefix = outletName.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3).padEnd(3, "X");
  for (let attempt = 0; attempt < 30; attempt++) {
    const candidate = `${prefix}${String(randomInt(100)).padStart(2, "0")}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new Error("Could not generate an outlet code. Please type one.");
}

/** One "Main Hall" with tables T1..Tn, each with its own QR code (no tables for a hotel without a restaurant) */
async function addStarterFloor(tx: Tx, tenantId: string, outletId: string, zoneId: string, tableCount: number) {
  await tx.insert(s.zones).values({ id: zoneId, tenantId, outletId, name: "Main Hall", isActive: tableCount > 0 });
  for (let i = 1; i <= tableCount; i++) {
    const tableId = uuidv7();
    await tx.insert(s.diningTables).values({ id: tableId, tenantId, outletId, zoneId, code: `T${i}`, maxSeats: 4, tableClass: "4-top", joinCode: joinCode() });
    await tx.insert(s.qrCodes).values({ id: uuidv7(), tenantId, outletId, tableId, type: "table", shortCode: shortCode() });
  }
}

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
    const customPackage = text(form, "customizeFeatures") === "on";
    let selectedFeatures: Features | null = null;
    if (customPackage) {
      try { selectedFeatures = readFeatures(JSON.parse(text(form, "customFeatures"))); }
      catch { return { error: "The custom feature selection is invalid. Please review it and try again.", success: null }; }
      if (selectedFeatures.maxTables !== null && (selectedFeatures.maxTables < 1 || selectedFeatures.maxTables > 500)) return { error: "Table limit must be from 1 to 500, or empty for no limit.", success: null };
      if (selectedFeatures.maxStaff !== null && (selectedFeatures.maxStaff < 1 || selectedFeatures.maxStaff > 500)) return { error: "Staff limit must be from 1 to 500, or empty for no limit.", success: null };
      if (selectedFeatures.maxRooms !== null && (selectedFeatures.maxRooms < 1 || selectedFeatures.maxRooms > 1000)) return { error: "Room limit must be from 1 to 1000, or empty for no limit.", success: null };
    }
    const typedCode = text(form, "outletCode").toUpperCase();
    const outletName = text(form, "outletName");
    const city = text(form, "city");
    const address = text(form, "address");
    const ownerPhone = text(form, "ownerPhone");
    const ownerName = text(form, "ownerName");
    const ownerPin = text(form, "ownerPin");
    const tableCount = Math.min(100, Math.max(1, Number(text(form, "tableCount") || 4)));
    const roomCount = Math.min(200, Math.max(0, Math.floor(Number(text(form, "roomCount") || 0))));
    const trialDays = Math.min(90, Math.max(1, Math.floor(Number(text(form, "trialDays") || 14))));
    const guestPayments = text(form, "guestPayments") || "online";
    if (!["online", "counter"].includes(guestPayments)) return { error: "Choose online checkout or restaurant-collected payments.", success: null };
    // Kitchen screen chosen at onboarding: stored only when it differs from the plan
    const kitchenChoice = form.get("kitchenDisplay") === null ? null : text(form, "kitchenDisplay") === "on";
    if (!tenantName || !contactName || !contactPhone || !planCode || !outletName || !city || !address || !ownerPhone || !ownerName || !isPin(ownerPin)) {
      return { error: "Please fill every required field. Owner PIN must be exactly 4 digits.", success: null };
    }
    if (typedCode && !/^[A-Z0-9]{2,12}$/.test(typedCode)) return { error: "Outlet code must be 2-12 letters or numbers.", success: null };

    const result = await db.transaction(async (tx) => {
      const [plan] = await tx.select({ code: s.plans.code, features: s.plans.features }).from(s.plans).where(and(eq(s.plans.code, planCode), eq(s.plans.isPublic, true)));
      if (!plan) throw new Error("Selected plan does not exist.");
      const outletCode = await pickOutletCode(tx, typedCode, outletName);
      const tenantId = uuidv7();
      const brandId = uuidv7();
      const outletId = uuidv7();
      const zoneId = uuidv7();
      const userId = uuidv7();
      const planFeatures = selectedFeatures ?? readFeatures(plan.features);
      const kitchenDisplay = kitchenChoice === null || kitchenChoice === planFeatures.kitchenDisplay ? null : kitchenChoice;
      // The plan's table limit applies; only tables beyond it are stored as this restaurant's own limit
      const planTables = planFeatures.maxTables;
      const tableLimit = planTables !== null && tableCount > planTables ? tableCount : null;
      await tx.insert(s.tenants).values({ id: tenantId, name: tenantName, planCode, contactName, contactPhone, contactEmail: contactEmail || null, createdByAdminId: admin.id, kitchenDisplay, tableLimit, customFeatures: selectedFeatures, trialEndsAt: new Date(Date.now() + trialDays * 86_400_000) });
      await tx.insert(s.brands).values({ id: brandId, tenantId, name: brandName });
      await tx.insert(s.outlets).values({ id: outletId, tenantId, brandId, code: outletCode, name: outletName, city, address, guestOnlinePayments: guestPayments === "online" });
      await tx.insert(s.users).values({ id: userId, tenantId, phone: ownerPhone, name: ownerName, pinHash: await hashPin(ownerPin) });
      await tx.insert(s.staffRoles).values({ id: uuidv7(), tenantId, userId, outletId, role: "owner" });
      await addStarterFloor(tx, tenantId, outletId, zoneId, planFeatures.dineIn ? tableCount : 0);
      // Hotel plans: rooms 101, 102 … with their QR codes; the owner can renumber them in Rooms
      if (planFeatures.rooms) {
        const rooms = Math.min(planFeatures.maxRooms ?? 200, roomCount);
        for (let i = 0; i < rooms; i++) await insertRoom(tx, { tenantId, outletId, zoneId }, { number: String(101 + i) });
      }
      return { tenantId, outletCode };
    });
    await logAdminAction(admin, result.tenantId, "admin.tenant_created", null, { name: tenantName, planCode, outlet: result.outletCode });
    return { error: null, success: `Restaurant created. Owner can sign in at /console/login using outlet ${result.outletCode}.`, outletCode: result.outletCode };
  } catch (error) {
    return { error: friendlyError(error, "Restaurant could not be created."), success: null };
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
    return { error: friendlyError(error, "Tenant could not be updated.") };
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
    return { error: friendlyError(error, "Trial could not be extended.") };
  }
}

const FEE_METHODS = { upi: "UPI", cash: "Cash", bank: "Bank transfer" } as const;
export type FeeMethod = keyof typeof FEE_METHODS;

/** The restaurant paid its TableQR fee by hand (UPI, cash or bank): record it; the paid months start right away */
export async function recordFeePaymentAction(tenantId: string, input: { months: number; amountRupees: number; method: FeeMethod; reference: string }): Promise<TenantActionState> {
  try {
    const admin = await requireSuperAdmin();
    if (!(input.method in FEE_METHODS)) return { error: "Choose how they paid." };
    const r = await recordFee(`admin:${admin.email}`, tenantId, input);
    await logFee(admin, tenantId, r.before, r);
    revalidatePath("/admin");
    return { error: null };
  } catch (error) {
    return { error: friendlyError(error, "Payment could not be saved.") };
  }
}

async function logFee(admin: { email: string }, tenantId: string, before: string, r: { months: number; amountPaise: number; method: string; reference: string | null; periodEnd?: Date; paidUntil?: Date }) {
  const until = (r.periodEnd ?? r.paidUntil)!;
  await logAdminAction(admin, tenantId, "admin.fee_received", { status: before }, { status: "active", months: r.months, amountPaise: r.amountPaise, method: r.method, reference: r.reference, paidUntil: until.toISOString() },
    `₹${(r.amountPaise / 100).toLocaleString("en-IN")} by ${FEE_METHODS[r.method as FeeMethod]}${r.reference ? ` (${r.reference})` : ""} for ${r.months} ${r.months === 1 ? "month" : "months"}`);
}

/** The owner said they paid and the money is in the bank: add their months */
export async function confirmFeeAction(id: string): Promise<TenantActionState> {
  try {
    const admin = await requireSuperAdmin();
    const r = await confirmFee(id);
    const [claim] = await db.select({ method: s.feePayments.method, reference: s.feePayments.reference }).from(s.feePayments).where(and(eq(s.feePayments.tenantId, r.tenantId), eq(s.feePayments.id, id)));
    await logFee(admin, r.tenantId, r.before, { ...r, method: claim?.method ?? "upi", reference: claim?.reference ?? null });
    revalidatePath("/admin");
    return { error: null };
  } catch (error) {
    return { error: friendlyError(error, "Payment could not be confirmed.") };
  }
}

/** The money never came: the owner can say "I have paid" again */
export async function rejectFeeAction(id: string): Promise<TenantActionState> {
  try {
    const admin = await requireSuperAdmin();
    const r = await rejectFee(id);
    await logAdminAction(admin, r.tenantId, "admin.fee_rejected", null, { feePaymentId: id });
    revalidatePath("/admin");
    return { error: null };
  } catch (error) {
    return { error: friendlyError(error, "Payment could not be updated.") };
  }
}

export async function getFeesAction(): Promise<{ data: FeesData | null; error: string | null }> {
  try {
    await requirePlatformAdmin();
    return { data: await feesData(), error: null };
  } catch (error) {
    return { data: null, error: friendlyError(error, "Fees could not be loaded.") };
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
    return { error: friendlyError(error, "Tenant could not be updated.") };
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
    return { error: friendlyError(error, "Plan could not be changed.") };
  }
}

const CUSTOM_PLAN = "custom";

/**
 * Another outlet for a restaurant whose plan (or custom package) has Multiple outlets. It shares
 * the restaurant's menu; the owners can sign in there and switch between outlets in the console.
 */
export async function addOutletAction(tenantId: string, input: { name: string; city: string; address: string; code: string; tableCount: number }): Promise<TenantActionState & { outletCode?: string }> {
  try {
    const admin = await requireSuperAdmin();
    const name = input.name.trim().slice(0, 80);
    const city = input.city.trim().slice(0, 60);
    const address = input.address.trim().slice(0, 300);
    const typed = input.code.trim().toUpperCase();
    const tableCount = Math.floor(Number(input.tableCount));
    if (!name || !city || !address) return { error: "Enter the outlet name, city and address." };
    if (typed && !/^[A-Z0-9]{2,12}$/.test(typed)) return { error: "Outlet code must be 2-12 letters or numbers." };
    if (!Number.isFinite(tableCount) || tableCount < 1 || tableCount > 100) return { error: "Tables must be from 1 to 100." };
    const features = await tenantFeatures(tenantId);
    if (!features.multiOutlet) return { error: "Multiple outlets is not in this restaurant's plan. Change the plan, or tick it in the Custom package." };
    if (features.maxTables !== null && tableCount > features.maxTables) return { error: `This plan allows ${features.maxTables} tables per outlet.` };
    const outletCode = await db.transaction(async (tx) => {
      const [brand] = await tx.select({ id: s.brands.id }).from(s.brands).where(eq(s.brands.tenantId, tenantId)).orderBy(s.brands.createdAt).limit(1);
      if (!brand) throw new Error("Tenant not found.");
      const code = await pickOutletCode(tx, typed, name);
      const outletId = uuidv7();
      await tx.insert(s.outlets).values({ id: outletId, tenantId, brandId: brand.id, code, name, city, address });
      await addStarterFloor(tx, tenantId, outletId, uuidv7(), tableCount);
      // Owners tied to one outlet get the new one too; an owner for every outlet needs nothing
      const owners = await tx.select({ userId: s.staffRoles.userId, outletId: s.staffRoles.outletId }).from(s.staffRoles).where(and(eq(s.staffRoles.tenantId, tenantId), eq(s.staffRoles.role, "owner")));
      const everywhere = new Set(owners.filter((o) => o.outletId === null).map((o) => o.userId));
      for (const userId of new Set(owners.map((o) => o.userId))) {
        if (!everywhere.has(userId)) await tx.insert(s.staffRoles).values({ id: uuidv7(), tenantId, userId, outletId, role: "owner" });
      }
      return code;
    });
    await logAdminAction(admin, tenantId, "admin.outlet_added", null, { name, city, outletCode, tables: tableCount });
    revalidatePath("/admin");
    return { error: null, outletCode };
  } catch (error) {
    return { error: friendlyError(error, "Outlet could not be added.") };
  }
}

/** Custom package: the platform admin picks this restaurant's features, limits and price by hand */
export async function setCustomPackageAction(tenantId: string, input: { features: Features; priceRupees: number }): Promise<TenantActionState> {
  try {
    const admin = await requireSuperAdmin();
    const price = Math.floor(Number(input.priceRupees));
    if (!Number.isFinite(price) || price < 0 || price > 1_000_000) return { error: "Enter the price per month in rupees." };
    if (input.features.maxTables !== null && !(input.features.maxTables >= 1 && input.features.maxTables <= 500)) return { error: "Tables must be from 1 to 500, or empty for no limit." };
    if (input.features.maxStaff !== null && !(input.features.maxStaff >= 1 && input.features.maxStaff <= 500)) return { error: "Staff must be from 1 to 500, or empty for no limit." };
    if (input.features.maxRooms != null && !(input.features.maxRooms >= 1 && input.features.maxRooms <= 1000)) return { error: "Rooms must be from 1 to 1000, or empty for no limit." };
    const [tenant] = await db.select({ planCode: s.tenants.planCode, customFeatures: s.tenants.customFeatures, customPricePaise: s.tenants.customPricePaise }).from(s.tenants).where(eq(s.tenants.id, tenantId));
    if (!tenant) return { error: "Tenant not found." };
    const features = cleanFeatures(input.features);
    await db.update(s.tenants).set({ customFeatures: features, customPricePaise: price * 100, kitchenDisplay: null, tableLimit: null }).where(eq(s.tenants.id, tenantId));
    await logAdminAction(admin, tenantId, "admin.custom_package_saved", { features: tenant.customFeatures ? readFeatures(tenant.customFeatures) : null, pricePaise: tenant.customPricePaise }, { features, pricePaise: price * 100 });
    revalidatePath("/admin");
    return { error: null };
  } catch (error) {
    return { error: friendlyError(error, "Custom package could not be saved.") };
  }
}

/** Which roles may open which console section at this restaurant; the owner always keeps everything */
export async function setRoleAccessAction(tenantId: string, access: unknown): Promise<TenantActionState> {
  try {
    const admin = await requireSuperAdmin();
    const [tenant] = await db.select({ roleAccess: s.tenants.roleAccess }).from(s.tenants).where(eq(s.tenants.id, tenantId));
    if (!tenant) return { error: "Tenant not found." };
    const cleaned = cleanRoleAccess(access);
    const saved = Object.keys(cleaned).length ? cleaned : null;
    await db.update(s.tenants).set({ roleAccess: saved }).where(eq(s.tenants.id, tenantId));
    await logAdminAction(admin, tenantId, "admin.role_access_saved", tenant.roleAccess ?? null, saved);
    revalidatePath("/admin");
    return { error: null };
  } catch (error) {
    return { error: friendlyError(error, "Role access could not be saved.") };
  }
}

/** The admin has handled a restaurant's request (changed the plan, package or price, or said no) */
export async function markPlanRequestDoneAction(requestId: string): Promise<TenantActionState> {
  try {
    const admin = await requireSuperAdmin();
    const [request] = await db.select({ tenantId: s.planRequests.tenantId, feature: s.planRequests.feature, note: s.planRequests.note }).from(s.planRequests).where(eq(s.planRequests.id, requestId));
    if (!request) return { error: "Request not found." };
    await db.update(s.planRequests).set({ status: "done", doneAt: new Date() }).where(and(eq(s.planRequests.tenantId, request.tenantId), eq(s.planRequests.id, requestId)));
    await logAdminAction(admin, request.tenantId, "admin.plan_request_done", { feature: request.feature, note: request.note }, { status: "done" });
    revalidatePath("/admin");
    return { error: null };
  } catch (error) {
    return { error: friendlyError(error, "Request could not be updated.") };
  }
}

/** Charge this restaurant more or less than its plan's list price; null goes back to the plan's price */
export async function setTenantPriceAction(tenantId: string, rupees: number | null): Promise<TenantActionState> {
  try {
    const admin = await requireSuperAdmin();
    const price = rupees === null ? null : Math.floor(Number(rupees));
    if (price !== null && (!Number.isFinite(price) || price < 0 || price > 1_000_000)) return { error: "Enter the price per month in rupees." };
    const [tenant] = await db.select({ customPricePaise: s.tenants.customPricePaise }).from(s.tenants).where(eq(s.tenants.id, tenantId));
    if (!tenant) return { error: "Tenant not found." };
    await db.update(s.tenants).set({ customPricePaise: price === null ? null : price * 100 }).where(eq(s.tenants.id, tenantId));
    await logAdminAction(admin, tenantId, "admin.price_set", { pricePaise: tenant.customPricePaise }, { pricePaise: price === null ? null : price * 100 });
    revalidatePath("/admin");
    return { error: null };
  } catch (error) {
    return { error: friendlyError(error, "Price could not be saved.") };
  }
}

/** How many tables this restaurant may have on its floor (what it pays for) */
/** This restaurant's own table limit; null follows its plan */
export async function setTenantTableLimitAction(tenantId: string, limit: number | null): Promise<TenantActionState> {
  try {
    const admin = await requireSuperAdmin();
    const next = limit === null ? null : Math.floor(Number(limit));
    if (next !== null && (!Number.isFinite(next) || next < 1 || next > 500)) return { error: "Enter a table limit from 1 to 500, or leave it empty to follow the plan." };
    const [tenant] = await db.select({ tableLimit: s.tenants.tableLimit }).from(s.tenants).where(eq(s.tenants.id, tenantId));
    if (!tenant) return { error: "Tenant not found." };
    await db.update(s.tenants).set({ tableLimit: next }).where(eq(s.tenants.id, tenantId));
    await logAdminAction(admin, tenantId, "admin.table_limit_changed", { tableLimit: tenant.tableLimit }, { tableLimit: next });
    revalidatePath("/admin");
    return { error: null };
  } catch (error) {
    return { error: friendlyError(error, "Table limit could not be saved.") };
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
    return { error: friendlyError(error, "Kitchen setting could not be saved.") };
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
    return { error: friendlyError(error, "PIN could not be reset.") };
  }
}

export async function getTenantDetailAction(tenantId: string): Promise<{ detail: TenantDetail | null; error: string | null }> {
  try {
    return { detail: await getTenantDetail(tenantId), error: null };
  } catch (error) {
    return { detail: null, error: friendlyError(error, "Tenant details could not be loaded.") };
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
  maxTables: limit(f.maxTables), maxStaff: limit(f.maxStaff), maxRooms: limit(f.maxRooms ?? null), poweredBy: f.poweredBy === true,
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
    return { error: friendlyError(error, "Plan could not be saved.") };
  }
}

export async function getAnalyticsAction(range: AnalyticsRange): Promise<{ data: AnalyticsData | null; error: string | null }> {
  try {
    return { data: await getAnalyticsData(range), error: null };
  } catch (error) {
    return { data: null, error: friendlyError(error, "Analytics could not be loaded.") };
  }
}

export async function getAuditAction(): Promise<{ data: AuditData | null; error: string | null }> {
  try {
    return { data: await getAuditData(), error: null };
  } catch (error) {
    return { data: null, error: friendlyError(error, "Audit log could not be loaded.") };
  }
}

export async function getSettingsAction(): Promise<{ data: SettingsData | null; error: string | null }> {
  try {
    return { data: await getSettingsData(), error: null };
  } catch (error) {
    return { data: null, error: friendlyError(error, "Settings could not be loaded.") };
  }
}

/** Runs a real publish-and-receive round trip through the realtime Worker; says which step broke */
export async function checkRealtimeAction(): Promise<{ data: RealtimeCheck | null; error: string | null }> {
  try {
    await requirePlatformAdmin();
    return { data: await checkRealtime(), error: null };
  } catch (error) {
    return { data: null, error: friendlyError(error, "The live-updates check could not run.") };
  }
}
