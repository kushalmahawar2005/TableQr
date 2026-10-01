import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { isPlaceholderName } from "@/domain/guest-name";
import { ATTEMPT_WINDOW_MS, computeDraft, isBillLocked, loadBillInputs } from "../billing/bill";
import { gatewayFor } from "../payments/gateway";
import { guestContextForDevice } from "./menu-screen";

// Everything G8 Bill shows, in one server call, computed live from order lines. Before the bill
// is requested it is a read-only preview; after, the split, tip and pay controls open.

export const DEFAULT_TIP_PRESETS_BP = [500, 1000];

export type PaymentView = "pending" | "success" | "failed" | "cancelled" | "unknown";

export async function getBillScreen(outletCode: string, shortCode: string, deviceId: string | null, now = new Date()) {
  const { t, open, ctx } = await guestContextForDevice(outletCode, shortCode, deviceId);
  const scope = { tenantId: ctx.tenantId, outletId: ctx.outletId, sessionId: ctx.sessionId };
  const inputs = await loadBillInputs(db, scope);
  const draft = computeDraft(inputs);
  const session = open.session;
  const requested = session.status === "bill_requested";
  const locked = isBillLocked(inputs, now.getTime());

  const nameOf = new Map(inputs.people.map((p) => [p.id, isPlaceholderName(p.displayName) ? null : p.displayName]));
  const person = new Map(inputs.people.map((p) => [p.id, p]));
  const shareOf = new Map(inputs.shares.map((sh) => [sh.participantId, sh]));
  const liveShares = new Set(
    inputs.payments
      .filter((p) => p.status === "pending" || (p.status === "initiated" && now.getTime() - p.createdAt.getTime() < ATTEMPT_WINDOW_MS))
      .flatMap((p) => p.allocations.map((a) => a.shareId)),
  );
  const hostId = session.hostParticipantId;
  const me = ctx.participantId;
  const imHost = hostId === me && !person.get(me)?.paidOutAt;

  const people = draft.shares.map((d) => {
    const stored = shareOf.get(d.participantId);
    const paidPaise = stored?.paidPaise ?? 0;
    const duePaise = Math.max(0, d.amountPaise - paidPaise);
    const p = person.get(d.participantId)!;
    const status = duePaise === 0 ? ("paid" as const) : stored && liveShares.has(stored.id) ? ("paying" as const) : ("unpaid" as const);
    return {
      id: d.participantId,
      name: nameOf.get(d.participantId) ?? null,
      isMe: d.participantId === me,
      isHost: d.participantId === hostId,
      removed: !!p.removedAt,
      paidAndLeft: !!p.paidOutAt,
      amountPaise: d.amountPaise,
      paidPaise,
      duePaise,
      status,
      basis: d.basis,
      paidBy: stored?.paidByParticipantId && stored.paidByParticipantId !== d.participantId ? (nameOf.get(stored.paidByParticipantId) ?? null) : null,
      paidByMe: stored?.paidByParticipantId === me && d.participantId !== me,
    };
  });

  const mine = draft.shares.find((d) => d.participantId === me);
  const myRow = people.find((p) => p.isMe);
  const myLines = draft.splitLines
    .map((l) => {
      const owners = l.sharedWith?.length ? l.sharedWith : [l.ownerId];
      return { id: l.id, owners };
    })
    .filter((l) => l.owners.includes(me));
  const lineInfo = new Map(inputs.lines.map((l) => [l.id, l]));
  const named = (ids: string[]) => ids.map((id) => ({ en: lineInfo.get(id)!.nameEn, hi: lineInfo.get(id)!.nameHi }));

  const frozen = new Set(inputs.shares.filter((sh) => sh.frozenAt).map((sh) => sh.participantId));
  const eligible = inputs.people.filter((p) => !p.removedAt && !p.paidOutAt).map((p) => p.id);
  const lines = inputs.lines.map((l) => {
    const sharers = (l.sharedWith ?? []).filter((id) => person.has(id));
    const owners = sharers.length > 1 ? sharers : l.participantId ? [l.participantId] : [];
    return {
      id: l.id,
      nameEn: l.nameEn,
      nameHi: l.nameHi,
      qty: l.qty,
      amountPaise: l.unitPricePaise * l.qty,
      assignees: owners,
      settled: owners.some((id) => frozen.has(id)),
    };
  });

  // Refunds that are really pending for money this guest paid, never invented
  const myPaymentIds = inputs.payments.filter((p) => p.payerParticipantId === me).map((p) => p.id);
  const refunds = myPaymentIds.length
    ? await db
        .select({ amountPaise: s.refunds.amountPaise })
        .from(s.refunds)
        .where(and(eq(s.refunds.tenantId, ctx.tenantId), inArray(s.refunds.paymentId, myPaymentIds), eq(s.refunds.status, "pending")))
    : [];
  const [latest] = await db
    .select({ id: s.payments.id, status: s.payments.status, failureReason: s.payments.failureReason, amountPaise: s.payments.amountPaise, tipPaise: s.payments.tipPaise, createdAt: s.payments.createdAt })
    .from(s.payments)
    .where(and(eq(s.payments.tenantId, ctx.tenantId), eq(s.payments.billId, inputs.bill?.id ?? ""), eq(s.payments.payerParticipantId, me)))
    .orderBy(desc(s.payments.createdAt))
    .limit(1);
  const [counter] = await db
    .select({ createdAt: s.serviceRequests.createdAt, status: s.serviceRequests.status })
    .from(s.serviceRequests)
    .where(and(eq(s.serviceRequests.tenantId, ctx.tenantId), eq(s.serviceRequests.sessionId, ctx.sessionId), eq(s.serviceRequests.kind, "pay_at_counter")))
    .orderBy(desc(s.serviceRequests.createdAt))
    .limit(1);
  const host = hostId ? person.get(hostId) : undefined;

  return {
    renderedAt: now.getTime(),
    outlet: { code: t.outlet.code, name: t.outlet.name, logoUrl: t.logoUrl, accentColor: t.outlet.accentColor },
    table: { code: t.table.code },
    session: {
      key: session.id,
      status: session.status,
      requested,
      isHost: imHost,
      hostName: host ? (nameOf.get(host.id) ?? null) : null,
      hostIsMe: hostId === me,
      people: inputs.people.filter((p) => !p.removedAt && !p.paidOutAt).length,
    },
    bill: {
      mode: draft.mode,
      requestedAt: requested ? (inputs.bill?.requestedAt?.getTime() ?? null) : null,
      rounds: new Set(inputs.lines.map((l) => l.orderId)).size,
      itemCount: inputs.lines.reduce((n, l) => n + l.qty, 0),
      locked,
      canEdit: imHost && requested && !locked,
      reopened: !!inputs.bill?.reopenedAt,
      totals: {
        subtotalPaise: draft.totals.subtotalPaise,
        discountPaise: draft.totals.discountPaise,
        serviceChargePaise: draft.totals.serviceChargePaise,
        serviceChargeBp: draft.serviceChargeBp,
        serviceChargeWaived: draft.serviceChargeWaived,
        taxPaise: draft.totals.taxPaise,
        taxBreakup: draft.totals.taxBreakup,
        roundOffPaise: draft.totals.roundOffPaise,
        totalPaise: draft.totals.totalPaise,
      },
      paidCount: people.filter((p) => p.status === "paid").length,
      // Custom split: who the host enters amounts for, what they must add up to, and what is saved
      custom: {
        ids: draft.custom.ids,
        targetPaise: draft.custom.targetPaise,
        amounts: draft.customAmounts ?? null,
        valid: draft.custom.valid,
      },
    },
    people,
    mine:
      mine && myRow
        ? {
            amountPaise: mine.amountPaise,
            paidPaise: myRow.paidPaise,
            duePaise: myRow.duePaise,
            basis: mine.basis,
            detail: mine.detail
              ? {
                  ownItemsPaise: mine.detail.ownItemsPaise,
                  sharedItemsPaise: mine.detail.sharedItemsPaise,
                  subtotalPaise: mine.detail.subtotalPaise,
                  discountPaise: mine.detail.discountPaise,
                  serviceChargePaise: mine.detail.serviceChargePaise,
                  taxPaise: mine.detail.taxPaise,
                  roundOffPaise: mine.detail.roundOffPaise,
                }
              : null,
            ownItems: named(myLines.filter((l) => l.owners.length === 1).map((l) => l.id)),
            sharedItems: named(myLines.filter((l) => l.owners.length > 1).map((l) => l.id)),
            equalBetween: mine.basis === "equal" ? draft.shares.filter((d) => d.basis === "equal").length : 0,
          }
        : null,
    lines,
    eligibleIds: eligible,
    tipPresetsBp: inputs.outlet.tipPresetsBp?.length ? inputs.outlet.tipPresetsBp : DEFAULT_TIP_PRESETS_BP,
    onlinePayment: !!gatewayFor(),
    latestPayment: latest
      ? { id: latest.id, status: viewOf(latest.status, latest.failureReason), amountPaise: latest.amountPaise, tipPaise: latest.tipPaise }
      : null,
    refundPendingPaise: refunds.reduce((n, r) => n + r.amountPaise, 0),
    payAtCounter: counter ? { requestedAt: counter.createdAt.getTime(), done: counter.status === "done" } : null,
  };
}

export const viewOf = (status: string, reason: string | null): PaymentView =>
  status === "success" || status === "refunded" ? "success" : status === "failed" ? (reason === "Cancelled before paying" ? "cancelled" : "failed") : "pending";

export type BillScreenData = Awaited<ReturnType<typeof getBillScreen>>;
