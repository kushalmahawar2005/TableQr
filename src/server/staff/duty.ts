import "server-only";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { canSee } from "@/lib/staff-permissions";
import { AppError } from "../errors";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import { audit } from "./audit";
import type { StaffSession } from "./auth";
import { rebalanceWaiterVisit } from "./waiter-coverage";

// Who is working right now. The manager or owner sets each person's shift (on duty, on a break,
// off duty) from the dashboard; staff only see theirs. The staff app checks in while it is open,
// which gives "online now". Only people on duty are rung for new tasks.

export type DutyStatus = "on" | "break" | "off";
export const DUTY: DutyStatus[] = ["on", "break", "off"];
/** The staff app checks in at least this often while open */
export const ONLINE_MS = 2 * 60_000;

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "userId" | "name" | "roles">;

export async function myDuty(staff: Staff): Promise<{ status: DutyStatus; since: number | null }> {
  const [u] = await db.select({ status: s.users.dutyStatus, since: s.users.dutyChangedAt }).from(s.users).where(and(eq(s.users.tenantId, staff.tenantId), eq(s.users.id, staff.userId)));
  return { status: u?.status ?? "on", since: u?.since?.getTime() ?? null };
}

/** A manager or owner sets someone's shift */
export async function setDuty(staff: Staff, userId: string, status: DutyStatus, now = new Date()) {
  if (!staff.roles.some((r) => r === "owner" || r === "manager")) throw new AppError("forbidden", "Only a manager or owner can change shifts.");
  if (!DUTY.includes(status)) throw new AppError("invalid_state", "Choose on duty, break or off duty.");
  const member = (await teamDuty(staff, now)).find((r) => r.id === String(userId));
  if (!member) throw new AppError("not_found", "That person is not on this outlet's floor team.");
  if (member.status === status) return { status, since: member.since };
  await db.update(s.users).set({ dutyStatus: status, dutyChangedAt: now }).where(and(eq(s.users.tenantId, staff.tenantId), eq(s.users.id, member.id)));
  await audit(db, staff, { action: "staff.duty", entity: "user", entityId: member.id, before: { status: member.status }, after: { status, name: member.name }, now });
  if (status !== "on") {
    const visits = await db.select({ id: s.tableSessions.id }).from(s.tableSessions).where(and(eq(s.tableSessions.tenantId, staff.tenantId), eq(s.tableSessions.outletId, staff.outletId), eq(s.tableSessions.waiterUserId, member.id), inArray(s.tableSessions.status, ["open", "bill_requested"])));
    for (const visit of visits) await rebalanceWaiterVisit(staff, visit.id, now);
  }
  // Staff apps and other dashboards pick the change up straight away
  await publish({ tenantId: staff.tenantId, outletId: staff.outletId }, [{ topic: topics.tasks, type: "staff.duty", data: { userId: member.id, status } }]);
  return { status, since: now.getTime() };
}

/** The staff app is open: remember when, at most once a minute */
export async function checkIn(staff: Staff, now = new Date()) {
  await db
    .update(s.users)
    .set({ lastSeenAt: now })
    .where(and(eq(s.users.tenantId, staff.tenantId), eq(s.users.id, staff.userId), or(isNull(s.users.lastSeenAt), lt(s.users.lastSeenAt, new Date(now.getTime() - 60_000)))));
}

export type DutyRow = { id: string; name: string; photoUrl: string | null; roles: string[]; status: DutyStatus; since: number | null; lastSeenAt: number | null; online: boolean };

/** The floor team with their shift status, people on duty first */
export async function teamDuty(staff: Staff, now = new Date()): Promise<DutyRow[]> {
  if (!canSee(staff, "team")) throw new AppError("forbidden", "Your role cannot view the team.");
  const rows = await db
    .select({ id: s.users.id, name: s.users.name, photoUrl: s.users.photoUrl, role: s.staffRoles.role, status: s.users.dutyStatus, since: s.users.dutyChangedAt, seen: s.users.lastSeenAt })
    .from(s.staffRoles)
    .innerJoin(s.users, and(eq(s.users.tenantId, s.staffRoles.tenantId), eq(s.users.id, s.staffRoles.userId)))
    .where(and(eq(s.staffRoles.tenantId, staff.tenantId), eq(s.users.isActive, true), or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, staff.outletId)), inArray(s.staffRoles.role, ["manager", "waiter", "host", "cashier", "kitchen", "rider"])));
  const byId = new Map<string, DutyRow>();
  for (const r of rows) {
    const row = byId.get(r.id) ?? { id: r.id, name: r.name, photoUrl: r.photoUrl, roles: [], status: r.status, since: r.since?.getTime() ?? null, lastSeenAt: r.seen?.getTime() ?? null, online: !!r.seen && now.getTime() - r.seen.getTime() < ONLINE_MS };
    if (!row.roles.includes(r.role)) row.roles.push(r.role);
    byId.set(r.id, row);
  }
  const order: Record<DutyStatus, number> = { on: 0, break: 1, off: 2 };
  return [...byId.values()].sort((a, b) => order[a.status] - order[b.status] || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}
