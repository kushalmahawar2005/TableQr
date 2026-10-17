import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { FEATURE_KEYS, type FeatureKey } from "@/lib/plan-features";
import { AppError } from "../errors";
import type { StaffSession } from "./auth";

// A restaurant asks TableQR to unlock a feature or change its plan. Nothing changes by itself: the
// platform admin sees the request and changes the plan, custom package or price by hand.

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "roles" | "name">;

/** Owner or manager asks; asking again for the same thing while it is still open changes nothing */
export async function requestPlanChange(staff: Staff, input: { feature?: string | null; note?: string | null }, now = new Date()) {
  if (!staff.roles.some((r) => r === "owner" || r === "manager")) throw new AppError("forbidden", "Ask the owner or a manager to request this.");
  const feature = input.feature && (FEATURE_KEYS as readonly string[]).includes(input.feature) ? (input.feature as FeatureKey) : null;
  const note = String(input.note ?? "").trim().slice(0, 300) || null;
  if (!feature && !note) throw new AppError("invalid_state", "Write what you need.");
  const [open] = await db
    .select({ id: s.planRequests.id })
    .from(s.planRequests)
    .where(and(eq(s.planRequests.tenantId, staff.tenantId), eq(s.planRequests.status, "open"), feature ? eq(s.planRequests.feature, feature) : and(isNull(s.planRequests.feature), eq(s.planRequests.note, note!))));
  if (open) return { id: open.id, already: true };
  const id = uuidv7();
  await db.insert(s.planRequests).values({ id, tenantId: staff.tenantId, outletId: staff.outletId, requestedBy: staff.name.slice(0, 80), feature, note, createdAt: now });
  return { id, already: false };
}

/** Whether this restaurant already asked for the feature and is waiting */
export async function hasOpenRequest(tenantId: string, feature: FeatureKey) {
  const [row] = await db.select({ id: s.planRequests.id }).from(s.planRequests).where(and(eq(s.planRequests.tenantId, tenantId), eq(s.planRequests.status, "open"), eq(s.planRequests.feature, feature)));
  return !!row;
}
