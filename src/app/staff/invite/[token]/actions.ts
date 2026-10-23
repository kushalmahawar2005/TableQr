"use server";

import { AppError } from "@/server/errors";
import { completeStaffInvitation, sendStaffInvitationOtp } from "@/server/staff/invitations";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };
const failed = (error: unknown): { ok: false; message: string } => ({ ok: false, message: error instanceof AppError ? error.message : "We could not complete this step. Try again." });

export async function sendInvitationCodeAction(token: string, phone: string): Promise<Result<Awaited<ReturnType<typeof sendStaffInvitationOtp>>>> {
  try { return { ok: true, data: await sendStaffInvitationOtp(String(token), String(phone)) }; }
  catch (error) { return failed(error); }
}

export async function completeInvitationAction(token: string, input: { challengeId: string; code: string; name: string; pin: string }): Promise<Result<Awaited<ReturnType<typeof completeStaffInvitation>>>> {
  try { return { ok: true, data: await completeStaffInvitation({ token: String(token), challengeId: String(input.challengeId), code: String(input.code), name: String(input.name), pin: String(input.pin) }) }; }
  catch (error) { return failed(error); }
}
