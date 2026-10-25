import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "../errors";
import { topics } from "../realtime/token";
import { audit } from "../staff/audit";
import type { StaffSession } from "../staff/auth";
import { requireStaffRole } from "../staff/waiter";
import { ATTEMPT_WINDOW_MS } from "./bill";
import { announceBill, reconcilePayment, type PaymentView } from "./payments";

// An online payment can hang when the gateway never answers. While it is "being checked" the
// counter cannot take cash, so the cashier needs a way out: ask the gateway again, and after 10
// minutes a manager may release it as not paid. A late "paid" from the gateway is still recorded
// (and refunded if the bill was settled another way), so releasing never loses a payment.

async function pendingPaymentOf(staff: StaffSession, sessionId: string) {
  const [row] = await db
    .select({ payment: s.payments, sessionId: s.bills.sessionId })
    .from(s.payments)
    .innerJoin(s.bills, and(eq(s.bills.tenantId, s.payments.tenantId), eq(s.bills.id, s.payments.billId)))
    .where(and(eq(s.payments.tenantId, staff.tenantId), eq(s.payments.outletId, staff.outletId), eq(s.bills.sessionId, String(sessionId)), inArray(s.payments.status, ["initiated", "pending"])))
    .limit(1);
  return row ?? null;
}

/** "Check again": asks the gateway now */
export async function recheckOnlinePayment(staff: StaffSession, sessionId: string, now = new Date()): Promise<PaymentView | "none"> {
  await requireStaffRole(staff, ["cashier", "manager", "owner", "accountant", "reception"]);
  const row = await pendingPaymentOf(staff, sessionId);
  if (!row) return "none";
  return reconcilePayment({ tenantId: staff.tenantId }, row.payment.id, now);
}

/** "Not paid, release": a manager closes a payment the gateway never answered for */
export async function releaseStuckPayment(staff: StaffSession, sessionId: string, now = new Date()) {
  await requireStaffRole(staff, ["manager", "owner"]);
  const row = await pendingPaymentOf(staff, sessionId);
  if (!row) return { released: false, view: "none" as const };
  // One last look: if the gateway has an answer now, that answer wins
  const view = await reconcilePayment({ tenantId: staff.tenantId }, row.payment.id, now).catch(() => "unknown" as const);
  if (view === "success" || view === "failed" || view === "cancelled") return { released: false, view };
  if (now.getTime() - row.payment.createdAt.getTime() < ATTEMPT_WINDOW_MS) {
    throw new AppError("invalid_state", "The guest may still be paying. Wait 10 minutes from when they started, then try again.", { reason: "too_soon" });
  }
  const [res] = await db
    .update(s.payments)
    .set({ status: "failed", failureReason: "Released by staff: no answer from the gateway", checkedAt: now })
    .where(and(eq(s.payments.tenantId, staff.tenantId), eq(s.payments.id, row.payment.id), inArray(s.payments.status, ["initiated", "pending"])));
  if (!res.affectedRows) {
    // The gateway's answer landed between the last look and the release: that answer stands, and
    // the manager is told so, not that the payment was released
    const [now1] = await db.select({ status: s.payments.status }).from(s.payments).where(and(eq(s.payments.tenantId, staff.tenantId), eq(s.payments.id, row.payment.id)));
    return { released: false, view: now1?.status === "success" || now1?.status === "refunded" ? ("success" as const) : ("failed" as const) };
  }
  await audit(db, staff, { action: "payment.released", entity: "payment", entityId: row.payment.id, before: { status: row.payment.status }, after: { status: "failed" }, now });
  announceBill({ tenantId: staff.tenantId, outletId: staff.outletId, sessionId: row.sessionId }, undefined, [
    { topic: topics.session(row.sessionId), type: "payment.updated", data: { paymentId: row.payment.id } },
  ]);
  return { released: true, view: "failed" as const };
}
