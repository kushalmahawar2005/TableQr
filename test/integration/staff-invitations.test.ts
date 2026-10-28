import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { completeStaffInvitation, createStaffInvitation, getStaffInvitation, revokeStaffInvitation, sendStaffInvitationOtp } from "@/server/staff/invitations";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { resetTestDb } from "./setup-db";

let env: Awaited<ReturnType<typeof resetTestDb>>;
let owner: StaffSession;
const signIn = async (phone: string, pin: string) => (await resolveStaff((await signInStaff({ outletCode: env.demo.outletCode, phone, pin })).token))!;
const fail = async (promise: Promise<unknown>, code: AppError["code"]) => {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
};

beforeAll(async () => {
  env = await resetTestDb();
  owner = await signIn("9000000001", "1111");
});
afterAll(async () => { await env.conn.end(); await appDb.$client.end(); });

describe("verified staff invitations", () => {
  it("signs in when an existing owner phone is stored with +91 and spaces", async () => {
    const ownerId = env.demo.staffIds.owner;
    await env.db.update(s.users).set({ phone: "+91 90000 00001" }).where(eq(s.users.id, ownerId));
    try {
      expect((await signIn("9000000001", "1111")).roles).toContain("owner");
    } finally {
      await env.db.update(s.users).set({ phone: "9000000001" }).where(eq(s.users.id, ownerId));
    }
  });

  it("does not create an account until the invited phone verifies, then activates the chosen role", async () => {
    const invitation = await createStaffInvitation(owner, { phone: "+91 93333 33331", role: "waiter" });
    expect(await getStaffInvitation(invitation.token)).toMatchObject({ valid: true, role: "waiter", phoneLast4: "3331" });
    const [before] = await env.db.select().from(s.users).where(eq(s.users.phone, "9333333331"));
    expect(before).toBeUndefined();
    await fail(sendStaffInvitationOtp(invitation.token, "9333333332"), "invalid_phone");
    const sent = await sendStaffInvitationOtp(invitation.token, "9333333331");
    expect(sent.devCode).toMatch(/^\d{4}$/);
    await fail(completeStaffInvitation({ token: invitation.token, challengeId: sent.challengeId, code: "0000" === sent.devCode ? "1111" : "0000", name: "New Waiter", pin: "4321" }), "wrong");
    const accepted = await completeStaffInvitation({ token: invitation.token, challengeId: sent.challengeId, code: sent.devCode!, name: "  New   Waiter ", pin: "4321" });
    expect(accepted).toMatchObject({ name: "New Waiter", phone: "9333333331", outletCode: env.demo.outletCode, role: "waiter", existing: false });
    const member = await signIn("9333333331", "4321");
    expect(member.roles).toContain("waiter");
    const [user] = await env.db.select().from(s.users).where(eq(s.users.phone, "9333333331"));
    expect(user.pinHash).not.toBe("4321");
    const [saved] = await env.db.select().from(s.staffInvitations).where(eq(s.staffInvitations.id, invitation.id));
    expect(saved.tokenHash).not.toBe(invitation.token);
    expect(saved.acceptedAt).not.toBeNull();
    expect(await getStaffInvitation(invitation.token)).toEqual({ valid: false });
    await fail(completeStaffInvitation({ token: invitation.token, challengeId: sent.challengeId, code: sent.devCode!, name: "Replay", pin: "4321" }), "expired");
  });

  it("revokes a pending invitation and makes its public link unusable", async () => {
    const invitation = await createStaffInvitation(owner, { phone: "9333333333", role: "accountant" });
    await revokeStaffInvitation(owner, invitation.id);
    expect(await getStaffInvitation(invitation.token)).toEqual({ valid: false });
    await fail(sendStaffInvitationOtp(invitation.token, "9333333333"), "expired");
    await fail(revokeStaffInvitation({ ...owner, tenantId: env.other.tenantId }, invitation.id), "not_found");
  });

  it("blocks acceptance after three wrong codes and permits a fresh challenge after lockout", async () => {
    const invitation = await createStaffInvitation(owner, { phone: "9333333334", role: "waiter" });
    const sent = await sendStaffInvitationOtp(invitation.token, "9333333334");
    const wrong = sent.devCode === "0000" ? "1111" : "0000";
    await fail(completeStaffInvitation({ token: invitation.token, challengeId: sent.challengeId, code: wrong, name: "Locked Person", pin: "4321" }), "wrong");
    await fail(completeStaffInvitation({ token: invitation.token, challengeId: sent.challengeId, code: wrong, name: "Locked Person", pin: "4321" }), "wrong");
    await fail(completeStaffInvitation({ token: invitation.token, challengeId: sent.challengeId, code: wrong, name: "Locked Person", pin: "4321" }), "locked");
    expect(await env.db.select().from(s.users).where(eq(s.users.phone, "9333333334"))).toEqual([]);
  });
});
