import { char, index, int, mysqlEnum, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { at, createdAt, id, ref, sameTenant, tenantId } from "./_columns";
import { outlets, users } from "./tenancy";

export const staffInvitationRoles = ["manager", "reception", "waiter", "accountant", "kitchen"] as const;

/** An owner-scoped, single-use link. Only the token hash is stored. */
export const staffInvitations = mysqlTable(
  "staff_invitations",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    phone: varchar("phone", { length: 15 }).notNull(),
    role: mysqlEnum("role", staffInvitationRoles).notNull(),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    createdByUserId: ref("created_by_user_id").notNull(),
    expiresAt: at("expires_at").notNull(),
    acceptedAt: at("accepted_at"),
    revokedAt: at("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("staff_invitations_token_uq").on(t.tokenHash),
    uniqueIndex("staff_invitations_tenant_id_uq").on(t.tenantId, t.id),
    index("staff_invitations_outlet_idx").on(t.tenantId, t.outletId, t.createdAt),
    index("staff_invitations_phone_idx").on(t.tenantId, t.phone, t.createdAt),
    sameTenant("fk_staff_invitations_outlet", t, t.outletId, outlets),
    sameTenant("fk_staff_invitations_creator", t, t.createdByUserId, users),
  ],
);

/** OTP attempts are separate rows so per-phone sending limits survive resends and invite revocation. */
export const staffInvitationOtps = mysqlTable(
  "staff_invitation_otps",
  {
    id: id(),
    tenantId: tenantId(),
    invitationId: ref("invitation_id").notNull(),
    phone: varchar("phone", { length: 15 }).notNull(),
    codeHash: char("code_hash", { length: 64 }).notNull(),
    expiresAt: at("expires_at").notNull(),
    resendAt: at("resend_at").notNull(),
    attempts: int("attempts").notNull().default(0),
    lockedUntil: at("locked_until"),
    verifiedAt: at("verified_at"),
    deadAt: at("dead_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("staff_invitation_otps_invite_idx").on(t.tenantId, t.invitationId, t.createdAt),
    index("staff_invitation_otps_phone_idx").on(t.tenantId, t.phone, t.createdAt),
    sameTenant("fk_staff_invitation_otps_invite", t, t.invitationId, staffInvitations),
  ],
);
