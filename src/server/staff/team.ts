import { storeMenuImage } from "../menu-storage";
import "server-only";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { canSee, type StaffRole } from "@/lib/staff-permissions";
import { AppError } from "../errors";
import { audit } from "./audit";
import type { StaffSession } from "./auth";
import { hashPin, isPin } from "./pin";
import { staffLimitMessage, tenantFeatures } from "../plan";

// Team: the people who can sign in at this outlet. Managers see the list; only the owner adds
// people, changes a role, resets a PIN or switches someone off. The owner role itself is never
// handed out here, and a person can never change their own access.

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "roles" | "userId" | "name">;
/** Roles the owner can give. Kitchen only with the kitchen screen, Waiter only with the waiter app, Reception only with rooms, Rider only with delivery (plan or admin). */
export const TEAM_ROLES = ["manager", "reception", "waiter", "accountant", "kitchen", "rider"] as const satisfies readonly StaffRole[];
export type TeamRole = (typeof TEAM_ROLES)[number];
/** Older roles (cashier, host) are no longer handed out; people who already have them keep working */
const LIST_ORDER = ["owner", "manager", "reception", "waiter", "accountant", "kitchen", "rider", "cashier", "host"];

/** The roles this restaurant's owner may give, from its plan */
export async function assignableRoles(tenantId: string): Promise<TeamRole[]> {
  const f = await tenantFeatures(tenantId);
  return TEAM_ROLES.filter((r) => (r !== "kitchen" || f.kitchenDisplay) && (r !== "waiter" || f.waiterApp) && (r !== "reception" || f.rooms) && (r !== "rider" || f.delivery));
}

/** Stops the owner going past the plan's staff logins; the owner's own login does not count */
async function assertRoomForStaff(tx: Pick<typeof db, "selectDistinct">, staff: Staff, joining: string | null) {
  const { maxStaff } = await tenantFeatures(staff.tenantId);
  if (maxStaff === null) return;
  const rows = await tx.selectDistinct({ id: s.users.id }).from(s.users)
    .innerJoin(s.staffRoles, and(eq(s.staffRoles.tenantId, s.users.tenantId), eq(s.staffRoles.userId, s.users.id)))
    .where(and(eq(s.users.tenantId, staff.tenantId), eq(s.users.isActive, true)));
  const owners = await tx.selectDistinct({ id: s.staffRoles.userId }).from(s.staffRoles).where(and(eq(s.staffRoles.tenantId, staff.tenantId), eq(s.staffRoles.role, "owner")));
  const ownerIds = new Set(owners.map((o) => o.id));
  const counted = rows.filter((r) => !ownerIds.has(r.id) && r.id !== joining).length;
  if (counted >= maxStaff) throw bad(staffLimitMessage(maxStaff));
}

export type TeamMember = { id: string; name: string; phone: string; photoUrl: string | null; isActive: boolean; roles: StaffRole[]; isMe: boolean; locked: boolean };

const bad = (message: string) => new AppError("invalid_state", message, { reason: "team" });
const ownerOnly = (staff: Staff) => { if (!staff.roles.includes("owner")) throw new AppError("forbidden", "Only the owner can change the team."); };

export async function listTeam(staff: Staff): Promise<TeamMember[]> {
  if (!canSee(staff, "team")) throw new AppError("forbidden", "Your role cannot view the team.");
  const rows = await db
    .select({ id: s.users.id, name: s.users.name, phone: s.users.phone, photoUrl: s.users.photoUrl, isActive: s.users.isActive, role: s.staffRoles.role, outletId: s.staffRoles.outletId })
    .from(s.staffRoles)
    .innerJoin(s.users, and(eq(s.users.tenantId, s.staffRoles.tenantId), eq(s.users.id, s.staffRoles.userId)))
    .where(and(eq(s.staffRoles.tenantId, staff.tenantId), or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, staff.outletId))));
  const byUser = new Map<string, TeamMember>();
  for (const r of rows) {
    const m = byUser.get(r.id) ?? { id: r.id, name: r.name, phone: r.phone, photoUrl: r.photoUrl, isActive: r.isActive, roles: [], isMe: r.id === staff.userId, locked: false };
    if (!m.roles.includes(r.role)) m.roles.push(r.role);
    // Owners and people with access to every outlet are managed by TableQR, not here
    if (r.role === "owner" || r.outletId === null) m.locked = true;
    byUser.set(r.id, m);
  }
  return [...byUser.values()].sort((a, b) => LIST_ORDER.indexOf(a.roles[0]) - LIST_ORDER.indexOf(b.roles[0]) || a.name.localeCompare(b.name));
}

async function target(tx: Pick<typeof db, "select">, staff: Staff, userId: string) {
  const roles = await tx.select().from(s.staffRoles).where(and(eq(s.staffRoles.tenantId, staff.tenantId), eq(s.staffRoles.userId, userId), or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, staff.outletId))));
  const [user] = await tx.select().from(s.users).where(and(eq(s.users.tenantId, staff.tenantId), eq(s.users.id, userId)));
  if (!user || roles.length === 0) throw new AppError("not_found", "That person is not on this outlet's team.");
  if (userId === staff.userId) throw bad("You cannot change your own access.");
  if (roles.some((r) => r.role === "owner" || r.outletId === null)) throw bad("This person is managed by TableQR. Contact support to change them.");
  return { user, roles };
}

const revokeSessions = (tx: Pick<typeof db, "update">, staff: Staff, userId: string, now: Date) =>
  tx.update(s.staffSessions).set({ revokedAt: now }).where(and(eq(s.staffSessions.tenantId, staff.tenantId), eq(s.staffSessions.userId, userId), isNull(s.staffSessions.revokedAt)));

export async function changeRole(staff: Staff, userId: string, role: string, now = new Date()) {
  ownerOnly(staff);
  if (!(await assignableRoles(staff.tenantId)).includes(role as TeamRole)) throw bad("Pick a role.");
  await db.transaction(async (tx) => {
    const { roles } = await target(tx, staff, userId);
    await tx.delete(s.staffRoles).where(and(eq(s.staffRoles.tenantId, staff.tenantId), eq(s.staffRoles.userId, userId), eq(s.staffRoles.outletId, staff.outletId)));
    await tx.insert(s.staffRoles).values({ id: uuidv7(), tenantId: staff.tenantId, userId, outletId: staff.outletId, role: role as TeamRole });
    await audit(tx, staff, { action: "team.role_changed", entity: "user", entityId: userId, before: { roles: roles.map((r) => r.role) }, after: { role }, now });
  });
}

export async function resetPin(staff: Staff, userId: string, pin: string, now = new Date()) {
  ownerOnly(staff);
  if (!isPin(pin)) throw bad("The PIN must be 4 digits.");
  await db.transaction(async (tx) => {
    await target(tx, staff, userId);
    await tx.update(s.users).set({ pinHash: await hashPin(pin) }).where(and(eq(s.users.tenantId, staff.tenantId), eq(s.users.id, userId)));
    await revokeSessions(tx, staff, userId, now);
    await audit(tx, staff, { action: "team.pin_reset", entity: "user", entityId: userId, now });
  });
}

export async function setMemberActive(staff: Staff, userId: string, active: boolean, now = new Date()) {
  ownerOnly(staff);
  await db.transaction(async (tx) => {
    await target(tx, staff, userId);
    if (active) await assertRoomForStaff(tx, staff, userId);
    await tx.update(s.users).set({ isActive: !!active }).where(and(eq(s.users.tenantId, staff.tenantId), inArray(s.users.id, [userId])));
    if (!active) await revokeSessions(tx, staff, userId, now);
    await audit(tx, staff, { action: active ? "team.member_on" : "team.member_off", entity: "user", entityId: userId, now });
  });
}

/** A face photo for a team member, shown on the dashboard, the team list and, for riders, to customers */
export async function setMemberPhoto(staff: Staff, userId: string, photo: { bytes: Buffer; contentType: string; filename: string }, now = new Date()) {
  ownerOnly(staff);
  const { url } = await storeMenuImage({ tenantId: staff.tenantId, brandId: "staff", ...photo });
  await db.transaction(async (tx) => {
    await target(tx, staff, userId);
    await tx.update(s.users).set({ photoUrl: url }).where(and(eq(s.users.tenantId, staff.tenantId), eq(s.users.id, userId)));
    await audit(tx, staff, { action: "team.photo_set", entity: "user", entityId: userId, now });
  });
  return { photoUrl: url };
}
