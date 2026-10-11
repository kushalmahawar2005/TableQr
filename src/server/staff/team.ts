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
import { tenantHasKitchen } from "../plan";

// Team: the people who can sign in at this outlet. Managers see the list; only the owner adds
// people, changes a role, resets a PIN or switches someone off. The owner role itself is never
// handed out here, and a person can never change their own access.

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "roles" | "userId" | "name">;
/** Roles the owner can give. Kitchen only when the restaurant has the kitchen screen (plan or admin). */
export const TEAM_ROLES = ["manager", "waiter", "accountant", "kitchen"] as const satisfies readonly StaffRole[];
export type TeamRole = (typeof TEAM_ROLES)[number];
/** Older roles (cashier, host) are no longer handed out; people who already have them keep working */
const LIST_ORDER = ["owner", "manager", "waiter", "accountant", "kitchen", "cashier", "host"];

/** The roles this restaurant's owner may give, from its plan */
export async function assignableRoles(tenantId: string): Promise<TeamRole[]> {
  const kitchen = await tenantHasKitchen(tenantId);
  return TEAM_ROLES.filter((r) => r !== "kitchen" || kitchen);
}

export type TeamMember = { id: string; name: string; phone: string; isActive: boolean; roles: StaffRole[]; isMe: boolean; locked: boolean };

const normalPhone = (phone: string) => phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "").slice(-15);
const bad = (message: string) => new AppError("invalid_state", message, { reason: "team" });
const ownerOnly = (staff: Staff) => { if (!staff.roles.includes("owner")) throw new AppError("forbidden", "Only the owner can change the team."); };

export async function listTeam(staff: Staff): Promise<TeamMember[]> {
  if (!canSee(staff.roles, "team")) throw new AppError("forbidden", "Your role cannot view the team.");
  const rows = await db
    .select({ id: s.users.id, name: s.users.name, phone: s.users.phone, isActive: s.users.isActive, role: s.staffRoles.role, outletId: s.staffRoles.outletId })
    .from(s.staffRoles)
    .innerJoin(s.users, and(eq(s.users.tenantId, s.staffRoles.tenantId), eq(s.users.id, s.staffRoles.userId)))
    .where(and(eq(s.staffRoles.tenantId, staff.tenantId), or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, staff.outletId))));
  const byUser = new Map<string, TeamMember>();
  for (const r of rows) {
    const m = byUser.get(r.id) ?? { id: r.id, name: r.name, phone: r.phone, isActive: r.isActive, roles: [], isMe: r.id === staff.userId, locked: false };
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

export async function addMember(staff: Staff, input: { name: string; phone: string; role: string; pin: string }, now = new Date()) {
  ownerOnly(staff);
  const name = String(input.name ?? "").trim();
  const phone = normalPhone(String(input.phone ?? ""));
  const role = input.role as TeamRole;
  if (name.length < 2 || name.length > 80) throw bad("Enter the person's name.");
  if (phone.length !== 10) throw bad("Enter a 10-digit mobile number.");
  if (!(await assignableRoles(staff.tenantId)).includes(role)) throw bad("Pick a role.");
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(s.users).where(and(eq(s.users.tenantId, staff.tenantId), eq(s.users.phone, phone)));
    let userId = existing?.id;
    if (existing) {
      const [has] = await tx.select({ id: s.staffRoles.id }).from(s.staffRoles).where(and(eq(s.staffRoles.tenantId, staff.tenantId), eq(s.staffRoles.userId, existing.id), or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, staff.outletId))));
      if (has) throw bad("This number is already on the team.");
      // An existing PIN is kept; the person signs in with the PIN they already have
      if (!existing.isActive) await tx.update(s.users).set({ isActive: true }).where(and(eq(s.users.tenantId, staff.tenantId), eq(s.users.id, existing.id)));
    } else {
      if (!isPin(input.pin)) throw bad("The PIN must be 4 digits.");
      userId = uuidv7();
      await tx.insert(s.users).values({ id: userId, tenantId: staff.tenantId, phone, name, pinHash: await hashPin(input.pin) });
    }
    await tx.insert(s.staffRoles).values({ id: uuidv7(), tenantId: staff.tenantId, userId: userId!, outletId: staff.outletId, role });
    await audit(tx, staff, { action: "team.member_added", entity: "user", entityId: userId!, after: { name, phone, role }, now });
    return { id: userId!, existing: !!existing };
  });
}

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
    await tx.update(s.users).set({ isActive: !!active }).where(and(eq(s.users.tenantId, staff.tenantId), inArray(s.users.id, [userId])));
    if (!active) await revokeSessions(tx, staff, userId, now);
    await audit(tx, staff, { action: active ? "team.member_on" : "team.member_off", entity: "user", entityId: userId, now });
  });
}
