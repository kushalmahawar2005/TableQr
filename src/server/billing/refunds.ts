import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import type { StaffRole } from "@/lib/staff-permissions";
import { LOCK_THEN_READ } from "../db-types";
import { AppError } from "../errors";
import { gatewayByName } from "../payments/gateway";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import { audit } from "../staff/audit";
import type { StaffSession } from "../staff/auth";
import { managerApproval, type Approval } from "../staff/waiter-mutations";
import { executeRefund, recordRefundResult } from "./payments";

// Staff-initiated refunds against one successful payment (PS 6.3). A refund is its own record: it
// never touches the bill, the order lines or the invoice, which stay exactly as they were issued.
// Money rules: only a successful payment can be refunded, never more than what is left of it
// (amount plus tip, minus refunds already pending or done), one request id makes one refund, and
// an online refund is "success" only when the gateway says so. A counter payment (cash or card
// taken by staff) has no gateway: its refund is staff handing the money back, recorded as done.

export const refundRoles = ["cashier", "manager", "owner", "accountant"] as const satisfies readonly StaffRole[];

/** A refund that holds part of the payment: pending or done. Failed refunds give the money back. */
const HOLDING = ["pending", "success"] as const;

/** What can still be refunded from a payment, in paise */
export const refundableOf = (payment: { amountPaise: number; tipPaise: number }, holdingPaise: number) => Math.max(0, payment.amountPaise + payment.tipPaise - holdingPaise);

/** The same request id always names the same refund, within one payment of one restaurant */
export function refundIdFor(tenantId: string, paymentId: string, requestId: string) {
  const h = createHash("sha256").update(`${tenantId}|${paymentId}|${requestId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export type RefundInput = { paymentId: string; amountPaise: number; reason: string; requestId: string; approval?: Approval };

function checkInput(input: RefundInput) {
  if (typeof input.paymentId !== "string" || !input.paymentId) throw new AppError("invalid_state", "Choose a payment to refund.");
  if (typeof input.requestId !== "string" || !/^[a-zA-Z0-9_-]{8,64}$/.test(input.requestId)) throw new AppError("invalid_state", "A refund request id is required.");
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) throw new AppError("invalid_state", "Enter a refund amount above zero.");
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 3) throw new AppError("invalid_state", "Give a reason for the refund.");
  return reason.slice(0, 200);
}

const announce = (staff: { tenantId: string; outletId: string }, sessionId: string | null, refundId: string) =>
  sessionId ? publish(staff, [{ topic: topics.session(sessionId), type: "refund.updated", data: { refundId } }]) : Promise.resolve();

async function sessionOfPayment(tenantId: string, billId: string) {
  const [bill] = await db.select({ sessionId: s.bills.sessionId }).from(s.bills).where(and(eq(s.bills.tenantId, tenantId), eq(s.bills.id, billId)));
  return bill?.sessionId ?? null;
}

/**
 * Starts a refund. Cashiers and accountants need a manager or owner of this outlet to approve it
 * with their PIN, the same rule as a void or a reopened bill. Safe to repeat with the same request
 * id: the second call returns the first refund and never reaches the gateway again.
 */
export async function requestRefund(staff: StaffSession, input: RefundInput, now = new Date()) {
  const approverUserId = await managerApproval(staff, input.approval, refundRoles);
  const reason = checkInput(input);
  const id = refundIdFor(staff.tenantId, input.paymentId, input.requestId);

  const created = await db.transaction(async (tx) => {
    // The payment row is the lock: refunds of one payment are decided one at a time
    const [payment] = await tx
      .select()
      .from(s.payments)
      .where(and(eq(s.payments.tenantId, staff.tenantId), eq(s.payments.outletId, staff.outletId), eq(s.payments.id, input.paymentId)))
      .for("update");
    if (!payment) throw new AppError("not_found", "Payment not found at this outlet.");
    if (payment.status !== "success") throw new AppError("invalid_state", "Only a successful payment can be refunded.", { reason: "not_refundable" });

    const [existing] = await tx.select().from(s.refunds).where(and(eq(s.refunds.tenantId, staff.tenantId), eq(s.refunds.id, id)));
    if (existing) {
      if (existing.paymentId !== payment.id || existing.amountPaise !== input.amountPaise) throw new AppError("conflict", "This request id was already used for a different refund.");
      return { id, payment, replayed: true };
    }

    const [{ held }] = await tx
      .select({ held: sql<string>`coalesce(sum(${s.refunds.amountPaise}), 0)` })
      .from(s.refunds)
      .where(and(eq(s.refunds.tenantId, staff.tenantId), eq(s.refunds.paymentId, payment.id), inArray(s.refunds.status, [...HOLDING])));
    const refundable = refundableOf(payment, Number(held));
    if (input.amountPaise > refundable) throw new AppError("invalid_state", "That is more than is left to refund on this payment.", { reason: "over_refund", refundablePaise: refundable });

    await tx.insert(s.refunds).values({ id, tenantId: staff.tenantId, paymentId: payment.id, amountPaise: input.amountPaise, reason, byUserId: staff.userId, status: "pending", createdAt: now });
    await audit(tx, staff, { action: "refund.requested", entity: "refund", entityId: id, after: { paymentId: payment.id, amountPaise: input.amountPaise, requestId: input.requestId, approverUserId }, reason, now });
    return { id, payment, replayed: false };
  }, LOCK_THEN_READ);

  // The gateway call is single-flight inside executeRefund (it holds the refund row), so a
  // replay of a refund that is already sent, or settled, does nothing
  const status = await executeRefund(staff, id, now);
  if (!created.replayed) await db.transaction((tx) => audit(tx, staff, { action: "refund.sent", entity: "refund", entityId: id, after: { status }, now }));
  await announce(staff, await sessionOfPayment(staff.tenantId, created.payment.billId), id);
  return { refundId: id, status, replayed: created.replayed };
}

/** Sends a refund that was created by the billing flow (an overpayment) and is waiting for staff */
export async function processRefund(staff: StaffSession, refundId: string, approval?: Approval, now = new Date()) {
  const approverUserId = await managerApproval(staff, approval, refundRoles);
  const [row] = await db
    .select({ refund: s.refunds, billId: s.payments.billId })
    .from(s.refunds)
    .innerJoin(s.payments, and(eq(s.payments.tenantId, s.refunds.tenantId), eq(s.payments.id, s.refunds.paymentId)))
    .where(and(eq(s.refunds.tenantId, staff.tenantId), eq(s.payments.outletId, staff.outletId), eq(s.refunds.id, refundId)));
  if (!row) throw new AppError("not_found", "Refund not found.");
  const status = await executeRefund(staff, refundId, now);
  await db.transaction((tx) => audit(tx, staff, { action: "refund.sent", entity: "refund", entityId: refundId, after: { status, approverUserId }, now }));
  await announce(staff, await sessionOfPayment(staff.tenantId, row.billId), refundId);
  return { refundId, status };
}

/** Asks the gateway where a pending online refund stands and settles it the same way a webhook does */
export async function reconcileRefund(ctx: { tenantId: string; outletId: string }, refundId: string, now = new Date()) {
  const [row] = await db
    .select({ refund: s.refunds, payment: s.payments })
    .from(s.refunds)
    .innerJoin(s.payments, and(eq(s.payments.tenantId, s.refunds.tenantId), eq(s.payments.id, s.refunds.paymentId)))
    .where(and(eq(s.refunds.tenantId, ctx.tenantId), eq(s.payments.outletId, ctx.outletId), eq(s.refunds.id, refundId)));
  if (!row) throw new AppError("not_found", "Refund not found.");
  const { refund, payment } = row;
  if (refund.status !== "pending" || !refund.gatewayRef || !payment.gatewayRef) return refund.status;
  const gateway = gatewayByName(payment.channel);
  if (!gateway) return refund.status;
  const seen = await gateway.fetchRefund({ gatewayRef: payment.gatewayRef, gatewayRefundId: refund.gatewayRef });
  if (seen.status === "pending") return "pending" as const;
  await recordRefundResult(payment.channel, { gatewayRefundId: refund.gatewayRef, status: seen.status }, now);
  return seen.status;
}

/** The scheduled sweep: online refunds still pending after two minutes, checked with the gateway */
export async function reconcilePendingRefunds(scope: { tenantId: string; outletId: string }, now = new Date()) {
  const rows = await db
    .select({ id: s.refunds.id })
    .from(s.refunds)
    .innerJoin(s.payments, and(eq(s.payments.tenantId, s.refunds.tenantId), eq(s.payments.id, s.refunds.paymentId)))
    .where(and(eq(s.refunds.tenantId, scope.tenantId), eq(s.payments.outletId, scope.outletId), eq(s.refunds.status, "pending"), sql`${s.refunds.gatewayRef} is not null`, lt(s.refunds.createdAt, new Date(now.getTime() - 120_000))))
    .orderBy(asc(s.refunds.createdAt))
    .limit(50);
  let settled = 0;
  for (const { id } of rows) {
    try {
      if ((await reconcileRefund(scope, id, now)) !== "pending") settled++;
    } catch (err) {
      console.error("[refunds] reconcile failed", { refundId: id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return settled;
}

export type PaymentRefundState = {
  refunds: { id: string; amountPaise: number; status: "pending" | "success" | "failed"; createdAt: number; sent: boolean }[];
  refundedPaise: number;
  pendingPaise: number;
  refundablePaise: number;
};

/** Refund figures for a set of payments at this outlet; one read, no per-payment queries */
export async function loadRefundState(tenantId: string, payments: { id: string; status: string; amountPaise: number; tipPaise: number }[]) {
  const out = new Map<string, PaymentRefundState>();
  const rows = payments.length ? await db.select().from(s.refunds).where(and(eq(s.refunds.tenantId, tenantId), inArray(s.refunds.paymentId, payments.map((p) => p.id)))).orderBy(asc(s.refunds.createdAt)) : [];
  for (const p of payments) {
    const mine = rows.filter((r) => r.paymentId === p.id);
    const refundedPaise = mine.filter((r) => r.status === "success").reduce((n, r) => n + r.amountPaise, 0);
    const pendingPaise = mine.filter((r) => r.status === "pending").reduce((n, r) => n + r.amountPaise, 0);
    out.set(p.id, {
      refunds: mine.map((r) => ({ id: r.id, amountPaise: r.amountPaise, status: r.status, createdAt: r.createdAt.getTime(), sent: !!r.gatewayRef })),
      refundedPaise,
      pendingPaise,
      refundablePaise: p.status === "success" ? refundableOf(p, refundedPaise + pendingPaise) : 0,
    });
  }
  return out;
}
