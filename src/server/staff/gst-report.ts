import "server-only";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { gstRow, gstSummary, monthDays, type GstInvoice } from "@/domain/gst";
import { canSee } from "@/lib/staff-permissions";
import { AppError } from "../errors";
import type { StaffSession } from "./auth";
import { istToday } from "./day-close";

// GST report: a month of this outlet's invoices, summed the way GSTR-1 asks for them, with sheets
// for the CA or Tally. Every plan has it: filing GST is not optional. Months run on India time,
// the same day boundary as Day close.

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "roles">;
const IST = 330 * 60_000;
const DAY = 86_400_000;

export const thisMonth = (now = new Date()) => istToday(now).slice(0, 7);

type Snapshot = Partial<Pick<GstInvoice, "subtotalPaise" | "discountPaise" | "serviceChargePaise" | "taxPaise" | "roundOffPaise" | "totalPaise" | "taxBreakup" | "paymentModes">>;

export async function getGstReport(staff: Staff, month: string, now = new Date()) {
  if (!canSee(staff.roles, "reports")) throw new AppError("forbidden", "Your role cannot see the GST report.");
  const m = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : thisMonth(now);
  const [first, last] = monthDays(m);
  const from = new Date(Date.parse(`${first}T00:00:00Z`) - IST);
  const to = new Date(Date.parse(`${last}T00:00:00Z`) - IST + DAY);
  const scope = and(eq(s.invoices.tenantId, staff.tenantId), eq(s.invoices.outletId, staff.outletId));

  const [invoices, credits, [outlet]] = await Promise.all([
    db
      .select({ number: s.invoices.number, issuedAt: s.invoices.issuedAt, customerGstin: s.invoices.customerGstin, customerName: s.invoices.customerName, totalPaise: s.invoices.totalPaise, snapshot: s.invoices.snapshot })
      .from(s.invoices)
      .where(and(scope, gte(s.invoices.issuedAt, from), lt(s.invoices.issuedAt, to)))
      .orderBy(asc(s.invoices.issuedAt)),
    db
      .select({ number: s.creditNotes.number, amountPaise: s.creditNotes.amountPaise, reason: s.creditNotes.reason, createdAt: s.creditNotes.createdAt })
      .from(s.creditNotes)
      .where(and(eq(s.creditNotes.tenantId, staff.tenantId), eq(s.creditNotes.outletId, staff.outletId), gte(s.creditNotes.createdAt, from), lt(s.creditNotes.createdAt, to)))
      .orderBy(asc(s.creditNotes.createdAt)),
    db.select({ name: s.outlets.name, gstin: s.outlets.gstin }).from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId))),
  ]);

  const rows = invoices.map((i) => {
    const snap = (i.snapshot ?? {}) as Snapshot;
    return gstRow({
      number: i.number,
      issuedAt: i.issuedAt.getTime(),
      customerGstin: i.customerGstin,
      customerName: i.customerName,
      subtotalPaise: snap.subtotalPaise ?? 0,
      discountPaise: snap.discountPaise ?? 0,
      serviceChargePaise: snap.serviceChargePaise ?? 0,
      taxPaise: snap.taxPaise ?? 0,
      roundOffPaise: snap.roundOffPaise ?? 0,
      totalPaise: snap.totalPaise ?? i.totalPaise,
      taxBreakup: snap.taxBreakup ?? null,
      paymentModes: snap.paymentModes ?? null,
    });
  });

  return {
    month: m,
    current: thisMonth(now),
    outlet: { name: outlet?.name ?? "", gstin: outlet?.gstin ?? null },
    summary: gstSummary(rows, credits),
    rows,
    creditNotes: credits.map((c) => ({ ...c, createdAt: c.createdAt.getTime() })),
  };
}

export type GstReport = Awaited<ReturnType<typeof getGstReport>>;
