"use server";
import { staffFor } from "./request";
import { AppError } from "../errors";
import { posBillDetail, posQueue, posRoles } from "./pos-read";
import { settleAtCounter, reopenBill } from "../billing/payments";
import { processRefund, reconcileRefund, requestRefund, type RefundInput } from "../billing/refunds";
import { changeWaiterLine, managerApproval, type Approval } from "./waiter-mutations";
import { staffRealtimeToken, topics } from "../realtime/token";

async function run<T>(work: (staff: Awaited<ReturnType<typeof staffFor>>) => Promise<T>) {
  try { return { ok: true as const, data: await work(await staffFor(posRoles)) }; }
  catch (e) { return { ok: false as const, error: e instanceof AppError ? e.message : "Could not complete this action. Try again.", code: e instanceof AppError ? e.code : "unknown" }; }
}
export async function queueAction() { return run(posQueue); }
export async function detailAction(sessionId: string) { return run(s => posBillDetail(s, sessionId)); }
export async function tokenAction() { const s = await staffFor(posRoles); return staffRealtimeToken(s, [topics.floor, topics.tasks, topics.kitchen]); }
export async function settleAction(input: { sessionId: string; method: "cash" | "card"; forParticipantIds?: string[]; receivedPaise?: number; clientRequestId: string; externalReference?: string }) {
  return run(s => { if (!input.clientRequestId) throw new AppError("invalid_state", "A settlement request id is required."); return settleAtCounter(s, input, new Date(), posRoles); });
}
export async function reopenAction(sessionId: string, approval?: Approval) {
  return run(async s => { const approverUserId = await managerApproval(s, approval, posRoles); await reopenBill({ kind: "staff", ctx: s, sessionId }, new Date(), { initiator: s, approverUserId }); return { ok: true }; });
}
export async function voidAction(input: { sessionId: string; lineId: string; reason: string; approval?: Approval }) {
  return run(s => changeWaiterLine(s, input, new Date(), posRoles));
}
export async function refundAction(input: RefundInput) {
  return run(s => requestRefund(s, { paymentId: String(input.paymentId), amountPaise: Number(input.amountPaise), reason: String(input.reason ?? ""), requestId: String(input.requestId), approval: input.approval }));
}
export async function processRefundAction(refundId: string, approval?: Approval) {
  return run(s => processRefund(s, String(refundId), approval));
}
export async function checkRefundAction(refundId: string) {
  return run(async s => ({ status: await reconcileRefund(s, String(refundId)) }));
}
