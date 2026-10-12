"use client";

import { CheckmarkCircle02Icon, WifiOff01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { BlockReason } from "@/db/schema";
import type { Lang } from "@/lib/i18n";
import type { FloorData, FloorTable, TableDetail } from "@/server/floor/read";
import {
  blockAction,
  capacityAction,
  checkInAction,
  clearEmptyAction,
  closeVisitAction,
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
import * as pos from "@/server/staff/pos-actions";
import { billHtml, printHtml } from "@/app/pos/_components/bill-print";
import { combinableFree } from "./floor-logic";
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
  | { kind: "close"; tableId: string; error?: string; unpaid?: boolean }
  | { kind: "waitlist_add"; error?: string }
  | { kind: "manage"; tableId: string; error?: string };

/** A frozen state for the /dev/s1 review board */
export type FloorPreview = { offline?: boolean; tab?: Tab; selected?: string; zone?: string; detail?: TableDetail; sheet?: FloorSheet; notice?: { text: string; error?: boolean }; toast?: string; dragging?: boolean; failed?: boolean };

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
  // Success is a short toast that leaves the layout alone; problems stay inline until the next action
  const [toast, setToast] = useState<{ text: string; key: number } | null>(preview?.toast ? { text: preview.toast, key: 0 } : null);
  useEffect(() => {
    if (!toast || preview) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast, preview]);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"grid" | "map">("grid");
  const [stateFilter, setStateFilter] = useState<string | null>(null);
  const [dragging, setDragging] = useState(!!preview?.dragging);

  const tz = data.outlet.timezone;
  const clock = useMemo(() => {
    const f = new Intl.DateTimeFormat(lang === "hi" ? "hi-IN-u-nu-latn" : "en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit" });
    return (ms: number) => f.format(ms).replace(/\s?(am|pm)$/i, (m) => m.toLowerCase());
  }, [lang, tz]);
  const selected = data.tables.find((t) => t.id === selectedId) ?? null;

  async function run(call: () => Promise<FloorResult>, ok: string, onFail?: (r: Extract<FloorResult, { ok: false }>) => boolean) {
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
        setToast({ text: ok, key: Date.now() });
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

  const codeOf = (tableId: string) => data.tables.find((t) => t.id === tableId)?.code ?? "";
  const codesOf = (ids: string[]) => ids.map(codeOf).join(" + ");

  function onTableAction(a: TableAction) {
    if (!selected) return;
    const id = selected.id;
    const code = selected.code;
    const b = selected.booking;
    if (a === "seat") setSheet({ kind: "seat", tableId: id });
    // A booking is always seated on every table it holds (the server checks again)
    else if (a === "seat_booking" && b) void run(() => seatBookingAction(b.id, null), c.toast.bookingSeated(b.name, codesOf(b.tableIds)));
    else if (a === "check_in" && b) void run(() => checkInAction(b.id), c.toast.checkedIn(b.name));
    else if (a === "move" || a === "swap" || a === "combine") setSheet({ kind: "pick", mode: a, tableId: id });
    else if (a === "manage") setSheet({ kind: "manage", tableId: id });
    else if (a === "block") setSheet({ kind: "block", tableId: id });
    else if (a === "extend") void run(() => extendAction(id), c.toast.extended(code));
    else if (a === "cleaning") void run(() => needsCleaningAction(id), c.toast.cleaning(code));
    else if (a === "ready") void run(() => readyAction(id), selected.state === "paid" ? c.toast.closed(code) : c.toast.ready(code));
    else if (a === "close") setSheet({ kind: "close", tableId: id });
    else if (a === "pay" && selected.visit) router.push(`/console/billing?session=${encodeURIComponent(selected.visit.sessionId)}`);
    else if (a === "print" && selected.visit) {
      // The table's bill as it stands, on the receipt printer (same slip as Billing prints)
      const sessionId = selected.visit.sessionId;
      void pos.detailAction(sessionId).then((r) => {
        if (r.ok) printHtml(billHtml(r.data, data.outlet.name, r.data.bill?.status === "paid" ? "receipt" : "bill"));
        else setNotice({ text: r.error, error: true });
      });
    }
    else if (a === "clear") void run(() => clearEmptyAction(id), c.toast.cleared(code));
    else if (a === "unblock") void run(() => unblockAction(id), c.toast.unblocked(code));
  }

  const disabled = !online || busy;
  const nameOfBooking = (id: string) => data.arrivals.find((x) => x.id === id)?.name ?? "";
  const nameOfParty = (id: string) => data.waitlist.find((x) => x.id === id)?.name ?? "";
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
        <div role="alert" className="sticky top-0 z-20 flex sm:top-14 items-center gap-2 bg-danger px-4 py-2 text-body font-semibold text-white">
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
        <div role="group" aria-label="View" className="flex rounded-input border border-line p-0.5 text-caption font-semibold">
          {([["grid", "Tables"], ["map", "Map"]] as const).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`min-h-9 rounded-[8px] px-3 ${focus} ${view === v ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>
              {label}
            </button>
          ))}
        </div>
        <ul aria-label={c.legend} className="order-last flex w-full gap-1.5 overflow-x-auto pb-0.5 2xl:order-none 2xl:ml-auto 2xl:w-auto">
          {(["available", "held", "reserved", "seated", "bill_requested", "paid", "needs_cleaning", "blocked"] as const).map((st) => (
            <li key={st} className="shrink-0">
              <button type="button" aria-pressed={stateFilter === st} title={stateFilter === st ? "Show all tables" : `Show only ${c.states[st].toLowerCase()} tables`} onClick={() => setStateFilter(stateFilter === st ? null : st)} className={`rounded-full ${focus} ${stateFilter === st ? "ring-2 ring-ink ring-offset-1 ring-offset-surface" : stateFilter ? "opacity-50" : ""}`}>
                <StateChip state={st} label={`${c.states[st]} ${counts(st)}`} size="sm" />
              </button>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex rounded-input border border-line p-0.5 text-caption font-semibold 2xl:ml-0">
          {(["en", "hi"] as const).map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} onClick={() => !preview && void setStaffLangAction(l).then(() => router.refresh())} className={`min-h-9 rounded-[8px] px-2.5 ${focus} ${lang === l ? "bg-ink text-white" : "text-muted"}`}>
              {l === "en" ? "EN" : "हिं"}
            </button>
          ))}
        </div>
        {data.roles.some((r) => r === "owner" || r === "manager") && !preview && <Link href="/console/floor/editor" className="min-h-10 rounded-input border border-line px-3 py-2 text-body font-semibold">Edit floor plan</Link>}
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

      <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[minmax(0,1fr)_300px] lg:grid-cols-[minmax(0,1fr)_360px]">
        <main className="min-h-[60dvh] min-w-0 overflow-auto sm:min-h-0">
          <FloorMap
            data={data}
            c={c}
            zoneId={zone}
            view={view}
            stateFilter={stateFilter}
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
              void run(() => seatWaitlistAction(entryId, [t.id]), c.toast.waitlistSeated(data.waitlist.find((w) => w.id === entryId)?.name ?? "", t.code));
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
                onCheckIn={(id) => void run(() => checkInAction(id), c.toast.checkedIn(nameOfBooking(id)))}
                onNoShow={(id) => void run(() => noShowAction(id), c.toast.noShow(nameOfBooking(id)))}
                onSeat={(id) => {
                  const a = data.arrivals.find((x) => x.id === id);
                  if (a?.tableIds.length) void run(() => seatBookingAction(id, null), c.toast.bookingSeated(a.name, codesOf(a.tableIds)));
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
                onNotify={(id) => void run(() => notifyAction(id), c.toast.notified(nameOfParty(id)))}
                onSkip={(id) => void run(() => skipAction(id), c.toast.skipped(nameOfParty(id)))}
                onLeft={(id) => void run(() => leftAction(id), c.toast.left(nameOfParty(id)))}
                onMove={(id, to) => void run(() => reorderAction(id, to), c.toast.reordered)}
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
                onPause={(p) => void run(() => pauseAction(p), p ? c.toast.paused : c.toast.resumed)}
                onExtra={(at) => void run(() => capacityAction(at, (data.pacing.slots.find((x) => x.startAt === at)?.extraCovers ?? 0) + 10), c.toast.capacity(clock(at)))}
              />
            )}
          </div>
        </aside>
      </div>

      {sheet?.kind === "seat" && <SeatSheet sheet={sheet} data={data} c={c} clock={clock} busy={busy} disabled={disabled} onClose={() => setSheet(null)} run={run} setSheet={setSheet} />}
      {sheet?.kind === "pick" && <PickSheet sheet={sheet} data={data} c={c} busy={busy} disabled={disabled} onClose={() => setSheet(null)} run={run} setSheet={setSheet} />}
      {sheet?.kind === "close" && <CloseSheet sheet={sheet} data={data} c={c} disabled={disabled} onClose={() => setSheet(null)} run={run} setSheet={setSheet} />}
      {sheet?.kind === "block" && <BlockSheet sheet={sheet} data={data} c={c} disabled={disabled} now={now} onClose={() => setSheet(null)} run={run} setSheet={setSheet} />}
      {sheet?.kind === "manage" && <ManageSheet sheet={sheet} data={data} c={c} disabled={disabled} onClose={() => setSheet(null)} run={run} setSheet={setSheet} />}
      {toast && (
        <p key={toast.key} role="status" aria-live="polite" className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-input bg-ink px-4 py-2.5 text-body font-semibold text-white shadow-[var(--shadow-float)]">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} aria-hidden />
          {toast.text}
        </p>
      )}
      {sheet?.kind === "waitlist_add" && <WaitlistSheet sheet={sheet} c={c} disabled={disabled} onClose={() => setSheet(null)} run={run} setSheet={setSheet} />}
    </div>
  );
}

type Run = (call: () => Promise<FloorResult>, ok: string, onFail?: (r: Extract<FloorResult, { ok: false }>) => boolean) => Promise<void>;

function SeatSheet({ sheet, data, c, clock, busy, disabled, onClose, run, setSheet }: { sheet: Extract<FloorSheet, { kind: "seat" }>; data: FloorData; c: S1Copy; clock: (ms: number) => string; busy: boolean; disabled: boolean; onClose: () => void; run: Run; setSheet: (s: FloorSheet) => void }) {
  const table = data.tables.find((t) => t.id === sheet.tableId)!;
  const [size, setSize] = useState(sheet.partySize ?? Math.min(2, table.maxSeats));
  const [name, setName] = useState("");
  const seat = (endBy: number | null) =>
    run(
      () => seatWalkInAction(table.id, size, name || null, endBy),
      c.toast.seated(table.code),
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
    if (sheet.mode === "move") void run(() => moveAction(sheet.tableId!, t.id), c.toast.moved(t.code), fail);
    else if (sheet.mode === "swap") void run(() => swapAction(sheet.tableId!, t.id), c.toast.swapped(from?.code ?? "", t.code), fail);
    else if (sheet.mode === "combine") void run(() => combineAction(sheet.tableId!, t.id), c.toast.combined(from?.code ?? "", t.code), fail);
    else if (sheet.mode === "reassign") void run(() => reassignAction(sheet.reservationId!, [t.id]), c.toast.reassigned(booking?.name ?? "", t.code), fail);
    else if (sheet.mode === "seat_booking") void run(() => seatBookingAction(sheet.reservationId!, [t.id]), c.toast.bookingSeated(booking?.name ?? "", t.code), fail);
    else void run(() => seatWaitlistAction(sheet.entryId!, [t.id]), c.toast.waitlistSeated(entry?.name ?? "", t.code), fail);
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

/** Clears a seated table: closes the visit; money still owed needs a written reason */
function CloseSheet({ sheet, data, c, disabled, onClose, run, setSheet }: { sheet: Extract<FloorSheet, { kind: "close" }>; data: FloorData; c: S1Copy; disabled: boolean; onClose: () => void; run: Run; setSheet: (s: FloorSheet) => void }) {
  const table = data.tables.find((t) => t.id === sheet.tableId)!;
  const [reason, setReason] = useState("");
  return (
    <Dialog title={c.closeTitle(table.code)} onClose={onClose} closeLabel={c.close}>
      <p className="text-body text-muted">{c.closeBody}</p>
      {sheet.unpaid && (
        <>
          <p className="mt-3 text-body text-muted">{c.closeUnpaid}</p>
          <label className="mt-3 block text-body font-semibold">
            {c.closeReason}
            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value.slice(0, 200))} className="mt-1 h-11 w-full rounded-input border border-line px-3 text-body outline-none focus:border-ink" />
          </label>
        </>
      )}
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
          disabled={disabled || (sheet.unpaid && !reason.trim())}
          onClick={() =>
            void run(
              () => closeVisitAction(table.id, reason.trim() || null),
              c.toast.closed(table.code),
              (r) => {
                setSheet({ ...sheet, error: r.message, unpaid: sheet.unpaid || r.details?.reason === "unpaid" });
                return true;
              },
            )
          }
          className={btnPrimary}
        >
          {c.actions.close}
        </button>
      </div>
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
              c.toast.blocked(table.code),
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
              c.toast.waitlistAdded,
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

/** The tables of a combined party: which is main, which can be taken off, which can be added */
function ManageSheet({ sheet, data, c, disabled, onClose, run, setSheet }: { sheet: Extract<FloorSheet, { kind: "manage" }>; data: FloorData; c: S1Copy; disabled: boolean; onClose: () => void; run: Run; setSheet: (s: FloorSheet) => void }) {
  const table = data.tables.find((t) => t.id === sheet.tableId)!;
  const v = table.visit!;
  const tables = v.tableIds.map((id) => data.tables.find((t) => t.id === id)!).filter(Boolean);
  const addable = combinableFree(table, data);
  const codes = tables.map((t) => t.code).join(" + ");
  return (
    <Dialog title={c.manageTitle(codes)} onClose={onClose} closeLabel={c.close}>
      <p className="text-caption text-muted">
        {c.combined} · {c.seats(tables.reduce((n, t) => n + t.minSeats, 0), tables.reduce((n, t) => n + t.maxSeats, 0))} · {c.guests(v.partySize)}
      </p>
      {sheet.error && (
        <div className="mt-2">
          <ErrorNote text={sheet.error} />
        </div>
      )}
      <ul className="mt-3 divide-y divide-line rounded-card border border-line">
        {tables.map((t, i) => (
          <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span className="text-body font-semibold text-ink">
              {t.code} <span className="font-normal text-muted">· {c.seats(t.minSeats, t.maxSeats)}</span>
            </span>
            {i === 0 ? (
              <span className="text-caption font-semibold text-muted">{c.mainTable}</span>
            ) : v.status === "open" ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  void run(() => uncombineAction(t.id), c.toast.uncombined(t.code), (r) => {
                    setSheet({ ...sheet, error: r.message });
                    return true;
                  })
                }
                className={btnLine}
              >
                {c.uncombineOne(t.code)}
              </button>
            ) : (
              <span className="text-caption text-muted">{c.cantUncombineBill}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-body font-semibold">{c.addTable}</p>
      {addable.length === 0 ? (
        <p className="mt-1 text-body text-muted">{c.noMoreTables}</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {addable.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={disabled}
              onClick={() =>
                void run(() => combineAction(table.id, t.id), c.toast.combined(tables[0].code, t.code), (r) => {
                  setSheet({ ...sheet, error: r.message });
                  return true;
                })
              }
              className={btnLine}
            >
              + {t.code}
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
}
