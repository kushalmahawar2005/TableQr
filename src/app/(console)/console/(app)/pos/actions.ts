"use server";
import { AppError } from "@/server/errors";
import { startTakeaway } from "@/server/floor/takeaway";
import type { AnyDraftLine } from "@/server/guest/order";
import type { PriceQuote } from "@/domain/pricing";
import { posBillDetail } from "@/server/staff/pos-read";
import { posOpenTable, posRecoverOfflineOrderVisit, posSendOrder, posTerminal, posTerminalRoles } from "@/server/staff/pos-terminal";
import { staffRealtimeToken, topics } from "@/server/realtime/token";
import { staffFor } from "@/server/staff/request";
import { waiterRequestBill } from "@/server/staff/waiter-mutations";
import { settleAtCounter } from "@/server/billing/payments";
import { audit } from "@/server/staff/audit";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { AppError as ServerError } from "@/server/errors";

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
export async function sendOrderAction(input: { sessionId: string; clientRequestId: string; lines: AnyDraftLine[]; quote?: PriceQuote; guestName?: string | null; managerApprovedOfflineRequestId?: string }) { return run((s) => posSendOrder(s, input)); }
/** Record a manager's explicit review before replaying a local order saved by another staff login. */
export async function approveOfflineOrderAction(input: { requestId: string; originalStaffUserId: string; current: { sessionId: string | null; tableId: string | null; code: string; takeaway: boolean; seats: number }; partySize: number; lines: AnyDraftLine[]; quote?: PriceQuote; guestName: string }) {
  return run(async (staff) => {
    if (!staff.roles.some((role) => role === "owner" || role === "manager")) throw new ServerError("forbidden", "Only an owner or manager can review a saved order from another staff account.");
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(input.requestId) || !input.originalStaffUserId || input.originalStaffUserId.length > 64 || !input.current || typeof input.current.code !== "string" || input.current.code.length > 40 || !Number.isSafeInteger(input.partySize) || input.partySize < 1 || input.partySize > 50 || !Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 100 || input.lines.some((line) => !line || !Number.isSafeInteger(line.qty) || line.qty < 1 || line.qty > 99) || typeof input.guestName !== "string" || input.guestName.length > 120) {
      throw new ServerError("invalid_state", "This saved order cannot be reviewed because its recovery details are invalid.");
    }
    if ((!input.current.sessionId && !input.current.takeaway && !input.current.tableId) || (input.current.sessionId && !input.current.tableId)) throw new ServerError("invalid_state", "This saved order does not have enough table or takeaway details to recover safely.");
    const [sourceStaff] = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.tenantId, staff.tenantId), eq(schema.users.id, input.originalStaffUserId)));
    if (!sourceStaff) throw new ServerError("invalid_state", "The staff account that created this order could not be verified.");
    await audit(db, staff, {
      action: "pos.offline_order_approved", entity: "offline_pos_order", entityId: input.requestId, now: new Date(),
      before: { originalStaffUserId: input.originalStaffUserId },
      after: { approvedByUserId: staff.userId, current: input.current, partySize: input.partySize, lines: input.lines, quote: input.quote ?? {}, guestName: input.guestName.trim() || null },
      reason: "Manager reviewed a local POS recovery record before retrying it.",
    });
    return { approvedByUserId: staff.userId };
  });
}
/** A manager may open a visit for a reviewed local order that had not reached the server yet. */
export async function recoverOfflineOrderVisitAction(input: { requestId: string; current: { sessionId: string | null; tableId: string | null; code: string; takeaway: boolean; seats: number }; guestName: string; partySize: number }) {
  return run((staff) => posRecoverOfflineOrderVisit(staff, input));
}
/** Settle a full, previously requested bill with cash captured offline; the server rechecks the due amount. */
export async function settleOfflineCashAction(input: { sessionId: string; clientRequestId: string; receivedPaise: number; expectedDuePaise: number }) {
  return run((s) => settleAtCounter(s, { ...input, method: "cash" }, new Date(), posTerminalRoles));
}
/** Close the eating stage so the bill can be paid on the Billing screen */
export async function billAction(sessionId: string) { return run((s) => waiterRequestBill(s, String(sessionId), new Date(), [...posTerminalRoles])); }
