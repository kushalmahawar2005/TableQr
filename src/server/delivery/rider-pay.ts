import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { lockSession, syncBill } from "../billing/bill";
import { reconcilePayment, settleAtCounter } from "../billing/payments";
import { LOCK_THEN_READ } from "../db-types";
import { AppError } from "../errors";
import { gatewayForOutletPayment } from "../payments/outlet-gateway";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import { audit } from "../staff/audit";
import type { StaffSession } from "../staff/auth";
import { requireStaffRole } from "../staff/waiter";
import { announceDelivery } from "./events";

// Payment at the door for a pay-on-delivery order. The rider shows a QR:
// - the restaurant's own Cashfree when connected: the payment confirms itself (signed webhook, or
//   the rider's phone asking Cashfree), and the rider sees "Paid" without touching anything;
// - otherwise the restaurant's UPI ID with the amount filled in: the rider checks the customer's
//   screen and taps "UPI received".
// When something goes wrong the rider can still take the money another way, but must say why;
// that note waits on the order for the manager.

type Job = { id: string; outletId: string; sessionId: string; phone: string | null; name: string | null; status: string };

async function riderJob(staff: StaffSession, id: string): Promise<Job> {
  await requireStaffRole(staff, ["rider"]);
  const [row] = await db.select({ id: s.deliveryCheckouts.id, outletId: s.deliveryCheckouts.outletId, sessionId: s.deliveryCheckouts.sessionId, phone: s.deliveryCheckouts.phone, name: s.deliveryCheckouts.name, status: s.deliveryCheckouts.status, courier: s.deliveryCheckouts.courierUserId })
    .from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.id, String(id))));
  if (!row?.sessionId || row.courier !== staff.userId) throw new AppError("not_found", "This delivery is not given to you any more.");
  if (row.status !== "dispatched") throw new AppError("invalid_state", "Pick up the order before taking payment.");
  return { ...row, sessionId: row.sessionId };
}

const asOutlet = (staff: StaffSession, job: Job) => ({ ...staff, outletId: job.outletId });

const upiLink = (id: string, name: string, amountPaise: number, note: string) =>
  `upi://pay?${new URLSearchParams({ pa: id, pn: name, am: (amountPaise / 100).toFixed(2), cu: "INR", tn: note.slice(0, 50) }).toString()}`;

export type RiderQr =
  | { kind: "gateway"; paymentId: string; amountPaise: number; image: string | null; link: string | null }
  | { kind: "upi"; amountPaise: number; link: string; upiId: string }
  | { kind: "paid" };

/** A QR for the full amount due. Cashfree first; the restaurant's UPI ID when Cashfree is not connected or fails. */
export async function riderQr(staff: StaffSession, id: string, origin: string, now = new Date()): Promise<RiderQr> {
  const job = await riderJob(staff, id);
  const [outlet] = await db.select({ name: s.outlets.name, upiId: s.outlets.upiId, upiName: s.outlets.upiName }).from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, job.outletId)));
  const gateway = await gatewayForOutletPayment(staff.tenantId, job.outletId, "cashfree") ?? (process.env.NODE_ENV !== "production" ? await gatewayForOutletPayment(staff.tenantId, job.outletId, "mock") : null);
  const scope = { tenantId: staff.tenantId, outletId: job.outletId, sessionId: job.sessionId };

  // Reuse this rider's live QR for the bill, or open one attempt for everything still due
  const attempt = await db.transaction(async (tx) => {
    const session = await lockSession(tx, scope);
    if (session.status === "closed") return null;
    const { billId } = await syncBill(tx, scope, now);
    const shares = await tx.select().from(s.billShares).where(and(eq(s.billShares.tenantId, staff.tenantId), eq(s.billShares.billId, billId)));
    const allocations = shares.map((sh) => ({ shareId: sh.id, amountPaise: sh.amountPaise - sh.paidPaise })).filter((a) => a.amountPaise > 0);
    const amountPaise = allocations.reduce((n, a) => n + a.amountPaise, 0);
    if (!amountPaise) return null;
    if (!gateway) return { amountPaise, paymentId: null, gatewayRef: null };
    const live = await tx.select().from(s.payments).where(and(eq(s.payments.tenantId, staff.tenantId), eq(s.payments.billId, billId), inArray(s.payments.status, ["initiated", "pending"])));
    const mine = live.find((p) => p.takenByUserId === staff.userId && p.channel === gateway.name && p.amountPaise === amountPaise && p.gatewayRef);
    if (mine) return { amountPaise, paymentId: mine.id, gatewayRef: mine.gatewayRef };
    // An older QR for another amount is replaced; anything else in flight (the customer paying online) blocks
    for (const p of live) {
      if (p.takenByUserId !== staff.userId) throw new AppError("invalid_state", "The customer is paying online right now. Wait a minute and check again.", { reason: "payment_in_flight" });
      await tx.update(s.payments).set({ status: "failed", failureReason: "Replaced by a new QR" }).where(and(eq(s.payments.tenantId, staff.tenantId), eq(s.payments.id, p.id)));
    }
    const paymentId = uuidv7();
    await tx.insert(s.payments).values({ id: paymentId, tenantId: staff.tenantId, outletId: job.outletId, billId, allocations, payerParticipantId: null, method: "upi", channel: gateway.name, amountPaise, tipPaise: 0, takenByUserId: staff.userId, clientRequestId: `rqr-${paymentId.replace(/-/g, "").slice(0, 40)}`, createdAt: now });
    return { amountPaise, paymentId, gatewayRef: null as string | null };
  }, LOCK_THEN_READ);
  if (!attempt) return { kind: "paid" };

  if (gateway && attempt.paymentId) {
    try {
      let gatewayRef = attempt.gatewayRef;
      if (!gatewayRef) {
        gatewayRef = (await gateway.createOrder({ paymentId: attempt.paymentId, amountPaise: attempt.amountPaise, receipt: job.id, callbackUrl: `${origin}/rider`, customer: { phone: job.phone, name: job.name } })).gatewayRef;
        await db.update(s.payments).set({ gatewayRef, status: "pending" }).where(and(eq(s.payments.tenantId, staff.tenantId), eq(s.payments.id, attempt.paymentId)));
      }
      if (!gateway.upiQr) throw new Error("This gateway cannot make a UPI QR");
      const qr = await gateway.upiQr(gatewayRef);
      return { kind: "gateway", paymentId: attempt.paymentId, amountPaise: attempt.amountPaise, image: qr.image ?? null, link: qr.link ?? null };
    } catch (error) {
      console.error("[rider-qr] gateway QR failed", error);
      await db.update(s.payments).set({ status: "failed", failureReason: "Could not make a QR" }).where(and(eq(s.payments.tenantId, staff.tenantId), eq(s.payments.id, attempt.paymentId), inArray(s.payments.status, ["initiated", "pending"])));
      if (!outlet?.upiId) throw new AppError("invalid_state", "Could not make the Cashfree QR. Try again, or take cash and report the issue.", { reason: "gateway_down" });
    }
  }
  if (!outlet?.upiId) throw new AppError("invalid_state", "Online payment is not set up for this restaurant. Take cash, or ask the manager to add a UPI ID in Settings.", { reason: "no_upi" });
  return { kind: "upi", amountPaise: attempt.amountPaise, upiId: outlet.upiId, link: upiLink(outlet.upiId, outlet.upiName || outlet.name, attempt.amountPaise, `Delivery ${job.id.slice(-6)}`) };
}

/** Has the customer paid the Cashfree QR? Asks Cashfree directly every few seconds, in case the webhook is slow. */
export async function riderQrStatus(staff: StaffSession, id: string, paymentId: string, now = new Date()) {
  const job = await riderJob(staff, id);
  const [payment] = await db.select({ status: s.payments.status, takenBy: s.payments.takenByUserId, checkedAt: s.payments.checkedAt })
    .from(s.payments).innerJoin(s.bills, and(eq(s.bills.tenantId, s.payments.tenantId), eq(s.bills.id, s.payments.billId)))
    .where(and(eq(s.payments.tenantId, staff.tenantId), eq(s.payments.id, String(paymentId)), eq(s.bills.sessionId, job.sessionId)));
  if (!payment || payment.takenBy !== staff.userId) throw new AppError("not_found", "This QR is not for your delivery.");
  let status: string = payment.status;
  if ((status === "pending" || status === "initiated") && (!payment.checkedAt || now.getTime() - payment.checkedAt.getTime() > 4000)) {
    const view = await reconcilePayment({ tenantId: staff.tenantId }, String(paymentId), now);
    status = view === "success" ? "success" : view === "failed" ? "failed" : status;
  }
  if (status === "success") await announceDelivery({ tenantId: staff.tenantId, outletId: job.outletId }, job.sessionId, "delivery.updated", [staff.userId]);
  return { status: status === "success" ? "paid" as const : status === "failed" ? "failed" as const : "waiting" as const };
}

/** The rider checked the customer's UPI app: the money reached the restaurant's own UPI ID */
export async function riderUpiReceived(staff: StaffSession, id: string, reference: string, now = new Date()) {
  const job = await riderJob(staff, id);
  const ref = String(reference ?? "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 40);
  await settleAtCounter(asOutlet(staff, job), { sessionId: job.sessionId, method: "upi", clientRequestId: `upi-${job.id.replace(/-/g, "").slice(0, 40)}`, externalReference: ref || undefined }, now, ["rider"]);
  await announceDelivery({ tenantId: staff.tenantId, outletId: job.outletId }, job.sessionId, "delivery.updated", [staff.userId]);
}

/**
 * Something went wrong (QR would not load, customer's app failed, paid the wrong amount...). The rider
 * takes the money as cash or straight to the restaurant's UPI, writes what happened, and can finish the
 * delivery. The note stays on the order and the manager is told.
 */
export async function riderPaymentIssue(staff: StaffSession, id: string, input: { method: "cash" | "upi"; note: string }, now = new Date()) {
  const job = await riderJob(staff, id);
  const method = input.method === "upi" ? "upi" : "cash";
  const note = String(input.note ?? "").trim().replace(/\s+/g, " ").slice(0, 280);
  if (note.length < 5) throw new AppError("invalid_state", "Write what went wrong, so the manager can check it.");
  // A QR still waiting would block the settlement; it is closed (a late Cashfree success is caught as a double payment)
  await db.update(s.payments).set({ status: "failed", failureReason: "Rider took payment another way" })
    .where(and(eq(s.payments.tenantId, staff.tenantId), eq(s.payments.takenByUserId, staff.userId), inArray(s.payments.status, ["initiated", "pending"]),
      inArray(s.payments.billId, db.select({ id: s.bills.id }).from(s.bills).where(and(eq(s.bills.tenantId, staff.tenantId), eq(s.bills.sessionId, job.sessionId))))));
  const [bill] = await db.select({ totalPaise: s.bills.totalPaise, status: s.bills.status }).from(s.bills).where(and(eq(s.bills.tenantId, staff.tenantId), eq(s.bills.sessionId, job.sessionId)));
  if (bill && bill.status !== "paid") {
    await settleAtCounter(asOutlet(staff, job), { sessionId: job.sessionId, method, receivedPaise: method === "cash" ? bill.totalPaise : undefined, clientRequestId: `iss-${job.id.replace(/-/g, "").slice(0, 40)}`, externalReference: `Issue: ${note}`.slice(0, 120) }, now, ["rider"]);
  }
  const text = `${method === "cash" ? "Took cash" : "Took UPI directly"}: ${note}`.slice(0, 300);
  await db.update(s.deliveryCheckouts).set({ paymentIssue: text, paymentIssueAt: now }).where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.id, job.id)));
  await audit(db, staff, { action: "delivery.payment_issue", entity: "delivery", entityId: job.id, after: { method, note }, now });
  await publish({ tenantId: staff.tenantId, outletId: job.outletId }, [{ topic: topics.tasks, type: "delivery.payment_issue", data: { deliveryId: job.id, rider: staff.name, note: text } }]);
  await announceDelivery({ tenantId: staff.tenantId, outletId: job.outletId }, job.sessionId, "delivery.updated", [staff.userId]);
}
