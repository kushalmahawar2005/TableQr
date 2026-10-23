"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CalendarData } from "@/server/staff/reservations";
import {
  calendarAction,
  calendarTokenAction,
  editDetailsAction,
  groupRequestStatusAction,
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
  const [newDate, setNewDate] = useState(() => initial.date);
  const [newTime, setNewTime] = useState("19:00");
  const [adding, setAdding] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newSource, setNewSource] = useState<"phone" | "walk_in" | "staff">("phone");
  const [newTable, setNewTable] = useState("");
  const [newOccasion, setNewOccasion] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [advanceReceived, setAdvanceReceived] = useState(false);
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [moreFilters, setMoreFilters] = useState(false);
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

  const updateGroupRequest = async (id: string, status: "contacted" | "cancelled") => {
    if (preview) return;
    setBusy(true);
    setNotice(null);
    const result = await groupRequestStatusAction(id, status);
    setBusy(false);
    if (!result.ok) return setNotice({ kind: "error", text: result.message });
    setData((current) => ({
      ...current,
      groupRequests: status === "cancelled" ? current.groupRequests.filter((r) => r.id !== id) : current.groupRequests.map((r) => r.id === id ? { ...r, status } : r),
    }));
    setNotice({ kind: "ok", text: status === "contacted" ? "Enquiry marked as contacted." : "Enquiry closed." });
    reload();
  };

  const create = async () => {
    if (busy) return;
    const amount = advanceReceived ? Number(advanceAmount) : 0;
    if (advanceReceived && (!Number.isSafeInteger(amount) || amount < 1 || amount > 20_000_000)) return setNotice({ kind: "error", text: "Enter a valid advance amount in rupees." });
    setBusy(true);
    setNotice(null);
    try {
      const r = await reservationCreateAction({ name: newName, phone: newPhone.trim() || null, partySize: newParty, localDateTime: `${newDate}T${newTime}`, tableIds: newTable ? [newTable] : undefined, occasion: newOccasion || null, notes: newNotes.trim() || null, source: newSource, advanceReceivedRupees: amount });
      if (!r.ok) return setNotice({ kind: "error", text: r.message });
      setNewName("");
      setNewPhone("");
      setNewTable("");
      setNewOccasion("");
      setNewNotes("");
      setAdvanceReceived(false);
      setAdvanceAmount("");
      setAdding(false);
      setNotice({ kind: "ok", text: "Reservation created." });
      reload();
    } catch {
      setNotice({ kind: "error", text: "Could not create the reservation. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  const tz = data.timezone;
  const days = groupByDateAndTime(data.reservations, tz);
  const selected = data.reservations.find((r) => r.id === selectedId) ?? null;
  const step = data.view === "week" ? 7 : 1;

  const count = (st: string) => data.reservations.filter((r) => r.status === st).length;
  const chips: [string, string][] = [["", "All"], ["confirmed", "Confirmed"], ["arrived", "Arrived"], ["seated", "Seated"], ["completed", "Done"], ["cancelled", "Cancelled"], ["no_show", "No-show"]];
  const activeFilters = [query.zoneId, query.tableId, query.source, query.partySize].filter(Boolean).length;
  const clock12 = (t: string) => { const [h, m] = t.split(":").map(Number); return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[1680px] px-4 py-5 text-ink sm:px-6 lg:px-8 lg:py-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption font-semibold text-muted">{data.reservations.length} {data.reservations.length === 1 ? "booking" : "bookings"} · {data.view === "day" ? "one day" : "this week"}</p>
          <h1 className="mt-1 font-display text-title font-bold">{data.view === "day" ? formatDay(data.date) : `${formatDay(data.date)} – ${formatDay(addDays(data.date, 6))}`}</h1>
        </div>
        {data.mayOperate && (
          <button type="button" onClick={() => { setNewDate(query.date); setAdding(true); }} disabled={preview} className="inline-flex min-h-11 items-center gap-2 rounded-input bg-brand px-4 text-button font-semibold text-white hover:bg-brand-strong disabled:opacity-50">
            <span aria-hidden="true" className="text-lg leading-none">+</span> New reservation
          </button>
        )}
      </header>

      {data.groupRequests.length > 0 && (
        <section aria-labelledby="group-enquiries-title" className="mt-5 rounded-card border border-[var(--state-held)] bg-[var(--state-held-soft)] p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="group-enquiries-title" className="font-display text-section font-bold text-ink">Large group &amp; event enquiries</h2>
              <p className="mt-1 text-body text-muted">For groups above 12. Call the guest to discuss space, timing and your event terms.</p>
            </div>
            <span className="rounded-full bg-surface px-3 py-1 text-caption font-semibold text-ink">{data.groupRequests.filter((r) => r.status === "requested").length} new</span>
          </div>
          <ul className="mt-4 grid gap-3 xl:grid-cols-2">
            {data.groupRequests.map((request) => (
              <li key={request.id} className="rounded-card border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-ink">{request.name} <span className="font-normal text-muted">· {request.partySize} guests</span></p>
                    <p className="mt-1 text-body text-muted">{formatDay(request.desiredDate)} · {formatTime(request.desiredStartAt, data.timezone)} · Ref {request.publicReference}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-caption font-semibold capitalize ${request.status === "requested" ? "bg-[var(--state-held-soft)] text-[var(--state-held-text)]" : "bg-[var(--state-cleaning-soft)] text-[var(--state-cleaning-text)]"}`}>{request.status === "requested" ? "Needs a call" : "Contacted"}</span>
                </div>
                {request.notes && <p className="mt-2 rounded-input bg-paper px-3 py-2 text-body text-muted">{request.notes}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <a href={`tel:${request.phone}`} className="inline-flex min-h-10 items-center rounded-input bg-brand px-3 text-body font-semibold text-white">Call {request.phone}</a>
                  {request.status === "requested" && <button type="button" disabled={busy || preview} onClick={() => void updateGroupRequest(request.id, "contacted")} className={`${plainButton} bg-surface`}>Mark contacted</button>}
                  <button type="button" disabled={busy || preview} onClick={() => void updateGroupRequest(request.id, "cancelled")} className={`${plainButton} bg-surface text-muted`}>Close enquiry</button>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-caption text-muted">No deposit or booking fee is collected from this enquiry. Agree any event payment terms with the guest first.</p>
        </section>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-input border border-line bg-surface p-1" role="group" aria-label="Date">
          <button type="button" className="grid size-10 place-items-center rounded-[8px] text-lg font-semibold hover:bg-ink/5" aria-label={data.view === "day" ? "Previous day" : "Previous week"} onClick={() => change({ date: addDays(data.date, -step) })}>‹</button>
          <button type="button" className="min-h-10 rounded-[8px] px-3 text-body font-semibold hover:bg-ink/5 disabled:opacity-50" disabled={busy || preview} onClick={today}>Today</button>
          <button type="button" className="grid size-10 place-items-center rounded-[8px] text-lg font-semibold hover:bg-ink/5" aria-label={data.view === "day" ? "Next day" : "Next week"} onClick={() => change({ date: addDays(data.date, step) })}>›</button>
          <input aria-label="Pick a date" type="date" className="min-h-10 rounded-[8px] border-0 bg-transparent px-2 text-body" value={query.date} onChange={(e) => e.target.value && change({ date: e.target.value })} />
        </div>
        <div className="flex rounded-input border border-line bg-surface p-1" role="group" aria-label="View">
          {(["day", "week"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={data.view === v} className="min-h-10 rounded-[8px] px-3 text-body font-semibold text-muted aria-pressed:bg-ink aria-pressed:text-paper" onClick={() => change({ view: v })}>{v === "day" ? "Day" : "Week"}</button>
          ))}
        </div>
        <form className="flex min-w-0 flex-1 gap-2 sm:max-w-md" onSubmit={(e) => { e.preventDefault(); change({ search: query.search }); }}>
          <input aria-label="Search guest, phone or reference" placeholder="Search by name, phone or booking number" className={`${field} min-w-0 flex-1`} value={query.search} onChange={(e) => setQuery((q) => ({ ...q, search: e.target.value }))} />
        </form>
        <button type="button" aria-expanded={moreFilters} onClick={() => setMoreFilters((v) => !v)} className={`${plainButton} bg-surface`}>Filters{activeFilters ? ` (${activeFilters})` : ""}</button>
      </div>

      {moreFilters && (
        <section aria-label="More filters" className="mt-3 flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-3">
          <select aria-label="Zone filter" className={field} value={query.zoneId} onChange={(e) => change({ zoneId: e.target.value })}>
            <option value="">All areas</option>
            {data.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
          <select aria-label="Table filter" className={field} value={query.tableId} onChange={(e) => change({ tableId: e.target.value })}>
            <option value="">All tables</option>
            {data.tables.map((t) => <option key={t.id} value={t.id}>{t.code}</option>)}
          </select>
          <select aria-label="Source filter" className={field} value={query.source} onChange={(e) => change({ source: e.target.value })}>
            <option value="">Any source</option>
            {data.sources.map((x) => <option key={x} value={x}>{x.replace("_", " ")}</option>)}
          </select>
          <input aria-label="Party size filter" type="number" min={1} placeholder="Guests" className={`${field} w-28`} value={query.partySize} onChange={(e) => change({ partySize: e.target.value })} />
          {activeFilters > 0 && <button type="button" className="min-h-11 px-2 text-body font-semibold underline underline-offset-4" onClick={() => change({ zoneId: "", tableId: "", source: "", partySize: "" })}>Clear filters</button>}
        </section>
      )}

      <div role="tablist" aria-label="Booking status" className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {chips.map(([value, label]) => (
          <button key={value || "all"} role="tab" aria-selected={query.status === value} onClick={() => change({ status: value })} className={`min-h-10 shrink-0 rounded-full border px-3.5 text-body font-semibold ${query.status === value ? "border-ink bg-ink text-paper" : "border-line bg-surface text-muted hover:text-ink"}`}>
            {label}{!query.status && value ? ` ${count(value)}` : ""}
          </button>
        ))}
      </div>

      {notice && (
        <p role={notice.kind === "error" ? "alert" : "status"} className={`mt-4 rounded-input border p-3 ${notice.kind === "error" ? "border-danger text-danger" : "border-line text-ink"}`}>{notice.text}</p>
      )}

      <div className={`mt-5 grid gap-5 ${selected ? "lg:grid-cols-[minmax(0,1fr)_400px]" : "grid-cols-1"}`}>
        <section className="min-w-0 space-y-6" aria-busy={busy}>
          {!days.length && (
            <div className="rounded-card border border-line bg-surface p-10 text-center">
              <p className="font-display text-section font-bold">No bookings {query.status || query.search || activeFilters ? "match" : "for this day"}</p>
              <p className="mt-1 text-body text-muted">{query.status || query.search || activeFilters ? "Try clearing the filters or search." : "When guests book online or you add one, it will show up here."}</p>
              {data.mayOperate && !query.status && !query.search && <button type="button" onClick={() => { setNewDate(query.date); setAdding(true); }} className="mt-4 inline-flex min-h-11 items-center rounded-input bg-brand px-4 text-button font-semibold text-white">+ New reservation</button>}
            </div>
          )}
          {days.map((day) => (
            <section key={day.date} aria-label={day.label} data-date={day.date}>
              {data.view === "week" && <h2 className="mb-2 font-display text-section font-bold">{day.label}</h2>}
              <div className="space-y-4">
                {day.slots.map((slot) => (
                  <section key={slot.clock} className="grid gap-2 sm:grid-cols-[84px_minmax(0,1fr)]">
                    <h3 className="pt-3 font-display text-section font-bold text-ink tabular">{slot.label}</h3>
                    <div className="space-y-2">
                      {slot.items.map((r) => <ReservationCard key={r.id} r={r} selected={r.id === selectedId} onSelect={() => setSelectedId(r.id)} />)}
                    </div>
                  </section>
                ))}
              </div>
            </section>
          ))}
        </section>
        {selected && <aside className="max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-card border border-line bg-surface p-4 sm:p-5 lg:sticky lg:top-4" aria-label="Reservation details">
          <Drawer key={selected.id} reservation={selected} data={data} preview={preview} onDone={reload} onClose={() => setSelectedId(null)} />
        </aside>}
      </div>
      <ReservationCompanion data={data} />

      {adding && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="New reservation" onClick={() => setAdding(false)} onKeyDown={(e) => { if (e.key === "Escape") setAdding(false); }}>
          <form className="no-scrollbar max-h-[92dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-[1.25rem] border border-line bg-surface p-5 shadow-modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <div className="flex items-center justify-between"><h2 className="font-display text-title font-bold">New reservation</h2><button type="button" aria-label="Close" onClick={() => setAdding(false)} className="grid size-10 place-items-center rounded-input text-muted hover:bg-ink/5">✕</button></div>
            <p className="text-body text-muted">Keep a table for a guest at the time you choose. The table is held until they arrive.</p>
            <label className="block text-body font-semibold">Guest name<input autoFocus required className={`${field} mt-1 block w-full`} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name of the person booking" /></label>
            <label className="block text-body font-semibold">Phone number <span className="font-normal text-muted">(optional, to call them if needed)</span><input type="tel" inputMode="tel" className={`${field} mt-1 block w-full`} value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="98765 43210" /></label>
            <div>
              <p className="text-body font-semibold">How many guests</p>
              <div className="mt-1 flex items-center gap-3">
                <button type="button" aria-label="One less" className="grid size-11 place-items-center rounded-input border border-line text-xl" onClick={() => setNewParty((n) => Math.max(1, n - 1))}>−</button>
                <span className="w-10 text-center font-display text-title font-bold tabular" aria-live="polite">{newParty}</span>
                <button type="button" aria-label="One more" className="grid size-11 place-items-center rounded-input border border-line text-xl" onClick={() => setNewParty((n) => Math.min(50, n + 1))}>+</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-body font-semibold">Date<input type="date" required className={`${field} mt-1 block w-full`} value={newDate} onChange={(e) => setNewDate(e.target.value)} /></label>
              <label className="block text-body font-semibold">Time<input type="time" step={900} required className={`${field} mt-1 block w-full`} value={newTime} onChange={(e) => setNewTime(e.target.value)} /><span className="mt-1 block text-caption font-normal text-muted">Choose any time in 15-minute intervals.</span></label>
            </div>
            <fieldset>
              <legend className="text-body font-semibold">Which table? <span className="font-normal text-muted">(or let the system pick)</span></legend>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" aria-pressed={!newTable} onClick={() => setNewTable("")} className={`min-h-11 rounded-input border px-3 text-body font-semibold ${!newTable ? "border-brand bg-brand-soft text-ink" : "border-line text-muted hover:text-ink"}`}>Pick for me</button>
                {data.tables.filter((t) => t.maxSeats >= newParty).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })).map((t) => (
                  <button key={t.id} type="button" aria-pressed={newTable === t.id} onClick={() => setNewTable(t.id)} className={`min-h-11 min-w-16 rounded-input border px-3 text-left leading-tight ${newTable === t.id ? "border-brand bg-brand-soft text-ink" : "border-line text-ink hover:border-ink/40"}`}>
                    <span className="block text-body font-bold">{t.code}</span>
                    <span className="block text-label text-muted">seats {t.maxSeats}</span>
                  </button>
                ))}
              </div>
              {data.tables.filter((t) => t.maxSeats >= newParty).length === 0 && <p className="mt-2 text-caption text-warning">No single table seats {newParty}. The system will combine tables if it can.</p>}
              <p className="mt-2 text-caption text-muted">{newTable ? `Table ${data.tables.find((t) => t.id === newTable)?.code} will be held for ${newName.trim() || "this guest"} at ${clock12(newTime)}.` : "A free table that fits the group is chosen for you."}</p>
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-body font-semibold">How did they book?
                <select className={`${field} mt-1 block w-full`} value={newSource} onChange={(e) => setNewSource(e.target.value as typeof newSource)}>
                  <option value="phone">Phone call</option><option value="walk_in">Walked in</option><option value="staff">Other</option>
                </select>
              </label>
              <label className="block text-body font-semibold">Occasion <span className="font-normal text-muted">(optional)</span>
                <select className={`${field} mt-1 block w-full`} value={newOccasion} onChange={(e) => setNewOccasion(e.target.value)}>
                  <option value="">None</option><option value="Birthday">Birthday</option><option value="Anniversary">Anniversary</option><option value="Business meal">Business meal</option><option value="Family gathering">Family gathering</option>
                </select>
              </label>
            </div>
            <fieldset className="rounded-card border border-line p-3">
              <legend className="px-1 text-body font-semibold">Advance received</legend>
              <label className="flex min-h-10 items-center gap-2 text-body text-ink">
                <input type="checkbox" checked={advanceReceived} onChange={(e) => { setAdvanceReceived(e.target.checked); if (!e.target.checked) setAdvanceAmount(""); }} className="size-4 accent-[var(--brand)]" />
                Guest has already paid an advance
              </label>
              {advanceReceived ? <label className="mt-2 block text-body font-semibold">Amount received
                <span className="mt-1 flex h-11 items-center rounded-input border border-line bg-surface px-3"><span className="mr-2 text-muted">₹</span><input type="number" min="1" max="20000000" step="1" required inputMode="numeric" className="min-w-0 flex-1 bg-transparent outline-none" value={advanceAmount} onChange={(e) => setAdvanceAmount(e.target.value)} placeholder="e.g. 500" /></span>
                <span className="mt-1 block text-caption font-normal text-muted">This amount will be credited on the guest’s final bill.</span>
              </label> : <p className="text-caption text-muted">Optional. Leave off if no advance was collected.</p>}
            </fieldset>
            <label className="block text-body font-semibold">Notes <span className="font-normal text-muted">(optional)</span><input className={`${field} mt-1 block w-full`} value={newNotes} onChange={(e) => setNewNotes(e.target.value)} maxLength={200} placeholder="Allergies, high chair, quiet corner…" /></label>
            <div className="sticky -bottom-5 -mx-5 flex justify-end gap-2 border-t border-line bg-surface px-5 py-3">
              <button type="button" className={plainButton} onClick={() => setAdding(false)}>Cancel</button>
              <button type="submit" className="min-h-11 rounded-input bg-brand px-4 font-semibold text-white disabled:opacity-50" disabled={!newName.trim() || !newDate || !newTime || busy || preview}>{busy ? "Creating…" : "Create reservation"}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

const STATUS_TONE: Record<string, string> = {
  requested: "bg-[var(--state-held-soft)] text-[var(--state-held-text)]",
  confirmed: "bg-[var(--state-cleaning-soft)] text-[var(--state-cleaning-text)]",
  reminded: "bg-[var(--state-cleaning-soft)] text-[var(--state-cleaning-text)]",
  arrived: "bg-[var(--state-reserved-soft)] text-[var(--state-reserved-text)]",
  seated: "bg-[var(--state-available-soft)] text-[var(--state-available-text)]",
  completed: "bg-[var(--state-paid-soft)] text-[var(--state-paid-text)]",
  cancelled: "bg-[var(--state-seated-soft)] text-[var(--state-seated-text)]",
  no_show: "bg-[var(--state-seated-soft)] text-[var(--state-seated-text)]",
};

function ReservationCard({ r, selected, onSelect }: { r: CalendarReservation; selected: boolean; onSelect: () => void }) {
  const tables = r.assignments.map((a) => a.code).join(" + ");
  return (
    <button type="button" aria-pressed={selected} onClick={onSelect} className="block w-full rounded-card border border-line bg-surface p-4 text-left transition-colors hover:border-ink/30 focus-visible:outline-2 focus-visible:outline-brand aria-pressed:border-brand aria-pressed:ring-2 aria-pressed:ring-brand/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="font-display text-section">{r.name}</strong>
        <span className={`rounded-full px-2.5 py-0.5 text-caption font-semibold capitalize ${STATUS_TONE[r.status] ?? "bg-ink/10"}`}>{r.status.replace("_", " ")}</span>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-muted">
        <span><b className="text-ink">{r.partySize}</b> {r.partySize === 1 ? "guest" : "guests"}</span>
        <span>{tables ? <>Table <b className="text-ink">{tables}</b></> : <b className="text-warning">No table yet</b>}</span>
        <span className="capitalize">{r.source.replace("_", " ")}</span>
      </p>
      {r.occasion && <p className="mt-1 text-caption text-muted">{r.occasion}</p>}
      {r.preorder.length > 0 && <p className="mt-1 text-caption font-semibold text-brand-strong">Preorder · {r.preorder.reduce((sum, line) => sum + line.qty, 0)} items · ₹{(r.preorderTotalPaise / 100).toLocaleString("en-IN")}</p>}
      {r.advanceReceivedPaise > 0 && <p className="mt-1 text-caption font-semibold text-[var(--state-available-text)]">Advance received · ₹{(r.advanceReceivedPaise / 100).toLocaleString("en-IN")}</p>}
      {r.lateMinutes > 0 && <p className="mt-1 text-caption font-semibold text-warning">{r.lateMinutes} min late</p>}
      {r.credit && <p className="mt-1 text-caption font-semibold text-warning">Credit: ₹{(r.credit.amountPaise / 100).toLocaleString("en-IN")} · {r.credit.status}</p>}
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
        <dt className="text-muted">Advance received</dt>
        <dd>{r.advanceReceivedPaise > 0 ? `₹${(r.advanceReceivedPaise / 100).toLocaleString("en-IN")} · credited on final bill` : "No advance recorded"}</dd>
        {r.preorder.length > 0 && <><dt className="text-muted">Preordered food</dt><dd>{r.preorder.map((line) => `${line.qty} × ${line.nameEn}`).join(", ")} · ₹{(r.preorderTotalPaise / 100).toLocaleString("en-IN")} advance</dd></>}
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
