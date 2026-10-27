"use client";

import Link from "next/link";
import { BackToReports } from "../../_components/back-to-reports";
import { useRouter } from "next/navigation";
import { invoicesCsv, ratesCsv, shiftMonth } from "@/domain/gst";
import type { GstReport } from "@/server/staff/gst-report";

// GST report: one month of invoices summed for GSTR-1, with sheets to send the CA or load in Tally.

const rs = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthName = (m: string) => new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T12:00:00Z`));
const dateIst = (at: number) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" }).format(at).replaceAll("/", "-");
const rate = (bp: number) => (bp === 0 ? "No tax" : `${bp / 100}%`);
const btn = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink hover:border-ink/40 print:hidden";
const card = "rounded-2xl border border-line bg-surface";

function download(name: string, csv: string) {
  // The BOM makes Excel read ₹ and Hindi names correctly
  const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className={`${card} p-4`}>
      <p className="text-caption font-semibold text-muted">{label}</p>
      <p className="mt-1 font-display text-[24px] font-bold leading-8 tabular-nums">{value}</p>
      {note && <p className="text-caption text-muted">{note}</p>}
    </div>
  );
}

export function GstScreen({ report: r }: { report: GstReport }) {
  const router = useRouter();
  const s = r.summary;
  const go = (m: string) => router.push(`/console/reports/gst?month=${m}`);
  const file = (kind: string) => `GST-${kind}-${r.month}${r.outlet.gstin ? `-${r.outlet.gstin}` : ""}.csv`;

  return (
    <main id="gst-report-print" className="mx-auto w-full max-w-[1000px] px-4 py-5 text-ink sm:px-6 lg:px-8 lg:py-7 print:max-w-none print:p-0">
      <BackToReports />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-caption font-semibold text-muted">{r.outlet.name}{r.outlet.gstin ? ` · GSTIN ${r.outlet.gstin}` : ""}</p>
          <h1 className="mt-1 font-display text-title font-bold">GST report</h1>
          <p className="mt-1 text-body text-muted">{monthName(r.month)} <span className="hidden print:inline print:text-[7.5pt]">· CGST/SGST are split equally on intra-state sales; confirm with your CA before filing.</span></p>
          {!r.outlet.gstin && <p className="hidden print:block text-caption text-muted">GSTIN: Not configured for this outlet</p>}
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <button type="button" className={btn} onClick={() => go(shiftMonth(r.month, -1))} aria-label="Previous month">‹</button>
          <span className="min-w-36 text-center font-display text-body font-bold">{monthName(r.month)}</span>
          <button type="button" className={btn} disabled={r.month >= r.current} onClick={() => go(shiftMonth(r.month, 1))} aria-label="Next month">›</button>
        </div>
      </header>

      {!r.outlet.gstin && (
        <p className="mt-4 rounded-xl border border-warning/30 bg-[var(--state-held-soft)] px-4 py-3 text-body text-[var(--state-held-text)] print:hidden">
          This outlet has no GSTIN yet, so bills print as receipts. Add it in <Link href="/console/settings" className="font-semibold underline underline-offset-4">Settings</Link> to issue tax invoices.
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2 print:hidden">
        <button type="button" className={btn} disabled={!r.rows.length} onClick={() => download(file("invoices"), invoicesCsv(r.rows, dateIst))}>Download invoices (Excel)</button>
        <button type="button" className={btn} disabled={!r.rows.length} onClick={() => download(file("rate-summary"), ratesCsv(s.byRate))}>Download rate summary</button>
        <button type="button" className={btn} onClick={() => window.print()}>Print</button>
        <Link href="/console/reports/day-close" className={btn}>Day close</Link>
      </div>

      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 print:grid-cols-4" aria-label="Month totals">
        <Stat label="Taxable value" value={rs(s.taxablePaise)} note={`${s.invoices} ${s.invoices === 1 ? "invoice" : "invoices"}`} />
        <Stat label="CGST" value={rs(s.cgstPaise)} />
        <Stat label="SGST" value={rs(s.sgstPaise)} />
        <Stat label="Total with tax" value={rs(s.totalPaise)} note={s.roundOffPaise ? `Round off ${rs(s.roundOffPaise)}` : undefined} />
      </section>

      {s.invoices === 0 ? (
        <p className={`${card} mt-5 p-8 text-center text-body text-muted`}>No invoices in {monthName(r.month)}. Paid bills show up here.</p>
      ) : (
        <>
          <section className={`${card} mt-5 overflow-hidden`} aria-label="Tax by rate">
            <h2 className="px-5 pt-5 font-display text-section font-bold">Tax by rate</h2>
            <p className="px-5 text-caption text-muted">Sales to customers without a GSTIN go in GSTR-1 as B2C, by rate.</p>
            <div className="mt-3 overflow-x-auto print:overflow-visible">
              <table className="w-full min-w-[520px] text-left text-body tabular-nums print:min-w-0">
                <thead><tr className="text-caption text-muted"><th className="px-5 py-2 font-medium">Rate</th><th className="px-3 py-2 text-right font-medium">Invoices</th><th className="px-3 py-2 text-right font-medium">Taxable value</th><th className="px-3 py-2 text-right font-medium">CGST</th><th className="px-5 py-2 text-right font-medium">SGST</th></tr></thead>
                <tbody>
                  {s.byRate.map((row) => (
                    <tr key={row.rateBp} className="border-t border-line"><td className="px-5 py-2.5 font-semibold">{rate(row.rateBp)}</td><td className="px-3 py-2.5 text-right">{row.invoices}</td><td className="px-3 py-2.5 text-right">{rs(row.taxablePaise)}</td><td className="px-3 py-2.5 text-right">{rs(row.cgstPaise)}</td><td className="px-5 py-2.5 text-right">{rs(row.sgstPaise)}</td></tr>
                  ))}
                  <tr className="border-t-2 border-line font-semibold"><td className="px-5 py-2.5">Total</td><td className="px-3 py-2.5 text-right">{s.invoices}</td><td className="px-3 py-2.5 text-right">{rs(s.taxablePaise)}</td><td className="px-3 py-2.5 text-right">{rs(s.cgstPaise)}</td><td className="px-5 py-2.5 text-right">{rs(s.sgstPaise)}</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <div className="mt-5 grid gap-5 md:grid-cols-2 print:grid-cols-2">
            <section className={`${card} p-5`} aria-label="Documents issued">
              <h2 className="font-display text-section font-bold">Invoices issued</h2>
              <p className="text-caption text-muted">For the documents table of GSTR-1</p>
              <dl className="mt-3 grid gap-2 text-body">
                <div className="flex justify-between gap-3"><dt className="text-muted">From</dt><dd className="font-semibold tabular-nums">{s.firstNumber}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">To</dt><dd className="font-semibold tabular-nums">{s.lastNumber}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Count</dt><dd className="font-semibold tabular-nums">{s.invoices}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Credit notes</dt><dd className="font-semibold tabular-nums">{s.creditNotes ? `${s.creditNotes} · ${rs(s.creditNotePaise)}` : "None"}</dd></div>
              </dl>
            </section>
            <section className={`${card} p-5`} aria-label="Paid by">
              <h2 className="font-display text-section font-bold">Paid by</h2>
              <p className="text-caption text-muted">How guests paid these invoices</p>
              <dl className="mt-3 grid gap-2 text-body">
                {Object.entries(s.paymentModes).sort((a, b) => b[1] - a[1]).map(([m, p]) => (
                  <div key={m} className="flex justify-between gap-3"><dt className="capitalize text-muted">{m}</dt><dd className="font-semibold tabular-nums">{rs(p)}</dd></div>
                ))}
              </dl>
            </section>
          </div>

          {s.b2b.length > 0 && (
            <section className={`${card} mt-5 overflow-hidden`} aria-label="Business invoices">
              <h2 className="px-5 pt-5 font-display text-section font-bold">Invoices with the customer&apos;s GSTIN (B2B)</h2>
              <p className="px-5 text-caption text-muted">Reported one by one in GSTR-1</p>
              <div className="mt-3 overflow-x-auto print:overflow-visible">
                <table className="w-full min-w-[560px] text-left text-body tabular-nums print:min-w-0">
                  <thead><tr className="text-caption text-muted"><th className="px-5 py-2 font-medium">Invoice</th><th className="px-3 py-2 font-medium">Customer</th><th className="px-3 py-2 text-right font-medium">Taxable</th><th className="px-5 py-2 text-right font-medium">Tax</th></tr></thead>
                  <tbody>{s.b2b.map((b) => <tr key={b.number} className="border-t border-line"><td className="px-5 py-2.5">{b.number}<span className="block text-caption text-muted">{dateIst(b.issuedAt)}</span></td><td className="px-3 py-2.5">{b.customerName ?? "—"}<span className="block text-caption text-muted">{b.customerGstin}</span></td><td className="px-3 py-2.5 text-right">{rs(b.taxablePaise)}</td><td className="px-5 py-2.5 text-right">{rs(b.taxPaise)}</td></tr>)}</tbody>
                </table>
              </div>
            </section>
          )}

          <section className={`${card} mt-5 overflow-hidden`} aria-label="All invoices">
            <h2 className="px-5 pt-5 font-display text-section font-bold">All invoices</h2>
            <div className="mt-3 max-h-[480px] overflow-auto print:max-h-none print:overflow-visible">
              <table className="w-full min-w-[620px] text-left text-body tabular-nums print:min-w-0">
                <thead className="sticky top-0 bg-surface print:static"><tr className="text-caption text-muted"><th className="px-5 py-2 font-medium">Invoice</th><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 text-right font-medium">Taxable</th><th className="px-3 py-2 text-right font-medium">CGST</th><th className="px-3 py-2 text-right font-medium">SGST</th><th className="px-5 py-2 text-right font-medium">Total</th></tr></thead>
                <tbody>{r.rows.map((row) => <tr key={row.number} className="border-t border-line"><td className="px-5 py-2">{row.number}</td><td className="px-3 py-2">{dateIst(row.issuedAt)}</td><td className="px-3 py-2 text-right">{rs(row.taxablePaise)}</td><td className="px-3 py-2 text-right">{rs(row.cgstPaise)}</td><td className="px-3 py-2 text-right">{rs(row.sgstPaise)}</td><td className="px-5 py-2 text-right font-semibold">{rs(row.totalPaise)}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        </>
      )}
      <p className="mt-4 text-caption text-muted print:hidden">CGST and SGST are half of the tax each, for sales within your state. Check with your CA before filing.</p>
    </main>
  );
}
