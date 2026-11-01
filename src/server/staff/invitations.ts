import "server-only";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, count, desc, eq, gte, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { isCompleteCode, normaliseCode, OTP } from "@/domain/otp";
import { LOCK_THEN_READ } from "../db-types";
import { AppError } from "../errors";
import { smsMockEnabled, smsSender } from "../sms/sender";
import type { StaffSession } from "./auth";
import { hashPin, isPin } from "./pin";
import { staffLimitMessage, tenantFeatures } from "../plan";
import { assignableRoles, type TeamRole } from "./team";

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "roles" | "userId" | "name">;
const bad = (message: string) => new AppError("invalid_state", message, { reason: "staff_invitation" });
const ownerOnly = (staff: Staff) => { if (!staff.roles.includes("owner")) throw new AppError("forbidden", "Only the owner can invite staff."); };
const normalPhone = (value: string) => value.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
const tokenDigest = (token: string) => createHash("sha256").update(token).digest("hex");
const tokenTenantId = (token: string) => token.match(/^([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i)?.[1] ?? null;
const later = (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000);

function otpSecret() {
  const secret = process.env.OTP_SECRET || (process.env.NODE_ENV === "production" ? "" : "tableqr-local-otp-secret");
  if (!secret) throw new AppError("sms_failed", "Phone verification is temporarily unavailable.");
  return secret;
}

const otpDigest = (inviteId: string, challengeId: string, code: string) =>
  createHmac("sha256", otpSecret()).update(`${inviteId}:${challengeId}:${code}`).digest("hex");
const digestMatches = (expected: string, actual: string) => {
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(actual, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
};

function activeInvite(invite: typeof s.staffInvitations.$inferSelect | undefined, now: Date) {
  if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt <= now) {
    throw new AppError("expired", "This invitation is no longer valid. Ask the owner for a new link.");
  }
}

async function staffCapacity(tx: Pick<typeof db, "select" | "selectDistinct">, tenantId: string, now: Date, ignoreInviteId?: string) {
  const [features, activeRows, owners, activeInvites] = await Promise.all([
    tenantFeatures(tenantId),
    tx.selectDistinct({ id: s.users.id, phone: s.users.phone }).from(s.users)
      .innerJoin(s.staffRoles, and(eq(s.staffRoles.tenantId, s.users.tenantId), eq(s.staffRoles.userId, s.users.id)))
      .where(and(eq(s.users.tenantId, tenantId), eq(s.users.isActive, true))),
    tx.selectDistinct({ id: s.staffRoles.userId }).from(s.staffRoles)
      .where(and(eq(s.staffRoles.tenantId, tenantId), eq(s.staffRoles.role, "owner"))),
    tx.select({ id: s.staffInvitations.id, phone: s.staffInvitations.phone }).from(s.staffInvitations)
      .where(and(
        eq(s.staffInvitations.tenantId, tenantId),
        isNull(s.staffInvitations.acceptedAt),
        isNull(s.staffInvitations.revokedAt),
        gte(s.staffInvitations.expiresAt, now),
      )),
  ]);
  const ownerIds = new Set(owners.map((row) => row.id));
  const members = activeRows.filter((row) => !ownerIds.has(row.id));
  const occupiedPhones = new Set(members.map((row) => row.phone));
  const pending = activeInvites.filter((invite) => invite.id !== ignoreInviteId && !occupiedPhones.has(invite.phone));
  return { maxStaff: features.maxStaff, occupied: members.length + new Set(pending.map((invite) => invite.phone)).size, activePhones: occupiedPhones };
}

export type PendingStaffInvitation = { id: string; phone: string; role: TeamRole; expiresAt: number; createdAt: number };

export async function listStaffInvitations(staff: Staff, now = new Date()): Promise<PendingStaffInvitation[]> {
  if (!staff.roles.includes("owner")) return [];
  const rows = await db.select({ id: s.staffInvitations.id, phone: s.staffInvitations.phone, role: s.staffInvitations.role, expiresAt: s.staffInvitations.expiresAt, createdAt: s.staffInvitations.createdAt })
    .from(s.staffInvitations)
    .where(and(eq(s.staffInvitations.tenantId, staff.tenantId), eq(s.staffInvitations.outletId, staff.outletId), isNull(s.staffInvitations.acceptedAt), isNull(s.staffInvitations.revokedAt), gte(s.staffInvitations.expiresAt, now)))
    .orderBy(desc(s.staffInvitations.createdAt));
  return rows.map((row) => ({ ...row, expiresAt: row.expiresAt.getTime(), createdAt: row.createdAt.getTime() }));
}

export async function createStaffInvitation(staff: Staff, input: { phone: string; role: string }, now = new Date()) {
  ownerOnly(staff);
  const phone = normalPhone(String(input.phone ?? ""));
  const role = input.role as TeamRole;
  if (!/^\d{10}$/.test(phone)) throw bad("Enter a valid 10-digit mobile number.");
  if (!(await assignableRoles(staff.tenantId)).includes(role)) throw bad("Choose a role available on this restaurant's plan.");

  // Include the tenant UUID so all later invite lookups remain explicitly tenant-scoped.
  const token = `${staff.tenantId}.${randomBytes(32).toString("base64url")}`;
  const tokenHash = tokenDigest(token);
  const id = uuidv7();
  await db.transaction(async (tx) => {
    await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.id, staff.tenantId)).for("update");
    const [existing] = await tx.select({ id: s.users.id, isActive: s.users.isActive }).from(s.users)
      .where(and(eq(s.users.tenantId, staff.tenantId), eq(s.users.phone, phone)));
    if (existing && !existing.isActive) throw bad("This number belongs to switched-off staff. Switch their account on before inviting them.");
    if (existing) {
      const roles = await tx.select({ role: s.staffRoles.role }).from(s.staffRoles)
        .where(and(eq(s.staffRoles.tenantId, staff.tenantId), eq(s.staffRoles.userId, existing.id), or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, staff.outletId))));
      if (roles.length) throw bad("This number already has access to this outlet.");
      if (roles.some((row) => row.role === "owner")) throw bad("Owners cannot be invited as outlet staff.");
    }
    const [pending] = await tx.select({ id: s.staffInvitations.id }).from(s.staffInvitations)
      .where(and(eq(s.staffInvitations.tenantId, staff.tenantId), eq(s.staffInvitations.outletId, staff.outletId), eq(s.staffInvitations.phone, phone), isNull(s.staffInvitations.acceptedAt), isNull(s.staffInvitations.revokedAt), gte(s.staffInvitations.expiresAt, now)));
    if (pending) throw bad("An invitation for this number is already pending. Revoke it before creating another.");
    const capacity = await staffCapacity(tx, staff.tenantId, now);
    if (capacity.maxStaff !== null && capacity.occupied >= capacity.maxStaff) throw bad(staffLimitMessage(capacity.maxStaff));

    await tx.insert(s.staffInvitations).values({
      id, tenantId: staff.tenantId, outletId: staff.outletId, phone, role, tokenHash,
      createdByUserId: staff.userId, expiresAt: later(now, 7 * 24 * 3600), createdAt: now,
    });
  }, LOCK_THEN_READ);
  return { id, token, phone, role, expiresAt: later(now, 7 * 24 * 3600).getTime() };
}

export async function revokeStaffInvitation(staff: Staff, inviteId: string, now = new Date()) {
  ownerOnly(staff);
  await db.transaction(async (tx) => {
    const [invite] = await tx.select().from(s.staffInvitations).where(and(eq(s.staffInvitations.tenantId, staff.tenantId), eq(s.staffInvitations.outletId, staff.outletId), eq(s.staffInvitations.id, inviteId))).for("update");
    if (!invite || invite.acceptedAt || invite.revokedAt) throw new AppError("not_found", "This pending invitation was not found.");
    await tx.update(s.staffInvitations).set({ revokedAt: now }).where(and(eq(s.staffInvitations.tenantId, staff.tenantId), eq(s.staffInvitations.outletId, staff.outletId), eq(s.staffInvitations.id, inviteId), isNull(s.staffInvitations.acceptedAt), isNull(s.staffInvitations.revokedAt)));
    await tx.update(s.staffInvitationOtps).set({ deadAt: now }).where(and(eq(s.staffInvitationOtps.tenantId, staff.tenantId), eq(s.staffInvitationOtps.invitationId, inviteId), isNull(s.staffInvitationOtps.verifiedAt), isNull(s.staffInvitationOtps.deadAt)));
  }, LOCK_THEN_READ);
}

export async function getStaffInvitation(token: string, now = new Date()) {
  const tenantId = tokenTenantId(token);
  if (!tenantId) return { valid: false as const };
  const [row] = await db.select({ invite: s.staffInvitations, outletName: s.outlets.name, outletCode: s.outlets.code })
    .from(s.staffInvitations)
    .innerJoin(s.outlets, and(eq(s.outlets.tenantId, s.staffInvitations.tenantId), eq(s.outlets.id, s.staffInvitations.outletId)))
    .where(and(eq(s.staffInvitations.tenantId, tenantId), eq(s.staffInvitations.tokenHash, tokenDigest(token))));
  if (!row) return { valid: false as const };
  try { activeInvite(row.invite, now); } catch { return { valid: false as const }; }
  return { valid: true as const, outletName: row.outletName, outletCode: row.outletCode, role: row.invite.role, phoneLast4: row.invite.phone.slice(-4), expiresAt: row.invite.expiresAt.getTime() };
}

export async function sendStaffInvitationOtp(token: string, phoneInput: string, now = new Date()) {
  const tenantId = tokenTenantId(token);
  if (!tenantId) throw new AppError("expired", "This invitation is no longer valid. Ask the owner for a new link.");
  const phone = normalPhone(String(phoneInput ?? ""));
  if (!/^\d{10}$/.test(phone)) throw bad("Enter a valid 10-digit mobile number.");
  const code = String(randomInt(0, 10 ** OTP.length)).padStart(OTP.length, "0");
  const challengeId = uuidv7();
  const digest = tokenDigest(token);
  const sent = await db.transaction(async (tx) => {
    const [invite] = await tx.select().from(s.staffInvitations).where(and(eq(s.staffInvitations.tenantId, tenantId), eq(s.staffInvitations.tokenHash, digest))).for("update");
    activeInvite(invite, now);
    if (invite.phone !== phone) throw new AppError("invalid_phone", "This phone number does not match the invitation.");
    await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.id, invite.tenantId)).for("update");
    const [latest] = await tx.select().from(s.staffInvitationOtps)
      .where(and(eq(s.staffInvitationOtps.tenantId, invite.tenantId), eq(s.staffInvitationOtps.invitationId, invite.id)))
      .orderBy(desc(s.staffInvitationOtps.createdAt)).limit(1);
    if (latest && latest.resendAt > now) throw new AppError("rate_limited", "Wait a minute before requesting another code.");
    const since = new Date(now.getTime() - 10 * 60_000);
    const dayAgo = new Date(now.getTime() - 24 * 3600_000);
    const [[sentToday], [sentRecently]] = await Promise.all([
      tx.select({ n: count() }).from(s.staffInvitationOtps).where(and(eq(s.staffInvitationOtps.tenantId, invite.tenantId), eq(s.staffInvitationOtps.phone, phone), gte(s.staffInvitationOtps.createdAt, dayAgo))),
      tx.select({ n: count() }).from(s.staffInvitationOtps).where(and(eq(s.staffInvitationOtps.tenantId, invite.tenantId), eq(s.staffInvitationOtps.invitationId, invite.id), gte(s.staffInvitationOtps.createdAt, since))),
    ]);
    if (Number(sentToday.n) >= 5 || Number(sentRecently.n) >= 3) throw new AppError("rate_limited", "Too many verification codes. Try again later.");
    await tx.update(s.staffInvitationOtps).set({ deadAt: now }).where(and(eq(s.staffInvitationOtps.tenantId, invite.tenantId), eq(s.staffInvitationOtps.invitationId, invite.id), isNull(s.staffInvitationOtps.verifiedAt), isNull(s.staffInvitationOtps.deadAt)));
    const [outlet] = await tx.select({ name: s.outlets.name }).from(s.outlets).where(and(eq(s.outlets.tenantId, invite.tenantId), eq(s.outlets.id, invite.outletId)));
    await tx.insert(s.staffInvitationOtps).values({
      id: challengeId, tenantId: invite.tenantId, invitationId: invite.id, phone,
      codeHash: otpDigest(invite.id, challengeId, code), expiresAt: later(now, OTP.validSeconds),
      resendAt: later(now, OTP.resendSeconds), createdAt: now,
    });
    return { tenantId: invite.tenantId, outletName: outlet.name };
  }, LOCK_THEN_READ);

  const sender = smsSender();
  const result = await sender.sendOtp({ phone: `+91${phone}`, code, outletName: sent.outletName }).catch(() => ({ ok: false }));
  if (!result.ok) {
    await db.update(s.staffInvitationOtps).set({ deadAt: now }).where(and(eq(s.staffInvitationOtps.tenantId, sent.tenantId), eq(s.staffInvitationOtps.id, challengeId)));
    throw new AppError("sms_failed", "We could not send the code. Ask the owner to try again later.");
  }
  return { challengeId, phoneLast4: phone.slice(-4), expiresIn: OTP.validSeconds, resendIn: OTP.resendSeconds, devCode: sender.name === "mock" && (process.env.NODE_ENV !== "production" || smsMockEnabled()) ? code : undefined };
}

export async function completeStaffInvitation(input: { token: string; challengeId: string; code: string; name: string; pin: string }, now = new Date()) {
  const tenantId = tokenTenantId(input.token);
  if (!tenantId) throw new AppError("expired", "This invitation is no longer valid. Ask the owner for a new link.");
  const name = String(input.name ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) throw bad("Enter your name (2 to 80 characters).");
  if (!isPin(input.pin)) throw bad("Choose a 4-digit PIN.");
  const digest = tokenDigest(input.token);
  const code = normaliseCode(String(input.code ?? ""));
  const result = await db.transaction(async (tx) => {
    const [invite] = await tx.select().from(s.staffInvitations).where(and(eq(s.staffInvitations.tenantId, tenantId), eq(s.staffInvitations.tokenHash, digest))).for("update");
    activeInvite(invite, now);
    const [challenge] = await tx.select().from(s.staffInvitationOtps)
      .where(and(eq(s.staffInvitationOtps.tenantId, invite.tenantId), eq(s.staffInvitationOtps.invitationId, invite.id), eq(s.staffInvitationOtps.id, input.challengeId))).for("update");
    if (!challenge || challenge.phone !== invite.phone || challenge.deadAt || challenge.verifiedAt || challenge.expiresAt <= now) {
      return { ok: false as const, error: new AppError("expired", "This code has expired. Request a fresh code.") };
    }
    if (challenge.lockedUntil) return { ok: false as const, error: new AppError(challenge.lockedUntil > now ? "locked" : "expired", "Too many wrong codes. Request a fresh code.") };
    if (!isCompleteCode(code) || !digestMatches(challenge.codeHash, otpDigest(invite.id, challenge.id, code))) {
      const attempts = challenge.attempts + 1;
      const locked = attempts >= OTP.maxAttempts;
      await tx.update(s.staffInvitationOtps).set({ attempts, lockedUntil: locked ? later(now, OTP.lockSeconds) : null }).where(and(eq(s.staffInvitationOtps.tenantId, invite.tenantId), eq(s.staffInvitationOtps.id, challenge.id)));
      return { ok: false as const, error: new AppError(locked ? "locked" : "wrong", locked ? "Too many wrong codes. Request a fresh code." : "That code is not right. Check the message and try again.", { attemptsLeft: OTP.maxAttempts - attempts }) };
    }

    // Only spend the password-hash cost after the code is proven correct.
    const newPinHash = await hashPin(input.pin);
    await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.id, invite.tenantId)).for("update");
    const [existing] = await tx.select().from(s.users).where(and(eq(s.users.tenantId, invite.tenantId), eq(s.users.phone, invite.phone))).for("update");
    if (existing && !existing.isActive) throw bad("This staff account is switched off. Ask the owner to switch it on, then request a fresh invitation.");
    if (existing) {
      const [already] = await tx.select({ id: s.staffRoles.id }).from(s.staffRoles)
        .where(and(eq(s.staffRoles.tenantId, invite.tenantId), eq(s.staffRoles.userId, existing.id), or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, invite.outletId))));
      if (already) throw bad("This number already has access to this outlet. Ask the owner to manage the existing account.");
    }
    const capacity = await staffCapacity(tx, invite.tenantId, now, invite.id);
    const addsStaff = !existing;
    const pendingForOthers = Math.max(0, capacity.occupied - capacity.activePhones.size);
    if (capacity.maxStaff !== null && capacity.activePhones.size + (addsStaff ? 1 : 0) + pendingForOthers > capacity.maxStaff) {
      throw bad(staffLimitMessage(capacity.maxStaff));
    }

    const userId = existing?.id ?? uuidv7();
    if (!existing) {
      await tx.insert(s.users).values({ id: userId, tenantId: invite.tenantId, phone: invite.phone, name, pinHash: newPinHash, isActive: true });
    }
    await tx.insert(s.staffRoles).values({ id: uuidv7(), tenantId: invite.tenantId, userId, outletId: invite.outletId, role: invite.role });
    await tx.update(s.staffInvitationOtps).set({ verifiedAt: now }).where(and(eq(s.staffInvitationOtps.tenantId, invite.tenantId), eq(s.staffInvitationOtps.id, challenge.id)));
    await tx.update(s.staffInvitations).set({ acceptedAt: now }).where(and(eq(s.staffInvitations.tenantId, invite.tenantId), eq(s.staffInvitations.id, invite.id)));
    await tx.insert(s.auditLog).values({ tenantId: invite.tenantId, outletId: invite.outletId, actorLabel: "staff_invitation", action: "team.invitation_accepted", entity: "user", entityId: userId, after: { role: invite.role }, createdAt: now });
    const [outlet] = await tx.select({ code: s.outlets.code }).from(s.outlets).where(and(eq(s.outlets.tenantId, invite.tenantId), eq(s.outlets.id, invite.outletId)));
    return { ok: true as const, phone: invite.phone, name: existing?.name ?? name, outletCode: outlet.code, role: invite.role, existing: !!existing };
  }, LOCK_THEN_READ);
  if (!result.ok) throw result.error;
  return result;
}
