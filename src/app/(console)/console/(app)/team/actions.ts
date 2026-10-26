"use server";
import { AppError } from "@/server/errors";
import { headers } from "next/headers";
import { consoleSectionRoles } from "@/lib/staff-permissions";
import { staffFor } from "@/server/staff/request";
import { changeRole, listTeam, resetPin, setMemberActive, setMemberPhoto } from "@/server/staff/team";
import { createStaffInvitation, revokeStaffInvitation } from "@/server/staff/invitations";
import { publicOrigin } from "@/server/guest/invite";
import { setDuty, teamDuty, type DutyStatus } from "@/server/staff/duty";

type TeamResult<T> = { ok: true; data: T } | { ok: false; message: string };

async function run<T>(work: (s: Awaited<ReturnType<typeof staffFor>>) => Promise<T>): Promise<TeamResult<T>> {
  try {
    return { ok: true, data: await work(await staffFor(consoleSectionRoles.team, "team")) };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    console.error("[team] action failed", err);
    return { ok: false, message: "That didn't go through. Try again." };
  }
}

export async function teamAction() { return run((s) => listTeam(s)); }
export async function teamDutyAction() { return run((s) => teamDuty(s)); }
export async function setDutyAction(userId: string, status: DutyStatus) { return run((s) => setDuty(s, userId, status)); }
export async function createInvitationAction(input: { phone: string; role: string }) {
  return run(async (staff) => {
    const invite = await createStaffInvitation(staff, input);
    const origin = publicOrigin(await headers());
    return { ...invite, inviteUrl: `${origin}/staff/invite/${encodeURIComponent(invite.token)}` };
  });
}
export async function revokeInvitationAction(invitationId: string) { return run((s) => revokeStaffInvitation(s, String(invitationId))); }
export async function changeRoleAction(userId: string, role: string) { return run((s) => changeRole(s, String(userId), role)); }
export async function resetPinAction(userId: string, pin: string) { return run((s) => resetPin(s, String(userId), pin)); }
export async function setActiveAction(userId: string, active: boolean) { return run((s) => setMemberActive(s, String(userId), !!active)); }
export async function setPhotoAction(userId: string, form: FormData) {
  return run(async (s) => {
    const file = form.get("photo");
    if (!(file instanceof File) || !file.size) throw new AppError("invalid_state", "Choose a photo first.");
    return setMemberPhoto(s, String(userId), { bytes: Buffer.from(await file.arrayBuffer()), contentType: file.type, filename: file.name });
  });
}
