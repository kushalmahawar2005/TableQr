"use server";
import { consoleSectionRoles } from "@/lib/staff-permissions";
import { AppError } from "@/server/errors";
import type { StaffSession } from "@/server/staff/auth";
import { getDashboard, getRevenueTrend } from "@/server/staff/dashboard";
import { staffFor } from "@/server/staff/request";

// O1 Owner Dashboard reads. Read-only: staff, role and outlet come from the httpOnly cookie, and
// the read model checks the role again. Nothing here changes restaurant data.

export type DashboardResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

async function run<T>(work: (staff: StaffSession) => Promise<T>): Promise<DashboardResult<T>> {
  try {
    return { ok: true, data: await work(await staffFor(consoleSectionRoles.dashboard)) };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, code: err.code, message: err.message };
    console.error("[dashboard] read failed", err);
    return { ok: false, code: "failed", message: "Could not refresh the dashboard. Retrying." };
  }
}

export async function dashboardAction() {
  return run((s) => getDashboard(s));
}

export async function revenueTrendAction() {
  return run((s) => getRevenueTrend(s));
}
