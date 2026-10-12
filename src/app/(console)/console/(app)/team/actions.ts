"use server";
import { AppError } from "@/server/errors";
import { consoleSectionRoles } from "@/lib/staff-permissions";
import { staffFor } from "@/server/staff/request";
import { addMember, changeRole, listTeam, resetPin, setMemberActive } from "@/server/staff/team";
import { setDuty, teamDuty, type DutyStatus } from "@/server/staff/duty";

type TeamResult<T> = { ok: true; data: T } | { ok: false; message: string };

async function run<T>(work: (s: Awaited<ReturnType<typeof staffFor>>) => Promise<T>): Promise<TeamResult<T>> {
  try {
    return { ok: true, data: await work(await staffFor(consoleSectionRoles.team)) };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    console.error("[team] action failed", err);
    return { ok: false, message: "That didn't go through. Try again." };
  }
}

export async function teamAction() { return run((s) => listTeam(s)); }
export async function teamDutyAction() { return run((s) => teamDuty(s)); }
export async function setDutyAction(userId: string, status: DutyStatus) { return run((s) => setDuty(s, userId, status)); }
export async function addMemberAction(input: { name: string; phone: string; role: string; pin: string }) { return run((s) => addMember(s, input)); }
export async function changeRoleAction(userId: string, role: string) { return run((s) => changeRole(s, String(userId), role)); }
export async function resetPinAction(userId: string, pin: string) { return run((s) => resetPin(s, String(userId), pin)); }
export async function setActiveAction(userId: string, active: boolean) { return run((s) => setMemberActive(s, String(userId), !!active)); }
