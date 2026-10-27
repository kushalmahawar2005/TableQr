"use server";
import { staffFor } from "./request";
import { AppError } from "../errors";
import { posBillDetail, posQueue, posRoles } from "./pos-read";
import { settleAtCounter, reopenBill } from "../billing/payments";
import { clearBillDiscount, setBillDiscount } from "../billing/discounts";
import { rememberCustomer } from "./customers";
import { sendBillOnWhatsApp } from "../billing/send-bill";
import { cancelTakeaway, startTakeaway } from "../floor/takeaway";
import { recheckOnlinePayment, releaseStuckPayment } from "../billing/stuck-payment";
import { addItemsAtBilling } from "../billing/counter-items";
import type { AnyDraftLine } from "../guest/order";
import { processRefund, reconcileRefund, requestRefund, type RefundInput } from "../billing/refunds";
import { addPhonelessDiner, changeWaiterLine, managerApproval, waiterRequestBill, type Approval } from "./waiter-mutations";
import { waiterMenu } from "./waiter-read";
import { staffRealtimeToken, topics } from "../realtime/token";

async function run<T>(work: (staff: Awaited<ReturnType<typeof staffFor>>) => Promise<T>) {
  try { return { ok: true as const, data: await work(await staffFor(posRoles, "billing")) }; }
  catch (e) { return { ok: false as const, error: e instanceof AppError ? e.message : "Could not complete this action. Try again.", code: e instanceof AppError ? e.code : "unknown" }; }
}
export async function queueAction() { return run(posQueue); }
export async function detailAction(sessionId: string) { return run(s => posBillDetail(s, sessionId)); }
export async function tokenAction() { const s = await staffFor(posRoles, "billing"); return staffRealtimeToken(s, [topics.floor, topics.tasks, topics.kitchen]); }
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

/** Guests are done but nobody asked for the bill (or the request got lost): the cashier closes the eating stage so the bill can be paid. */
export async function requestBillAction(sessionId: string) {
  return run(s => waiterRequestBill(s, String(sessionId), new Date(), posRoles));
}
/** Discount on the whole bill: percent (1-100) or whole rupees, with a reason */
export async function discountAction(input: { sessionId: string; kind: "percent" | "flat"; value: number; reason: string; approval?: Approval }) { return run((s) => setBillDiscount(s, input)); }
export async function clearDiscountAction(sessionId: string) { return run((s) => clearBillDiscount(s, sessionId)); }
/** Save the number a bill was sent to on WhatsApp in the customer list */
export async function addItemsAction(input: { sessionId: string; tableId: string; participantId: string; clientRequestId: string; lines: AnyDraftLine[] }) { return run((s) => addItemsAtBilling(s, input)); }
export async function recheckPaymentAction(sessionId: string) { return run((s) => recheckOnlinePayment(s, sessionId)); }
export async function releasePaymentAction(sessionId: string) { return run((s) => releaseStuckPayment(s, sessionId)); }
/** The menu and a new diner for Add items, under the billing roles (the waiter app's own actions are for waiters) */
export async function menuAction() { return run((s) => waiterMenu(s, new Date(), posRoles)); }
export async function addDinerAction(sessionId: string, name: string) { return run((s) => addPhonelessDiner(s, String(sessionId), String(name ?? ""), new Date(), posRoles)); }
export async function startTakeawayAction(name?: string | null) { return run((s) => startTakeaway(s, { name })); }
export async function cancelTakeawayAction(sessionId: string) { return run((s) => cancelTakeaway(s, sessionId)); }
export async function sendBillAction(input: { sessionId: string; phone: string }) { return run((s) => sendBillOnWhatsApp(s, input)); }
export async function rememberCustomerAction(input: { sessionId: string; phone: string; name?: string | null }) { return run((s) => rememberCustomer(s, input)); }
