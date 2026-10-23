import "server-only";
import { ROOM_CLASS } from "@/domain/rooms";
import { TAKEAWAY_CLASS } from "../floor/takeaway-class";
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { isPlaceholderName } from "@/domain/guest-name";
import { amountInWords } from "@/domain/words";
import { LOCK_THEN_READ, type Tx } from "../db-types";
import { AppError } from "../errors";
import type { GuestContext } from "../guest/context";
import { gatewayByName, guestGateway, type GatewayStatus } from "../payments/gateway";
import { publish, type RealtimeEvent } from "../realtime/publish";
import { topics } from "../realtime/token";
import { requireStaffRole } from "../staff/waiter";
import { audit } from "../staff/audit";
import type { StaffSession } from "../staff/auth";
import type { StaffContext } from "../staff/context";
import type { StaffRole } from "@/lib/staff-permissions";
import { ATTEMPT_WINDOW_MS, computeDraft, isBillLocked, loadBillInputs, lockSession, lockShares, syncBill, type BillScope, type CreatedRefund, type SplitMode } from "./bill";
import { nextInvoiceNumber } from "./invoice-number";
import { releaseVisitTables, setVisitTablesState, tableStateEvents, visitChanged } from "../floor/assignments";
import { requireFeature } from "../plan";
import { takeStockForBill } from "../staff/inventory";

// Paying the bill (PS 3.6, 3.8, 6.2, 6.4). Rules that keep money right:
// - amounts come from the server; the phone only says whose shares and how much tip
// - online payment starts only after the bill is requested, and a retry of the same tap returns
//   the same attempt
// - a share cannot be paid twice at once: a live attempt blocks others for 10 minutes
// - only the gateway decides success (signed webhook or server status check); confirming is
//   idempotent, so a webhook, a status check and the phone's return can all arrive safely
// - the last payment closes the bill, issues one invoice and frees the table, in one transaction

const scopeOf = (ctx: GuestContext): BillScope => ({ tenantId: ctx.tenantId, outletId: ctx.outletId, sessionId: ctx.sessionId });

/** After commit: phones at the table reload the bill; the floor map recolours the table */
export function announceBill(scope: BillScope, tables?: { tableIds: string[]; state: "bill_requested" | "paid" | "seated" }, extra: RealtimeEvent[] = []) {
  void publish(scope, [
    { topic: topics.session(scope.sessionId), type: "bill.updated" },
    ...extra,
    ...(tables ? tableStateEvents(tables.tableIds, tables.state) : []),
    visitChanged(scope.sessionId, "bill"),
  ]);
}

export const refundEvents = (scope: BillScope, refunds: CreatedRefund[]): RealtimeEvent[] =>
  refunds.map((r) => ({ topic: topics.session(scope.sessionId), type: "refund.updated", data: { refundId: r.refundId } }));

/** Request bill: pauses ordering and puts the table in Bill requested (PS 4.2) */
export async function requestBill(scope: BillScope, now = new Date()) {
  const res = await db.transaction((tx) => requestBillInTransaction(tx, scope, now), LOCK_THEN_READ);
  announceBill(scope, { tableIds: res.tableIds, state: "bill_requested" });
  return { billId: res.billId, totalPaise: res.totalPaise };
}

/** Shared by the G6 task transaction, so requesting the bill never leaves a half-created task. */
export async function requestBillInTransaction(tx: Tx, scope: BillScope, now: Date) {
  const session = await lockSession(tx, scope);
  if (session.status === "closed") throw new AppError("session_expired", "This table has already been settled.");
  let tableIds: string[] = [];
  if (session.status === "open") {
    await tx
      .update(s.tableSessions)
      .set({ status: "bill_requested", lastActivityAt: now })
      .where(and(eq(s.tableSessions.tenantId, scope.tenantId), eq(s.tableSessions.id, scope.sessionId)));
    // Every table of the visit, including tables combined with it
    tableIds = await setVisitTablesState(tx, scope.tenantId, scope.sessionId, "bill_requested", now);
  }
  const { billId, draft } = await syncBill(tx, scope, now, { requestedAt: now });
  return { billId, totalPaise: draft.totals.totalPaise, tableIds };
}

/**
 * Locks the session and checks the caller can change how the bill is split: the current host,
 * still at the table, after the bill is requested, before any payment is in flight or done.
 */
async function lockForSplitChange(tx: Tx, ctx: GuestContext, now: Date) {
  const session = await lockSession(tx, scopeOf(ctx));
  if (session.status === "closed") throw new AppError("session_expired", "This table has already been settled.");
  if (session.hostParticipantId !== ctx.participantId) {
    throw new AppError("invalid_state", "Only the table host can change how the bill is split.", { reason: "host_only" });
  }
  if (session.status !== "bill_requested") throw new AppError("invalid_state", "Request the bill first.", { reason: "not_requested" });
  const inputs = await loadBillInputs(tx, scopeOf(ctx));
  if (isBillLocked(inputs, now.getTime())) {
    throw new AppError("invalid_state", "The split cannot change once someone has started paying.", { reason: "locked" });
  }
  return inputs;
}

/** Host changes how the bill is split; allowed until the first payment starts */
export async function setSplitMode(ctx: GuestContext, mode: SplitMode, now = new Date()) {
  if (!["my_items", "equal", "custom"].includes(mode)) throw new AppError("invalid_state", "Choose a split.");
  // Without group split everyone pays for their own items
  if (mode !== "my_items") await requireFeature(ctx.tenantId, "groupSplit");
  const shares = await db.transaction(async (tx) => {
    const inputs = await lockForSplitChange(tx, ctx, now);
    // Custom starts from what My items would charge each person, so it already adds up; the
    // host then moves rupees between people
    let customAmounts: Record<string, number> | undefined;
    if (mode === "custom") {
      const current = computeDraft(inputs, { mode: "custom" });
      if (!current.custom.valid) {
        const items = computeDraft(inputs, { mode: "my_items" });
        customAmounts = Object.fromEntries(current.custom.ids.map((id) => [id, items.shares.find((sh) => sh.participantId === id)?.amountPaise ?? 0]));
      }
    }
    const res = await syncBill(tx, scopeOf(ctx), now, { mode, ...(customAmounts ? { customAmounts } : {}) });
    return res.draft.shares;
  }, LOCK_THEN_READ);
  announceBill(scopeOf(ctx));
  return shares;
}

/**
 * Custom split (PS 3.6): the host sets how much each person still at the table pays, in whole
 * rupees. Saved only when the amounts add up exactly to what is left to split; people who paid
 * and left keep their frozen share and removed people keep their own items.
 */
export async function setCustomAmounts(ctx: GuestContext, amounts: Record<string, number>, now = new Date()) {
  const clean = Object.fromEntries(Object.entries(amounts && typeof amounts === "object" ? amounts : {}).map(([id, v]) => [String(id), Number(v)]));
  const shares = await db.transaction(async (tx) => {
    const inputs = await lockForSplitChange(tx, ctx, now);
    if (inputs.bill?.splitMode !== "custom") throw new AppError("invalid_state", "Switch to Custom first.", { reason: "not_custom" });
    const { custom } = computeDraft(inputs, { mode: "custom", customAmounts: clean });
    const keys = Object.keys(clean);
    if (keys.length !== custom.ids.length || custom.ids.some((id) => !(id in clean))) {
      throw new AppError("invalid_state", "Enter an amount for everyone still at the table.", { reason: "people" });
    }
    if (Object.values(clean).some((v) => !Number.isInteger(v) || v < 0 || v % 100 !== 0)) {
      throw new AppError("invalid_state", "Enter whole rupee amounts.", { reason: "amount" });
    }
    const leftPaise = custom.targetPaise - Object.values(clean).reduce((a, b) => a + b, 0);
    if (!custom.valid) throw new AppError("invalid_state", "The amounts must add up to the bill.", { reason: "total", leftPaise });
    return (await syncBill(tx, scopeOf(ctx), now, { customAmounts: clean })).draft.shares;
  }, LOCK_THEN_READ);
  announceBill(scopeOf(ctx));
  return shares;
}

/** The host removes (or restores) the optional service charge before anyone pays (PS 6.1) */
export async function setServiceChargeWaived(ctx: GuestContext, waived: boolean, now = new Date()) {
  await db.transaction(async (tx) => {
    const inputs = await lockForSplitChange(tx, ctx, now);
    if (!inputs.bill?.serviceChargeBp) throw new AppError("invalid_state", "This bill has no service charge.");
    await syncBill(tx, scopeOf(ctx), now, { serviceChargeWaived: waived === true });
  }, LOCK_THEN_READ);
  announceBill(scopeOf(ctx));
}

export type StartedPayment = {
  paymentId: string;
  amountPaise: number;
  tipPaise: number;
  totalPaise: number;
  /** Raw gateway order reference, for tests and webhooks; the phone uses checkout. Null if the gateway was unreachable. */
  gatewayRef: string | null;
  replayed: boolean;
};

/**
 * Guest starts paying their own share, or others' too (Pay for others), after the bill is
 * requested. Nothing is marked paid until the gateway confirms. The same requestId always
 * returns the same attempt, so a double tap or a retry never makes two.
 */
export async function startPayment(
  ctx: GuestContext,
  input: { forParticipantIds?: string[]; tipPaise?: number; method: "upi" | "card" | "wallet"; requestId: string },
  now = new Date(),
): Promise<StartedPayment> {
  const tipPaise = input.tipPaise ?? 0;
  if (!Number.isInteger(tipPaise) || tipPaise < 0) throw new AppError("invalid_state", "Choose a valid tip amount.");
  if (!["upi", "card", "wallet"].includes(input.method)) throw new AppError("invalid_state", "Choose a way to pay.");
  const requestId = typeof input.requestId === "string" ? input.requestId.trim() : "";
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(requestId)) throw new AppError("invalid_state", "This payment request is not valid.");
  const gateway = guestGateway();
  if (!gateway) throw new AppError("invalid_state", "Online payment is not available here. Please pay at the counter.", { reason: "no_gateway" });
  const [outletPaymentSetting] = await db.select({ enabled: s.outlets.guestOnlinePayments }).from(s.outlets)
    .where(and(eq(s.outlets.tenantId, ctx.tenantId), eq(s.outlets.id, ctx.outletId)));
  if (!outletPaymentSetting?.enabled) throw new AppError("invalid_state", "This restaurant collects payment at the counter. Please ask staff to help.", { reason: "online_payments_disabled" });

  const payment = await db.transaction(async (tx) => {
    const session = await lockSession(tx, scopeOf(ctx));
    if (session.status === "closed") throw new AppError("session_expired", "This table has already been settled.");
    const [me] = await tx
      .select({ id: s.participants.id })
      .from(s.participants)
      .where(and(eq(s.participants.tenantId, ctx.tenantId), eq(s.participants.id, ctx.participantId), isNull(s.participants.removedAt)));
    if (!me) throw new AppError("session_expired", "You are no longer at this table.");

    const [bill] = await tx
      .select({ id: s.bills.id })
      .from(s.bills)
      .where(and(eq(s.bills.tenantId, ctx.tenantId), eq(s.bills.sessionId, ctx.sessionId)));
    if (bill) {
      const [replay] = await tx
        .select()
        .from(s.payments)
        .where(and(eq(s.payments.tenantId, ctx.tenantId), eq(s.payments.billId, bill.id), eq(s.payments.clientRequestId, requestId)));
      if (replay) {
        if (replay.payerParticipantId !== ctx.participantId) throw new AppError("invalid_state", "This payment request is not valid.");
        return { id: replay.id, amountPaise: replay.amountPaise, tipPaise: replay.tipPaise, gatewayRef: replay.gatewayRef, replayed: true };
      }
    }
    if (session.status !== "bill_requested") {
      throw new AppError("invalid_state", "Request the bill first. Paying opens once the bill is requested.", { reason: "not_requested" });
    }
    const { billId } = await syncBill(tx, scopeOf(ctx), now);

    const whose = [...new Set(input.forParticipantIds?.length ? input.forParticipantIds.map(String) : [ctx.participantId])];
    const shares = await tx
      .select()
      .from(s.billShares)
      .where(and(eq(s.billShares.tenantId, ctx.tenantId), eq(s.billShares.billId, billId), inArray(s.billShares.participantId, whose)));
    const allocations = shares.map((sh) => ({ shareId: sh.id, amountPaise: sh.amountPaise - sh.paidPaise })).filter((a) => a.amountPaise > 0);
    if (allocations.length === 0) throw new AppError("invalid_state", "There is nothing left to pay for this share.", { reason: "nothing_due" });
    const amountPaise = allocations.reduce((sum, a) => sum + a.amountPaise, 0);
    if (tipPaise > amountPaise) throw new AppError("invalid_state", "The tip cannot be more than the bill.");

    await releaseOrBlockLiveAttempts(tx, ctx, billId, allocations.map((a) => a.shareId), now);

    const id = uuidv7();
    await tx.insert(s.payments).values({
      id,
      tenantId: ctx.tenantId,
      outletId: ctx.outletId,
      billId,
      allocations,
      payerParticipantId: ctx.participantId,
      method: input.method,
      channel: gateway.name,
      amountPaise,
      tipPaise,
      clientRequestId: requestId,
      createdAt: now,
    });
    return { id, amountPaise, tipPaise, gatewayRef: null as string | null, replayed: false };
  }, LOCK_THEN_READ);

  // The gateway call happens outside the transaction so no row stays locked on a network call
  let gatewayRef = payment.gatewayRef;
  if (!gatewayRef && !payment.replayed) {
    try {
      gatewayRef = (await gateway.createOrder({ paymentId: payment.id, amountPaise: payment.amountPaise + payment.tipPaise, receipt: payment.id })).gatewayRef;
    } catch (err) {
      await db
        .update(s.payments)
        .set({ status: "failed", failureReason: "Could not reach the payment gateway" })
        .where(and(eq(s.payments.tenantId, ctx.tenantId), eq(s.payments.id, payment.id), eq(s.payments.status, "initiated")));
      announceBill(scopeOf(ctx));
      throw new AppError("invalid_state", "We could not reach the payment gateway. No money was taken. Try again.", { reason: "gateway_down", cause: String(err) });
    }
    await db
      .update(s.payments)
      .set({ gatewayRef, status: "pending" })
      .where(and(eq(s.payments.tenantId, ctx.tenantId), eq(s.payments.id, payment.id)));
    // Others see these shares are being paid, and the split locks
    announceBill(scopeOf(ctx), undefined, [{ topic: topics.session(ctx.sessionId), type: "payment.updated", data: { paymentId: payment.id } }]);
  }
  return {
    paymentId: payment.id,
    amountPaise: payment.amountPaise,
    tipPaise: payment.tipPaise,
    totalPaise: payment.amountPaise + payment.tipPaise,
    gatewayRef,
    replayed: payment.replayed,
  };
}

/** Someone else mid-checkout on one of these shares blocks this attempt; your own old attempt is replaced */
async function releaseOrBlockLiveAttempts(tx: Tx, ctx: GuestContext, billId: string, shareIds: string[], now: Date) {
  const live = await tx
    .select({ id: s.payments.id, allocations: s.payments.allocations, payer: s.payments.payerParticipantId, createdAt: s.payments.createdAt })
    .from(s.payments)
    .where(and(eq(s.payments.tenantId, ctx.tenantId), eq(s.payments.billId, billId), inArray(s.payments.status, ["initiated", "pending"])));
  for (const p of live) {
    const overlaps = p.allocations.some((a) => shareIds.includes(a.shareId));
    if (!overlaps || now.getTime() - p.createdAt.getTime() > ATTEMPT_WINDOW_MS) continue;
    if (p.payer === ctx.participantId) {
      await tx
        .update(s.payments)
        .set({ status: "failed", failureReason: "Replaced by a new attempt" })
        .where(and(eq(s.payments.tenantId, ctx.tenantId), eq(s.payments.id, p.id)));
    } else {
      throw new AppError("invalid_state", "Someone at the table is already paying this share. Try again in a minute.", { reason: "being_paid" });
    }
  }
}

type Verdict = { gatewayRef: string; status: "success" | "failed"; amountPaise: number; gatewayPaymentId?: string; reason?: string };

/**
 * Records the gateway's verdict. Safe to call more than once for the same payment: only the
 * first call changes anything. The caller must have verified it came from the gateway (signed
 * webhook or server-to-server status check).
 */
export async function confirmPayment(paymentId: string, verdict: Verdict, now = new Date()) {
  const res = await db.transaction((tx) => confirmPaymentTx(tx, paymentId, verdict, now), LOCK_THEN_READ);
  if (res.scope) {
    announceBill(res.scope, res.closedTableIds ? { tableIds: res.closedTableIds, state: "paid" } : undefined, [
      { topic: topics.session(res.scope.sessionId), type: "payment.updated", data: { paymentId } },
      ...(res.closedTableIds ? [{ topic: topics.session(res.scope.sessionId), type: "session.closed" }] : []),
    ]);
  }
  return { status: res.status, alreadyFinal: res.alreadyFinal, billPaid: res.billPaid, refundPaise: res.refundPaise };
}

/** For webhooks: the gateway names its own order reference */
export async function confirmByGatewayRef(channel: string, verdict: Verdict, now = new Date()) {
  // isolation-exempt: a verified gateway event names the order; its tenant is read from the row
  const [payment] = await db
    .select({ id: s.payments.id })
    .from(s.payments)
    .where(and(eq(s.payments.channel, channel), eq(s.payments.gatewayRef, verdict.gatewayRef)));
  if (!payment) return null;
  return confirmPayment(payment.id, verdict, now);
}

type Confirmed = {
  status: "initiated" | "pending" | "success" | "failed" | "refunded";
  alreadyFinal: boolean;
  billPaid: boolean;
  refundPaise: number;
  scope?: BillScope;
  closedTableIds?: string[];
};

async function confirmPaymentTx(tx: Tx, paymentId: string, verdict: Verdict, now: Date): Promise<Confirmed> {
  // isolation-exempt: a verified gateway callback names the payment; its tenant is read from the row
  const [payment] = await tx.select().from(s.payments).where(eq(s.payments.id, paymentId)).for("update");
  if (!payment) throw new AppError("not_found", "Payment not found.");
  if (payment.gatewayRef !== verdict.gatewayRef) throw new AppError("invalid_state", "Payment reference does not match.");
  const scope = await scopeOfBill(tx, payment.tenantId, payment.outletId, payment.billId);
  // Final states only change in one direction: an attempt we gave up on ("failed" by us, e.g.
  // replaced) can still succeed at the gateway, and captured money must always be recorded.
  const final = payment.status === "success" || payment.status === "refunded" || (payment.status === "failed" && verdict.status === "failed");
  if (final) return { status: payment.status, alreadyFinal: true, billPaid: false, refundPaise: 0 };

  const expected = payment.amountPaise + payment.tipPaise;
  if (verdict.status === "failed" || verdict.amountPaise !== expected) {
    const reason = verdict.status === "failed" ? (verdict.reason ?? "Declined") : `Amount mismatch: expected ${expected}, got ${verdict.amountPaise}`;
    await tx
      .update(s.payments)
      .set({ status: "failed", failureReason: reason.slice(0, 200), gatewayPaymentId: verdict.gatewayPaymentId ?? payment.gatewayPaymentId, checkedAt: now })
      .where(and(eq(s.payments.tenantId, payment.tenantId), eq(s.payments.id, payment.id)));
    return { status: "failed" as const, alreadyFinal: false, billPaid: false, refundPaise: 0, scope };
  }

  const applied = await applyPayment(tx, { ...payment, gatewayPaymentId: verdict.gatewayPaymentId ?? payment.gatewayPaymentId }, now);
  return { status: "success" as const, alreadyFinal: false, ...applied };
}

async function scopeOfBill(tx: Tx, tenantId: string, outletId: string, billId: string): Promise<BillScope> {
  const [{ sessionId }] = await tx.select({ sessionId: s.bills.sessionId }).from(s.bills).where(and(eq(s.bills.tenantId, tenantId), eq(s.bills.id, billId)));
  return { tenantId, outletId, sessionId };
}

export type PaymentView = "pending" | "success" | "failed" | "cancelled" | "unknown";

/**
 * Asks the gateway, server to server, where a payment stands and records a final answer. The
 * phone's return from the gateway only triggers this; it never decides the result itself.
 * "unknown" means the gateway could not be reached or has no answer yet: never call it failed.
 */
export async function reconcilePayment(scope: { tenantId: string }, paymentId: string, now = new Date()): Promise<PaymentView> {
  const [payment] = await db.select().from(s.payments).where(and(eq(s.payments.tenantId, scope.tenantId), eq(s.payments.id, paymentId)));
  if (!payment) throw new AppError("not_found", "Payment not found.");
  if (payment.status === "success" || payment.status === "refunded") return "success";
  if (payment.status === "failed" && payment.failureReason === "Cancelled before paying") return "cancelled";
  const gateway = gatewayByName(payment.channel);
  if (!gateway || !payment.gatewayRef) return payment.status === "failed" ? "failed" : "unknown";
  let status: { status: GatewayStatus; amountPaise: number; gatewayPaymentId?: string; reason?: string };
  try {
    status = await gateway.fetchStatus(payment.gatewayRef);
  } catch {
    return payment.status === "failed" ? "failed" : "unknown";
  }
  await db.update(s.payments).set({ checkedAt: now }).where(and(eq(s.payments.tenantId, payment.tenantId), eq(s.payments.id, payment.id)));
  if (status.status === "success" || status.status === "failed") {
    const res = await confirmPayment(payment.id, { gatewayRef: payment.gatewayRef, status: status.status, amountPaise: status.amountPaise, gatewayPaymentId: status.gatewayPaymentId, reason: status.reason }, now);
    return res.status === "success" ? "success" : "failed";
  }
  return payment.status === "failed" ? "failed" : status.status === "none" ? "pending" : "unknown";
}

/**
 * The guest came back from the gateway saying they cancelled. Only if the gateway confirms no
 * payment was even attempted is the attempt closed as cancelled; otherwise it stays to be checked.
 */
export async function cancelIfUnattempted(scope: { tenantId: string }, paymentId: string, now = new Date()): Promise<PaymentView> {
  const view = await reconcilePayment(scope, paymentId, now);
  if (view !== "pending") return view;
  const [closed] = await db
    .update(s.payments)
    .set({ status: "failed", failureReason: "Cancelled before paying", checkedAt: now })
    .where(and(eq(s.payments.tenantId, scope.tenantId), eq(s.payments.id, paymentId), inArray(s.payments.status, ["initiated", "pending"])));
  if (closed.affectedRows) {
    const [p] = await db.select({ outletId: s.payments.outletId, billId: s.payments.billId }).from(s.payments).where(and(eq(s.payments.tenantId, scope.tenantId), eq(s.payments.id, paymentId)));
    const [bill] = await db.select({ sessionId: s.bills.sessionId }).from(s.bills).where(and(eq(s.bills.tenantId, scope.tenantId), eq(s.bills.id, p.billId)));
    announceBill({ tenantId: scope.tenantId, outletId: p.outletId, sessionId: bill.sessionId }, undefined, [
      { topic: topics.session(bill.sessionId), type: "payment.updated", data: { paymentId } },
    ]);
  }
  return "cancelled";
}

/** Scheduled every minute (PS 6.4): re-check pending payments with the gateway */
export async function reconcilePendingPayments(scope: { tenantId: string; outletId: string }, now = new Date()) {
  const since = new Date(now.getTime() - 60 * 60_000);
  const pending = await db
    .select({ id: s.payments.id, createdAt: s.payments.createdAt })
    .from(s.payments)
    .where(and(eq(s.payments.tenantId, scope.tenantId), eq(s.payments.outletId, scope.outletId), eq(s.payments.status, "pending"), sql`${s.payments.createdAt} >= ${since}`))
    .limit(50);
  let settled = 0;
  for (const p of pending) {
    const view = await reconcilePayment(scope, p.id, now).catch(() => "unknown" as const);
    if (view === "success" || view === "failed") settled++;
    else if (now.getTime() - p.createdAt.getTime() > ATTEMPT_WINDOW_MS) {
      // Still unknown after 10 minutes: flag to the cashier, never guess
      await publish(scope, [{ topic: topics.tasks, type: "payment.stuck", data: { paymentId: p.id } }]);
    }
  }
  return settled;
}

/** Cashier or waiter settles shares in cash, card or counter UPI (S4) */
export async function settleAtCounter(
  ctx: StaffContext,
  input: { sessionId: string; forParticipantIds?: string[]; method: "cash" | "card" | "upi"; receivedPaise?: number; clientRequestId?: string; externalReference?: string },
  now = new Date(),
  allowedRoles: readonly StaffRole[] = ["waiter", "manager", "owner"],
) {
  if (input.clientRequestId) {
    await requireStaffRole(ctx, allowedRoles);
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(input.clientRequestId) || !["cash", "card"].includes(input.method)) throw new AppError("invalid_state", "Invalid settlement request.");
    if (input.method === "cash" && (!Number.isSafeInteger(input.receivedPaise) || input.receivedPaise! < 0)) throw new AppError("invalid_state", "Enter the cash received.");
  }
  const scope = { tenantId: ctx.tenantId, outletId: ctx.outletId, sessionId: input.sessionId };
  const res = await db.transaction(async (tx) => {
    const session = await lockSession(tx, scope);
    if (input.clientRequestId) {
      const [old] = await tx.select({ payment: s.payments }).from(s.payments).innerJoin(s.bills, and(eq(s.bills.tenantId, s.payments.tenantId), eq(s.bills.id, s.payments.billId))).where(and(eq(s.payments.tenantId, ctx.tenantId), eq(s.payments.outletId, ctx.outletId), eq(s.bills.sessionId, input.sessionId), eq(s.payments.clientRequestId, input.clientRequestId)));
      if (old) {
        if(old.payment.takenByUserId !== ctx.userId || old.payment.method !== input.method) throw new AppError("conflict", "This request id belongs to another settlement.");
        const [entry] = await tx.select({after:s.auditLog.after}).from(s.auditLog).where(and(eq(s.auditLog.tenantId,ctx.tenantId),eq(s.auditLog.entityId,old.payment.id),eq(s.auditLog.action,"waiter.settled")));
        const stored=entry?.after as {changePaise?:number}|null;
        return {paymentId:old.payment.id,amountPaise:old.payment.amountPaise,changePaise:stored?.changePaise??0,billPaid:session.status === "closed",closedTableIds:undefined};
      }
    }
    if (session.status === "closed") throw new AppError("session_expired", "This table has already been settled.");
    const { billId } = await syncBill(tx, scope, now);

    const shares = await tx
      .select()
      .from(s.billShares)
      .where(
        and(
          eq(s.billShares.tenantId, ctx.tenantId),
          eq(s.billShares.billId, billId),
          input.forParticipantIds?.length ? inArray(s.billShares.participantId, input.forParticipantIds) : undefined,
        ),
      );
    if(input.forParticipantIds?.length && shares.length !== new Set(input.forParticipantIds).size) throw new AppError("not_found", "A selected share is not part of this bill.");
    if (input.clientRequestId) {
      const pending=await tx.select({allocations:s.payments.allocations}).from(s.payments).where(and(eq(s.payments.tenantId,ctx.tenantId),eq(s.payments.billId,billId),inArray(s.payments.status,["initiated","pending"])));
      if(pending.some(p=>p.allocations.some(a=>shares.some(sh=>sh.id===a.shareId)))) throw new AppError("invalid_state", "An online payment is still pending or being checked.", {reason:"payment_in_flight"});
    }
    const allocations = shares.map((sh) => ({ shareId: sh.id, amountPaise: sh.amountPaise - sh.paidPaise })).filter((a) => a.amountPaise > 0);
    if (allocations.length === 0) throw new AppError("invalid_state", "Nothing left to settle.");
    const amountPaise = allocations.reduce((sum, a) => sum + a.amountPaise, 0);

    if (input.method === "cash" && input.receivedPaise !== undefined && input.receivedPaise < amountPaise) {
      throw new AppError("invalid_state", `Cash received is less than ₹${amountPaise / 100}.`);
    }

    const payment = {
      id: uuidv7(),
      tenantId: ctx.tenantId,
      outletId: ctx.outletId,
      billId,
      allocations,
      payerParticipantId: null,
      method: input.method,
      channel: "counter",
      gatewayRef: null,
      amountPaise,
      tipPaise: 0,
      status: "initiated" as const,
      failureReason: null,
      clientRequestId: input.clientRequestId ?? null,
      gatewayPaymentId: null,
      checkedAt: null,
      takenByUserId: ctx.userId,
      createdAt: now,
      updatedAt: now,
    };
    await tx.insert(s.payments).values({ ...payment, tenantId: ctx.tenantId });
    const applied = await applyPayment(tx, payment, now);
    if(input.clientRequestId) await tx.insert(s.auditLog).values({tenantId:ctx.tenantId,outletId:ctx.outletId,actorLabel:"staff",actorUserId:ctx.userId,action:"waiter.settled",entity:"payment",entityId:payment.id,after:{clientRequestId:input.clientRequestId,sessionId:input.sessionId,receivedPaise:input.receivedPaise,changePaise:input.method === "cash" ? input.receivedPaise!-amountPaise:0,externalReference:input.externalReference?.trim().slice(0,120) || null},createdAt:now});
    return {
      paymentId: payment.id,
      amountPaise,
      changePaise: input.method === "cash" && input.receivedPaise !== undefined ? input.receivedPaise - amountPaise : 0,
      billPaid: applied.billPaid,
      closedTableIds: applied.closedTableIds,
    };
  }, LOCK_THEN_READ);
  announceBill(scope, res.closedTableIds ? { tableIds: res.closedTableIds, state: "paid" } : undefined, [
    { topic: topics.session(scope.sessionId), type: "payment.updated", data: { paymentId: res.paymentId } },
    ...(res.closedTableIds ? [{ topic: topics.session(scope.sessionId), type: "session.closed" }] : []),
  ]);
  return { paymentId: res.paymentId, amountPaise: res.amountPaise, changePaise: res.changePaise, billPaid: res.billPaid };
}

type PaymentRow = typeof s.payments.$inferSelect;

/**
 * Marks a payment successful and credits its shares, never beyond what each share still owes.
 * Money beyond that (a share paid twice, e.g. online and in cash) becomes a pending refund for
 * the manager instead of being lost or double counted. Closes the bill when nothing is left.
 */
async function applyPayment(tx: Tx, payment: PaymentRow, now: Date): Promise<{ billPaid: boolean; refundPaise: number; scope: BillScope; closedTableIds?: string[] }> {
  const t = payment.tenantId;
  // Lock order is always session, then bill, everywhere, so payments never deadlock. The bill is
  // read again after the lock: a copy read before it could miss that another payment just closed it.
  const scope = await scopeOfBill(tx, t, payment.outletId, payment.billId);
  await lockSession(tx, scope);
  const [bill] = await tx
    .select()
    .from(s.bills)
    .where(and(eq(s.bills.tenantId, t), eq(s.bills.id, payment.billId)))
    .for("update");

  const shares = await lockShares(tx, t, payment.allocations.map((a) => a.shareId));
  const byId = new Map(shares.map((sh) => [sh.id, sh]));
  let credited = 0;
  let tipGiven = false;
  for (const alloc of payment.allocations) {
    const share = byId.get(alloc.shareId);
    if (!share) continue;
    const credit = Math.min(alloc.amountPaise, Math.max(0, share.amountPaise - share.paidPaise));
    if (credit === 0) continue;
    credited += credit;
    const paidPaise = share.paidPaise + credit;
    await tx
      .update(s.billShares)
      .set({
        paidPaise,
        status: paidPaise >= share.amountPaise ? "paid" : "unpaid",
        // The tip is the payer's own and rides on the first share the payment settles
        tipPaise: share.tipPaise + (tipGiven ? 0 : payment.tipPaise),
        paidByParticipantId: payment.payerParticipantId ?? share.paidByParticipantId,
      })
      .where(and(eq(s.billShares.tenantId, t), eq(s.billShares.id, share.id)));
    tipGiven = true;
  }

  await tx
    .update(s.payments)
    .set({ status: "success", failureReason: null, gatewayPaymentId: payment.gatewayPaymentId, checkedAt: now })
    .where(and(eq(s.payments.tenantId, t), eq(s.payments.id, payment.id)));

  // Nothing settled means the tip had nothing to ride on either, so it goes back too
  const refundPaise = payment.amountPaise - credited + (tipGiven ? 0 : payment.tipPaise);
  if (refundPaise > 0) {
    await tx.insert(s.refunds).values({
      tenantId: t,
      paymentId: payment.id,
      amountPaise: refundPaise,
      reason: "Paid twice: this share was already settled",
      status: "pending",
      createdAt: now,
    });
  }
  if (tipGiven && payment.tipPaise > 0) {
    await tx
      .update(s.bills)
      .set({ tipPaise: sql`${s.bills.tipPaise} + ${payment.tipPaise}` })
      .where(and(eq(s.bills.tenantId, t), eq(s.bills.id, bill.id)));
  }

  if (bill.status === "paid" || credited === 0) return { billPaid: false, refundPaise, scope };
  const [{ unpaid }] = await tx
    .select({ unpaid: sql<number>`count(*)` })
    .from(s.billShares)
    .where(and(eq(s.billShares.tenantId, t), eq(s.billShares.billId, bill.id), eq(s.billShares.status, "unpaid")));
  if (Number(unpaid) > 0) return { billPaid: false, refundPaise, scope };

  const closedTableIds = await closeBill(tx, bill, now);
  return { billPaid: true, refundPaise, scope, closedTableIds };
}

export type InvoicePayment = { method: string; channel: string; amountPaise: number; tipPaise: number; payer: string | null; covered: string[]; at: number };

/**
 * Everything settled: bill paid, one table invoice issued, session closed, table waits for reset.
 * A restaurant with a GSTIN issues a Tax invoice; without one it is a Receipt, never labelled as tax.
 */
async function closeBill(tx: Tx, bill: typeof s.bills.$inferSelect, now: Date): Promise<string[]> {
  const t = bill.tenantId;
  const [[outlet], [session], lines, paid, people, shares] = await Promise.all([
    tx.select().from(s.outlets).where(and(eq(s.outlets.tenantId, t), eq(s.outlets.id, bill.outletId))),
    tx
      .select({ tableId: s.tableSessions.tableId, tableCode: s.diningTables.code })
      .from(s.tableSessions)
      .innerJoin(s.diningTables, eq(s.diningTables.id, s.tableSessions.tableId))
      .where(and(eq(s.tableSessions.tenantId, t), eq(s.tableSessions.id, bill.sessionId))),
    tx
      .select({ itemId: s.orderLines.itemId, nameEn: s.orderLines.nameEn, qty: s.orderLines.qty, unitPricePaise: s.orderLines.unitPricePaise, taxRateBp: s.orderLines.taxRateBp })
      .from(s.orderLines)
      .where(and(eq(s.orderLines.tenantId, t), eq(s.orderLines.sessionId, bill.sessionId), notInArray(s.orderLines.status, ["cancelled", "voided"])))
      .orderBy(s.orderLines.id),
    tx
      .select()
      .from(s.payments)
      .where(and(eq(s.payments.tenantId, t), eq(s.payments.billId, bill.id), eq(s.payments.status, "success")))
      .orderBy(s.payments.createdAt),
    tx.select({ id: s.participants.id, name: s.participants.displayName }).from(s.participants).where(and(eq(s.participants.tenantId, t), eq(s.participants.sessionId, bill.sessionId))),
    tx.select({ id: s.billShares.id, participantId: s.billShares.participantId }).from(s.billShares).where(and(eq(s.billShares.tenantId, t), eq(s.billShares.billId, bill.id))),
  ]);

  const invoice = await nextInvoiceNumber(tx, { tenantId: t, id: outlet.id, code: outlet.code, timezone: outlet.timezone }, now);
  const paymentModes: Record<string, number> = {};
  for (const p of paid) paymentModes[p.method] = (paymentModes[p.method] ?? 0) + p.amountPaise;
  const nameOf = new Map(people.map((p) => [p.id, isPlaceholderName(p.name) ? null : p.name]));
  const shareOwner = new Map(shares.map((sh) => [sh.id, sh.participantId]));
  const payments: InvoicePayment[] = paid.map((p) => ({
    method: p.method,
    channel: p.channel,
    amountPaise: p.amountPaise,
    tipPaise: p.tipPaise,
    payer: p.payerParticipantId ? (nameOf.get(p.payerParticipantId) ?? null) : null,
    covered: p.allocations.map((a) => shareOwner.get(a.shareId)).map((id) => (id ? (nameOf.get(id) ?? "Guest") : "Table")),
    at: p.createdAt.getTime(),
  }));

  await tx.insert(s.invoices).values({
    tenantId: t,
    outletId: outlet.id,
    billId: bill.id,
    financialYear: invoice.financialYear,
    seq: invoice.seq,
    number: invoice.number,
    totalPaise: bill.totalPaise,
    issuedAt: now,
    snapshot: {
      docType: outlet.gstin ? "tax_invoice" : "receipt",
      seller: { name: outlet.name, city: outlet.city, address: outlet.address, gstin: outlet.gstin, fssai: outlet.fssai },
      table: session.tableCode,
      lines: lines.map((l) => ({ nameEn: l.nameEn, qty: l.qty, unitPricePaise: l.unitPricePaise, taxRateBp: l.taxRateBp, amountPaise: l.unitPricePaise * l.qty })),
      subtotalPaise: bill.subtotalPaise,
      discountPaise: bill.discountPaise,
      serviceChargePaise: bill.serviceChargePaise,
      deliveryFeePaise: bill.deliveryFeePaise,
      taxBreakup: bill.taxBreakup,
      taxPaise: bill.taxPaise,
      roundOffPaise: bill.roundOffPaise,
      totalPaise: bill.totalPaise,
      totalInWords: amountInWords(bill.totalPaise),
      paymentModes,
      tipsPaise: paid.reduce((n, p) => n + p.tipPaise, 0),
      payments,
    },
  });

  // What the dishes used comes off the stock, in this same transaction
  await takeStockForBill(tx, t, outlet.id, bill.id, lines.map((l) => ({ itemId: l.itemId, qty: l.qty })));

  await tx.update(s.bills).set({ status: "paid", closedAt: now }).where(and(eq(s.bills.tenantId, t), eq(s.bills.id, bill.id)));
  await tx.update(s.tableSessions).set({ status: "closed", openKey: null, closedAt: now }).where(and(eq(s.tableSessions.tenantId, t), eq(s.tableSessions.id, bill.sessionId)));
  // Every table of the visit waits in Paid until staff mark it for cleaning (S1); the visit lets go
  // of them now, so nothing open still claims a table that is about to be reset
  const tableIds = await setVisitTablesState(tx, t, bill.sessionId, "paid", now);
  await releaseVisitTables(tx, t, bill.sessionId, now);
  // A takeaway counter or a room has no table to clear away: it is free for the next order at once
  if (tableIds.length) {
    await tx
      .update(s.diningTables)
      .set({ state: "available", stateChangedAt: now })
      .where(and(eq(s.diningTables.tenantId, t), inArray(s.diningTables.id, tableIds), inArray(s.diningTables.tableClass, [TAKEAWAY_CLASS, ROOM_CLASS])));
  }
  await tx
    .update(s.reservations)
    .set({ status: "completed", completedAt: now })
    .where(and(eq(s.reservations.tenantId, t), eq(s.reservations.sessionId, bill.sessionId), eq(s.reservations.status, "seated")));
  return tableIds.length ? tableIds : [session.tableId];
}

type Actor = { kind: "guest"; ctx: GuestContext } | { kind: "staff"; ctx: StaffContext; sessionId: string };

const actorScope = (a: Actor): BillScope =>
  a.kind === "guest" ? scopeOf(a.ctx) : { tenantId: a.ctx.tenantId, outletId: a.ctx.outletId, sessionId: a.sessionId };

async function assertActorMayManage(tx: Tx, actor: Actor, session: { hostParticipantId: string | null }) {
  if (actor.kind === "staff") return;
  const [me] = await tx
    .select({ paidOutAt: s.participants.paidOutAt, removedAt: s.participants.removedAt })
    .from(s.participants)
    .where(and(eq(s.participants.tenantId, actor.ctx.tenantId), eq(s.participants.id, actor.ctx.participantId)));
  if (!me || me.removedAt || me.paidOutAt) throw new AppError("session_expired", "You have already left this table.");
  if (session.hostParticipantId !== actor.ctx.participantId) {
    throw new AppError("invalid_state", "Only the table host can do this.", { reason: "host_only" });
  }
}

/**
 * Paid and left (PS 3.6): someone whose share is fully settled leaves early. Their share is fixed
 * from now on and later orders exclude them. Host or staff only; the host passes host first.
 */
export async function markPaidAndLeft(actor: Actor, participantId: string, now = new Date()) {
  const scope = actorScope(actor);
  await db.transaction(async (tx) => {
    const session = await lockSession(tx, scope);
    if (session.status === "closed") throw new AppError("session_expired", "This table has already been settled.");
    await assertActorMayManage(tx, actor, session);
    if (participantId === session.hostParticipantId) {
      throw new AppError("invalid_state", "Pass host to someone else first.", { reason: "is_host" });
    }
    const [person] = await tx
      .select()
      .from(s.participants)
      .where(and(eq(s.participants.tenantId, scope.tenantId), eq(s.participants.sessionId, scope.sessionId), eq(s.participants.id, String(participantId))))
      .for("update");
    if (!person) throw new AppError("not_found", "This person is not at your table.");
    if (person.paidOutAt) return;
    if (person.removedAt) throw new AppError("invalid_state", "This person is no longer at the table.", { reason: "removed" });
    const inputs = await loadBillInputs(tx, scope);
    const share = inputs.shares.find((sh) => sh.participantId === person.id);
    const live = inputs.payments.some(
      (p) => (p.status === "pending" || p.status === "initiated") && share && p.allocations.some((a) => a.shareId === share.id),
    );
    if (!share || share.paidPaise < share.amountPaise || share.amountPaise <= 0 || live) {
      throw new AppError("invalid_state", "Their share must be fully paid first.", { reason: "not_settled" });
    }
    await tx.update(s.participants).set({ paidOutAt: now }).where(and(eq(s.participants.tenantId, scope.tenantId), eq(s.participants.id, person.id)));
    await tx.update(s.billShares).set({ frozenAt: now }).where(and(eq(s.billShares.tenantId, scope.tenantId), eq(s.billShares.id, share.id)));
  }, LOCK_THEN_READ);
  announceBill(scope, undefined, [{ topic: topics.session(scope.sessionId), type: "participant.paid_out", data: { participantId } }]);
}

/**
 * Reopen the bill so the table can order more (PS 3.6 edge case). Host or staff. Blocked while an
 * online payment is still in flight, so nobody pays against numbers that are about to change.
 * Payments made so far stay; frozen shares stay; the rest recalculates when the bill is requested again.
 */
export async function reopenBill(actor: Actor, now = new Date(), approval?: {initiator:StaffSession; approverUserId:string}) {
  const scope = actorScope(actor);
  const tableIds = await db.transaction(async (tx) => {
    const session = await lockSession(tx, scope);
    if (session.status !== "bill_requested") throw new AppError("invalid_state", "The bill is not requested.", { reason: "not_requested" });
    await assertActorMayManage(tx, actor, session);
    const inputs = await loadBillInputs(tx, scope);
    if (inputs.payments.some((p) => p.status === "pending" || p.status === "initiated")) {
      throw new AppError("invalid_state", "A payment is still being checked. Try again once it finishes.", { reason: "payment_in_flight" });
    }
    await tx
      .update(s.tableSessions)
      .set({ status: "open", lastActivityAt: now })
      .where(and(eq(s.tableSessions.tenantId, scope.tenantId), eq(s.tableSessions.id, scope.sessionId)));
    const ids = await setVisitTablesState(tx, scope.tenantId, scope.sessionId, "seated", now);
    if (inputs.bill) await tx.update(s.bills).set({ reopenedAt: now }).where(and(eq(s.bills.tenantId, scope.tenantId), eq(s.bills.id, inputs.bill.id)));
    if(approval) await audit(tx,approval.initiator,{action:"waiter.bill_reopened",entity:"session",entityId:scope.sessionId,after:{approverUserId:approval.approverUserId},now});
    return ids;
  }, LOCK_THEN_READ);
  announceBill(scope, { tableIds, state: "seated" }, [{ topic: topics.session(scope.sessionId), type: "session.updated", data: { change: "bill_reopened" } }]);
}

/**
 * Sends a pending refund to the gateway (manager action, PS 6.3). It stays "pending" until the
 * gateway confirms it; nothing here marks it refunded on our own say-so. Counter refunds are
 * completed by staff.
 */
export async function executeRefund(ctx: StaffContext, refundId: string, now = new Date()) {
  // The refund row stays locked for the whole attempt, so two clicks or two screens can never send
  // the same refund to the gateway twice: the second one finds it already sent and returns.
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ refund: s.refunds, payment: s.payments })
      .from(s.refunds)
      .innerJoin(s.payments, and(eq(s.payments.tenantId, s.refunds.tenantId), eq(s.payments.id, s.refunds.paymentId)))
      .where(and(eq(s.refunds.tenantId, ctx.tenantId), eq(s.payments.outletId, ctx.outletId), eq(s.refunds.id, refundId)))
      .for("update");
    if (!row) throw new AppError("not_found", "Refund not found.");
    const { refund, payment } = row;
    if (refund.status !== "pending" || refund.gatewayRef) return refund.status;
    const settle = (patch: Partial<typeof s.refunds.$inferInsert>) =>
      tx.update(s.refunds).set(patch).where(and(eq(s.refunds.tenantId, ctx.tenantId), eq(s.refunds.id, refund.id)));
    if (payment.channel === "counter") {
      await settle({ status: "success", completedAt: now });
      return "success" as const;
    }
    const gateway = gatewayByName(payment.channel);
    if (!gateway || !payment.gatewayRef || !payment.gatewayPaymentId) throw new AppError("invalid_state", "This payment cannot be refunded online.");
    let res;
    try {
      res = await gateway.refund({ gatewayRef: payment.gatewayRef, gatewayPaymentId: payment.gatewayPaymentId, amountPaise: refund.amountPaise, refundId: refund.id });
    } catch (err) {
      // A refused or failed call never counts as money returned; the amount is free to refund again
      console.error("[refunds] gateway refund failed", { refundId: refund.id, error: err instanceof Error ? err.message : String(err) });
      await settle({ status: "failed", completedAt: null });
      return "failed" as const;
    }
    await settle({ gatewayRef: res.gatewayRefundId, status: res.status, completedAt: res.status === "success" ? now : null });
    return res.status;
  }, LOCK_THEN_READ);
}

/** A verified gateway refund event: the only way an online refund becomes "success" */
export async function recordRefundResult(channel: string, event: { gatewayRefundId: string; status: "success" | "failed" }, now = new Date()) {
  // isolation-exempt: a verified gateway event names its refund; its tenant is read from the row
  const [row] = await db
    .select({ refund: s.refunds, payment: s.payments })
    .from(s.refunds)
    .innerJoin(s.payments, and(eq(s.payments.tenantId, s.refunds.tenantId), eq(s.payments.id, s.refunds.paymentId)))
    .where(and(eq(s.refunds.gatewayRef, event.gatewayRefundId), eq(s.payments.channel, channel)));
  if (!row || row.refund.status !== "pending") return false;
  await db
    .update(s.refunds)
    .set({ status: event.status, completedAt: event.status === "success" ? now : null })
    .where(and(eq(s.refunds.tenantId, row.refund.tenantId), eq(s.refunds.id, row.refund.id)));
  const [bill] = await db.select({ sessionId: s.bills.sessionId }).from(s.bills).where(and(eq(s.bills.tenantId, row.payment.tenantId), eq(s.bills.id, row.payment.billId)));
  if (bill) await publish({ tenantId: row.payment.tenantId, outletId: row.payment.outletId }, [{ topic: topics.session(bill.sessionId), type: "refund.updated", data: { refundId: row.refund.id } }]);
  return true;
}

/** The hosted checkout for one of this guest's own attempts, rebuilt on every call so a retry works */
export async function checkoutFor(ctx: GuestContext, paymentId: string, callbackUrl: string) {
  const [row] = await db
    .select({ payment: s.payments, outletName: s.outlets.name })
    .from(s.payments)
    .innerJoin(s.outlets, and(eq(s.outlets.tenantId, s.payments.tenantId), eq(s.outlets.id, s.payments.outletId)))
    .where(and(eq(s.payments.tenantId, ctx.tenantId), eq(s.payments.id, paymentId), eq(s.payments.payerParticipantId, ctx.participantId)));
  if (!row?.payment.gatewayRef || row.payment.status !== "pending") return null;
  const gateway = gatewayByName(row.payment.channel);
  if (!gateway || row.payment.method === "cash") return null;
  return await gateway.checkout({
    gatewayRef: row.payment.gatewayRef,
    paymentId,
    amountPaise: row.payment.amountPaise + row.payment.tipPaise,
    method: row.payment.method,
    outletName: row.outletName,
    callbackUrl,
  });
}
