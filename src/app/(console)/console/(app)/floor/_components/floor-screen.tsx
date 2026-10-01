"use client";

import { WifiOff01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { BlockReason } from "@/db/schema";
import type { Lang } from "@/lib/i18n";
import type { FloorData, FloorTable, TableDetail } from "@/server/floor/read";
import {
  blockAction,
  capacityAction,
  checkInAction,
  clearEmptyAction,
  combineAction,
  extendAction,
  leftAction,
  moveAction,
  needsCleaningAction,
  noShowAction,
  notifyAction,
  pauseAction,
  readyAction,
  reassignAction,
  reorderAction,
  seatBookingAction,
  seatWaitlistAction,
  seatWalkInAction,
  setStaffLangAction,
  skipAction,
  swapAction,
  unblockAction,
  uncombineAction,
  addWaitlistAction,
  type FloorResult,
} from "../actions";
import { s1Copy, type S1Copy } from "../_copy";
import { FloorMap } from "./floor-map";
import { useFloorSync } from "./use-floor-sync";
import { ArrivalsPanel, TablePanel, TonightPanel, WaitlistPanel, type TableAction } from "./panels";
import { Dialog, ErrorNote, StateChip, Stepper, btnLine, btnPrimary, focus } from "./ui";

export type Tab = "table" | "arrivals" | "waitlist" | "tonight";
export type PickMode = "move" | "swap" | "combine" | "reassign" | "seat_booking" | "seat_waitlist";
export type FloorSheet =
  | { kind: "seat"; tableId: string; partySize?: number; error?: { message: string; latestEndAt?: number | null } }
  | { kind: "pick"; mode: PickMode; tableId?: string; reservationId?: string; entryId?: string; error?: string }
  | { kind: "block"; tableId: string; error?: string }
  | { kind: "waitlist_add"; error?: string };

/** A frozen state for the /dev/s1 review board */
export type FloorPreview = { offline?: boolean; tab?: Tab; selected?: string; zone?: string; detail?: TableDetail; sheet?: FloorSheet; notice?: { text: string; error?: boolean }; dragging?: boolean; failed?: boolean };

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function FloorScreen({ data: initial, lang, realtimeUrl, preview }: { data: FloorData; lang: Lang; realtimeUrl: string | null; preview?: FloorPreview }) {
  const c = s1Copy[lang];
  const router = useRouter();
  const navOnline = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  const online = navOnline && !preview?.offline;
  const [zone, setZone] = useState<string | null>(() => (preview?.zone ? (initial.layout.zones.find((z) => z.name === preview.zone)?.id ?? null) : null));
  const { data, now, failed, selectedId, detail, refresh, select } = useFloorSync(
    initial,
    realtimeUrl,
    !!preview,
    preview?.selected ? (initial.tables.find((t) => t.code === preview.selected)?.id ?? null) : null,
    preview?.detail ?? null,
    !!preview?.failed,
  );
  const [tab, setTab] = useState<Tab>(preview?.tab ?? (preview?.selected ? "table" : "arrivals"));
  const [sheet, setSheet] = useState<FloorSheet | null>(preview?.sheet ?? null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(preview?.notice ?? null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(!!preview?.dragging);

  const tz = data.outlet.timezone;
  const clock = useMemo(() => {
    const f = new Intl.DateTimeFormat(lang === "hi" ? "hi-IN-u-nu-latn" : "en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit" });
    return (ms: number) => f.format(ms).replace(/\s?(am|pm)$/i, (m) => m.toLowerCase());
  }, [lang, tz]);
  const selected = data.tables.find((t) => t.id === selectedId) ?? null;

  async function run(call: () => Promise<FloorResult>, onFail?: (r: Extract<FloorResult, { ok: false }>) => boolean) {
    if (preview) {
      setSheet(null);
      return;
    }
    if (busy) return;
    if (!navigator.onLine) {
      setNotice({ text: c.errors.offline, error: true });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await call();
      if (res.ok) {
        setSheet(null);
        setNotice({ text: c.done });
      } else if (res.code === "staff_signed_out") {
        router.replace("/console/login");
      } else if (!onFail?.(res)) {
        setSheet(null);
        setNotice({ text: c.errors[res.code] ?? res.message, error: true });
      }
      await refresh();
    } catch {
      setNotice({ text: c.errors.failed, error: true });
    } finally {
      setBusy(false);
    }
  }

  function onTableAction(a: TableAction) {
    if (!selected) return;
    const id = selected.id;
    if (a === "seat") setSheet({ kind: "seat", tableId: id });
    else if (a === "seat_booking" && selected.booking) void run(() => seatBookingAction(selected.booking!.id, [id]));
    else if (a === "check_in" && selected.booking) void run(() => checkInAction(selected.booking!.id));
    else if (a === "move" || a === "swap" || a === "combine") setSheet({ kind: "pick", mode: a, tableId: id });
    else if (a === "block") setSheet({ kind: "block", tableId: id });
    else if (a === "extend") void run(() => extendAction(id));
    else if (a === "uncombine") void run(() => uncombineAction(id));
    else if (a === "cleaning") void run(() => needsCleaningAction(id));
    else if (a === "ready") void run(() => readyAction(id));
    else if (a === "clear") void run(() => clearEmptyAction(id));
    else if (a === "unblock") void run(() => unblockAction(id));
  }

  const disabled = !online || busy;
  const counts = (state: string) => data.tables.filter((t) => t.state === state).length;
  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "table", label: selected ? `${c.tabs.table} ${selected.code}` : c.tabs.table },
    { id: "arrivals", label: c.tabs.arrivals, badge: data.arrivals.length },
    { id: "waitlist", label: c.tabs.waitlist, badge: data.waitlist.length },
    { id: "tonight", label: c.tabs.tonight },
  ];

  return (
    <div lang={lang} className="flex min-h-dvh flex-1 flex-col">
      {!online && (
        <div role="alert" className="sticky top-0 z-20 flex items-center gap-2 bg-danger px-4 py-2 text-body font-semibold text-white">
          <HugeiconsIcon icon={WifiOff01Icon} size={18} aria-hidden />
          {c.offline}
        </div>
      )}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2.5">
        <div className="min-w-0">
          <h1 className="font-display text-title leading-tight font-bold text-ink">{c.title}</h1>
          <p className="text-caption text-muted">
            {data.outlet.name} · <span className="tabular">{clock(now)}</span>
          </p>
        </div>
        <nav aria-label={c.title} className="flex flex-wrap gap-1">
          {[{ id: null as string | null, name: c.all }, ...data.layout.zones.map((z) => ({ id: z.id as string | null, name: z.name }))].map((z) => (
            <button key={z.id ?? "all"} type="button" aria-pressed={zone === z.id} onClick={() => setZone(z.id)} className={`min-h-10 rounded-input px-3 text-body font-semibold ${focus} ${zone === z.id ? "bg-ink text-white" : "text-muted hover:bg-ink/5 hover:text-ink"}`}>
              {z.name}
            </button>
          ))}
        </nav>
        <ul aria-label={c.legend} className="ml-auto hidden flex-wrap gap-1.5 xl:flex">
          {(["available", "reserved", "seated", "bill_requested", "needs_cleaning"] as const).map((st) => (
            <li key={st}>
              <StateChip state={st} label={`${c.states[st]} ${counts(st)}`} size="sm" />
            </li>
          ))}
        </ul>
        <div className="flex rounded-input border border-line p-0.5 text-caption font-semibold">
          {(["en", "hi"] as const).map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} onClick={() => !preview && void setStaffLangAction(l).then(() => router.refresh())} className={`min-h-9 rounded-[8px] px-2.5 ${focus} ${lang === l ? "bg-ink text-white" : "text-muted"}`}>
              {l === "en" ? "EN" : "हिं"}
            </button>
          ))}
        </div>
      </header>

      {(failed || notice) && (
        <div className="space-y-2 px-4 pt-3">
          {failed && (
            <p role="status" className="flex items-center justify-between gap-3 rounded-input border border-line bg-surface px-3 py-2 text-body">
              {c.refreshFailed}
              <button type="button" onClick={() => void refresh()} className={btnLine}>
                {c.retry}
              </button>
            </p>
          )}
          {notice && (notice.error ? <ErrorNote text={notice.text} /> : <p role="status" className="text-body font-semibold text-[var(--state-available-text)]">{notice.text}</p>)}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] lg:grid-cols-[minmax(0,1fr)_360px]">
        <main className="min-w-0 overflow-auto">
          <FloorMap
            data={data}
            c={c}
            zoneId={zone}
            selectedId={selectedId}
            now={now}
            clock={clock}
            dropping={dragging}
            onSelect={(t) => {
              select(t.id, !!t.visit);
              setTab("table");
            }}
            onDrop={(t, entryId) => {
              setDragging(false);
              void run(() => seatWaitlistAction(entryId, [t.id]));
            }}
          />
        </main>
        <aside className="flex min-h-0 flex-col border-l border-line bg-surface">
          <div role="tablist" aria-label={c.title} className="grid grid-cols-4 border-b border-line">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`relative flex min-h-12 flex-wrap items-center justify-center gap-x-1 px-1 text-center text-caption leading-tight font-bold ${focus} ${tab === t.id ? "text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-ink" : "text-muted"}`}
              >
                {t.label}
                {!!t.badge && <span className="rounded-full bg-ink px-1.5 text-label text-white tabular">{t.badge}</span>}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
            {tab === "table" && <TablePanel table={selected} detail={detail} data={data} c={c} clock={clock} now={now} disabled={disabled} onAction={onTableAction} />}
            {tab === "arrivals" && (
              <ArrivalsPanel
                data={data}
                c={c}
                clock={clock}
                now={now}
                disabled={disabled}
                onCheckIn={(id) => void run(() => checkInAction(id))}
                onNoShow={(id) => void run(() => noShowAction(id))}
                onSeat={(id) => {
                  const a = data.arrivals.find((x) => x.id === id);
                  if (a?.tableIds.length) void run(() => seatBookingAction(id, null));
                  else setSheet({ kind: "pick", mode: "seat_booking", reservationId: id });
                }}
                onReassign={(id) => setSheet({ kind: "pick", mode: "reassign", reservationId: id })}
              />
            )}
            {tab === "waitlist" && (
              <WaitlistPanel
                data={data}
                c={c}
                clock={clock}
                now={now}
                disabled={disabled}
                onAdd={() => setSheet({ kind: "waitlist_add" })}
                onSeat={(id) => setSheet({ kind: "pick", mode: "seat_waitlist", entryId: id })}
                onNotify={(id) => void run(() => notifyAction(id))}
                onSkip={(id) => void run(() => skipAction(id))}
                onLeft={(id) => void run(() => leftAction(id))}
                onMove={(id, to) => void run(() => reorderAction(id, to))}
                onDragStart={() => setDragging(true)}
                onDragEnd={() => setDragging(false)}
              />
            )}
            {tab === "tonight" && (
              <TonightPanel
                data={data}
                c={c}
                clock={clock}
                now={now}
                disabled={disabled}
                onPause={(p) => void run(() => pauseAction(p))}
                onExtra={(at) => void run(() => capacityAction(at, (data.pacing.slots.find((x) => x.startAt === at)?.extraCovers ?? 0) + 10))}
              />
            )}
          </div>
        </aside>
      </div>

      {sheet?.kind === "seat" && <SeatSheet sheet={sheet} data={data} c={c} clock={clock} busy={busy} disabled={disabled} onClose={() => setSheet(null)} run={run} setSheet={setSheet} />}
      {sheet?.kind === "pick" && <PickSheet sheet={sheet} data={data} c={c} busy={busy} disabled={disabled} onClose={() => setSheet(null)} run={run} setSheet={setSheet} />}
      {sheet?.kind === "block" && <BlockSheet sheet={sheet} data={data} c={c} disabled={disabled} now={now} onClose={() => setSheet(null)} run={run} setSheet={setSheet} />}
      {sheet?.kind === "waitlist_add" && <WaitlistSheet sheet={sheet} c={c} disabled={disabled} onClose={() => setSheet(null)} run={run} setSheet={setSheet} />}
    </div>
  );
}

type Run = (call: () => Promise<FloorResult>, onFail?: (r: Extract<FloorResult, { ok: false }>) => boolean) => Promise<void>;

function SeatSheet({ sheet, data, c, clock, busy, disabled, onClose, run, setSheet }: { sheet: Extract<FloorSheet, { kind: "seat" }>; data: FloorData; c: S1Copy; clock: (ms: number) => string; busy: boolean; disabled: boolean; onClose: () => void; run: Run; setSheet: (s: FloorSheet) => void }) {
  const table = data.tables.find((t) => t.id === sheet.tableId)!;
  const [size, setSize] = useState(sheet.partySize ?? Math.min(2, table.maxSeats));
  const [name, setName] = useState("");
  const seat = (endBy: number | null) =>
    run(
      () => seatWalkInAction(table.id, size, name || null, endBy),
      (r) => {
        if (r.code !== "conflict" && r.code !== "invalid_state") return false;
        setSheet({ ...sheet, partySize: size, error: { message: r.message, latestEndAt: (r.details?.latestEndAt as number | null) ?? null } });
        return true;
      },
    );
  return (
    <Dialog title={c.seatTitle(table.code)} onClose={onClose} closeLabel={c.close}>
      <p className="text-caption text-muted">{c.seats(table.minSeats, table.maxSeats)}</p>
      <p className="mt-3 text-body font-semibold">{c.partySize}</p>
      <div className="mt-1">
        <Stepper value={size} onChange={setSize} min={1} max={table.maxSeats} label={c.partySize} />
      </div>
      <label className="mt-4 block text-body font-semibold">
        {c.guestName}
        <input value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} className="mt-1 h-11 w-full rounded-input border border-line px-3 text-body outline-none focus:border-ink" />
      </label>
      {sheet.error && (
        <div className="mt-3">
          <ErrorNote text={sheet.error.message} />
        </div>
      )}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={btnLine}>
          {c.cancel}
        </button>
        {sheet.error?.latestEndAt && (
          <button type="button" disabled={disabled} onClick={() => void seat(sheet.error!.latestEndAt!)} className={btnLine}>
            {c.shortTurn(clock(sheet.error.latestEndAt))}
          </button>
        )}
        <button type="button" disabled={disabled || busy} onClick={() => void seat(null)} className={btnPrimary}>
          {c.confirmSeat}
        </button>
      </div>
    </Dialog>
  );
}

function PickSheet({ sheet, data, c, busy, disabled, onClose, run, setSheet }: { sheet: Extract<FloorSheet, { kind: "pick" }>; data: FloorData; c: S1Copy; busy: boolean; disabled: boolean; onClose: () => void; run: Run; setSheet: (s: FloorSheet) => void }) {
  const from = sheet.tableId ? data.tables.find((t) => t.id === sheet.tableId) : null;
  const booking = sheet.reservationId ? data.arrivals.find((a) => a.id === sheet.reservationId) : null;
  const entry = sheet.entryId ? data.waitlist.find((w) => w.id === sheet.entryId) : null;
  const party = from?.visit?.partySize ?? booking?.partySize ?? entry?.partySize ?? 1;
  const linked = new Set((from?.visit?.tableIds ?? []).flatMap((id) => data.tables.find((t) => t.id === id)?.combinableWith ?? []));
  const candidates: FloorTable[] = data.tables.filter((t) => {
    if (t.id === sheet.tableId) return false;
    if (sheet.mode === "swap") return !!t.visit && t.visit.tableIds.length === 1;
    if (sheet.mode === "combine") return t.state === "available" && linked.has(t.id);
    if (sheet.mode === "reassign") return t.state !== "blocked" && t.maxSeats >= party;
    if (sheet.mode === "seat_booking") return (t.state === "available" || booking?.tableIds.includes(t.id)) && t.maxSeats >= party;
    return t.state === "available" && t.maxSeats >= party;
  });
  const title =
    sheet.mode === "move" && from ? c.moveTitle(from.code) : sheet.mode === "swap" && from ? c.swapTitle(from.code) : sheet.mode === "combine" && from ? c.combineTitle(from.code) : booking ? c.reassignTitle(booking.name) : entry ? `${c.seatParty} ${entry.name}` : c.chooseTable;
  const zoneName = new Map(data.layout.zones.map((z) => [z.id, z.name]));
  function pick(t: FloorTable) {
    const fail = (r: Extract<FloorResult, { ok: false }>) => {
      setSheet({ ...sheet, error: r.message });
      return true;
    };
    if (sheet.mode === "move") void run(() => moveAction(sheet.tableId!, t.id), fail);
    else if (sheet.mode === "swap") void run(() => swapAction(sheet.tableId!, t.id), fail);
    else if (sheet.mode === "combine") void run(() => combineAction(sheet.tableId!, t.id), fail);
    else if (sheet.mode === "reassign") void run(() => reassignAction(sheet.reservationId!, [t.id]), fail);
    else if (sheet.mode === "seat_booking") void run(() => seatBookingAction(sheet.reservationId!, [t.id]), fail);
    else void run(() => seatWaitlistAction(sheet.entryId!, [t.id]), fail);
  }
  return (
    <Dialog title={title} onClose={onClose} closeLabel={c.close} wide>
      <p className="text-caption text-muted">{c.guests(party)}</p>
      {sheet.error && (
        <div className="mt-2">
          <ErrorNote text={sheet.error} />
        </div>
      )}
      {candidates.length === 0 ? (
        <p className="mt-3 text-body text-muted">{c.noTables}</p>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {candidates.map((t) => (
            <li key={t.id}>
              <button type="button" disabled={disabled || busy} onClick={() => pick(t)} className={`flex w-full flex-col items-start gap-1 rounded-card border border-line bg-surface p-3 text-left hover:border-ink ${focus} disabled:opacity-50`}>
                <span className="font-display text-section font-bold text-ink">{t.code}</span>
                <span className="text-caption text-muted">
                  {zoneName.get(t.zoneId)} · {c.seats(t.minSeats, t.maxSeats)}
                </span>
                <StateChip state={t.state} label={c.states[t.state]} size="sm" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function BlockSheet({ sheet, data, c, disabled, now, onClose, run, setSheet }: { sheet: Extract<FloorSheet, { kind: "block" }>; data: FloorData; c: S1Copy; disabled: boolean; now: number; onClose: () => void; run: Run; setSheet: (s: FloorSheet) => void }) {
  const table = data.tables.find((t) => t.id === sheet.tableId)!;
  const [reason, setReason] = useState<BlockReason>("maintenance");
  const [note, setNote] = useState("");
  const [until, setUntil] = useState<"none" | "h1" | "h3">("none");
  const untilAt = until === "h1" ? now + 3600_000 : until === "h3" ? now + 3 * 3600_000 : null;
  return (
    <Dialog title={c.blockTitle(table.code)} onClose={onClose} closeLabel={c.close}>
      <fieldset>
        <legend className="text-body font-semibold">{c.reason}</legend>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {(["maintenance", "private_event", "out_of_service", "other"] as const).map((r) => (
            <label key={r} className={`flex min-h-11 items-center gap-2 rounded-input border px-3 text-body ${reason === r ? "border-ink bg-ink/[0.04] font-semibold" : "border-line"}`}>
              <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} className="accent-[var(--ink)]" />
              {c.reasons[r]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mt-3 block text-body font-semibold">
        {c.note}
        <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 120))} className="mt-1 h-11 w-full rounded-input border border-line px-3 text-body outline-none focus:border-ink" />
      </label>
      <label className="mt-3 block text-body font-semibold">
        {c.until}
        <select value={until} onChange={(e) => setUntil(e.target.value as "none" | "h1" | "h3")} className="mt-1 h-11 w-full rounded-input border border-line bg-surface px-3 text-body">
          <option value="none">{c.untilOptions.none}</option>
          <option value="h1">{c.untilOptions.h1}</option>
          <option value="h3">{c.untilOptions.h3}</option>
        </select>
      </label>
      {sheet.error && (
        <div className="mt-3">
          <ErrorNote text={sheet.error} />
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={btnLine}>
          {c.cancel}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            void run(
              () => blockAction(table.id, reason, note || null, untilAt),
              (r) => {
                setSheet({ ...sheet, error: r.message });
                return true;
              },
            )
          }
          className={btnPrimary}
        >
          {c.actions.block}
        </button>
      </div>
    </Dialog>
  );
}

function WaitlistSheet({ sheet, c, disabled, onClose, run, setSheet }: { sheet: Extract<FloorSheet, { kind: "waitlist_add" }>; c: S1Copy; disabled: boolean; onClose: () => void; run: Run; setSheet: (s: FloorSheet) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [size, setSize] = useState(2);
  const [quote, setQuote] = useState("20");
  const [notes, setNotes] = useState("");
  const input = "mt-1 h-11 w-full rounded-input border border-line px-3 text-body outline-none focus:border-ink";
  return (
    <Dialog title={c.addWalkIn} onClose={onClose} closeLabel={c.close}>
      <label className="block text-body font-semibold">
        {c.name}
        <input value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} className={input} />
      </label>
      <p className="mt-3 text-body font-semibold">{c.partySize}</p>
      <div className="mt-1">
        <Stepper value={size} onChange={setSize} min={1} max={20} label={c.partySize} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block text-body font-semibold">
          {c.phone}
          <input value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value.slice(0, 15))} className={input} />
        </label>
        <label className="block text-body font-semibold">
          {c.quote}
          <input value={quote} inputMode="numeric" onChange={(e) => setQuote(e.target.value.replace(/\D/g, "").slice(0, 3))} className={input} />
        </label>
      </div>
      <label className="mt-3 block text-body font-semibold">
        {c.notes}
        <input value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 200))} className={input} />
      </label>
      {sheet.error && (
        <div className="mt-3">
          <ErrorNote text={sheet.error} />
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={btnLine}>
          {c.cancel}
        </button>
        <button
          type="button"
          disabled={disabled || !name.trim()}
          onClick={() =>
            void run(
              () => addWaitlistAction({ name, phone, partySize: size, quotedMinutes: quote ? Number(quote) : null, notes }),
              (r) => {
                setSheet({ ...sheet, error: r.message });
                return true;
              },
            )
          }
          className={btnPrimary}
        >
          {c.add}
        </button>
      </div>
    </Dialog>
  );
}
