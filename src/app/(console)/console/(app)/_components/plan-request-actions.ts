"use server";
import { AppError } from "@/server/errors";
import { requestPlanChange } from "@/server/staff/plan-request";
import { currentStaff } from "@/server/staff/request";

/** Owner or manager asks TableQR to unlock a feature or change the plan */
export async function requestPlanChangeAction(input: { feature?: string | null; note?: string | null }): Promise<{ ok: true; already: boolean } | { ok: false; error: string }> {
  try {
    // Works while the restaurant is paused too, so the owner can ask to renew
    const staff = await currentStaff();
    if (!staff) return { ok: false, error: "Please sign in again." };
    const r = await requestPlanChange(staff, input);
    return { ok: true, already: r.already };
  } catch (err) {
    return { ok: false, error: err instanceof AppError ? err.message : "Could not send the request. Try again." };
  }
}
