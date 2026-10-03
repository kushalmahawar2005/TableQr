import "server-only";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { splitBill, type BillTotals, type PersonShare, type ShareBasis, type SplitLine, type SplitMode } from "@/domain/split";
import type { Runner, Tx } from "../db-types";
import { AppError } from "../errors";

// The table bill (PS 3.6, 6.1). Everything is computed from order lines on the server; the
// stored bill and shares are a cache of that result plus what has been paid against it.

export type BillScope = { tenantId: string; outletId: string; sessionId: string };
export type { SplitMode };

const DEAD_LINES: ("cancelled" | "voided")[] = ["cancelled", "voided"];
/** A payment attempt this young still holds its shares (someone may be on the gateway page) */
export const ATTEMPT_WINDOW_MS = 10 * 60_000;

/** Everything the bill depends on */
export async function loadBillInputs(run: Runner, scope: BillScope) {
  const [[session], people, lines, [bill], [outlet]] = await Promise.all([
    run
      .select()
      .from(s.tableSessions)
      .where(and(eq(s.tableSessions.tenantId, scope.tenantId), eq(s.tableSessions.outletId, scope.outletId), eq(s.tableSessions.id, scope.sessionId))),
    // Removed people stay on the bill: what they ordered is still theirs to settle
    run
      .select({
        id: s.participants.id,
        displayName: s.participants.displayName,
        removedAt: s.participants.removedAt,
        paidOutAt: s.participants.paidOutAt,
      })
      .from(s.participants)
      .where(and(eq(s.participants.tenantId, scope.tenantId), eq(s.participants.sessionId, scope.sessionId)))
      .orderBy(s.participants.id),
    run
      .select({
        id: s.orderLines.id,
        participantId: s.orderLines.participantId,
        orderId: s.orderLines.orderId,
        nameEn: s.orderLines.nameEn,
        nameHi: s.orderLines.nameHi,
        unitPricePaise: s.orderLines.unitPricePaise,
        qty: s.orderLines.qty,
        taxRateBp: s.orderLines.taxRateBp,
        sharedWith: s.orderLines.sharedWith,
      })
      .from(s.orderLines)
      .where(and(eq(s.orderLines.tenantId, scope.tenantId), eq(s.orderLines.sessionId, scope.sessionId), notInArray(s.orderLines.status, DEAD_LINES)))
      .orderBy(s.orderLines.id),
    run.select().from(s.bills).where(and(eq(s.bills.tenantId, scope.tenantId), eq(s.bills.sessionId, scope.sessionId))),
    run
      .select({ serviceChargeBp: s.outlets.serviceChargeBp, tipPresetsBp: s.outlets.tipPresetsBp })
      .from(s.outlets)
      .where(and(eq(s.outlets.tenantId, scope.tenantId), eq(s.outlets.id, scope.outletId))),
  ]);
  if (!session) throw new AppError("not_found", "This table session was not found.");

  const [shares, discounts, payments] = bill
    ? await Promise.all([
        run.select().from(s.billShares).where(and(eq(s.billShares.tenantId, scope.tenantId), eq(s.billShares.billId, bill.id))),
        run
          .select({ orderLineId: s.discounts.orderLineId, amountPaise: s.discounts.amountPaise })
          .from(s.discounts)
          .where(and(eq(s.discounts.tenantId, scope.tenantId), eq(s.discounts.billId, bill.id))),
        run
          .select({
            id: s.payments.id,
            status: s.payments.status,
            allocations: s.payments.allocations,
            payerParticipantId: s.payments.payerParticipantId,
            createdAt: s.payments.createdAt,
          })
          .from(s.payments)
          .where(and(eq(s.payments.tenantId, scope.tenantId), eq(s.payments.billId, bill.id))),
      ])
    : [[], [], []];

  return { session, people, lines, bill: bill ?? null, shares, discounts, payments, outlet: outlet ?? { serviceChargeBp: 0, tipPresetsBp: null } };
}

export type BillInputs = Awaited<ReturnType<typeof loadBillInputs>>;

export type DraftShare = { participantId: string; amountPaise: number; basis: ShareBasis; detail: PersonShare | null };

/**
 * The bill is locked (split mode, custom amounts, service charge) from the first payment attempt
 * that is in flight or succeeded, so nobody is charged against numbers that then move.
 */
export function isBillLocked(inputs: Pick<BillInputs, "payments">, now = Date.now()) {
  return inputs.payments.some(
    (p) => p.status === "success" || p.status === "pending" || (p.status === "initiated" && now - p.createdAt.getTime() < ATTEMPT_WINDOW_MS),
  );
}

/** Pure: turns inputs into totals and one amount per person for the chosen split mode */
export function computeDraft(inputs: BillInputs, opts: { mode?: SplitMode; customAmounts?: Record<string, number> | null; serviceChargeWaived?: boolean } = {}) {
  const { session, people, lines, discounts, bill } = inputs;
  const known = new Set(people.map((p) => p.id));
  const frozenAmount = new Map(inputs.shares.filter((sh) => sh.frozenAt && sh.participantId).map((sh) => [sh.participantId!, sh.amountPaise]));
  const active = people.filter((p) => !p.removedAt && !frozenAmount.has(p.id));
  const hostId = session.hostParticipantId && known.has(session.hostParticipantId) ? session.hostParticipantId : (active[0]?.id ?? people[0]?.id ?? null);

  const itemDiscount = new Map<string, number>();
  let billDiscountPaise = 0;
  for (const d of discounts) {
    if (d.orderLineId) itemDiscount.set(d.orderLineId, (itemDiscount.get(d.orderLineId) ?? 0) + d.amountPaise);
    else billDiscountPaise += d.amountPaise;
  }

  const splitLines: SplitLine[] = lines.map((l) => {
    const sharers = (l.sharedWith ?? []).filter((id) => known.has(id));
    return {
      id: l.id,
      // A line nobody owns (added by staff for the table) belongs to the host, as it always has
      ownerId: l.participantId && known.has(l.participantId) ? l.participantId : (hostId ?? ""),
      amountPaise: Math.max(0, l.unitPricePaise * l.qty - (itemDiscount.get(l.id) ?? 0)),
      taxRateBp: l.taxRateBp,
      sharedWith: sharers.length > 1 ? sharers : null,
    };
  });

  const mode: SplitMode = opts.mode ?? bill?.splitMode ?? "my_items";
  const waived = opts.serviceChargeWaived ?? bill?.serviceChargeWaived ?? false;
  const serviceChargeBp = bill ? bill.serviceChargeBp : inputs.outlet.serviceChargeBp;
  const customAmounts = opts.customAmounts !== undefined ? opts.customAmounts : (bill?.customAmounts ?? null);

  if (people.length === 0 || !hostId) {
    const custom = { ids: [] as string[], targetPaise: 0, valid: false };
    return { mode, totals: emptyTotals(), shares: [] as DraftShare[], hostId, splitLines, serviceChargeBp, serviceChargeWaived: waived, customAmounts, custom };
  }
  const { totals, shares, custom } = splitBill({
    people: people.map((p) => ({ id: p.id, removed: !!p.removedAt, frozenAmountPaise: frozenAmount.get(p.id) ?? null })),
    hostId,
    lines: splitLines,
    billDiscountPaise,
    serviceChargeBp: waived ? 0 : serviceChargeBp,
    mode,
    customAmounts: mode === "custom" ? customAmounts : null,
  });
  // A removed person with nothing ordered and nothing paid has no place on the bill
  const paidBy = new Map(inputs.shares.map((sh) => [sh.participantId, sh.paidPaise]));
  const removed = new Set(people.filter((p) => p.removedAt).map((p) => p.id));
  const kept = shares.filter((sh) => !removed.has(sh.participantId) || sh.amountPaise > 0 || (paidBy.get(sh.participantId) ?? 0) > 0);
  return { mode, totals, shares: kept as DraftShare[], hostId, splitLines, serviceChargeBp, serviceChargeWaived: waived, customAmounts, custom };
}

function emptyTotals(): BillTotals {
  return { subtotalPaise: 0, discountPaise: 0, serviceChargePaise: 0, taxPaise: 0, taxBreakup: {}, exactPaise: 0, roundOffPaise: 0, totalPaise: 0 };
}

export type CreatedRefund = { refundId: string; paymentId: string; shareId: string; amountPaise: number };

/**
 * Writes the current bill and shares, keeping what each person has already paid. If a change
 * (a void, a cancelled item) leaves a share paid beyond what it now owes, the difference becomes
 * an explicit pending refund against the payment that paid it; money is never silently lost.
 * Call inside a transaction that holds the session lock.
 */
export async function syncBill(
  tx: Tx,
  scope: BillScope,
  now: Date,
  opts: { mode?: SplitMode; customAmounts?: Record<string, number> | null; serviceChargeWaived?: boolean; requestedAt?: Date } = {},
) {
  const inputs = await loadBillInputs(tx, scope);
  let draft = computeDraft(inputs, opts);
  let bookingCreditPaise = inputs.bill?.bookingCreditPaise ?? 0;
  let bookingCreditReservationId = inputs.bill?.bookingCreditReservationId ?? null;
  if (inputs.session.reservationId && !bookingCreditPaise) {
    const [reservation] = await tx.select({ id: s.reservations.id, creditPaidPaise: s.reservations.creditPaidPaise, creditAppliedPaise: s.reservations.creditAppliedPaise })
      .from(s.reservations).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, inputs.session.reservationId)));
    const available = Math.max(0, (reservation?.creditPaidPaise ?? 0) - (reservation?.creditAppliedPaise ?? 0));
    if (available > 0) {
      const applied = Math.min(available, draft.totals.totalPaise);
      let remain = applied;
      const shares = draft.shares.map((share) => { const take = Math.min(remain, share.amountPaise); remain -= take; return { ...share, amountPaise: share.amountPaise - take }; });
      draft = { ...draft, shares, totals: { ...draft.totals, discountPaise: draft.totals.discountPaise + applied, totalPaise: draft.totals.totalPaise - applied, exactPaise: draft.totals.exactPaise - applied } };
      bookingCreditPaise = applied;
      bookingCreditReservationId = reservation?.id ?? null;
      await tx.update(s.reservations).set({ creditAppliedPaise: (reservation?.creditAppliedPaise ?? 0) + applied, creditStatus: "applied", updatedAt: now }).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, reservation!.id)));
    }
  }
  const t = draft.totals;

  const billId = inputs.bill?.id ?? uuidv7();
  const values = {
    splitMode: draft.mode,
    subtotalPaise: t.subtotalPaise,
    discountPaise: t.discountPaise,
    taxPaise: t.taxPaise,
    serviceChargePaise: t.serviceChargePaise,
    roundOffPaise: t.roundOffPaise,
    totalPaise: t.totalPaise,
    bookingCreditPaise,
    bookingCreditReservationId,
    taxBreakup: t.taxBreakup,
    serviceChargeWaived: draft.serviceChargeWaived,
    customAmounts: draft.customAmounts,
    ...(opts.requestedAt ? { requestedAt: opts.requestedAt } : {}),
  };
  if (inputs.bill) {
    await tx.update(s.bills).set(values).where(and(eq(s.bills.tenantId, scope.tenantId), eq(s.bills.id, billId)));
  } else {
    await tx.insert(s.bills).values({
      id: billId,
      tenantId: scope.tenantId,
      outletId: scope.outletId,
      sessionId: scope.sessionId,
      serviceChargeBp: draft.serviceChargeBp,
      createdAt: now,
      ...values,
    });
  }

  const existing = new Map(inputs.shares.map((sh) => [sh.participantId, sh]));
  const target = new Map(draft.shares.map((d) => [d.participantId, d.amountPaise]));
  // People who dropped off the bill keep their row at zero, so nothing they paid is forgotten
  for (const sh of inputs.shares) if (sh.participantId && !target.has(sh.participantId)) target.set(sh.participantId, 0);

  const refunds: CreatedRefund[] = [];
  const fresh = [];
  for (const [participantId, amountPaise] of target) {
    const prev = existing.get(participantId);
    if (!prev) {
      fresh.push({ tenantId: scope.tenantId, billId, participantId, amountPaise, status: amountPaise <= 0 ? ("paid" as const) : ("unpaid" as const), createdAt: now });
      continue;
    }
    if (prev.frozenAt) continue;
    let paidPaise = prev.paidPaise;
    if (paidPaise > amountPaise) {
      const refund = await refundOverpayment(tx, scope, inputs, prev.id, paidPaise - amountPaise, now);
      if (refund) {
        refunds.push(refund);
        paidPaise = amountPaise;
      }
    }
    const status = paidPaise >= amountPaise ? ("paid" as const) : ("unpaid" as const);
    if (prev.amountPaise !== amountPaise || prev.status !== status || prev.paidPaise !== paidPaise) {
      await tx
        .update(s.billShares)
        .set({ amountPaise, status, paidPaise })
        .where(and(eq(s.billShares.tenantId, scope.tenantId), eq(s.billShares.id, prev.id)));
    }
  }
  if (fresh.length) await tx.insert(s.billShares).values(fresh.map((f) => ({ ...f, tenantId: scope.tenantId })));

  return { billId, draft, refunds };
}

/** The money goes back through the latest successful payment that paid this share */
async function refundOverpayment(tx: Tx, scope: BillScope, inputs: BillInputs, shareId: string, amountPaise: number, now: Date): Promise<CreatedRefund | null> {
  const paid = inputs.payments
    .filter((p) => p.status === "success" && p.allocations.some((a) => a.shareId === shareId))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (!paid) return null;
  const refundId = uuidv7();
  await tx.insert(s.refunds).values({
    id: refundId,
    tenantId: scope.tenantId,
    paymentId: paid.id,
    shareId,
    amountPaise,
    reason: "The bill went down after this share was paid",
    status: "pending",
    createdAt: now,
  });
  return { refundId, paymentId: paid.id, shareId, amountPaise };
}

/** Locks the session row; every bill mutation starts here */
export async function lockSession(tx: Tx, scope: BillScope) {
  const [session] = await tx
    .select()
    .from(s.tableSessions)
    .where(and(eq(s.tableSessions.tenantId, scope.tenantId), eq(s.tableSessions.outletId, scope.outletId), eq(s.tableSessions.id, scope.sessionId)))
    .for("update");
  if (!session) throw new AppError("not_found", "This table session was not found.");
  return session;
}

export async function lockShares(tx: Tx, tenantId: string, shareIds: string[]) {
  if (shareIds.length === 0) return [];
  return tx
    .select()
    .from(s.billShares)
    .where(and(eq(s.billShares.tenantId, tenantId), inArray(s.billShares.id, shareIds)))
    .for("update");
}
