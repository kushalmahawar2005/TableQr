"use client";

import Link from "next/link";
import { BackToReports } from "../../_components/back-to-reports";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { SalesDetail } from "@/server/staff/sales-detail";

// Items & staff: every dish sold in a date range, what did not sell, and each person's sales,
// discounts and cancelled items.

const rs = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const DAY = 86_400_000;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const nice = (d: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
const card = "rounded-2xl border border-line bg-surface";
const btn = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold text-ink hover:border-ink/40 print:hidden";

function csv(rows: (string | number)[][]) {
  const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));
  return rows.map((r) => r.map(cell).join(",")).join("\n");
}
function download(name: string, body: string) {
  const url = URL.createObjectURL(new Blob(["﻿", body], { type: "text/csv;charset=utf-8" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ItemsScreen({ report: r, outletName }: { report: SalesDetail; outletName: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const go = (from: string, to: string) => router.push(`/console/reports/items?from=${from}&to=${to}`);
  const presets: [string, string, string][] = [
    ["Today", r.today, r.today],
    ["Yesterday", addDays(r.today, -1), addDays(r.today, -1)],
    ["Last 7 days", addDays(r.today, -6), r.today],
    ["Last 30 days", addDays(r.today, -29), r.today],
    ["This month", `${r.today.slice(0, 7)}-01`, r.today],
  ];
  const categories = useMemo(() => ["All", ...new Set(r.items.map((i) => i.category))], [r.items]);
  const shown = r.items.filter((i) => (category === "All" || i.category === category) && (!query.trim() || i.name.toLowerCase().includes(query.trim().toLowerCase())));
  const top = Math.max(...r.items.map((i) => i.qty), 1);
  const range = r.from === r.to ? nice(r.from) : `${nice(r.from)} – ${nice(r.to)}`;

  return (
    <main id="items-report-print" className="mx-auto w-full max-w-[1200px] px-4 py-5 text-ink sm:px-6 lg:px-8 lg:py-7 print:max-w-none print:p-0">
      <BackToReports />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-caption font-semibold text-muted">{outletName}</p>
          <h1 className="mt-1 font-display text-title font-bold">Items &amp; staff</h1>
          <p className="mt-0.5 text-body text-muted">{range}</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Link href="/console/reports" className={btn}>Reports</Link>
          <button type="button" className={btn} onClick={() => window.print()}>Print</button>
        </div>
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-2 print:hidden">
        <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1">
          {presets.map(([label, f, t]) => (
            <button key={label} type="button" onClick={() => go(f, t)} aria-pressed={r.from === f && r.to === t} className={`min-h-9 rounded-lg px-3 text-sm font-semibold ${r.from === f && r.to === t ? "bg-forest text-white" : "text-muted hover:text-ink"}`}>
              {label}
            </button>
          ))}
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            go(String(f.get("from")), String(f.get("to")));
          }}
        >
          <input type="date" name="from" defaultValue={r.from} max={r.today} aria-label="From" className="h-10 rounded-xl border border-line bg-surface px-3 text-sm" />
          <span className="text-muted">to</span>
          <input type="date" name="to" defaultValue={r.to} max={r.today} aria-label="To" className="h-10 rounded-xl border border-line bg-surface px-3 text-sm" />
          <button type="submit" className={btn}>Show</button>
        </form>
      </div>

      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 print:break-inside-avoid" aria-label="Totals">
        <div className={`${card} p-4`}><p className="text-caption font-semibold text-muted">Item sales</p><p className="mt-1 font-display text-[24px] font-bold tabular-nums">{rs(r.totals.grossPaise)}</p><p className="text-caption text-muted">Before discount and tax</p></div>
        <div className={`${card} p-4`}><p className="text-caption font-semibold text-muted">Items sold</p><p className="mt-1 font-display text-[24px] font-bold tabular-nums">{r.totals.qty}</p></div>
        <div className={`${card} col-span-2 p-4 sm:col-span-1`}><p className="text-caption font-semibold text-muted">Different dishes</p><p className="mt-1 font-display text-[24px] font-bold tabular-nums">{r.totals.dishes}</p><p className="text-caption text-muted">{r.notSold.length} on the menu did not sell</p></div>
      </section>

      <section className={`${card} mt-5 overflow-hidden`} aria-label="Every dish">
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5">
          <div><h2 className="font-display text-section font-bold">Every dish</h2><p className="text-caption text-muted">Most sold first. Amount is before discount and tax.</p></div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" className="h-10 rounded-xl border border-line bg-surface px-3 text-sm">{categories.map((c) => <option key={c}>{c}</option>)}</select>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search dish" aria-label="Search dish" className="h-10 w-40 rounded-xl border border-line bg-surface px-3 text-sm" />
            <button type="button" disabled={!r.items.length} className={btn} onClick={() => download(`items-${r.from}-to-${r.to}.csv`, csv([["Dish", "Category", "Qty", "Orders", "Sales (Rs)", "Share %"], ...r.items.map((i) => [i.name, i.category, i.qty, i.orders, (i.grossPaise / 100).toFixed(2), i.sharePct])]))}>Download</button>
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="px-5 py-8 text-center text-body text-muted">{r.items.length ? "No dish matches." : "Nothing sold in these days."}</p>
        ) : (
          <div className="mt-3 max-h-[560px] overflow-auto print:max-h-none print:overflow-visible">
            <table className="w-full min-w-[620px] text-left text-body tabular-nums print:min-w-0">
              <thead className="sticky top-0 bg-surface print:static"><tr className="text-caption text-muted"><th className="px-5 py-2 font-medium">Dish</th><th className="px-3 py-2 font-medium">Category</th><th className="px-3 py-2 text-right font-medium">Qty</th><th className="px-3 py-2 text-right font-medium">Sales</th><th className="px-5 py-2 text-right font-medium">Share</th></tr></thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.itemId} className="border-t border-line">
                    <td className="px-5 py-2.5">
                      <span className="font-semibold">{i.name}</span>
                      <span className="mt-1 block h-1.5 max-w-48 overflow-hidden rounded-full bg-ink/[0.06]" aria-hidden><span className="block h-full rounded-full bg-brand" style={{ width: `${Math.round((i.qty / top) * 100)}%` }} /></span>
                    </td>
                    <td className="px-3 py-2.5 text-muted">{i.category}</td>
                    <td className="px-3 py-2.5 text-right font-semibold">{i.qty}</td>
                    <td className="px-3 py-2.5 text-right">{rs(i.grossPaise)}</td>
                    <td className="px-5 py-2.5 text-right text-muted">{i.sharePct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-2 print:grid-cols-2">
        <section className={`${card} p-5`} aria-label="Sales by staff">
          <h2 className="font-display text-section font-bold">Sales by staff</h2>
          <p className="text-caption text-muted">Who put the orders in. Guests ordering by QR are one line.</p>
          {r.staff.length === 0 ? <p className="mt-3 text-body text-muted">No orders in these days.</p> : (
            <ul className="mt-3 grid gap-2">
              {r.staff.map((p) => (
                <li key={p.name} className="flex items-center justify-between gap-3 rounded-xl bg-paper px-4 py-3">
                  <span className="min-w-0"><span className={`block truncate font-semibold ${p.guests ? "text-muted" : ""}`}>{p.name}</span><span className="text-caption text-muted tabular-nums">{p.orders} {p.orders === 1 ? "order" : "orders"} · {p.qty} {p.qty === 1 ? "item" : "items"}</span></span>
                  <span className="font-display font-bold tabular-nums">{rs(p.grossPaise)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${card} p-5`} aria-label="Discounts and cancelled items">
          <h2 className="font-display text-section font-bold">Discounts and cancelled items</h2>
          <p className="text-caption text-muted">Who gave money off, and who cancelled dishes after ordering.</p>
          <h3 className="mt-4 text-body font-semibold">Discounts</h3>
          {r.discounts.length === 0 ? <p className="text-body text-muted">None.</p> : (
            <ul className="mt-2 grid gap-2">
              {r.discounts.map((d) => (
                <li key={d.name} className="rounded-xl bg-paper px-4 py-3">
                  <span className="flex justify-between gap-3"><span className="font-semibold">{d.name}</span><span className="font-bold tabular-nums">{rs(d.paise)}</span></span>
                  <span className="block text-caption text-muted">{d.count} {d.count === 1 ? "bill" : "bills"}{d.reasons ? ` · ${d.reasons}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
          <h3 className="mt-4 text-body font-semibold">Cancelled items</h3>
          {r.voids.length === 0 ? <p className="text-body text-muted">None.</p> : (
            <ul className="mt-2 grid gap-2">
              {r.voids.map((v) => (
                <li key={v.name} className="flex justify-between gap-3 rounded-xl bg-paper px-4 py-3">
                  <span><span className="font-semibold">{v.name}</span><span className="block text-caption text-muted">{v.qty} {v.qty === 1 ? "item" : "items"} cancelled</span></span>
                  <span className="font-bold tabular-nums">{rs(v.grossPaise)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {r.notSold.length > 0 && (
        <section className={`${card} mt-5 p-5`} aria-label="Dishes that did not sell">
          <h2 className="font-display text-section font-bold">Did not sell</h2>
          <p className="text-caption text-muted">On the menu but not ordered once in these days. Worth a look: change the price, the photo, or take it off.</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {r.notSold.map((n) => <li key={`${n.category}-${n.name}`} className="rounded-full border border-line px-3 py-1 text-caption"><span className="font-semibold">{n.name}</span> <span className="text-muted">· {n.category}</span></li>)}
          </ul>
        </section>
      )}
    </main>
  );
}
