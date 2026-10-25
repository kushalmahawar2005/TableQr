"use client";

import { ChevronLeft, ChevronRight, Download, MessageSquareText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addDays, addMonths, STATUS_LABEL, STATUSES, type AttendanceStatus } from "@/lib/attendance";
import type { Month, Register, RegisterPerson } from "@/server/attendance/register";
import { markAction, markAllPresentAction } from "../actions";

// The attendance register. Daily: one tap per person (Present, Half day, Absent, Leave, Week off);
// tap the chosen one again to clear it. Monthly: each person's totals and a day-by-day strip.

const TONE: Record<AttendanceStatus, { on: string; letter: string }> = {
  present: { on: "bg-forest text-white border-forest", letter: "P" },
  half_day: { on: "bg-[var(--state-reserved-soft)] text-[var(--state-reserved-text)] border-[var(--state-reserved)]", letter: "H" },
  absent: { on: "bg-terracotta text-white border-terracotta", letter: "A" },
  leave: { on: "bg-[var(--state-cleaning-soft)] text-[var(--state-cleaning-text)] border-[var(--state-cleaning)]", letter: "L" },
  week_off: { on: "bg-neutral-200 text-ink border-neutral-300", letter: "W" },
};
const ROLE: Record<string, string> = { owner: "Owner", manager: "Manager", cashier: "Cashier", host: "Host", waiter: "Waiter", kitchen: "Kitchen", accountant: "Accountant", reception: "Reception" };
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const field = "h-10 rounded-xl border border-line bg-surface px-3 text-body text-ink focus-visible:outline-2 focus-visible:outline-forest";

export function AttendanceScreen({ day, month }: { day: Register | null; month: Month | null }) {
  const router = useRouter();
  const view = day ? "day" : "month";
  const outlets = (day ?? month)!.outlets;
  const outletId = (day ?? month)!.outletId;
  const [, nav] = useTransition();
  const go = (p: Record<string, string>) => nav(() => router.push(`/console/attendance?${new URLSearchParams({ view, outlet: outletId, ...p }).toString()}`));

  return (
    <main className="mx-auto w-full max-w-[1100px] space-y-5 px-4 py-5 sm:px-6 lg:py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-title font-bold tracking-tight text-ink">Attendance</h1>
          <p className="mt-0.5 text-body text-muted">Mark who was present, on a half day or absent.</p>
        </div>
        <div className="flex items-center gap-2">
          {outlets.length > 1 && <select aria-label="Outlet" className={field} value={outletId} onChange={(e) => go({ outlet: e.target.value })}>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
          <div role="tablist" aria-label="View" className="flex rounded-xl border border-line bg-surface p-1">
            {(["day", "month"] as const).map((v) => <button key={v} role="tab" type="button" aria-selected={view === v} onClick={() => go({ view: v })} className={`h-8 rounded-lg px-4 text-body font-semibold ${view === v ? "bg-forest text-white" : "text-muted hover:text-ink"}`}>{v === "day" ? "Daily" : "Monthly"}</button>)}
          </div>
        </div>
      </header>
      {day ? <Daily r={day} go={go} /> : <Monthly m={month!} go={go} />}
    </main>
  );
}

function Daily({ r, go }: { r: Register; go: (p: Record<string, string>) => void }) {
  const [people, setPeople] = useState<RegisterPerson[]>(r.people);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Set<string>>(() => new Set(r.people.filter((p) => p.note).map((p) => p.id)));
  const future = r.date > r.today;
  const counts = { present: 0, half_day: 0, absent: 0, leave: 0, week_off: 0, unmarked: 0 };
  for (const p of people) counts[p.status ?? "unmarked"]++;
  const label = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${r.date}T12:00:00Z`));

  async function mark(p: RegisterPerson, status: AttendanceStatus | null, note = p.note) {
    if (future || busy) return;
    setBusy(p.id);
    setMessage(null);
    const before = people;
    setPeople((list) => list.map((x) => (x.id === p.id ? { ...x, status, note } : x)));
    const res = await markAction({ userId: p.id, date: r.date, status, note, outletId: r.outletId }).catch(() => null);
    if (!res || !res.ok) { setPeople(before); setMessage(res?.message ?? "That didn't save. Check your connection and try again."); }
    setBusy(null);
  }

  async function allPresent() {
    if (future || busy) return;
    setBusy("all");
    setMessage(null);
    const res = await markAllPresentAction({ date: r.date, outletId: r.outletId }).catch(() => null);
    if (!res || !res.ok) { setMessage(res?.message ?? "That didn't save. Try again."); setBusy(null); return; }
    setPeople((list) => list.map((x) => (x.status ? x : { ...x, status: "present" })));
    setBusy(null);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-xl border border-line bg-surface">
          <button type="button" aria-label="Previous day" className="grid size-10 place-items-center text-muted hover:text-ink" onClick={() => go({ date: addDays(r.date, -1) })}><ChevronLeft className="size-4" aria-hidden="true" /></button>
          <input type="date" aria-label="Date" value={r.date} max={r.today} onChange={(e) => e.target.value && go({ date: e.target.value })} className="h-10 bg-transparent px-1 text-body text-ink focus-visible:outline-2 focus-visible:outline-forest" />
          <button type="button" aria-label="Next day" disabled={r.date >= r.today} className="grid size-10 place-items-center text-muted hover:text-ink disabled:opacity-30" onClick={() => go({ date: addDays(r.date, 1) })}><ChevronRight className="size-4" aria-hidden="true" /></button>
        </div>
        {r.date !== r.today && <button type="button" className="h-10 rounded-xl border border-line bg-surface px-4 text-body font-semibold text-ink hover:bg-ink/5" onClick={() => go({ date: r.today })}>Today</button>}
        <p className="text-body font-semibold text-ink">{label}</p>
        <button type="button" onClick={() => void allPresent()} disabled={future || busy !== null || counts.unmarked === 0} className="ml-auto h-10 rounded-xl bg-forest px-4 text-body font-semibold text-white hover:bg-forest-hover disabled:opacity-40">Mark all present{counts.unmarked > 0 && ` (${counts.unmarked})`}</button>
      </div>

      <ul aria-label="Summary" className="flex flex-wrap gap-2">
        {STATUSES.map((s) => <li key={s} className="rounded-full border border-line bg-surface px-3 py-1.5 text-caption font-semibold text-ink"><span className="tabular-nums">{counts[s]}</span> <span className="text-muted">{STATUS_LABEL[s]}</span></li>)}
        <li className="rounded-full border border-dashed border-line px-3 py-1.5 text-caption font-semibold text-muted"><span className="tabular-nums text-ink">{counts.unmarked}</span> Not marked</li>
      </ul>

      {future && <p className="rounded-xl bg-[var(--state-bill-soft)] px-4 py-2.5 text-body text-[var(--state-bill-text)]">This day hasn&apos;t happened yet, so it can&apos;t be marked.</p>}
      {message && <p role="alert" className="rounded-xl bg-[var(--state-seated-soft)] px-4 py-2.5 text-body text-[var(--state-seated-text)]">{message}</p>}

      <section aria-label="Staff" className="overflow-hidden rounded-2xl border border-line bg-surface">
        {people.length === 0 ? <p className="px-5 py-10 text-center text-body text-muted">No staff at this outlet yet. Add people in Team.</p> : (
          <ul className="divide-y divide-line">
            {people.map((p) => (
              <li key={p.id} className="px-4 py-3.5 sm:px-5">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                  <div className="flex min-w-0 flex-1 basis-48 items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sage text-body font-bold text-forest" aria-hidden="true">{initials(p.name)}</span>
                    <div className="min-w-0"><p className="truncate text-body font-semibold text-ink">{p.name}</p><p className="truncate text-caption text-muted">{p.roles.map((x) => ROLE[x] ?? x).join(", ")}</p></div>
                  </div>
                  <div role="group" aria-label={`Attendance for ${p.name}`} className="flex flex-wrap gap-1.5">
                    {STATUSES.map((s) => {
                      const on = p.status === s;
                      return <button key={s} type="button" aria-pressed={on} disabled={future || busy !== null} onClick={() => void mark(p, on ? null : s)} className={`h-10 rounded-xl border px-3.5 text-body font-semibold transition-colors disabled:opacity-50 ${on ? TONE[s].on : "border-line bg-surface text-ink hover:bg-ink/5"}`}>{STATUS_LABEL[s]}</button>;
                    })}
                    <button type="button" aria-label={`Note for ${p.name}`} aria-expanded={notes.has(p.id)} onClick={() => setNotes((n) => { const x = new Set(n); if (x.has(p.id)) x.delete(p.id); else x.add(p.id); return x; })} className={`grid size-10 place-items-center rounded-xl border border-line hover:bg-ink/5 ${p.note ? "text-forest" : "text-muted"}`}><MessageSquareText className="size-4" aria-hidden="true" /></button>
                  </div>
                </div>
                {notes.has(p.id) && (
                  <input aria-label={`Note for ${p.name}`} defaultValue={p.note ?? ""} maxLength={200} disabled={future || !p.status} placeholder={p.status ? "Add a note, for example came late or left early" : "Mark the day first, then add a note"}
                    onBlur={(e) => { const v = e.target.value.trim(); if (p.status && v !== (p.note ?? "")) void mark(p, p.status, v || null); }}
                    className="mt-3 h-10 w-full rounded-xl border border-line bg-surface px-3 text-body text-ink disabled:opacity-60" />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Monthly({ m, go }: { m: Month; go: (p: Record<string, string>) => void }) {
  const label = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m.month}-01T12:00:00Z`));
  const cols = [["P", "present"], ["H", "half_day"], ["A", "absent"], ["L", "leave"], ["W", "week_off"]] as const;
  const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-xl border border-line bg-surface">
          <button type="button" aria-label="Previous month" className="grid size-10 place-items-center text-muted hover:text-ink" onClick={() => go({ month: addMonths(m.month, -1) })}><ChevronLeft className="size-4" aria-hidden="true" /></button>
          <input type="month" aria-label="Month" value={m.month} onChange={(e) => e.target.value && go({ month: e.target.value })} className="h-10 bg-transparent px-1 text-body text-ink focus-visible:outline-2 focus-visible:outline-forest" />
          <button type="button" aria-label="Next month" className="grid size-10 place-items-center text-muted hover:text-ink" onClick={() => go({ month: addMonths(m.month, 1) })}><ChevronRight className="size-4" aria-hidden="true" /></button>
        </div>
        <p className="text-body font-semibold text-ink">{label}</p>
        <a href={`/console/attendance/export?month=${m.month}&outlet=${m.outletId}`} className="ml-auto inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-body font-semibold text-ink hover:bg-ink/5"><Download className="size-4" aria-hidden="true" />Download for Excel</a>
      </div>
      <section aria-label="Month" className="overflow-x-auto rounded-2xl border border-line bg-surface">
        {m.rows.length === 0 ? <p className="px-5 py-10 text-center text-body text-muted">No staff at this outlet yet.</p> : (
          <table className="w-full min-w-max text-left text-body">
            <thead className="bg-paper text-caption text-muted">
              <tr>
                <th scope="col" className="sticky left-0 bg-paper px-4 py-3 font-semibold">Name</th>
                {cols.map(([k, key]) => <th key={k} scope="col" title={STATUS_LABEL[key]} className="px-2.5 py-3 text-center font-semibold">{k}</th>)}
                <th scope="col" className="px-2.5 py-3 text-center font-semibold" title="Days with no mark">Not marked</th>
                <th scope="col" className="px-3 py-3 text-center font-semibold" title="Present days plus half of each half day">Days worked</th>
                {m.dates.map((d) => <th key={d} scope="col" className="w-7 px-0.5 py-3 text-center font-medium">{Number(d.slice(8))}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {m.rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="sticky left-0 bg-surface px-4 py-3 font-semibold text-ink">{r.name}<span className="block text-caption font-normal text-muted">{r.roles.map((x) => ROLE[x] ?? x).join(", ")}</span></th>
                  {cols.map(([k, key]) => <td key={k} className="px-2.5 py-3 text-center tabular-nums text-ink">{r.counts[key] || <span className="text-muted/50">0</span>}</td>)}
                  <td className="px-2.5 py-3 text-center tabular-nums text-muted">{r.counts.unmarked}</td>
                  <td className="px-3 py-3 text-center font-bold tabular-nums text-ink">{num(r.counts.daysWorked)}</td>
                  {r.days.map((s, i) => <td key={m.dates[i]} className="px-0.5 py-3 text-center">{s ? <span title={STATUS_LABEL[s]} className={`inline-grid size-6 place-items-center rounded-md border text-[11px] font-bold ${TONE[s].on}`}>{TONE[s].letter}</span> : <span className="text-muted/40">·</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <p className="text-caption text-muted">P present · H half day (counts as half a day) · A absent · L leave · W week off. Leave and week off are not counted as days worked.</p>
    </>
  );
}
