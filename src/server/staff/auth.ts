import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, gt, gte, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { actionRoles, can, canUse, type ConsoleSectionSlug, type FloorPermission, type RoleAccess, type StaffRole } from "@/lib/staff-permissions";
import { AppError } from "../errors";
import type { StaffContext } from "./context";
import { ACCESS_STOPPED, tenantAccess } from "../access";

// Staff sign-in (S1): phone and a 4-digit PIN at one outlet. The device keeps a random token in an
// httpOnly cookie; the server stores only its hash. Roles and outlet scope are read from the
// database on every request, never from the cookie or the client.

export const STAFF_COOKIE = "tq_staff";
export const STAFF_SESSION_HOURS = 12;
/** Wrong PINs per phone and outlet before a 15-minute lock-out */
export const PIN_LIMIT = { attempts: 5, windowMinutes: 15 } as const;

export type StaffSession = StaffContext & {
  userId: string;
  sessionId: string;
  name: string;
  roles: StaffRole[];
  outlet: { code: string; name: string; timezone: string };
  expiresAt: number;
  /** Console sections the platform admin changed for this restaurant; null follows the defaults */
  access?: RoleAccess | null;
};

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const normalPhone = (phone: string) => phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "").slice(-15);
const failed = (message = "Phone number or PIN is not right.", details?: Record<string, unknown>) => new AppError("sign_in_failed", message, details);

/**
 * Checks phone and PIN at an outlet, with the 5-tries lock-out, and records the attempt.
 * Returns the user and their roles there; throws the same generic message for any failure.
 */
export async function verifyStaffPin(input: { outletCode: string; phone: string; pin: string; now?: Date }) {
  const { verifyPin } = await import("./pin");
  const now = input.now ?? new Date();
  const phone = normalPhone(String(input.phone ?? ""));
  // isolation-exempt: the tenant is resolved here, from the public outlet code typed at sign-in
  const [outlet] = await db.select({ id: s.outlets.id, tenantId: s.outlets.tenantId, code: s.outlets.code }).from(s.outlets).where(eq(s.outlets.code, String(input.outletCode ?? "").trim().toUpperCase()));
  if (!outlet || phone.length < 10) throw failed();
  const scope = { tenantId: outlet.tenantId, outletId: outlet.id };

  const since = new Date(now.getTime() - PIN_LIMIT.windowMinutes * 60_000);
  const [{ n }] = await db
    .select({ n: count() })
    .from(s.staffLoginAttempts)
    .where(and(eq(s.staffLoginAttempts.tenantId, scope.tenantId), eq(s.staffLoginAttempts.outletId, scope.outletId), eq(s.staffLoginAttempts.phone, phone), eq(s.staffLoginAttempts.ok, false), gte(s.staffLoginAttempts.createdAt, since)));
  if (n >= PIN_LIMIT.attempts) throw failed("Too many wrong PINs. Try again in 15 minutes or ask a manager.", { reason: "locked" });

  const [user] = await db.select().from(s.users).where(and(eq(s.users.tenantId, scope.tenantId), eq(s.users.phone, phone)));
  const pinOk = await verifyPin(String(input.pin ?? ""), user?.pinHash ?? null);
  const roles = user ? await rolesAt(user.id, scope) : [];
  const ok = !!user && pinOk && user.isActive && roles.length > 0;
  await db.insert(s.staffLoginAttempts).values({ id: uuidv7(), tenantId: scope.tenantId, outletId: scope.outletId, phone, ok, createdAt: now });
  if (!ok) {
    // A right PIN for someone without access here says so; anything else stays generic
    if (user && pinOk && user.isActive) throw failed("You don't have access to this outlet. Ask a manager.", { reason: "no_role" });
    throw failed();
  }
  return { user: user!, roles, scope, outletCode: outlet.code };
}

/** Signs in at an outlet; returns the cookie token (shown to nobody but the browser) */
export async function signInStaff(input: { outletCode: string; phone: string; pin: string; now?: Date }) {
  const now = input.now ?? new Date();
  const { user, scope } = await verifyStaffPin({ ...input, now });
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + STAFF_SESSION_HOURS * 3600_000);
  await db.insert(s.staffSessions).values({ id: uuidv7(), tenantId: scope.tenantId, userId: user.id, outletId: scope.outletId, tokenHash: hashToken(token), createdAt: now, expiresAt, lastSeenAt: now });
  await db.insert(s.auditLog).values({ tenantId: scope.tenantId, outletId: scope.outletId, actorUserId: user.id, actorLabel: `staff:${user.name}`, action: "staff.sign_in", entity: "user", entityId: user.id, createdAt: now });
  return { token, expiresAt };
}

async function rolesAt(userId: string, scope: { tenantId: string; outletId: string }): Promise<StaffRole[]> {
  const rows = await db
    .select({ role: s.staffRoles.role })
    .from(s.staffRoles)
    .where(and(eq(s.staffRoles.tenantId, scope.tenantId), eq(s.staffRoles.userId, userId), or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, scope.outletId))));
  return [...new Set(rows.map((r) => r.role))];
}

/** The signed-in staff member for a cookie token, or null if signed out, expired or deactivated */
export async function resolveStaff(token: string | null | undefined, now = new Date()): Promise<StaffSession | null> {
  if (!token || token.length > 200) return null;
  // isolation-exempt: the token's hash is the lookup key; the row it finds carries the tenant
  const [row] = await db
    .select({ session: s.staffSessions, user: s.users, outlet: { code: s.outlets.code, name: s.outlets.name, timezone: s.outlets.timezone }, access: s.tenants.roleAccess })
    .from(s.staffSessions)
    .innerJoin(s.users, and(eq(s.users.tenantId, s.staffSessions.tenantId), eq(s.users.id, s.staffSessions.userId)))
    .innerJoin(s.outlets, and(eq(s.outlets.tenantId, s.staffSessions.tenantId), eq(s.outlets.id, s.staffSessions.outletId)))
    .innerJoin(s.tenants, eq(s.tenants.id, s.staffSessions.tenantId))
    .where(and(eq(s.staffSessions.tokenHash, hashToken(token)), isNull(s.staffSessions.revokedAt), gt(s.staffSessions.expiresAt, now)));
  if (!row || !row.user.isActive) return null;
  const scope = { tenantId: row.session.tenantId, outletId: row.session.outletId };
  const roles = await rolesAt(row.user.id, scope);
  if (roles.length === 0) return null;
  return {
    ...scope,
    userId: row.user.id,
    sessionId: row.session.id,
    name: row.user.name,
    roles,
    outlet: row.outlet,
    expiresAt: row.session.expiresAt.getTime(),
    access: row.access ?? null,
  };
}

/** Outlets of this restaurant where the signed-in person has a role, for the outlet switcher */
export async function outletsFor(staff: Pick<StaffSession, "tenantId" | "userId">) {
  const rows = await db
    .selectDistinct({ id: s.outlets.id, name: s.outlets.name, code: s.outlets.code })
    .from(s.outlets)
    .innerJoin(s.staffRoles, and(eq(s.staffRoles.tenantId, s.outlets.tenantId), eq(s.staffRoles.userId, staff.userId), or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, s.outlets.id))))
    .where(eq(s.outlets.tenantId, staff.tenantId));
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Moves a signed-in person to another outlet of the same restaurant where they also have a role:
 * a new session starts there and the old one ends. Returns the new cookie token.
 */
export async function switchOutlet(token: string | null | undefined, outletId: string, now = new Date()) {
  const staff = await resolveStaff(token, now);
  if (!staff) throw new AppError("staff_signed_out", "Please sign in again.");
  const target = (await outletsFor(staff)).find((o) => o.id === outletId);
  if (!target) throw new AppError("forbidden", "You don't have access to that outlet.");
  const scope = { tenantId: staff.tenantId, outletId: target.id };
  const fresh = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + STAFF_SESSION_HOURS * 3600_000);
  await db.transaction(async (tx) => {
    await tx.insert(s.staffSessions).values({ id: uuidv7(), tenantId: scope.tenantId, userId: staff.userId, outletId: scope.outletId, tokenHash: hashToken(fresh), createdAt: now, expiresAt, lastSeenAt: now });
    await tx.update(s.staffSessions).set({ revokedAt: now }).where(and(eq(s.staffSessions.tenantId, staff.tenantId), eq(s.staffSessions.id, staff.sessionId)));
    await tx.insert(s.auditLog).values({ tenantId: scope.tenantId, outletId: scope.outletId, actorUserId: staff.userId, actorLabel: `staff:${staff.name}`, action: "staff.outlet_switched", entity: "outlet", entityId: target.id, createdAt: now });
  });
  return { token: fresh, expiresAt, outletCode: target.code };
}

/**
 * The staff member, who must hold one of `allowed` at this outlet. With a console section, roles
 * the platform admin took off that section at this restaurant are refused, and roles added to a
 * read-only section are let in to its general actions.
 */
export async function requireStaff(token: string | null | undefined, allowed: readonly StaffRole[], now = new Date(), section?: ConsoleSectionSlug): Promise<StaffSession> {
  const staff = await resolveStaff(token, now);
  if (!staff) throw new AppError("staff_signed_out", "Please sign in again.");
  if (!canUse(staff.roles, section ? actionRoles(allowed, section, staff.access) : allowed)) throw new AppError("forbidden", "Your role can't do this. Ask a manager.");
  if ((await tenantAccess(staff.tenantId, now)).state === "blocked") throw new AppError("forbidden", ACCESS_STOPPED, { reason: "paused" });
  return staff;
}

/** Throws unless the signed-in staff member's roles allow a floor action */
export function assertMay(staff: { roles: readonly StaffRole[] }, permission: FloorPermission) {
  if (!can(staff.roles, permission)) throw new AppError("forbidden", "Your role can't do this. Ask a manager.", { permission });
}

export async function signOutStaff(token: string | null | undefined, now = new Date()) {
  if (!token) return;
  // isolation-exempt: revoking by the token's own hash
  await db.update(s.staffSessions).set({ revokedAt: now }).where(and(eq(s.staffSessions.tokenHash, hashToken(token)), isNull(s.staffSessions.revokedAt)));
}
