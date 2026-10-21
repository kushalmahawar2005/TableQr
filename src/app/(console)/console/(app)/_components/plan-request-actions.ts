"use server";
import { AppError } from "@/server/errors";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { ownerPlan, reconcileCashfreeFee, startFeePayment } from "@/server/fees";
import { publicOrigin } from "@/server/guest/invite";
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

/** Opens Cashfree for a TableQR plan renewal or upgrade. */
export async function startFeePaymentAction(input: { months: number; planCode?: string | null; requestId: string }) {
  try {
    const staff = await currentStaff();
    if (!staff) return { ok: false as const, error: "Please sign in again." };
    const origin = publicOrigin(await headers());
    const payment = await startFeePayment(staff, {
      months: input.months,
      planCode: input.planCode,
      requestId: input.requestId,
      callbackUrl: `${origin}/api/fees/return?p=PLACEHOLDER`,
    });
    return { ok: true as const, payment };
  } catch (err) {
    return { ok: false as const, error: err instanceof AppError ? err.message : "Cashfree could not start the payment. Try again." };
  }
}

/** Re-checks one of this restaurant's own pending Cashfree payments. */
export async function refreshFeePaymentAction(paymentId: string) {
  try {
    const staff = await currentStaff();
    if (!staff) return { ok: false as const, error: "Please sign in again." };
    const plan = await ownerPlan(staff);
    if (!plan.payments.some((payment) => payment.id === paymentId && payment.method === "cashfree" && payment.status === "claimed")) {
      return { ok: false as const, error: "This payment is no longer pending." };
    }
    const status = await reconcileCashfreeFee(paymentId);
    revalidatePath("/console", "layout");
    return { ok: true as const, status };
  } catch (err) {
    return { ok: false as const, error: err instanceof AppError ? err.message : "Could not refresh the payment. Try again." };
  }
}
