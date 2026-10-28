"use server";
import { AppError } from "@/server/errors";
import { startTakeaway } from "@/server/floor/takeaway";
import type { AnyDraftLine } from "@/server/guest/order";
import type { PriceQuote } from "@/domain/pricing";
import { posBillDetail } from "@/server/staff/pos-read";
import { posOpenTable, posSendOrder, posTerminal, posTerminalRoles } from "@/server/staff/pos-terminal";
import { staffRealtimeToken, topics } from "@/server/realtime/token";
import { staffFor } from "@/server/staff/request";
import { waiterRequestBill } from "@/server/staff/waiter-mutations";
import { settleAtCounter } from "@/server/billing/payments";

async function run<T>(work: (staff: Awaited<ReturnType<typeof staffFor>>) => Promise<T>) {
  try {
    return { ok: true as const, data: await work(await staffFor(posTerminalRoles, "pos")) };
  } catch (e) {
    if (!(e instanceof AppError)) console.error("[pos] action failed", e);
    return { ok: false as const, error: e instanceof AppError ? e.message : "Could not complete this. Try again." };
  }
}
export async function terminalAction() { return run((s) => posTerminal(s)); }
export async function tokenAction() { const s = await staffFor(posTerminalRoles, "pos"); return staffRealtimeToken(s, [topics.floor, topics.kitchen]); }
export async function orderAction(sessionId: string) { return run((s) => posBillDetail(s, String(sessionId))); }
export async function openTableAction(input: { tableId: string; partySize?: number; guestName?: string | null; clientRequestId?: string }) { return run((s) => posOpenTable(s, input)); }
export async function newTakeawayAction(name?: string | null, clientRequestId?: string) { return run((s) => startTakeaway(s, { name, clientRequestId })); }
export async function sendOrderAction(input: { sessionId: string; clientRequestId: string; lines: AnyDraftLine[]; quote?: PriceQuote; guestName?: string | null }) { return run((s) => posSendOrder(s, input)); }
/** Settle a full, previously requested bill with cash captured offline; the server rechecks the due amount. */
export async function settleOfflineCashAction(input: { sessionId: string; clientRequestId: string; receivedPaise: number; expectedDuePaise: number }) {
  return run((s) => settleAtCounter(s, { ...input, method: "cash" }, new Date(), posTerminalRoles));
}
/** Close the eating stage so the bill can be paid on the Billing screen */
export async function billAction(sessionId: string) { return run((s) => waiterRequestBill(s, String(sessionId), new Date(), [...posTerminalRoles])); }
