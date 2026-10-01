import "server-only";
import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { billTotals, splitByItems, splitEqually, type BillTotals, type PersonShare, type SplitLine } from "@/domain/split";
import type { Runner, Tx } from "../db-types";
import { AppError } from "../errors";

// The table bill (PS 3.6, 6.1). Everything is computed from order lines on the server; the
// stored bill and shares are a cache of that result plus what has been paid against it.

export type BillScope = { tenantId: string; outletId: string; sessionId: string };
export type SplitMode = "my_items" | "equal" | "custom";

const DEAD_LINES: ("cancelled" | "voided")[] = ["cancelled", "voided"];

/** Everything the bill depends on, in four queries */
export async function loadBillInputs(run: Runner, scope: BillScope) {
  const [[session], people, lines, [bill]] = await Promise.all([
    run
      .select()
      .from(s.tableSessions)
      .where(
        and(
          eq(s.tableSessions.tenantId, scope.tenantId),
          eq(s.tableSessions.outletId, scope.outletId),
          eq(s.tableSessions.id, scope.sessionId),
        ),
      ),
    run
      .select({ id: s.participants.id, displayName: s.participants.displayName })
      .from(s.participants)
      .where(
        and(
          eq(s.participants.tenantId, scope.tenantId),
          eq(s.participants.sessionId, scope.sessionId),
          isNull(s.participants.removedAt),
        ),
      )
      .orderBy(s.participants.id),
    run
      .select({
        id: s.orderLines.id,
        participantId: s.orderLines.participantId,
        nameEn: s.orderLines.nameEn,
        unitPricePaise: s.orderLines.unitPricePaise,
        qty: s.orderLines.qty,
        taxRateBp: s.orderLines.taxRateBp,
        sharedWith: s.orderLines.sharedWith,
      })
      .from(s.orderLines)
      .where(
        and(
          eq(s.orderLines.tenantId, scope.tenantId),
          eq(s.orderLines.sessionId, scope.sessionId),
          notInArray(s.orderLines.status, DEAD_LINES),
        ),
      )
      .orderBy(s.orderLines.id),
    run
      .select()
      .from(s.bills)
      .where(and(eq(s.bills.tenantId, scope.tenantId), eq(s.bills.sessionId, scope.sessionId))),
  ]);
  if (!session) throw new AppError("not_found", "This table session was not found.");

  const [shares, discounts] = bill
    ? await Promise.all([
        run
          .select()
          .from(s.billShares)
          .where(and(eq(s.billShares.tenantId, scope.tenantId), eq(s.billShares.billId, bill.id))),
        run
          .select({ orderLineId: s.discounts.orderLineId, amountPaise: s.discounts.amountPaise })
          .from(s.discounts)
          .where(and(eq(s.discounts.tenantId, scope.tenantId), eq(s.discounts.billId, bill.id))),
      ])
    : [[], []];

  return { session, people, lines, bill: bill ?? null, shares, discounts };
}

export type BillInputs = Awaited<ReturnType<typeof loadBillInputs>>;

export type DraftShare = { participantId: string; amountPaise: number; detail: PersonShare | null };

/** Pure: turns inputs into totals and one amount per person for the chosen split mode */
export function computeDraft(inputs: BillInputs, opts: { mode?: SplitMode; customAmounts?: Map<string, number> } = {}) {
  const { session, people, lines, discounts } = inputs;
  const ids = people.map((p) => p.id);
  const hostId = session.hostParticipantId && ids.includes(session.hostParticipantId) ? session.hostParticipantId : ids[0];

  const itemDiscount = new Map<string, number>();
  let billDiscountPaise = 0;
  for (const d of discounts) {
    if (d.orderLineId) itemDiscount.set(d.orderLineId, (itemDiscount.get(d.orderLineId) ?? 0) + d.amountPaise);
    else billDiscountPaise += d.amountPaise;
  }

  const present = new Set(ids);
  const splitLines: SplitLine[] = lines.map((l) => {
    const sharers = (l.sharedWith ?? []).filter((id) => present.has(id));
    return {
      id: l.id,
      ownerId: l.participantId && present.has(l.participantId) ? l.participantId : hostId,
      amountPaise: Math.max(0, l.unitPricePaise * l.qty - (itemDiscount.get(l.id) ?? 0)),
      taxRateBp: l.taxRateBp,
      sharedWith: sharers.length > 1 ? sharers : null,
    };
  });

  let mode: SplitMode = opts.mode ?? inputs.bill?.splitMode ?? "my_items";
  if (ids.length === 0) {
    return { mode, totals: billTotals({ lines: splitLines, billDiscountPaise }), shares: [] as DraftShare[], hostId, splitLines };
  }

  const byItems = splitByItems({ participantIds: ids, hostId, lines: splitLines, billDiscountPaise });
  const totals: BillTotals = byItems.totals;
  let shares: DraftShare[];

  if (mode === "custom") {
    // Custom amounts only stand while they still add up to the bill; a new round resets them
    const stored = opts.customAmounts ?? new Map(inputs.shares.map((sh) => [sh.participantId, sh.amountPaise]));
    const custom = ids.map((id) => ({ participantId: id, amountPaise: stored.get(id) ?? 0 }));
    if (custom.reduce((sum, c) => sum + c.amountPaise, 0) === totals.totalPaise) {
      shares = custom.map((c) => ({ ...c, detail: null }));
    } else {
      mode = "my_items";
      shares = byItems.shares.map((d) => ({ participantId: d.participantId, amountPaise: d.amountPaise, detail: d }));
    }
  } else if (mode === "equal") {
    shares = splitEqually(totals.totalPaise, ids).map((e) => ({ ...e, detail: null }));
  } else {
    shares = byItems.shares.map((d) => ({ participantId: d.participantId, amountPaise: d.amountPaise, detail: d }));
  }
  return { mode, totals, shares, hostId, splitLines };
}

/**
 * Writes the current bill and shares, keeping what each person has already paid.
 * Call inside a transaction that holds the session lock.
 */
export async function syncBill(
  tx: Tx,
  scope: BillScope,
  now: Date,
  opts: { mode?: SplitMode; customAmounts?: Map<string, number>; requestedAt?: Date } = {},
) {
  const inputs = await loadBillInputs(tx, scope);
  const draft = computeDraft(inputs, { mode: opts.mode, customAmounts: opts.customAmounts });
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
    taxBreakup: t.taxBreakup,
    ...(opts.requestedAt ? { requestedAt: opts.requestedAt } : {}),
  };
  if (inputs.bill) {
    await tx
      .update(s.bills)
      .set(values)
      .where(and(eq(s.bills.tenantId, scope.tenantId), eq(s.bills.id, billId)));
  } else {
    await tx.insert(s.bills).values({
      id: billId,
      tenantId: scope.tenantId,
      outletId: scope.outletId,
      sessionId: scope.sessionId,
      createdAt: now,
      ...values,
    });
  }

  const existing = new Map(inputs.shares.map((sh) => [sh.participantId, sh]));

  const fresh = [];
  for (const d of draft.shares) {
    const prev = existing.get(d.participantId);
    const paid = prev?.paidPaise ?? 0;
    const status = paid >= d.amountPaise ? ("paid" as const) : ("unpaid" as const);
    if (prev) {
      if (prev.amountPaise !== d.amountPaise || prev.status !== status) {
        await tx
          .update(s.billShares)
          .set({ amountPaise: d.amountPaise, status })
          .where(and(eq(s.billShares.tenantId, scope.tenantId), eq(s.billShares.id, prev.id)));
      }
    } else {
      fresh.push({ tenantId: scope.tenantId, billId, participantId: d.participantId, amountPaise: d.amountPaise, status, createdAt: now });
    }
  }
  if (fresh.length) await tx.insert(s.billShares).values(fresh.map((f) => ({ ...f, tenantId: scope.tenantId })));

  return { billId, draft };
}

/** Bill and split screen (G8), read-only and computed live */
export async function getBillView(scope: BillScope & { participantId: string }) {
  const inputs = await loadBillInputs(db, scope);
  const draft = computeDraft(inputs);
  const paid = new Map(inputs.shares.map((sh) => [sh.participantId, sh]));
  const names = new Map(inputs.people.map((p) => [p.id, p.displayName]));
  const anyPaid = inputs.shares.some((sh) => sh.paidPaise > 0);

  const people = draft.shares.map((d) => {
    const paidPaise = paid.get(d.participantId)?.paidPaise ?? 0;
    return {
      participantId: d.participantId,
      name: names.get(d.participantId) ?? "Guest",
      isMe: d.participantId === scope.participantId,
      isHost: d.participantId === draft.hostId,
      amountPaise: d.amountPaise,
      paidPaise,
      duePaise: Math.max(0, d.amountPaise - paidPaise),
      status: paidPaise >= d.amountPaise ? ("paid" as const) : ("unpaid" as const),
      paidBy: names.get(paid.get(d.participantId)?.paidByParticipantId ?? "") ?? null,
    };
  });

  const mine = draft.shares.find((d) => d.participantId === scope.participantId);
  const lineName = new Map(inputs.lines.map((l) => [l.id, l.nameEn]));
  const myLines = draft.splitLines.filter(
    (l) => l.ownerId === scope.participantId || l.sharedWith?.includes(scope.participantId),
  );

  return {
    status: inputs.bill?.status ?? "open",
    isRequested: inputs.session.status === "bill_requested",
    mode: draft.mode,
    canChangeMode: !anyPaid && scope.participantId === draft.hostId,
    totals: draft.totals,
    people,
    mine: mine
      ? {
          amountPaise: mine.amountPaise,
          duePaise: people.find((p) => p.isMe)!.duePaise,
          detail: mine.detail,
          ownItems: myLines.filter((l) => !l.sharedWith).map((l) => lineName.get(l.id)!),
          sharedItems: myLines.filter((l) => l.sharedWith).map((l) => lineName.get(l.id)!),
        }
      : null,
  };
}

/** Locks the session row; every bill mutation starts here */
export async function lockSession(tx: Tx, scope: BillScope) {
  const [session] = await tx
    .select()
    .from(s.tableSessions)
    .where(
      and(
        eq(s.tableSessions.tenantId, scope.tenantId),
        eq(s.tableSessions.outletId, scope.outletId),
        eq(s.tableSessions.id, scope.sessionId),
      ),
    )
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
