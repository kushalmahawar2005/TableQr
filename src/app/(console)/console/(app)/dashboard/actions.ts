"use server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { consoleSectionRoles } from "@/lib/staff-permissions";
import { AppError } from "@/server/errors";
import type { StaffSession } from "@/server/staff/auth";
import { getDashboard, getRevenueTrend } from "@/server/staff/dashboard";
import { staffRealtimeToken, topics } from "@/server/realtime/token";
import { staffFor } from "@/server/staff/request";

// O1 Owner Dashboard reads and interactive quick actions.
export type DashboardResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

async function run<T>(work: (staff: StaffSession) => Promise<T>): Promise<DashboardResult<T>> {
  try {
    return { ok: true, data: await work(await staffFor(consoleSectionRoles.dashboard, "dashboard")) };
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

export async function resolveServiceRequestAction(requestId: string) {
  try {
    const staff = await staffFor(consoleSectionRoles.dashboard, "dashboard");
    const now = new Date();
    await db
      .update(s.serviceRequests)
      .set({ status: "done", doneAt: now, doneByUserId: staff.userId })
      .where(
        and(
          eq(s.serviceRequests.tenantId, staff.tenantId),
          eq(s.serviceRequests.outletId, staff.outletId),
          eq(s.serviceRequests.id, requestId),
        ),
      );
    return { ok: true };
  } catch (err) {
    console.error("[dashboard] resolveServiceRequestAction failed", err);
    return { ok: false };
  }
}

export async function checkInReservationAction(reservationId: string) {
  try {
    const staff = await staffFor(consoleSectionRoles.dashboard, "dashboard");
    const now = new Date();
    await db
      .update(s.reservations)
      .set({ status: "arrived", updatedAt: now })
      .where(
        and(
          eq(s.reservations.tenantId, staff.tenantId),
          eq(s.reservations.outletId, staff.outletId),
          eq(s.reservations.id, reservationId),
        ),
      );
    return { ok: true };
  } catch (err) {
    console.error("[dashboard] checkInReservationAction failed", err);
    return { ok: false };
  }
}

/**
 * Short-lived staff-scoped realtime token for the dashboard subscription (floor/kitchen/tasks).
 * The role gate runs first (staffFor with the dashboard section roles); returns null when
 * realtime is not configured, in which case the client falls back to polling.
 */
export async function dashboardTokenAction() {
  return run(async (s) => staffRealtimeToken(s, [topics.floor, topics.kitchen, topics.tasks]));
}
