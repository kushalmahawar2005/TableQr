"use server";

import { cookies } from "next/headers";
import { AppError } from "@/server/errors";
import { customerCookie, customerCookieOptions, startCustomerSession } from "@/server/guest/customer-account";
import { ensureDeviceId } from "@/server/guest/device-cookie";
import { startOrJoinTable } from "@/server/guest/session";
import { sendCode, verifyCode, type SendOutcome, type VerifyOutcome } from "@/server/guest/verify";

// G2 actions. Table problems (closed, settling, not ready) send the guest back to G1, which shows
// the table's new state; anything unexpected reads as "could not reach the restaurant".

type Elsewhere = { ok: false; error: "table_changed" | "failed" };

export type SendCodeResult = SendOutcome | Elsewhere;
export type VerifyCodeResult = Exclude<VerifyOutcome, { ok: true }> | { ok: true; to: string } | Elsewhere;

const failed = (err: unknown): Elsewhere => ({ ok: false, error: err instanceof AppError ? "table_changed" : "failed" });

export async function sendCodeAction(
  outletCode: string,
  shortCode: string,
  input: { country: string; phone: string },
): Promise<SendCodeResult> {
  try {
    const deviceId = await ensureDeviceId();
    return await sendCode({ outletCode, shortCode, deviceId, country: String(input.country), phone: String(input.phone) });
  } catch (err) {
    return failed(err);
  }
}

/** Verify and continue: a right code joins the table and the guest goes straight to the menu */
export async function verifyCodeAction(
  outletCode: string,
  shortCode: string,
  input: { challengeId: string; code: string; name: string; consent: boolean },
): Promise<VerifyCodeResult> {
  try {
    const deviceId = await ensureDeviceId();
    const res = await verifyCode({
      outletCode,
      shortCode,
      deviceId,
      challengeId: String(input.challengeId),
      code: String(input.code),
      name: String(input.name),
      consent: input.consent === true,
    });
    if (!res.ok) return res;
    (await cookies()).set(customerCookie(outletCode), await startCustomerSession(res.tenantId, res.guestId), customerCookieOptions);
    await startOrJoinTable({ outletCode, shortCode, deviceId });
    return { ok: true, to: `/r/${encodeURIComponent(outletCode)}/t/${encodeURIComponent(shortCode)}/menu` };
  } catch (err) {
    return failed(err);
  }
}
