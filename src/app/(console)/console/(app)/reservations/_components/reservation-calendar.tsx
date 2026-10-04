"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CalendarData } from "@/server/staff/reservations";
import {
  calendarAction,
  calendarTokenAction,
  editDetailsAction,
  reservationArriveAction,
  reservationCancelAction,
  reservationCreateAction,
  reservationNoShowAction,
  reservationReassignAction,
  reservationRescheduleAction,
  reservationSeatAction,
  type CalendarResult,
} from "../actions";
import {
  addDays,
  canArrive,
  canCancel,
  canEditDetails,
  canReassign,
  canReschedule,
  canSeat,
  detailsPatch,
  drawerForm,
  formatDay,
  formatTime,
  formFor,
  groupByDateAndTime,
  queryOf,
  type CalendarQuery,
  type CalendarReservation,
} from "./calendar-logic";
import { createCalendarSync, startCalendarSync, type CalendarSync } from "./calendar-sync";
import { ReservationCompanion } from "./companion";

const STATUSES = ["requested", "confirmed", "reminded", "arrived", "seated", "completed", "cancelled", "no_show"];
const field = "min-h-11 rounded-input border border-line bg-surface px-3";
const plainButton = "min-h-11 rounded-input border border-line px-3 font-semibold disabled:opacity-50";

type Notice = { kind: "error" | "ok"; text: string } | null;

export function ReservationCalendar({ initial, realtimeUrl, preview = false, initialSelectedId = null }: { initial: CalendarData; realtimeUrl: string | null; preview?: boolean; initialSelectedId?: string | null }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState<CalendarQuery>(() => queryOf(initial));
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [newName, setNewName] = useState("");
  const [newParty, setNewParty] = useState(2);
  const [newWhen, setNewWhen] = useState("");
  const syncRef = useRef<CalendarSync | null>(null);

  useEffect(() => {
    if (preview) return;
    const sync = createCalendarSync({
      query: queryOf(initial),
      load: calendarAction,
      onData: (next, q) => {
        setData(next);
        // Keep a search the user is still typing; the server only settles date and view
        setQuery((prev) => ({ ...prev, date: q.date, view: q.view }));
        setBusy(false);
      },
      onError: (code, message) => {
        setBusy(false);
        if (code === "staff_signed_out") router.replace("/console/login");
        else setNotice({ kind: "error", text: message });
      },
    });
    syncRef.current = sync;
    const stop = startCalendarSync(sync, { realtimeUrl, getToken: calendarTokenAction });
    return () => {
      stop();
      syncRef.current = null;
    };
  }, [initial, preview, realtimeUrl, router]);

  /** Change what the screen shows; polls and realtime keep asking for the same thing afterwards */
  const change = (patch: Partial<CalendarQuery>) => {
    setQuery((q) => ({ ...q, ...patch }));
    if (!syncRef.current) return;
    setBusy(true);
    setNotice(null);
    void syncRef.current.refresh(patch);
  };
  const reload = () => void syncRef.current?.refresh();
  const today = () => {
    if (!syncRef.current) return;
    setBusy(true);
    void syncRef.current.today();
  };

  const create = async () => {
    const r = await reservationCreateAction({ name: newName, partySize: newParty, localDateTime: newWhen, source: "staff" });
    if (!r.ok) return setNotice({ kind: "error", text: r.message });
    setNewName("");
    setNewWhen("");
    setNotice({ kind: "ok", text: "Reservation created." });
    reload();
  };

  const tz = data.timezone;
  const days = groupByDateAndTime(data.reservations, tz);
  const selected = data.reservations.find((r) => r.id === selectedId) ?? null;
  const step = data.view === "week" ? 7 : 1;

  return (
    <main className="min-h-dvh bg-paper p-5 text-ink">
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <p className="text-caption uppercase tracking-widest text-muted">Reservations</p>
          <h1 className="font-display text-title font-bold">{data.view === "day" ? formatDay(data.date) : `${formatDay(data.date)} – ${formatDay(addDays(data.date, 6))}`}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Date">
          <button type="button" className={plainButton} aria-label={data.view === "day" ? "Previous day" : "Previous week"} onClick={() => change({ date: addDays(data.date, -step) })}>
            ‹
          </button>
          <input aria-label="Date" type="date" className={field} value={query.date} onChange={(e) => e.target.value && change({ date: e.target.value })} />
          <button type="button" className={plainButton} aria-label={data.view === "day" ? "Next day" : "Next week"} onClick={() => change({ date: addDays(data.date, step) })}>
            ›
          </button>
          <button type="button" className={plainButton} disabled={busy || preview} onClick={today}>
            Today
          </button>
        </div>
        <div className="flex gap-2" role="group" aria-label="View">
          {(["day", "week"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={data.view === v} className={`${plainButton} aria-pressed:bg-ink aria-pressed:text-paper`} onClick={() => change({ view: v })}>
              {v === "day" ? "Day" : "Week"}
            </button>
          ))}
        </div>
      </header>

      <section aria-label="Search and filters" className="mt-4 flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            change({ search: query.search });
          }}
        >
          <input aria-label="Search guest, phone or reference" placeholder="Search guest, phone or reference" className={`${field} min-w-64`} value={query.search} onChange={(e) => setQuery((q) => ({ ...q, search: e.target.value }))} />
          <button type="submit" className={plainButton}>
            Search
          </button>
        </form>
        <select aria-label="Status filter" className={field} value={query.status} onChange={(e) => change({ status: e.target.value })}>
          <option value="">All statuses</option>
          {STATUSES.map((x) => (
            <option key={x} value={x}>
              {x.replace("_", " ")}
            </option>
          ))}
        </select>
        <select aria-label="Zone filter" className={field} value={query.zoneId} onChange={(e) => change({ zoneId: e.target.value })}>
          <option value="">All zones</option>
          {data.zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
        <select aria-label="Table filter" className={field} value={query.tableId} onChange={(e) => change({ tableId: e.target.value })}>
          <option value="">All tables</option>
          {data.tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.code}
            </option>
          ))}
        </select>
        <select aria-label="Source filter" className={field} value={query.source} onChange={(e) => change({ source: e.target.value })}>
          <option value="">All sources</option>
          {data.sources.map((x) => (
            <option key={x} value={x}>
              {x.replace("_", " ")}
            </option>
          ))}
        </select>
        <input aria-label="Party size filter" type="number" min={1} placeholder="Party size" className={`${field} w-32`} value={query.partySize} onChange={(e) => change({ partySize: e.target.value })} />
      </section>

      {data.mayOperate && (
        <section aria-label="New reservation" className="mt-4 flex flex-wrap items-end gap-2 rounded-card border border-line bg-surface p-3">
          <label className="text-caption font-semibold">
            Guest
            <input aria-label="New reservation guest" className={`${field} mt-1 block`} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Guest name" />
          </label>
          <label className="text-caption font-semibold">
            Party
            <input type="number" min={1} max={50} className={`${field} mt-1 block w-20`} value={newParty} onChange={(e) => setNewParty(Number(e.target.value))} />
          </label>
          <label className="text-caption font-semibold">
            Time (outlet)
            <input type="datetime-local" className={`${field} mt-1 block`} value={newWhen} onChange={(e) => setNewWhen(e.target.value)} />
          </label>
          <button type="button" className="min-h-11 rounded-input bg-brand px-4 font-semibold text-white disabled:opacity-50" disabled={!newName || !newWhen || busy || preview} onClick={() => void create()}>
            Create reservation
          </button>
        </section>
      )}

      {notice && (
        <p role={notice.kind === "error" ? "alert" : "status"} className={`mt-4 rounded-input border p-3 ${notice.kind === "error" ? "border-danger text-danger" : "border-line text-ink"}`}>
          {notice.text}
        </p>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-6" aria-busy={busy}>
          {!days.length && <p className="rounded-card border border-line bg-surface p-6 text-muted">No reservations for this period.</p>}
          {days.map((day) => (
            <section key={day.date} aria-label={day.label} data-date={day.date}>
              {data.view === "week" && <h2 className="mb-2 font-display text-section font-bold">{day.label}</h2>}
              <div className="space-y-4">
                {day.slots.map((slot) => (
                  <section key={slot.clock}>
                    <h3 className="mb-2 text-body font-bold text-muted">{slot.label}</h3>
                    <div className="space-y-2">
                      {slot.items.map((r) => (
                        <ReservationCard key={r.id} r={r} selected={r.id === selectedId} onSelect={() => setSelectedId(r.id)} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </section>
          ))}
        </section>
        <aside className="rounded-card border border-line bg-surface p-5" aria-label="Reservation details">
          {selected ? <Drawer key={selected.id} reservation={selected} data={data} preview={preview} onDone={reload} onClose={() => setSelectedId(null)} /> : <p className="text-muted">Select a reservation.</p>}
        </aside>
      </div>
      <ReservationCompanion data={data} />
    </main>
  );
}

function ReservationCard({ r, selected, onSelect }: { r: CalendarReservation; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onSelect} className="block min-h-20 w-full rounded-card border border-line bg-surface p-4 text-left focus-visible:outline-2 focus-visible:outline-brand aria-pressed:border-brand">
      <div className="flex flex-wrap justify-between gap-2">
        <strong>{r.name}</strong>
        <span className="rounded-full border border-line px-2 py-0.5 text-caption">{r.status.replace("_", " ")}</span>
      </div>
      <p className="mt-1 text-body">
        {r.partySize} guests · {r.assignments.map((a) => a.code).join(" + ") || "Unassigned"} · {r.source.replace("_", " ")}
      </p>
      {r.occasion && <p className="text-caption text-muted">{r.occasion}</p>}
      {r.lateMinutes > 0 && <p className="text-caption font-semibold text-warning">{r.lateMinutes} min late</p>}
      {r.credit && (
        <p className="text-caption font-semibold text-warning">
          Credit: ₹{(r.credit.amountPaise / 100).toLocaleString("en-IN")} · {r.credit.status}
        </p>
      )}
    </button>
  );
}

function Drawer({ reservation: r, data, preview, onDone, onClose }: { reservation: CalendarReservation; data: CalendarData; preview: boolean; onDone: () => void; onClose: () => void }) {
  const tz = data.timezone;
  const original = drawerForm(r, tz);
  const [state, setState] = useState(original);
  // Keyed by booking id too; values typed for another booking can never be saved onto this one
  const form = formFor(state, r, tz);
  const set = (patch: Partial<typeof form>) => setState({ ...form, ...patch });
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  const act = async (fn: () => Promise<CalendarResult<unknown>>) => {
    if (preview) return;
    setWorking(true);
    setError("");
    const res = await fn();
    setWorking(false);
    if (!res.ok) return setError(res.message);
    onDone();
  };
  const patch = detailsPatch(r, form);
  const tablesChanged = [...form.tableIds].sort().join() !== [...original.tableIds].sort().join();
  const chosenCodes = data.tables.filter((t) => form.tableIds.includes(t.id)).map((t) => t.code);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-display text-section font-bold">{r.publicReference ?? r.name}</h2>
        <button type="button" className={plainButton} onClick={onClose} aria-label="Close details">
          ✕
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body">
        <dt className="text-muted">Guest</dt>
        <dd>{r.name}</dd>
        <dt className="text-muted">Phone</dt>
        <dd>{r.phone ?? "—"}</dd>
        <dt className="text-muted">When</dt>
        <dd>
          {formatDay(original.when.slice(0, 10))} · {formatTime(r.startAt, tz)}–{formatTime(r.expectedEndAt, tz)}
        </dd>
        <dt className="text-muted">Party</dt>
        <dd>{r.partySize} guests</dd>
        <dt className="text-muted">Status</dt>
        <dd>
          <strong>{r.status.replace("_", " ")}</strong>
        </dd>
        <dt className="text-muted">Tables</dt>
        <dd>{r.assignments.map((a) => a.code).join(" + ") || "Unassigned"}</dd>
        {r.occasion && (
          <>
            <dt className="text-muted">Occasion</dt>
            <dd>{r.occasion}</dd>
          </>
        )}
        {r.seatingPreference && (
          <>
            <dt className="text-muted">Seating</dt>
            <dd>{r.seatingPreference}</dd>
          </>
        )}
      </dl>
      {r.notes && <p className="text-muted">{r.notes}</p>}

      {error && (
        <p role="alert" className="rounded-input border border-danger p-3 text-danger">
          {error}
        </p>
      )}

      {data.mayEdit && canEditDetails(r) && (
        <fieldset className="space-y-2 border-t border-line pt-3">
          <legend className="text-caption font-semibold uppercase text-muted">Guest details</legend>
          <label className="block text-body font-semibold">
            Guest name
            <input className={`${field} mt-1 w-full`} value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="block text-body font-semibold">
            Phone
            <input className={`${field} mt-1 w-full`} inputMode="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
          </label>
          <button type="button" className="min-h-11 w-full rounded-input bg-brand px-3 font-semibold text-white disabled:opacity-50" disabled={working || !Object.keys(patch).length} onClick={() => void act(() => editDetailsAction(r.id, patch))}>
            Save guest
          </button>
        </fieldset>
      )}

      {data.mayEdit && canReschedule(r) && (
        <fieldset className="space-y-2 border-t border-line pt-3">
          <legend className="text-caption font-semibold uppercase text-muted">Reschedule</legend>
          <label className="block text-body font-semibold">
            New time (outlet)
            <input type="datetime-local" className={`${field} mt-1 w-full`} value={form.when} onChange={(e) => set({ when: e.target.value })} />
          </label>
          <button type="button" className={`${plainButton} w-full`} disabled={working || form.when === original.when} onClick={() => void act(() => reservationRescheduleAction(r.id, form.when, r.partySize))}>
            Save new time
          </button>
        </fieldset>
      )}

      {data.mayOperate && canReassign(r) && (
        <fieldset className="space-y-2 border-t border-line pt-3">
          <legend className="text-caption font-semibold uppercase text-muted">Tables</legend>
          <div className="flex flex-wrap gap-2">
            {data.tables.map((t) => {
              const on = form.tableIds.includes(t.id);
              return (
                <label key={t.id} className={`flex min-h-11 items-center gap-1 rounded-input border px-2 ${on ? "border-brand" : "border-line"}`}>
                  <input type="checkbox" checked={on} onChange={() => set({ tableIds: on ? form.tableIds.filter((x) => x !== t.id) : [...form.tableIds, t.id] })} />
                  {t.code} <span className="text-caption text-muted">({t.maxSeats})</span>
                </label>
              );
            })}
          </div>
          <button type="button" className={`${plainButton} w-full`} disabled={working || !form.tableIds.length || !tablesChanged} onClick={() => void act(() => reservationReassignAction(r.id, form.tableIds))}>
            Reassign tables
          </button>
        </fieldset>
      )}

      <div className="space-y-2 border-t border-line pt-3">
        {data.mayOperate && canArrive(r) && (
          <button type="button" className={`${plainButton} w-full`} disabled={working} onClick={() => void act(() => reservationArriveAction(r.id))}>
            Mark arrived
          </button>
        )}
        {data.mayOperate && canSeat(r) && (
          <button type="button" className={`${plainButton} w-full`} disabled={working || !form.tableIds.length} onClick={() => void act(() => reservationSeatAction(r.id, form.tableIds))}>
            {chosenCodes.length ? `Seat at ${chosenCodes.join(" + ")}` : "Seat"}
          </button>
        )}
        {data.mayOperate && r.canNoShow && (
          <button type="button" className={`${plainButton} w-full`} disabled={working} onClick={() => void act(() => reservationNoShowAction(r.id))}>
            No-show
          </button>
        )}
        {data.mayOperate && canCancel(r) && (
          <button type="button" className="min-h-11 w-full rounded-input bg-danger px-3 font-semibold text-white disabled:opacity-50" disabled={working} onClick={() => void act(() => reservationCancelAction(r.id))}>
            Cancel reservation
          </button>
        )}
      </div>
    </div>
  );
}
