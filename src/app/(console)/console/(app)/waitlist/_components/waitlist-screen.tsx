"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, BellRing, Check, Clock, Copy, Link2, Phone, Plus, SkipForward, UserRound, UserX, Users, X } from "lucide-react";
import { addWaitlistAction, leftAction, notifyAction, reorderAction, seatWaitlistAction, skipAction, type FloorResult } from "../../floor/actions";
import type { FloorData } from "@/server/floor/read";

type Entry = FloorData["waitlist"][number];
type Free = { id: string; code: string; seats: number; combinableWith: string[] };

const field = "mt-1 block h-11 w-full rounded-input border border-line bg-surface px-3 text-body text-ink outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-ink/20";
const base = "inline-flex min-h-11 items-center justify-center gap-2 rounded-input border px-4 text-body font-semibold transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const quiet = `${base} border-line bg-surface text-ink hover:border-ink/40`;
const solid = `${base} border-ink bg-ink text-white hover:bg-ink/90`;
const brand = `${base} border-brand bg-brand text-white hover:bg-brand-strong`;
const WAITS = [10, 15, 20, 30, 45, 60];

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="no-scrollbar max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-[1.25rem] border border-line bg-surface p-5 shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="font-display text-title font-bold text-ink">{title}</h2>{subtitle && <p className="mt-0.5 text-body text-muted">{subtitle}</p>}</div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-10 shrink-0 place-items-center rounded-input text-muted hover:bg-ink/5 hover:text-ink"><X className="size-5" aria-hidden="true" /></button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function WaitlistScreen({ entries, outlet, outletCode, freeTables, canManage }: { entries: Entry[]; outlet: string; outletCode: string; freeTables: Free[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [seating, setSeating] = useState<Entry | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [size, setSize] = useState(2);
  const [quote, setQuote] = useState<number | null>(20);

  // Wait times tick every 30 seconds and the list refreshes itself, so the screen stays true without touching it
  useEffect(() => {
    const t = setInterval(() => { setNow(Date.now()); router.refresh(); }, 30_000);
    return () => clearInterval(t);
  }, [router]);

  const run = (task: () => Promise<FloorResult>, after?: () => void) => {
    setError(null);
    start(async () => {
      const r = await task();
      if (!r.ok) return setError(r.message);
      after?.();
      router.refresh();
    });
  };

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    run(() => addWaitlistAction({ name: String(f.get("name") ?? ""), phone: String(f.get("phone") ?? ""), partySize: size, quotedMinutes: quote, notes: String(f.get("notes") ?? "") }), () => { setAdding(false); setSize(2); setQuote(20); });
  };

  const copyLink = async () => { try { await navigator.clipboard.writeText(`${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "") || window.location.origin}/r/${outletCode}/waitlist`); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); } };

  const waited = (e: Entry) => Math.max(0, Math.floor((now - e.joinedAt) / 60_000));
  const avg = entries.length ? Math.round(entries.reduce((n, e) => n + waited(e), 0) / entries.length) : 0;
  const people = entries.reduce((n, e) => n + e.partySize, 0);
  const fitGroups = (e: Entry) => {
    const sorted = [...freeTables].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    const groups: Free[][] = sorted.filter((t) => t.seats >= e.partySize).map((t) => [t]);
    const remainingSeats = sorted.map((_, i) => sorted.slice(i).reduce((n, t) => n + t.seats, 0));
    const walk = (start: number, picked: Free[]) => {
      if (groups.length >= 8) return;
      if (picked.length > 1 && picked.reduce((n, t) => n + t.seats, 0) >= e.partySize) {
        groups.push(picked);
        return;
      }
      if (start >= sorted.length || picked.reduce((n, t) => n + t.seats, 0) + (remainingSeats[start] ?? 0) < e.partySize) return;
      for (let i = start; i < sorted.length; i++) {
        const candidate = sorted[i];
        if (picked.some((t) => t.id === candidate.id)) continue;
        const connected = picked.length === 0 || picked.some((t) => t.combinableWith.includes(candidate.id) || candidate.combinableWith.includes(t.id));
        if (!connected) continue;
        walk(i + 1, [...picked, candidate]);
        if (groups.length >= 8) return;
      }
    };
    walk(0, []);
    return groups;
  };

  return (
    <main className="mx-auto w-full max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption font-semibold text-muted">{outlet}</p>
          <h1 className="mt-1 font-display text-title font-bold text-ink">Waitlist</h1>
          <p className="mt-1 text-body text-muted">Live queue · updates automatically</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={copyLink} className={quiet}>{copied ? <Check className="size-4" aria-hidden="true" /> : <Link2 className="size-4" aria-hidden="true" />}{copied ? "Link copied" : "Copy guest link"}</button>
          <Link href="/console/floor" className={quiet}>Open floor</Link>
          {canManage && <button type="button" className={brand} onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden="true" />Add a party</button>}
        </div>
      </header>

      <dl className="mt-5 grid grid-cols-3 gap-3">
        {[
          [Users, "Parties waiting", String(entries.length), "#c9482b"],
          [UserRound, "Guests in the queue", String(people), "#315e9e"],
          [Clock, "Average time waiting", entries.length ? `${avg} min` : "—", "#a74608"],
        ].map(([Icon, label, value, tone]) => {
          const I = Icon as typeof Users;
          return (
            <div key={label as string} className="rounded-card border border-line bg-surface p-4">
              <div className="flex items-center justify-between"><dt className="text-caption font-semibold text-muted">{label as string}</dt><span className="grid size-8 place-items-center rounded-input" style={{ background: `color-mix(in srgb, ${tone} 14%, var(--surface))`, color: tone as string }}><I className="size-4" aria-hidden="true" /></span></div>
              <dd className="mt-1 font-display text-[26px] leading-8 font-bold tabular text-ink">{value as string}</dd>
            </div>
          );
        })}
      </dl>

      {error && <p role="alert" className="mt-4 rounded-input bg-[var(--state-seated-soft)] px-3 py-2 text-body font-semibold text-danger">{error}</p>}

      {entries.length === 0 ? (
        <section className="mt-5 rounded-card border border-dashed border-line bg-surface px-6 py-10 text-center sm:py-12">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-brand-soft text-brand"><Users className="size-7" aria-hidden="true" /></span>
          <h2 className="mt-4 font-display text-section font-bold text-ink">Nobody is waiting</h2>
          <p className="mx-auto mt-1 max-w-md text-body text-muted">When the restaurant is full, add the next party here. Guests can also join by themselves from your QR page, and they will show up in order.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {canManage && <button type="button" className={brand} onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden="true" />Add a party</button>}
            <button type="button" className={quiet} onClick={copyLink}><Copy className="size-4" aria-hidden="true" />{copied ? "Link copied" : "Copy guest link"}</button>
          </div>
        </section>
      ) : (
        <ol className="mt-5 grid gap-3">
          {entries.map((w, i) => {
            const mins = waited(w);
            const quoted = w.quotedMinutes ?? w.estimateMinutes;
            const pct = quoted ? Math.min(100, Math.round((mins / quoted) * 100)) : 0;
            const late = !!quoted && mins > quoted;
            const called = w.status === "notified";
            return (
              <li key={w.id} className={`rounded-card border bg-surface p-4 sm:p-5 ${called ? "border-[var(--state-available)]" : "border-line"}`}>
                <div className="flex items-start gap-4">
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-ink font-display text-section font-bold text-white tabular" aria-label={`Number ${i + 1} in the queue`}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="truncate font-display text-section font-bold text-ink">{w.name}</p>
                      <span className={`rounded-full px-2.5 py-0.5 text-caption font-semibold ${called ? "bg-[var(--state-available-soft)] text-[var(--state-available-text)]" : "bg-[var(--state-held-soft)] text-[var(--state-held-text)]"}`}>{called ? "Called to the table" : "Waiting"}</span>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-body text-muted">
                      <span className="inline-flex items-center gap-1.5"><Users className="size-4" aria-hidden="true" /><b className="text-ink">{w.partySize}</b> {w.partySize === 1 ? "guest" : "guests"}</span>
                      {w.phone && <a href={`tel:${w.phone}`} className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline"><Phone className="size-4" aria-hidden="true" />{w.phone}</a>}
                      {w.seatingPreference && <span className="capitalize">{w.seatingPreference}</span>}
                    </p>
                    {w.notes && <p className="mt-1 text-body text-muted">“{w.notes}”</p>}

                    <div className="mt-3">
                      <div className="flex items-baseline justify-between text-caption">
                        <span className={`font-semibold tabular ${late ? "text-danger" : "text-ink"}`}>Waiting {mins} min</span>
                        <span className="text-muted tabular">{quoted ? (late ? `${mins - quoted} min over the ${quoted} min promised` : `${quoted} min promised`) : "No time promised"}</span>
                      </div>
                      {quoted ? <div className="mt-1 h-1.5 rounded-full bg-ink/[0.07]" role="progressbar" aria-valuenow={Math.min(mins, quoted)} aria-valuemin={0} aria-valuemax={quoted}><div className={`h-full rounded-full ${late ? "bg-danger" : "bg-[var(--state-available)]"}`} style={{ width: `${pct}%` }} /></div> : null}
                    </div>

                    {canManage && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button type="button" disabled={pending} onClick={() => setSeating(w)} className={solid}><Check className="size-4" aria-hidden="true" />Seat now{fitGroups(w).length ? ` · ${fitGroups(w).length} options` : ""}</button>
                        {!called && <button type="button" disabled={pending} onClick={() => run(() => notifyAction(w.id))} className={quiet}><BellRing className="size-4" aria-hidden="true" />Notify guest</button>}
                        {w.phone && <a href={`tel:${w.phone}`} className={quiet}><Phone className="size-4" aria-hidden="true" />Call guest</a>}
                        <button type="button" disabled={pending} onClick={() => run(() => skipAction(w.id))} className={quiet}><SkipForward className="size-4" aria-hidden="true" />Skip</button>
                        <button type="button" disabled={pending} onClick={() => run(() => leftAction(w.id))} className={`${base} border-transparent text-danger hover:bg-[var(--state-seated-soft)]`}><UserX className="size-4" aria-hidden="true" />Left</button>
                        <span className="ml-auto flex gap-1">
                          <button type="button" aria-label={`Move ${w.name} up in queue`} disabled={pending || i === 0} onClick={() => run(() => reorderAction(w.id, i - 1))} className="grid size-11 place-items-center rounded-input border border-line text-muted hover:text-ink disabled:opacity-40"><ArrowUp className="size-4" aria-hidden="true" /></button>
                          <button type="button" aria-label={`Move ${w.name} down in queue`} disabled={pending || i === entries.length - 1} onClick={() => run(() => reorderAction(w.id, i + 1))} className="grid size-11 place-items-center rounded-input border border-line text-muted hover:text-ink disabled:opacity-40"><ArrowDown className="size-4" aria-hidden="true" /></button>
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {adding && (
        <Modal title="Add a party" subtitle="They join the end of the line." onClose={() => setAdding(false)}>
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-body font-semibold text-ink">Name<input name="name" required autoFocus maxLength={80} placeholder="Who is waiting?" className={field} /></label>
            <div>
              <p className="text-body font-semibold text-ink">How many guests</p>
              <div className="mt-1 flex items-center gap-3">
                <button type="button" aria-label="One less" className="grid size-11 place-items-center rounded-input border border-line text-xl text-ink" onClick={() => setSize((n) => Math.max(1, n - 1))}>−</button>
                <span className="w-10 text-center font-display text-title font-bold tabular text-ink" aria-live="polite">{size}</span>
                <button type="button" aria-label="One more" className="grid size-11 place-items-center rounded-input border border-line text-xl text-ink" onClick={() => setSize((n) => Math.min(50, n + 1))}>+</button>
              </div>
            </div>
            <fieldset>
              <legend className="text-body font-semibold text-ink">How long will it take? <span className="font-normal text-muted">(what you tell them)</span></legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {[...WAITS, null].map((m) => (
                  <button key={m ?? "none"} type="button" aria-pressed={quote === m} onClick={() => setQuote(m)} className={`min-h-11 rounded-input border px-3.5 text-body font-semibold ${quote === m ? "border-brand bg-brand-soft text-ink" : "border-line text-muted hover:text-ink"}`}>{m ? `${m} min` : "Not sure"}</button>
                ))}
              </div>
            </fieldset>
            <label className="block text-body font-semibold text-ink">Phone <span className="font-normal text-muted">(optional)</span><input name="phone" type="tel" inputMode="tel" placeholder="98765 43210" className={field} /></label>
            <label className="block text-body font-semibold text-ink">Notes <span className="font-normal text-muted">(optional)</span><input name="notes" maxLength={200} placeholder="High chair, window seat…" className={field} /></label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className={quiet} onClick={() => setAdding(false)}>Cancel</button>
              <button type="submit" disabled={pending} className={brand}>{pending ? "Adding…" : "Add to waitlist"}</button>
            </div>
          </form>
        </Modal>
      )}

      {seating && (
        <Modal title={`Seat ${seating.name}`} subtitle={`${seating.partySize} ${seating.partySize === 1 ? "guest" : "guests"} · pick a free table`} onClose={() => setSeating(null)}>
          {fitGroups(seating).length === 0 ? (
            <p className="rounded-input bg-[var(--state-held-soft)] p-3 text-body text-[var(--state-held-text)]">No free table seats {seating.partySize} right now. Keep them waiting, or free up a table on the floor.</p>
          ) : (
            <div className="grid gap-2">
              {fitGroups(seating).map((group) => (
                <button key={group.map((t) => t.id).join("-")} type="button" disabled={pending} onClick={() => run(() => seatWaitlistAction(seating.id, group.map((t) => t.id)), () => setSeating(null))} className="flex min-h-14 items-center justify-between gap-3 rounded-input border border-[var(--state-available)] bg-[var(--state-available-soft)] px-3 text-left text-[var(--state-available-text)] hover:brightness-110 disabled:opacity-50">
                  <span><span className="block text-body font-bold">{group.map((t) => t.code).join(" + ")}</span><span className="block text-label">{group.length > 1 ? "Combined tables" : "Table"} · seats {group.reduce((n, t) => n + t.seats, 0)}</span></span><Check className="size-4 shrink-0" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
          {error && <p role="alert" className="mt-3 text-body font-semibold text-danger">{error}</p>}
        </Modal>
      )}
    </main>
  );
}
