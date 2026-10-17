import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { isPlaceholderName } from "@/domain/guest-name";
import type { InvoicePayment } from "../billing/payments";
import { AppError } from "../errors";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import { configuredReceiptChannels } from "../receipts/channels";
import { findTableByQr } from "./table";
import { tenantFeatures } from "../plan";

// G9 Paid, receipt and next visit (PS 3.8). The same phone that sat at the table can come back to
// this for 24 hours after the table is settled, read-only: success, progress, the receipt, one
// rating, the review link and booking. Access is the phone's own device cookie (httpOnly) matched
// to its participant row; no ids or tokens appear in any URL, so nothing here can be guessed.

export const AFTER_VISIT_HOURS = 24;

export type Visit = {
  tenantId: string;
  outletId: string;
  sessionId: string;
  participantId: string;
  tableId: string;
  state: "open" | "closed";
  closedAt: Date | null;
};

/** This phone's latest visit at this table, if it is still live or settled within 24 hours */
export async function findVisit(outletCode: string, shortCode: string, deviceId: string | null, now = new Date()): Promise<Visit | { expired: true } | null> {
  if (!deviceId) return null;
  const t = await findTableByQr(db, outletCode, shortCode);
  const [row] = await db
    .select({ participantId: s.participants.id, session: s.tableSessions })
    .from(s.participants)
    .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.participants.tenantId), eq(s.tableSessions.id, s.participants.sessionId)))
    // Any table the visit sat at, so a party moved or combined by the host (S1) still finds it
    .innerJoin(s.sessionTables, and(eq(s.sessionTables.tenantId, s.participants.tenantId), eq(s.sessionTables.sessionId, s.participants.sessionId)))
    .where(
      and(
        eq(s.participants.tenantId, t.outlet.tenantId),
        eq(s.participants.deviceId, deviceId),
        isNull(s.participants.removedAt),
        eq(s.sessionTables.tableId, t.table.id),
      ),
    )
    .orderBy(desc(s.tableSessions.openedAt))
    .limit(1);
  if (!row) return null;
  const closed = row.session.status === "closed";
  if (closed && (!row.session.closedAt || now.getTime() - row.session.closedAt.getTime() > AFTER_VISIT_HOURS * 3600_000)) return { expired: true };
  return {
    tenantId: t.outlet.tenantId,
    outletId: t.outlet.id,
    sessionId: row.session.id,
    participantId: row.participantId,
    tableId: row.session.tableId,
    state: closed ? "closed" : "open",
    closedAt: row.session.closedAt,
  };
}

export async function requireVisit(outletCode: string, shortCode: string, deviceId: string | null, now = new Date()): Promise<Visit> {
  const v = await findVisit(outletCode, shortCode, deviceId, now);
  if (!v) throw new AppError("session_expired", "Scan the table QR to continue.");
  if ("expired" in v) throw new AppError("session_expired", "This visit has ended.", { reason: "expired" });
  return v;
}

/** What G9 shows. Read-only; nothing here can change the bill or the table. */
export async function getAfterVisit(outletCode: string, shortCode: string, deviceId: string | null, now = new Date()) {
  const t = await findTableByQr(db, outletCode, shortCode);
  const outlet = { code: t.outlet.code, name: t.outlet.name, logoUrl: t.logoUrl, accentColor: t.outlet.accentColor };
  const table = { code: t.table.code };
  const v = await findVisit(outletCode, shortCode, deviceId, now);
  if (!v) return null;
  if ("expired" in v) return { expired: true as const, outlet, table, renderedAt: now.getTime() };

  const [[bill], people, [outletRow], [feedback]] = await Promise.all([
    db.select().from(s.bills).where(and(eq(s.bills.tenantId, v.tenantId), eq(s.bills.sessionId, v.sessionId))),
    db
      .select({ id: s.participants.id, name: s.participants.displayName, removedAt: s.participants.removedAt })
      .from(s.participants)
      .where(and(eq(s.participants.tenantId, v.tenantId), eq(s.participants.sessionId, v.sessionId))),
    db.select({ reviewUrl: s.outlets.reviewUrl, gstin: s.outlets.gstin }).from(s.outlets).where(and(eq(s.outlets.tenantId, v.tenantId), eq(s.outlets.id, v.outletId))),
    db
      .select({ rating: s.feedback.rating })
      .from(s.feedback)
      .where(and(eq(s.feedback.tenantId, v.tenantId), eq(s.feedback.sessionId, v.sessionId), eq(s.feedback.participantId, v.participantId))),
  ]);
  const nameOf = new Map(people.map((p) => [p.id, isPlaceholderName(p.name) ? null : p.name]));
  const [shares, payments] = bill
    ? await Promise.all([
        db.select().from(s.billShares).where(and(eq(s.billShares.tenantId, v.tenantId), eq(s.billShares.billId, bill.id))),
        db
          .select()
          .from(s.payments)
          .where(and(eq(s.payments.tenantId, v.tenantId), eq(s.payments.billId, bill.id), eq(s.payments.payerParticipantId, v.participantId), eq(s.payments.status, "success"))),
      ])
    : [[], []];
  const owed = shares.filter((sh) => sh.amountPaise > 0);
  const owner = new Map(shares.map((sh) => [sh.id, sh.participantId]));
  const covered = [...new Set(payments.flatMap((p) => p.allocations.map((a) => owner.get(a.shareId))).filter((id): id is string => !!id && id !== v.participantId))];
  const mine = shares.find((sh) => sh.participantId === v.participantId);
  const channels = configuredReceiptChannels();

  return {
    expired: false as const,
    renderedAt: now.getTime(),
    outlet,
    table,
    state: v.state,
    closedAt: v.closedAt?.getTime() ?? null,
    timezone: t.outlet.timezone,
    me: { name: nameOf.get(v.participantId) ?? null },
    paidPaise: payments.reduce((n, p) => n + p.amountPaise, 0),
    tipPaise: payments.reduce((n, p) => n + p.tipPaise, 0),
    mySettled: !!mine && mine.paidPaise >= mine.amountPaise,
    paidFor: covered.map((id) => nameOf.get(id) ?? null),
    progress: {
      paid: owed.filter((sh) => sh.status === "paid").length,
      total: owed.length,
      people: owed.map((sh) => ({ name: sh.participantId ? (nameOf.get(sh.participantId) ?? null) : null, isMe: sh.participantId === v.participantId, paid: sh.status === "paid" })),
    },
    waitingFor: owed.filter((sh) => sh.status === "unpaid" && sh.participantId !== v.participantId).map((sh) => (sh.participantId ? (nameOf.get(sh.participantId) ?? null) : null)),
    allSettled: v.state === "closed",
    receipt: { available: payments.length > 0 || v.state === "closed", kind: v.state === "closed" ? (outletRow?.gstin ? "tax_invoice" : "receipt") : "payment_receipt" },
    channels,
    rating: (feedback?.rating ?? null) as number | null,
    reviewUrl: outletRow?.reviewUrl ?? null,
    // "Book your next visit" only when the restaurant's plan has reservations
    bookingUrl: (await tenantFeatures(v.tenantId)).reservations ? `/r/${encodeURIComponent(outlet.code)}/book` : null,
  };
}

export type AfterVisitData = NonNullable<Awaited<ReturnType<typeof getAfterVisit>>>;

/** The receipt this phone may see: the table invoice once settled, and its own payments */
export async function getReceipt(outletCode: string, shortCode: string, deviceId: string | null, now = new Date()) {
  const v = await requireVisit(outletCode, shortCode, deviceId, now);
  const t = await findTableByQr(db, outletCode, shortCode);
  const [bill] = await db.select().from(s.bills).where(and(eq(s.bills.tenantId, v.tenantId), eq(s.bills.sessionId, v.sessionId)));
  if (!bill) throw new AppError("not_found", "There is no bill yet.");
  const [[invoice], payments, people, shares, [outlet]] = await Promise.all([
    db.select().from(s.invoices).where(and(eq(s.invoices.tenantId, v.tenantId), eq(s.invoices.billId, bill.id), isNull(s.invoices.shareId))),
    db
      .select()
      .from(s.payments)
      .where(and(eq(s.payments.tenantId, v.tenantId), eq(s.payments.billId, bill.id), eq(s.payments.payerParticipantId, v.participantId), inArray(s.payments.status, ["success", "refunded"])))
      .orderBy(s.payments.createdAt),
    db.select({ id: s.participants.id, name: s.participants.displayName }).from(s.participants).where(and(eq(s.participants.tenantId, v.tenantId), eq(s.participants.sessionId, v.sessionId))),
    db.select({ id: s.billShares.id, participantId: s.billShares.participantId }).from(s.billShares).where(and(eq(s.billShares.tenantId, v.tenantId), eq(s.billShares.billId, bill.id))),
    db.select().from(s.outlets).where(and(eq(s.outlets.tenantId, v.tenantId), eq(s.outlets.id, v.outletId))),
  ]);
  const nameOf = new Map(people.map((p) => [p.id, isPlaceholderName(p.name) ? null : p.name]));
  const owner = new Map(shares.map((sh) => [sh.id, sh.participantId]));
  const snapshot = invoice?.snapshot as
    | { docType: "tax_invoice" | "receipt"; lines: { nameEn: string; qty: number; amountPaise: number; taxRateBp: number }[]; payments: InvoicePayment[]; [k: string]: unknown }
    | undefined;
  return {
    outlet: { code: t.outlet.code, name: outlet.name, address: outlet.address, city: outlet.city, gstin: outlet.gstin, fssai: outlet.fssai, accentColor: outlet.accentColor },
    table: { code: t.table.code },
    invoice: invoice
      ? {
          number: invoice.number,
          issuedAt: invoice.issuedAt.getTime(),
          // Labelled by what the restaurant can legally issue: no GSTIN, no "Tax invoice"
          docType: snapshot?.docType ?? (outlet.gstin ? "tax_invoice" : "receipt"),
          snapshot: snapshot!,
        }
      : null,
    myPayments: payments.map((p) => ({
      id: p.id,
      at: p.createdAt.getTime(),
      method: p.method,
      amountPaise: p.amountPaise,
      tipPaise: p.tipPaise,
      covered: p.allocations.map((a) => owner.get(a.shareId)).map((id) => ({ isMe: id === v.participantId, name: id ? (nameOf.get(id) ?? null) : null })),
    })),
    timezone: t.outlet.timezone,
  };
}

/**
 * One rating per person per visit (PS 3.8). Two stars or fewer flags the visit for the manager
 * at once; the guest is never told, and the review link is shown to everyone regardless.
 */
export async function submitFeedback(visit: Visit, rating: number, comment?: string, now = new Date()) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new AppError("invalid_state", "Choose 1 to 5 stars.");
  const needsRecovery = rating <= 2;
  let created = true;
  try {
    await db.insert(s.feedback).values({
      tenantId: visit.tenantId,
      outletId: visit.outletId,
      sessionId: visit.sessionId,
      participantId: visit.participantId,
      rating,
      comment: comment?.trim().slice(0, 500) || null,
      needsRecovery,
      createdAt: now,
    });
  } catch (err) {
    // One rating per person per visit: a second tap or another tab keeps the first
    if (!isDuplicate(err)) throw err;
    created = false;
  }
  if (created && needsRecovery) {
    const [row] = await db
      .select({ id: s.feedback.id })
      .from(s.feedback)
      .where(and(eq(s.feedback.tenantId, visit.tenantId), eq(s.feedback.sessionId, visit.sessionId), eq(s.feedback.participantId, visit.participantId)));
    await publish(visit, [{ topic: topics.tasks, type: "feedback.low_rating", data: { feedbackId: row.id, tableId: visit.tableId } }]);
  }
  const [stored] = await db
    .select({ rating: s.feedback.rating })
    .from(s.feedback)
    .where(and(eq(s.feedback.tenantId, visit.tenantId), eq(s.feedback.sessionId, visit.sessionId), eq(s.feedback.participantId, visit.participantId)));
  return { rating: stored.rating, alreadyRated: !created };
}

function isDuplicate(err: unknown): boolean {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") return true;
  }
  return false;
}
