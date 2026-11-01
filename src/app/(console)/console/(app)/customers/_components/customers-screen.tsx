"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Customer, CustomerFilter, CustomersPage } from "@/server/staff/customers";
import { setCustomerBlockedAction } from "../actions";

// Customers: the regulars, how often they come and when they last did. A guest is messaged only
// one at a time from here, and offers only to people who agreed to receive them.

const rs = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
/** "Hitesh, Mitarthh and 1 more": the others at the table on their last visit */
const withText = (c: Customer) => {
  const { names, unnamed } = c.companions;
  if (!names.length) return unnamed ? `${unnamed} other${unnamed === 1 ? "" : "s"}` : "";
  return unnamed ? `${names.join(", ")} and ${unnamed} more` : names.join(", ");
};
const day = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
type Filter = CustomerFilter;

const href = (q: string, filter: Filter, page: number) => {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (filter !== "all") p.set("filter", filter);
  if (page > 1) p.set("page", String(page));
  const text = p.toString();
  return `/console/customers${text ? `?${text}` : ""}`;
};

export function CustomersScreen({ data, q, filter, outletName }: { data: CustomersPage; q: string; filter: Filter; outletName: string }) {
  const router = useRouter();
  const { customers: shown, counts, total, page, pages } = data;
  const [query, setQuery] = useState(q);
  // Typing searches the whole list on the server, a moment after the last key
  useEffect(() => {
    if (query.trim() === q.trim()) return;
    const timer = setTimeout(() => router.replace(href(query.trim(), filter, 1)), 350);
    return () => clearTimeout(timer);
  }, [query, q, filter, router]);
  const chip = (on: boolean) => `inline-flex min-h-10 shrink-0 items-center rounded-full border px-4 text-sm font-semibold ${on ? "border-forest bg-forest text-white" : "border-line bg-surface text-muted hover:text-ink"}`;
  const exportHref = `/console/customers/export${href(q, filter, 1).replace("/console/customers", "")}`;

  return (
    <main className="mx-auto w-full max-w-[1440px] px-3 py-3 pb-6 sm:px-6 sm:py-5 lg:px-8 lg:py-6 text-ink">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-lg font-bold leading-6 tracking-tight text-ink sm:text-[28px] sm:leading-8">Customers</h1>
          <p className="text-body text-muted">Guests who gave their number: at the table, for a booking, on the waitlist, or for a bill on WhatsApp.</p>
        </div>
        {total > 0 && <a href={exportHref} className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:border-ink/40">Download list (CSV)</a>}
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {([["all", "Everyone"], ["regulars", "Regulars (3+ visits)"], ["away", "Not seen in 30 days"], ["offers", "Agreed to offers"]] as const).map(([k, label]) => (
          <Link key={k} href={href(query.trim(), k, 1)} aria-current={filter === k ? "true" : undefined} className={chip(filter === k)}>{label}<span className="ml-1.5 opacity-70">{counts[k]}</span></Link>
        ))}
        <input aria-label="Search customers" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or number" type="search" autoComplete="off" className="ml-auto h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm sm:w-64" />
      </div>

      {shown.length === 0 ? (
        <section className="mt-5 rounded-2xl border border-dashed border-line bg-surface px-6 py-14 text-center">
          <h2 className="font-display text-section font-bold">{counts.all ? "No one matches" : "No customers yet"}</h2>
          <p className="mx-auto mt-1 max-w-md text-body text-muted">{counts.all ? "Try another search or filter." : "Numbers appear here when guests book, join the waitlist, verify at the table, or get their bill on WhatsApp."}</p>
        </section>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-caption text-muted">
              <tr>
                <th className="p-3 font-semibold">Guest</th>
                <th className="p-3 text-right font-semibold">Visits</th>
                <th className="p-3 font-semibold">Last visit</th>
                <th className="p-3 text-right font-semibold">Bookings</th>
                <th className="p-3 text-right font-semibold">Table spend</th>
                <th className="p-3 font-semibold">Offers</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.phone} className="border-b border-line/70 last:border-0">
                  <td className="p-3">
                    <b className="block">{c.name ?? "Guest"}</b>
                    <span className="text-caption text-muted tabular-nums">{c.phone.replace(/(\d{5})(\d{5})/, "$1 $2")}</span>
                    {c.noShows > 0 && <span className="ml-2 rounded-full bg-[var(--state-held-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--state-held-text)]">{c.noShows} no-show{c.noShows === 1 ? "" : "s"}</span>}
                    {withText(c) && <span className="mt-0.5 block text-caption text-muted">With {withText(c)}</span>}
                  </td>
                  <td className="p-3 text-right tabular-nums">{c.visits}{c.visits >= 3 && <span className="ml-1 text-xs text-[var(--state-available-text)]">★</span>}</td>
                  <td className="p-3">{day(c.lastVisitAt)}</td>
                  <td className="p-3 text-right tabular-nums">{c.bookings}</td>
                  <td className="p-3 text-right tabular-nums">{c.spendPaise ? rs(c.spendPaise) : "—"}</td>
                  <td className="p-3">{c.offersOk ? <span className="text-[var(--state-available-text)]">Yes</span> : <span className="text-muted">No</span>}</td>
                  <td className="p-3 text-right">
                    <button type="button" onClick={() => void setCustomerBlockedAction(c.phone, !c.blocked)} className={`mr-2 inline-flex min-h-9 cursor-pointer items-center rounded-lg border px-3 text-sm font-semibold ${c.blocked ? "border-rose-300 text-rose-700" : "border-line text-ink"}`}>{c.blocked ? "Unblock" : "Block"}</button>
                    <a href={`https://wa.me/91${c.phone}`} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-xs font-semibold hover:border-ink/40">WhatsApp</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3">
          {page > 1 ? <Link href={href(q, filter, page - 1)} className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:border-ink/40">‹ Previous</Link> : <span />}
          <p className="text-caption text-muted tabular-nums">Page {page} of {pages} · {total} {total === 1 ? "customer" : "customers"}</p>
          {page < pages ? <Link href={href(q, filter, page + 1)} className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:border-ink/40">Next ›</Link> : <span />}
        </nav>
      )}
      <p className="mt-3 text-caption text-muted">Table spend is the paid bill of every visit they were at. Send offers only to guests who agreed to them.</p>
    </main>
  );
}
