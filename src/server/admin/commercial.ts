import "server-only";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { ADDONS, BUSINESS_TYPES, businessSizesFor, freeMonthEnd, isBusinessSizeFor, setupFee, type BusinessSize, type BusinessType, type CommercialSettings } from "@/lib/subscription-pricing";
import { requirePlatformAdmin } from "./auth";

export async function commercialFor(tenantId: string) {
  await requirePlatformAdmin();
  const [tenant] = await db.select({ businessType: s.tenants.businessType, businessSize: s.tenants.businessSize, commercial: s.tenants.commercial, planCode: s.tenants.planCode }).from(s.tenants).where(eq(s.tenants.id, tenantId));
  if (!tenant) throw new Error("Business not found.");
  const outlets = await db.select({ id: s.outlets.id, name: s.outlets.name }).from(s.outlets).where(eq(s.outlets.tenantId, tenantId));
  return { ...tenant, outlets };
}
export type CommercialInput = { businessType: BusinessType; businessSize?: BusinessSize | null; outletCount: number; addons: CommercialSettings["addons"]; setupReceivedRupees: number; setupReference: string; goLive: boolean };
export async function saveCommercial(admin: { id: string; email: string; role: string }, tenantId: string, input: CommercialInput) {
  if (admin.role !== "super_admin") throw new Error("Only a super admin can change subscriptions.");
  if (!Object.hasOwn(BUSINESS_TYPES, input.businessType)) throw new Error("Choose a business category.");
  if (!Number.isInteger(input.outletCount) || input.outletCount < 1 || input.outletCount > 1000) throw new Error("Enter 1 to 1000 outlets.");
  if (!Number.isFinite(input.setupReceivedRupees) || input.setupReceivedRupees < 0 || !Number.isSafeInteger(Math.round(input.setupReceivedRupees * 100))) throw new Error("Enter the setup amount received.");
  await db.transaction(async tx => {
    const [tenant] = await tx.select().from(s.tenants).where(eq(s.tenants.id, tenantId)).for("update");
    if (!tenant || tenant.status === "cancelled" || tenant.status === "suspended") throw new Error("Business is unavailable.");
    const businessSize = input.businessSize === undefined ? (tenant.businessType === input.businessType ? tenant.businessSize : null) : input.businessSize;
    if (input.businessSize !== undefined && !isBusinessSizeFor(input.businessType, businessSize)) throw new Error("Choose a size that matches this business category.");
    if (input.businessSize === null && businessSizesFor(input.businessType).length) throw new Error("Choose Small, Big or Large for this business category.");
    const outlets = await tx.select({ id: s.outlets.id }).from(s.outlets).where(eq(s.outlets.tenantId, tenantId));
    const owned = new Set(outlets.map(x => x.id));
    if (input.outletCount < owned.size) throw new Error("Outlet count cannot be less than the outlets already created.");
    const addons: CommercialSettings["addons"] = {};
    for (const key of Object.keys(ADDONS) as (keyof typeof ADDONS)[]) {
      const ids = [...new Set(input.addons?.[key] ?? [])];
      if (ids.some(id => !owned.has(id))) throw new Error("Choose add-ons only for this business's outlets.");
      addons[key] = ids;
    }
    const now = new Date();
    const commercial: CommercialSettings = { version: 1, outletCount: input.outletCount, addons, goLiveAt: tenant.commercial?.goLiveAt ?? null, setupReceivedPaise: Math.round(input.setupReceivedRupees * 100), setupReference: String(input.setupReference ?? "").trim().slice(0,120) };
    if (commercial.setupReceivedPaise < (tenant.commercial?.setupReceivedPaise ?? 0)) throw new Error("A recorded setup receipt cannot be reduced here.");
    if (input.goLive && !commercial.goLiveAt) {
      const [paid] = await tx.select({ n: count() }).from(s.subscriptions).where(eq(s.subscriptions.tenantId, tenantId));
      if (Number(paid.n)) throw new Error("This business already has subscription history. Its existing paid period is preserved; contact support to migrate go-live dates.");
      if (commercial.setupReceivedPaise < setupFee(input.outletCount)) throw new Error("Record the full setup payment before going live.");
      commercial.goLiveAt = now.toISOString();
    }
    await tx.update(s.tenants).set({ businessType: input.businessType, businessSize, commercial,
      ...(commercial.goLiveAt && !tenant.commercial?.goLiveAt ? { status: "trial" as const, trialEndsAt: freeMonthEnd(now) } : {}),
    }).where(eq(s.tenants.id, tenantId));
    await tx.insert(s.auditLog).values({ tenantId, actorLabel: `admin:${admin.email}`, action: "admin.commercial_updated", entity: "tenant", entityId: tenantId, before: { businessType: tenant.businessType, businessSize: tenant.businessSize, commercial: tenant.commercial }, after: { businessType: input.businessType, businessSize, commercial }, createdAt: now });
  });
}
