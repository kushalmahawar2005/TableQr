import "server-only";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { amountInWords } from "@/domain/words";
import { LOCK_THEN_READ, type Tx } from "../db-types";
import { AppError } from "../errors";
import type { GuestContext } from "../guest/context";
import { gatewayFor, type GatewayStatus } from "../payments/gateway";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import type { StaffContext } from "../staff/context";
import { lockSession, lockShares, syncBill, type BillScope, type SplitMode } from "./bill";
import { nextInvoiceNumber } from "./invoice-number";

// Paying the bill (PS 3.6, 3.8, 6.2, 6.4). Rules that keep money right:
// - amounts come from the server; the phone only says whose shares and how much tip
// - a share cannot be paid twice at once: a live attempt blocks others for 10 minutes
// - confirming is idempotent, so a webhook and the phone's callback can both arrive safely
// - the last payment closes the bill, issues the gapless GST invoice and frees the table,
//   all in one transaction

const ATTEMPT_WINDOW_MS = 10 * 60_000;

const scopeOf = (ctx: GuestContext): BillScope => ({ tenantId: ctx.tenantId, outletId: ctx.outletId, sessionId: ctx.sessionId });

/** After commit: phones at the table reload the bill; the floor map recolours the table */
export function announceBill(scope: BillScope, table?: { tableId: string; state: "bill_requested" | "paid" }) {
  void publish(scope, [
    { topic: topics.session(scope.sessionId), type: "bill.updated" },
    ...(table ? [{ topic: topics.floor, type: "table.state_changed", data: { tableId: table.tableId, state: table.state } }] : []),
  ]);
}

/** Request bill: pauses ordering and puts the table in Bill requested (PS 4.2) */
export async function requestBill(scope: BillScope, now = new Date()) {
  const res = await requestBillTx(scope, now);
  announceBill(scope, { tableId: res.tableId, state: "bill_requested" });
  return { billId: res.billId, totalPaise: res.totalPaise };
}

function requestBillTx(scope: BillScope, now: Date) {
  return db.transaction((tx) => requestBillInTransaction(tx, scope, now), LOCK_THEN_READ);
}

/** Shared by the G6 task transaction, so requesting the bill never leaves a half-created task. */
export async function requestBillInTransaction(tx: Tx, scope: BillScope, now: Date) {
    const session = await lockSession(tx, scope);
    if (session.status === "closed") throw new AppError("session_expired", "This table has already been settled.");
    if (session.status === "open") {
      await tx
        .update(s.tableSessions)
        .set({ status: "bill_requested", lastActivityAt: now })
        .where(and(eq(s.tableSessions.tenantId, scope.tenantId), eq(s.tableSessions.id, scope.sessionId)));
      await tx
        .update(s.diningTables)
        .set({ state: "bill_requested" })
        .where(and(eq(s.diningTables.tenantId, scope.tenantId), eq(s.diningTables.id, session.tableId)));
    }
    const { billId, draft } = await syncBill(tx, scope, now, { requestedAt: now });
    return { billId, totalPaise: draft.totals.totalPaise, tableId: session.tableId };
}

/** Host changes how the bill is split; allowed until the first person pays */
export async function setSplitMode(
  ctx: GuestContext,
  mode: SplitMode,
  customAmounts?: { participantId: string; amountPaise: number }[],
  now = new Date(),
) {
  const shares = await setSplitModeTx(ctx, mode, customAmounts, now);
  announceBill(scopeOf(ctx));
  return shares;
}

function setSplitModeTx(
  ctx: GuestContext,
  mode: SplitMode,
  customAmounts: { participantId: string; amountPaise: number }[] | undefined,
  now: Date,
) {
  return db.transaction(async (tx) => {
    const session = await lockSession(tx, scopeOf(ctx));
    if (session.hostParticipantId !== ctx.participantId) {
      throw new AppError("invalid_state", "Only the table host can change how the bill is split.");
    }
    const { billId, draft } = await syncBill(tx, scopeOf(ctx), now);
    const [{ paid }] = await tx
      .select({ paid: sql<number>`coalesce(sum(${s.billShares.paidPaise}), 0)` })
      .from(s.billShares)
      .where(and(eq(s.billShares.tenantId, ctx.tenantId), eq(s.billShares.billId, billId)));
    if (Number(paid) > 0) throw new AppError("invalid_state", "The split cannot change after someone has paid.");

    let amounts: Map<string, number> | undefined;
    if (mode === "custom") {
      const people = new Set(draft.shares.map((d) => d.participantId));
      amounts = new Map((customAmounts ?? []).map((c) => [c.participantId, c.amountPaise]));
      const values = [...amounts.values()];
      if ([...amounts.keys()].some((id) => !people.has(id)) || values.some((v) => !Number.isInteger(v) || v < 0 || v % 100 !== 0)) {
        throw new AppError("invalid_state", "Enter whole rupee amounts for people at this table.");
      }
      const left = draft.totals.totalPaise - values.reduce((a, b) => a + b, 0);
      if (left !== 0) {
        throw new AppError("invalid_state", `The amounts must add up to the bill. ${left > 0 ? "Still to assign" : "Over by"}: INR ${Math.abs(left) / 100}.`, { leftPaise: left });
      }
    }
    const res = await syncBill(tx, scopeOf(ctx), now, { mode, customAmounts: amounts });
    await tx
      .update(s.bills)
      .set({ splitMode: mode })
      .where(and(eq(s.bills.tenantId, ctx.tenantId), eq(s.bills.id, res.billId)));
    return res.draft.shares;
  }, LOCK_THEN_READ);
}

/**
 * Guest starts paying their own share, or others' too (Pay for others). Returns the gateway
 * checkout. Nothing is marked paid until the gateway confirms.
 */
export async function startPayment(
  ctx: GuestContext,
  input: { forParticipantIds?: string[]; tipPaise?: number; method: "upi" | "card" | "wallet" },
  now = new Date(),
) {
  const tipPaise = input.tipPaise ?? 0;
  if (!Number.isInteger(tipPaise) || tipPaise < 0) throw new AppError("invalid_state", "Choose a valid tip amount.");
  const gateway = gatewayFor();

  const payment = await db.transaction(async (tx) => {
    const session = await lockSession(tx, scopeOf(ctx));
    if (session.status === "closed") throw new AppError("session_expired", "This table has already been settled.");
    const { billId } = await syncBill(tx, scopeOf(ctx), now);

    const whose = [...new Set(input.forParticipantIds?.length ? input.forParticipantIds : [ctx.participantId])];
    const shares = await tx
      .select()
      .from(s.billShares)
      .where(
        and(
          eq(s.billShares.tenantId, ctx.tenantId),
          eq(s.billShares.billId, billId),
          inArray(s.billShares.participantId, whose),
        ),
      );
    const allocations = shares
      .map((sh) => ({ shareId: sh.id, amountPaise: sh.amountPaise - sh.paidPaise }))
      .filter((a) => a.amountPaise > 0);
    if (allocations.length === 0) throw new AppError("invalid_state", "There is nothing left to pay for this share.");
    if (tipPaise > allocations.reduce((sum, a) => sum + a.amountPaise, 0)) {
      throw new AppError("invalid_state", "The tip cannot be more than the bill.");
    }

    await releaseOrBlockLiveAttempts(tx, ctx, billId, allocations.map((a) => a.shareId), now);

    const id = uuidv7();
    const amountPaise = allocations.reduce((sum, a) => sum + a.amountPaise, 0);
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
      createdAt: now,
    });
    return { id, amountPaise };
  }, LOCK_THEN_READ);

  // The gateway call happens outside the transaction so no row stays locked on a network call
  const order = await gateway.createOrder({ paymentId: payment.id, amountPaise: payment.amountPaise + tipPaise, receipt: payment.id });
  await db
    .update(s.payments)
    .set({ gatewayRef: order.gatewayRef, status: "pending" })
    .where(and(eq(s.payments.tenantId, ctx.tenantId), eq(s.payments.id, payment.id)));

  announceBill(scopeOf(ctx)); // others see this share is being paid
  return { paymentId: payment.id, amountPaise: payment.amountPaise, tipPaise, totalPaise: payment.amountPaise + tipPaise, checkout: order.checkout };
}

/** Someone else mid-checkout on one of these shares blocks this attempt; your own old attempt is replaced */
async function releaseOrBlockLiveAttempts(tx: Tx, ctx: GuestContext, billId: string, shareIds: string[], now: Date) {
  const live = await tx
    .select({ id: s.payments.id, allocations: s.payments.allocations, payer: s.payments.payerParticipantId, createdAt: s.payments.createdAt })
    .from(s.payments)
    .where(
      and(eq(s.payments.tenantId, ctx.tenantId), eq(s.payments.billId, billId), inArray(s.payments.status, ["initiated", "pending"])),
    );
  for (const p of live) {
    const overlaps = p.allocations.some((a) => shareIds.includes(a.shareId));
    if (!overlaps || now.getTime() - p.createdAt.getTime() > ATTEMPT_WINDOW_MS) continue;
    if (p.payer === ctx.participantId) {
      await tx
        .update(s.payments)
        .set({ status: "failed", failureReason: "Replaced by a new attempt" })
        .where(and(eq(s.payments.tenantId, ctx.tenantId), eq(s.payments.id, p.id)));
    } else {
      throw new AppError("invalid_state", "Someone at the table is already paying this share. Try again in a minute.");
    }
  }
}

/**
 * Records the gateway's verdict. Safe to call more than once for the same payment: only the
 * first call changes anything. The caller must have verified the gateway signature.
 */
export async function confirmPayment(
  paymentId: string,
  verdict: { gatewayRef: string; status: Exclude<GatewayStatus, "pending">; amountPaise: number; reason?: string },
  now = new Date(),
) {
  const res = await confirmPaymentTx(paymentId, verdict, now);
  if (res.scope) announceBill(res.scope, res.closedTableId ? { tableId: res.closedTableId, state: "paid" } : undefined);
  return { status: res.status, alreadyFinal: res.alreadyFinal, billPaid: res.billPaid, refundPaise: res.refundPaise };
}

function confirmPaymentTx(
  paymentId: string,
  verdict: { gatewayRef: string; status: Exclude<GatewayStatus, "pending">; amountPaise: number; reason?: string },
  now: Date,
) {
  return db.transaction(async (tx): Promise<{
    status: "success" | "failed" | "initiated" | "pending" | "refunded";
    alreadyFinal: boolean;
    billPaid: boolean;
    refundPaise: number;
    scope?: BillScope;
    closedTableId?: string;
  }> => {
    // isolation-exempt: a verified gateway callback names the payment; its tenant is read from the row
    const [payment] = await tx.select().from(s.payments).where(eq(s.payments.id, paymentId)).for("update");
    if (!payment) throw new AppError("not_found", "Payment not found.");
    if (payment.gatewayRef !== verdict.gatewayRef) throw new AppError("invalid_state", "Payment reference does not match.");
    // Final states only change in one direction: an attempt we gave up on ("failed" by us, e.g.
    // replaced) can still succeed at the gateway, and captured money must always be recorded.
    const final = payment.status === "success" || payment.status === "refunded" || (payment.status === "failed" && verdict.status === "failed");
    if (final) return { status: payment.status, alreadyFinal: true, billPaid: false, refundPaise: 0 };

    const expected = payment.amountPaise + payment.tipPaise;
    if (verdict.status === "failed" || verdict.amountPaise !== expected) {
      const reason = verdict.status === "failed" ? (verdict.reason ?? "Declined") : `Amount mismatch: expected ${expected}, got ${verdict.amountPaise}`;
      await tx
        .update(s.payments)
        .set({ status: "failed", failureReason: reason.slice(0, 200) })
        .where(and(eq(s.payments.tenantId, payment.tenantId), eq(s.payments.id, payment.id)));
      return { status: "failed" as const, alreadyFinal: false, billPaid: false, refundPaise: 0 };
    }

    const applied = await applyPayment(tx, payment, now);
    return { status: "success" as const, alreadyFinal: false, ...applied };
  }, LOCK_THEN_READ);
}

/** Cashier or waiter settles shares in cash, card or counter UPI (S4) */
export async function settleAtCounter(
  ctx: StaffContext,
  input: { sessionId: string; forParticipantIds?: string[]; method: "cash" | "card" | "upi"; receivedPaise?: number },
  now = new Date(),
) {
  const scope = { tenantId: ctx.tenantId, outletId: ctx.outletId, sessionId: input.sessionId };
  const res = await db.transaction(async (tx) => {
    const session = await lockSession(tx, scope);
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
    const allocations = shares
      .map((sh) => ({ shareId: sh.id, amountPaise: sh.amountPaise - sh.paidPaise }))
      .filter((a) => a.amountPaise > 0);
    if (allocations.length === 0) throw new AppError("invalid_state", "Nothing left to settle.");
    const amountPaise = allocations.reduce((sum, a) => sum + a.amountPaise, 0);

    if (input.method === "cash" && input.receivedPaise !== undefined && input.receivedPaise < amountPaise) {
      throw new AppError("invalid_state", `Cash received is less than INR ${amountPaise / 100}.`);
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
      takenByUserId: ctx.userId,
      createdAt: now,
      updatedAt: now,
    };
    await tx.insert(s.payments).values({ ...payment, tenantId: ctx.tenantId });
    const applied = await applyPayment(tx, payment, now);
    return {
      paymentId: payment.id,
      amountPaise,
      changePaise: input.method === "cash" && input.receivedPaise !== undefined ? input.receivedPaise - amountPaise : 0,
      billPaid: applied.billPaid,
      closedTableId: applied.closedTableId,
    };
  }, LOCK_THEN_READ);
  announceBill(scope, res.closedTableId ? { tableId: res.closedTableId, state: "paid" } : undefined);
  return { paymentId: res.paymentId, amountPaise: res.amountPaise, changePaise: res.changePaise, billPaid: res.billPaid };
}

type PaymentRow = typeof s.payments.$inferSelect;

/**
 * Marks a payment successful and credits its shares, never beyond what each share still owes.
 * Money beyond that (a share paid twice, e.g. online and in cash) becomes a pending refund for
 * the manager instead of being lost or double counted. Closes the bill when nothing is left.
 */
async function applyPayment(
  tx: Tx,
  payment: PaymentRow,
  now: Date,
): Promise<{ billPaid: boolean; refundPaise: number; scope: BillScope; closedTableId?: string }> {
  const t = payment.tenantId;
  // Lock order is always session, then bill, everywhere, so payments never deadlock. The bill is
  // read again after the lock: a copy read before it could miss that another payment just closed it.
  const [{ sessionId }] = await tx
    .select({ sessionId: s.bills.sessionId })
    .from(s.bills)
    .where(and(eq(s.bills.tenantId, t), eq(s.bills.id, payment.billId)));
  const scope = { tenantId: t, outletId: payment.outletId, sessionId };
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
        // The tip rides on the first share the payment actually settles
        tipPaise: share.tipPaise + (tipGiven ? 0 : payment.tipPaise),
        paidByParticipantId: payment.payerParticipantId ?? share.paidByParticipantId,
      })
      .where(and(eq(s.billShares.tenantId, t), eq(s.billShares.id, share.id)));
    tipGiven = true;
  }

  await tx
    .update(s.payments)
    .set({ status: "success", failureReason: null })
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

  const closedTableId = await closeBill(tx, bill, now);
  return { billPaid: true, refundPaise, scope, closedTableId };
}

/** Everything settled: bill paid, GST invoice issued, session closed, table waits for reset */
async function closeBill(tx: Tx, bill: typeof s.bills.$inferSelect, now: Date): Promise<string> {
  const t = bill.tenantId;
  const [[outlet], [session], lines, paid] = await Promise.all([
    tx.select().from(s.outlets).where(and(eq(s.outlets.tenantId, t), eq(s.outlets.id, bill.outletId))),
    tx
      .select({ tableId: s.tableSessions.tableId, tableCode: s.diningTables.code })
      .from(s.tableSessions)
      .innerJoin(s.diningTables, eq(s.diningTables.id, s.tableSessions.tableId))
      .where(and(eq(s.tableSessions.tenantId, t), eq(s.tableSessions.id, bill.sessionId))),
    tx
      .select({ nameEn: s.orderLines.nameEn, qty: s.orderLines.qty, unitPricePaise: s.orderLines.unitPricePaise, taxRateBp: s.orderLines.taxRateBp })
      .from(s.orderLines)
      .where(and(eq(s.orderLines.tenantId, t), eq(s.orderLines.sessionId, bill.sessionId), notInArray(s.orderLines.status, ["cancelled", "voided"])))
      .orderBy(s.orderLines.id),
    tx
      .select({ method: s.payments.method, amountPaise: s.payments.amountPaise })
      .from(s.payments)
      .where(and(eq(s.payments.tenantId, t), eq(s.payments.billId, bill.id), eq(s.payments.status, "success"))),
  ]);

  const invoice = await nextInvoiceNumber(tx, { tenantId: t, id: outlet.id, code: outlet.code, timezone: outlet.timezone }, now);
  const paymentModes: Record<string, number> = {};
  for (const p of paid) paymentModes[p.method] = (paymentModes[p.method] ?? 0) + p.amountPaise;

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
      seller: { name: outlet.name, city: outlet.city, address: outlet.address, gstin: outlet.gstin, fssai: outlet.fssai },
      table: session.tableCode,
      lines: lines.map((l) => ({ ...l, amountPaise: l.unitPricePaise * l.qty })),
      subtotalPaise: bill.subtotalPaise,
      discountPaise: bill.discountPaise,
      serviceChargePaise: bill.serviceChargePaise,
      taxBreakup: bill.taxBreakup,
      taxPaise: bill.taxPaise,
      roundOffPaise: bill.roundOffPaise,
      totalPaise: bill.totalPaise,
      totalInWords: amountInWords(bill.totalPaise),
      paymentModes,
    },
  });

  await tx
    .update(s.bills)
    .set({ status: "paid", closedAt: now })
    .where(and(eq(s.bills.tenantId, t), eq(s.bills.id, bill.id)));
  await tx
    .update(s.tableSessions)
    .set({ status: "closed", openKey: null, closedAt: now })
    .where(and(eq(s.tableSessions.tenantId, t), eq(s.tableSessions.id, bill.sessionId)));
  await tx
    .update(s.diningTables)
    .set({ state: "paid" })
    .where(and(eq(s.diningTables.tenantId, t), eq(s.diningTables.id, session.tableId)));
  return session.tableId;
}
