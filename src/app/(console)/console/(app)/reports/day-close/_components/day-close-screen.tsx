"use client";

import { useRouter } from "next/navigation";
import { printHtml } from "@/app/pos/_components/bill-print";
import type { DayClose } from "@/server/staff/day-close";
import { dayCloseHtml } from "./day-close-print";

// Day close: one page to count the drawer against, print, or send to the owner on WhatsApp.

const rs = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const METHOD: Record<string, string> = { cash: "Cash", card: "Card", upi: "UPI", wallet: "Wallet / online" };

function shareText(r: DayClose, outlet: string) {
  const lines = [
    `*${outlet} — Day close ${r.date}*`,
    `Bills paid: ${r.bills.count} · Sales ${rs(r.bills.totalPaise)}`,
    ...r.methods.map((m) => `${METHOD[m.method] ?? m.method}: ${rs(m.paise)} (${m.count})`),
    r.refunds.paise ? `Refunds: −${rs(r.refunds.paise)}` : "",
    `Collected: ${rs(r.netPaise)}`,
    r.bills.discountPaise ? `Discounts given: ${rs(r.bills.discountPaise)}` : "",
    `GST: ${rs(r.bills.taxPaise)}${r.bills.tipsPaise ? ` · Tips: ${rs(r.bills.tipsPaise)}` : ""}`,
    `Orders: ${r.orders} · Guests: ${r.visits.covers || r.visits.count}`,
    r.topItems.length ? `Top: ${r.topItems.slice(0, 3).map((t) => `${t.name} ×${t.qty}`).join(", ")}` : "",
    r.openTables.length ? `Still open: ${r.openTables.map((t) => t.table).join(", ")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-caption font-semibold text-muted">{label}</p>
      <p className="mt-1 font-display text-[26px] leading-8 font-bold tabular-nums">{value}</p>
      {note && <p className="text-caption text-muted">{note}</p>}
    </div>
  );
}

export function DayCloseScreen({ report: r, outletName, today }: { report: DayClose; outletName: string; today: string }) {
  const router = useRouter();
  const go = (date: string) => router.push(`/console/reports/day-close?date=${date}`);
  const shift = (days: number) => go(new Date(Date.parse(`${r.date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10));
  const text = shareText(r, outletName);
  const btn = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink hover:border-ink/40 print:hidden";

  return (
    <main className="mx-auto w-full max-w-[1000px] px-4 py-5 text-ink sm:px-6 lg:px-8 lg:py-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-caption font-semibold text-muted">{outletName}</p>
          <h1 className="mt-1 font-display text-title font-bold">Day close</h1>
          <p className="text-body text-muted">{new Date(`${r.date}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}{r.isToday ? " · today so far" : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={() => shift(-1)}>‹ Previous day</button>
          <input type="date" aria-label="Pick a day" value={r.date} max={today} onChange={(e) => e.target.value && go(e.target.value)} className="min-h-11 rounded-xl border border-line bg-surface px-3 text-sm print:hidden" />
          {!r.isToday && <button type="button" className={btn} onClick={() => shift(1)}>Next day ›</button>}
        </div>
      </header>

      {r.openTables.length > 0 && r.isToday && (
        <p role="alert" className="mt-4 rounded-xl bg-[var(--state-held-soft)] p-3 text-sm font-semibold text-[var(--state-held-text)]">
          {r.openTables.length} {r.openTables.length === 1 ? "table is" : "tables are"} still open: {r.openTables.map((t) => `${t.table}${t.totalPaise ? ` (${rs(t.totalPaise)})` : ""}`).join(", ")}. Settle them before closing the day.
        </p>
      )}

      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Collected" value={rs(r.netPaise)} note={r.refunds.paise ? `after ${rs(r.refunds.paise)} refunds` : "cash, card and online"} />
        <Stat label="Sales" value={rs(r.bills.totalPaise)} note={`${r.bills.count} paid ${r.bills.count === 1 ? "bill" : "bills"}`} />
        <Stat label="Average bill" value={rs(r.averageBillPaise)} />
        <Stat label="Guests" value={String(r.visits.covers || r.visits.count)} note={`${r.orders} orders · ${r.itemsSold} items`} />
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="font-display text-section font-bold">Money in, by method</h2>
          <p className="text-caption text-muted">Count the cash drawer against the Cash line.</p>
          <dl className="mt-3 divide-y divide-line">
            {r.methods.length === 0 && <p className="py-2 text-sm text-muted">No payments on this day.</p>}
            {r.methods.map((m) => (
              <div key={m.method} className="flex justify-between py-2 text-body"><dt>{METHOD[m.method] ?? m.method} <span className="text-muted">· {m.count}</span></dt><dd className="font-semibold tabular-nums">{rs(m.paise)}</dd></div>
            ))}
            {r.refunds.paise > 0 && <div className="flex justify-between py-2 text-body text-danger"><dt>Refunds · {r.refunds.count}</dt><dd className="font-semibold tabular-nums">− {rs(r.refunds.paise)}</dd></div>}
            <div className="flex justify-between py-2 font-display text-section font-bold"><dt>Collected</dt><dd className="tabular-nums">{rs(r.netPaise)}</dd></div>
          </dl>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="font-display text-section font-bold">What the bills add up to</h2>
          <dl className="mt-3 divide-y divide-line text-body">
            {([
              ["Food and drinks", r.bills.subtotalPaise],
              ["Discounts", -r.bills.discountPaise],
              ["Service charge", r.bills.serviceChargePaise],
              ["GST", r.bills.taxPaise],
              ["Round off", r.bills.roundOffPaise],
            ] as const).filter(([, v]) => v !== 0).map(([k, v]) => (
              <div key={k} className="flex justify-between py-2"><dt className="text-muted">{k}</dt><dd className="tabular-nums">{v < 0 ? `− ${rs(-v)}` : rs(v)}</dd></div>
            ))}
            <div className="flex justify-between py-2 font-display text-section font-bold"><dt>Sales</dt><dd className="tabular-nums">{rs(r.bills.totalPaise)}</dd></div>
            {r.bills.tipsPaise > 0 && <div className="flex justify-between py-2"><dt className="text-muted">Tips (on top)</dt><dd className="tabular-nums">{rs(r.bills.tipsPaise)}</dd></div>}
            {r.removed.qty > 0 && <div className="flex justify-between py-2 text-[var(--state-held-text)]"><dt>Cancelled or voided items · {r.removed.qty}</dt><dd className="tabular-nums">{rs(r.removed.paise)}</dd></div>}
          </dl>
        </section>
      </div>

      {r.topItems.length > 0 && (
        <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
          <h2 className="font-display text-section font-bold">Most ordered</h2>
          <ol className="mt-2 divide-y divide-line">
            {r.topItems.map((t, i) => <li key={t.name} className="flex justify-between py-2 text-body"><span><span className="text-muted">{i + 1}.</span> {t.name} <span className="text-muted">×{t.qty}</span></span><span className="tabular-nums">{rs(t.paise)}</span></li>)}
          </ol>
        </section>
      )}

      <div className="mt-5 flex flex-wrap gap-2 print:hidden">
        <a className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#1f8f4e] bg-[#1f8f4e] px-4 text-sm font-semibold text-white" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer noopener">Send on WhatsApp</a>
        <button type="button" className={btn} onClick={() => printHtml(dayCloseHtml(r, outletName))}>Print</button>
        <button type="button" className={btn} onClick={() => void navigator.clipboard?.writeText(text)}>Copy summary</button>
      </div>
    </main>
  );
}
