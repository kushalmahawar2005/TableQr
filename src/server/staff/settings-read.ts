import "server-only";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { canSee } from "@/lib/staff-permissions";
import { AppError } from "../errors";
import type { StaffSession } from "./auth";

// Outlet profile (read-only): the signed-in outlet's details and its setup counts, scoped to the
// tenant and outlet.

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "roles">;

export type OutletSettings = {
  name: string; code: string; city: string; address: string; gstin: string | null; fssai: string | null; timezone: string;
  sessionMode: string; autoAcceptOrders: boolean; serviceChargeBp: number; tipPresetsBp: number[] | null; reviewUrl: string | null;
  openingHours: Record<string, [string, string][]> | null;
  tables: number; staff: number; plan: string;
};

export async function getOutletSettings(staff: Staff): Promise<OutletSettings> {
  if (!canSee(staff.roles, "settings")) throw new AppError("forbidden", "Your role cannot view settings.");
  const [outlet] = await db.select().from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId)));
  if (!outlet) throw new AppError("not_found", "Outlet not found.");
  const [[tables], [team], [plan]] = await Promise.all([
    db.select({ n: count() }).from(s.diningTables).where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.outletId, staff.outletId))),
    db.select({ n: count() }).from(s.staffRoles).where(and(eq(s.staffRoles.tenantId, staff.tenantId))),
    db.select({ name: s.plans.name }).from(s.tenants).innerJoin(s.plans, eq(s.tenants.planCode, s.plans.code)).where(eq(s.tenants.id, staff.tenantId)),
  ]);
  return {
    name: outlet.name, code: outlet.code, city: outlet.city, address: outlet.address, gstin: outlet.gstin, fssai: outlet.fssai, timezone: outlet.timezone,
    sessionMode: outlet.sessionMode, autoAcceptOrders: outlet.autoAcceptOrders, serviceChargeBp: outlet.serviceChargeBp, tipPresetsBp: outlet.tipPresetsBp,
    reviewUrl: outlet.reviewUrl, openingHours: outlet.openingHours, tables: Number(tables.n), staff: Number(team.n), plan: plan?.name ?? "",
  };
}
