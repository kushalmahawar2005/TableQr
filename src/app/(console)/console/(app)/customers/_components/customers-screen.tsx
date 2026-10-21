"use client";

import { useMemo, useState } from "react";
import type { Customer } from "@/server/staff/customers";

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
const DAY = 86_400_000;

type Filter = "all" | "regulars" | "offers" | "away";

export function CustomersScreen({ customers, outletName, now }: { customers: Customer[]; outletName: string; now: number }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s/g, "");
    return customers.filter((c) => {
      if (q && !`${c.name ?? ""}${c.phone}`.toLowerCase().replace(/\s/g, "").includes(q)) return false;
      if (filter === "regulars") return c.visits >= 3;
      if (filter === "offers") return c.offersOk;
      if (filter === "away") return c.lastVisitAt !== null && now - c.lastVisitAt > 30 * DAY;
      return true;
    });
  }, [customers, query, filter, now]);

  const csv = () => {
    const rows = [["Name", "Phone", "Came with", "Visits", "Last visit", "Bookings", "No-shows", "Spend (Rs)", "Offers OK"], ...shown.map((c) => [c.name ?? "", c.phone, withText(c), c.visits, day(c.lastVisitAt), c.bookings, c.noShows, Math.round(c.spendPaise / 100), c.offersOk ? "yes" : "no"])];
    const text = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: "customers.csv" }).click();
    URL.revokeObjectURL(url);
  };

  const counts = { all: customers.length, regulars: customers.filter((c) => c.visits >= 3).length, offers: customers.filter((c) => c.offersOk).length, away: customers.filter((c) => c.lastVisitAt !== null && now - c.lastVisitAt > 30 * DAY).length };
  const chip = (on: boolean) => `min-h-10 shrink-0 rounded-full border px-4 text-sm font-semibold ${on ? "border-ink bg-ink text-white" : "border-line bg-surface text-muted hover:text-ink"}`;

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-5 text-ink sm:px-6 lg:px-8 lg:py-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-caption font-semibold text-muted">{outletName}</p>
          <h1 className="mt-1 font-display text-title font-bold">Customers</h1>
          <p className="text-body text-muted">Guests who gave their number: at the table, for a booking, on the waitlist, or for a bill on WhatsApp.</p>
        </div>
        <button type="button" onClick={csv} disabled={!shown.length} className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:border-ink/40 disabled:opacity-50">Download list (CSV)</button>
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {([["all", "Everyone"], ["regulars", "Regulars (3+ visits)"], ["away", "Not seen in 30 days"], ["offers", "Agreed to offers"]] as const).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={chip(filter === k)}>{label} <span className="opacity-70">{counts[k]}</span></button>
        ))}
        <input aria-label="Search customers" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or number" className="ml-auto h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm sm:w-64" />
      </div>

      {shown.length === 0 ? (
        <section className="mt-5 rounded-2xl border border-dashed border-line bg-surface px-6 py-14 text-center">
          <h2 className="font-display text-section font-bold">{customers.length ? "No one matches" : "No customers yet"}</h2>
          <p className="mx-auto mt-1 max-w-md text-body text-muted">{customers.length ? "Try another search or filter." : "Numbers appear here when guests book, join the waitlist, verify at the table, or get their bill on WhatsApp."}</p>
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
                    <a href={`https://wa.me/91${c.phone}`} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-xs font-semibold hover:border-ink/40">WhatsApp</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-caption text-muted">Table spend is the paid bill of every visit they were at. Send offers only to guests who agreed to them.</p>
    </main>
  );
}
