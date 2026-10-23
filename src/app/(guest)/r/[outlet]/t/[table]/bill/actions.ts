"use server";
import { cookies, headers } from "next/headers";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import { AppError } from "@/server/errors";
import {
  checkoutFor,
  markPaidAndLeft,
  reconcilePayment,
  reopenBill,
  setCustomAmounts,
  setServiceChargeWaived,
  setSplitMode,
  startPayment,
} from "@/server/billing/payments";
import type { SplitMode } from "@/server/billing/bill";
import { getBillScreen } from "@/server/guest/bill-screen";
import { publicOrigin } from "@/server/guest/invite";
import { guestContextForDevice } from "@/server/guest/menu-screen";
import { createServiceRequest } from "@/server/guest/service-requests";
import { guestRealtimeToken } from "@/server/realtime/token";

// G8 actions. The phone sends ids, a mode, a tip and a method; every amount comes from the server.

export type BillError = "gone" | "host_only" | "locked" | "being_paid" | "nothing_due" | "no_gateway" | "gateway_down" | "payment_in_flight" | "total" | "changed" | "failed";

async function device() {
  return (await cookies()).get(DEVICE_COOKIE)?.value ?? null;
}

function errorOf(err: unknown): BillError {
  if (!(err instanceof AppError)) return "failed";
  if (["session_expired", "qr_revoked", "outlet_unavailable", "participant_removed"].includes(err.code)) return "gone";
  const reason = err.details?.reason;
  if (typeof reason === "string" && ["host_only", "locked", "being_paid", "nothing_due", "no_gateway", "gateway_down", "payment_in_flight", "total"].includes(reason)) return reason as BillError;
  if (err.code === "invalid_state" || err.code === "not_found" || err.code === "table_settling") return "changed";
  return "failed";
}

async function run(outlet: string, table: string, fn: (ctx: Awaited<ReturnType<typeof guestContextForDevice>>["ctx"]) => Promise<unknown>) {
  try {
    const { ctx } = await guestContextForDevice(outlet, table, await device());
    await fn(ctx);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: errorOf(err) };
  }
}

export async function billDataAction(outlet: string, table: string) {
  try {
    return { ok: true as const, data: await getBillScreen(outlet, table, await device()) };
  } catch (err) {
    const error = errorOf(err);
    return { ok: false as const, error: error === "changed" ? ("gone" as const) : error };
  }
}

export async function billTokenAction(outlet: string, table: string) {
  try {
    const { ctx } = await guestContextForDevice(outlet, table, await device());
    return guestRealtimeToken(ctx);
  } catch {
    return null;
  }
}

export const splitModeAction = async (outlet: string, table: string, mode: SplitMode) => run(outlet, table, (ctx) => setSplitMode(ctx, mode));
export const customAmountsAction = async (outlet: string, table: string, amounts: Record<string, number>) =>
  run(outlet, table, (ctx) => setCustomAmounts(ctx, amounts));
export const serviceChargeAction = async (outlet: string, table: string, waived: boolean) => run(outlet, table, (ctx) => setServiceChargeWaived(ctx, waived === true));
export const reopenAction = async (outlet: string, table: string) => run(outlet, table, (ctx) => reopenBill({ kind: "guest", ctx }));
export const paidAndLeftAction = async (outlet: string, table: string, participantId: string) =>
  run(outlet, table, (ctx) => markPaidAndLeft({ kind: "guest", ctx }, String(participantId)));
export const payAtCounterAction = async (outlet: string, table: string, requestId: string) =>
  run(outlet, table, (ctx) => createServiceRequest(ctx, "pay_at_counter", String(requestId)));

/** Starts (or, for the same request id, resumes) a payment and returns the hosted checkout to open */
export async function startPaymentAction(
  outlet: string,
  table: string,
  input: { forParticipantIds: string[]; tipPaise: number; method: "upi" | "card" | "wallet"; requestId: string },
) {
  try {
    const { ctx } = await guestContextForDevice(outlet, table, await device());
    const billPath = `/r/${encodeURIComponent(outlet)}/t/${encodeURIComponent(table)}/bill`;
    const callbackUrl = `${publicOrigin(await headers())}/api/payments/return?p=PLACEHOLDER&to=${encodeURIComponent(billPath)}`;
    const started = await startPayment(ctx, {
      forParticipantIds: Array.isArray(input.forParticipantIds) ? input.forParticipantIds.map(String) : [],
      tipPaise: Number(input.tipPaise) || 0,
      method: input.method,
      requestId: String(input.requestId),
      callbackUrl: callbackUrl.replace("PLACEHOLDER", "{paymentId}"),
    });
    const checkout = await checkoutFor(ctx, started.paymentId, callbackUrl.replace("{paymentId}", started.paymentId));
    if (!checkout) return { ok: false as const, error: "gateway_down" as const, paymentId: started.paymentId };
    return { ok: true as const, paymentId: started.paymentId, checkout };
  } catch (err) {
    return { ok: false as const, error: errorOf(err), paymentId: null };
  }
}

/** Where this guest's own payment stands, asking the gateway if it is still open */
export async function paymentStatusAction(outlet: string, table: string, paymentId: string) {
  try {
    const { ctx } = await guestContextForDevice(outlet, table, await device());
    return { ok: true as const, status: await reconcilePayment(ctx, String(paymentId)) };
  } catch (err) {
    // The table may have just closed because this payment settled it: the paid screen knows
    return { ok: false as const, error: errorOf(err) };
  }
}
