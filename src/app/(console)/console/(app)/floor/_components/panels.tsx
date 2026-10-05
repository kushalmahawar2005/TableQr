"use client";

import { TableQr } from "./table-qr";
import { ArrowDown01Icon, ArrowUp01Icon, Calendar03Icon, DragDropVerticalIcon, Notification01Icon, PauseIcon, PlayIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatRupees } from "@/domain/menu-price";
import type { FloorData, FloorTable, TableDetail } from "@/server/floor/read";
import type { S1Copy } from "../_copy";
import { bookingTablesReady, combinableFree, inProgress } from "./floor-logic";
import { Pill, StateChip, btnDanger, btnLine, btnPrimary, btnQuiet, focus } from "./ui";

export type TableAction = "seat" | "seat_booking" | "check_in" | "move" | "swap" | "combine" | "manage" | "extend" | "cleaning" | "ready" | "clear" | "block" | "unblock";

type Shared = { c: S1Copy; clock: (ms: number) => string; now: number; disabled: boolean };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="text-body font-semibold text-ink">{children}</dd>
    </div>
  );
}

export function TablePanel({
  table,
  detail,
  data,
  c,
  clock,
  now,
  disabled,
  onAction,
}: Shared & { table: FloorTable | null; detail: TableDetail | null; data: FloorData; onAction: (a: TableAction) => void }) {
  if (!table) return <p className="p-5 text-body text-muted">{c.selectTable}</p>;
  const v = table.visit;
  const d = detail?.tableId === table.id ? detail.visit : null;
  const may = data.may;
  const codeOf = new Map(data.tables.map((t) => [t.id, t.code]));
  const minutes = v ? Math.max(0, Math.floor((now - v.openedAt) / 60_000)) : 0;
  const over = v ? Math.floor((now - v.expectedEndAt) / 60_000) : 0;
  const b = table.booking;
  // Held = an online guest is still booking: nothing to check in or seat until it is confirmed
  const held = !!b && inProgress(b);
  const live = b && !held && !v ? bookingTablesReady(b, data) : null;
  const multi = !!b && b.tableIds.length > 1;
  const combined = !!v && v.tableIds.length > 1;
  const canAdd = !!v && combinableFree(table, data).length > 0;
  const blocker = live && !live.ready ? (live.table ? c.notReady(live.table.code, c.stateLong[live.table.visit ? "seated" : live.table.state]) : c.noTables) : null;
  const buttons: { a: TableAction; label: string; kind?: "primary" | "danger"; show: boolean; off?: boolean }[] = [
    { a: "seat", label: c.actions.seat, kind: "primary", show: may.seat && table.state === "available" },
    {
      a: "seat_booking",
      label: multi ? c.seatOn(b!.tableIds.map((id) => codeOf.get(id)).join(" + ")) : c.actions.seatBooking,
      kind: "primary",
      show: may.seat && !!b && !held && !v && (table.state === "reserved" || table.state === "available" || multi),
      off: !!blocker,
    },
    { a: "check_in", label: c.actions.checkIn, show: may.bookings && !!b && !held && b.status !== "arrived" && !v },
    { a: "extend", label: c.actions.extend, show: may.seat && !!v },
    { a: "move", label: c.actions.move, show: may.seat && !!v && !combined },
    { a: "swap", label: c.actions.swap, show: may.seat && !!v && !combined },
    { a: "manage", label: c.manageTables, show: may.seat && combined },
    { a: "combine", label: c.actions.combine, show: may.seat && !!v && !combined && canAdd },
    { a: "clear", label: c.actions.clear, show: may.seat && !!v && v.rounds === 0 && v.joined === 0 },
    { a: "cleaning", label: c.actions.cleaning, kind: "primary", show: may.reset && table.state === "paid" },
    { a: "ready", label: c.actions.ready, kind: "primary", show: may.reset && table.state === "needs_cleaning" },
    { a: "unblock", label: c.actions.unblock, show: may.block && table.state === "blocked" },
    { a: "block", label: c.actions.block, kind: "danger", show: may.block && !v && ["available", "needs_cleaning", "paid"].includes(table.state) },
  ];
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-title leading-tight font-bold text-ink">{table.code}</h2>
          <p className="text-caption text-muted">
            {c.seats(table.minSeats, table.maxSeats)} · {table.tableClass}
            {v && v.tableIds.length > 1 && ` · ${c.combinedWith(v.tableIds.filter((id) => id !== table.id).map((id) => codeOf.get(id)).join(" + "))}`}
          </p>
        </div>
        <StateChip state={table.state} label={c.stateLong[table.state]} />
      </div>

      {combined && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 rounded-card border border-line bg-paper px-3 py-2 text-body">
          <span className="font-bold text-ink">{v!.tableIds.map((id) => codeOf.get(id)).join(" + ")}</span>
          <span className="text-muted">
            · {c.combined} · {c.seats(...combinedSeats(v!.tableIds, data))}
          </span>
        </p>
      )}

      {held && b && (
        <div className="mt-4 rounded-card border border-[var(--state-held)] bg-[var(--state-held-soft)] p-3 text-[var(--state-held-text)]">
          <p className="text-body font-bold">{c.bookingInProgress}</p>
          {b.holdUntil && (
            <p className="text-body font-semibold">
              {c.heldUntil(clock(b.holdUntil))} · <span className="tabular">{c.expiresIn(Math.max(0, Math.ceil((b.holdUntil - now) / 60_000)))}</span>
            </p>
          )}
          <p className="mt-1 text-caption text-ink/75">{c.heldNote}</p>
        </div>
      )}

      {v && (
        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-card border border-line bg-paper p-3">
          <Fact label={c.party}>
            {c.guests(v.partySize)}
            {v.guestName && <span className="block truncate text-caption font-normal text-muted">{v.guestName}</span>}
          </Fact>
          <Fact label={c.seatedFor}>
            <span className="tabular">{c.minutes(minutes)}</span>
          </Fact>
          <Fact label={c.expectedEnd}>
            <span className={`tabular ${over > 0 ? "text-danger" : ""}`}>
              {clock(v.expectedEndAt)}
              {over > 0 && <span className="block text-caption">{c.over(over)}</span>}
            </span>
          </Fact>
          <Fact label={v.billTotalPaise !== null ? c.billTotal : c.ordered}>
            <span className="tabular">{formatRupees(v.billTotalPaise ?? v.orderedPaise)}</span>
            <span className="block text-caption font-normal text-muted">{c.rounds(v.rounds)}</span>
          </Fact>
        </dl>
      )}

      {table.state === "blocked" && table.blocked && (
        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-card border border-dashed border-[var(--state-blocked)] bg-[var(--state-blocked-soft)] p-3">
          <Fact label={c.blockedReason}>
            {c.reasons[table.blocked.reason ?? "other"]}
            {table.blocked.note && <span className="block text-caption font-normal text-muted">{table.blocked.note}</span>}
          </Fact>
          <Fact label={c.blockedUntil}>{table.blocked.until ? clock(table.blocked.until) : c.untilUnblocked}</Fact>
        </dl>
      )}
      {table.state === "blocked" && !may.block && <p className="mt-2 text-caption text-muted">{c.managerOnly}</p>}

      {table.booking && !v && !held && (
        <div className="mt-4 rounded-card border border-line p-3">
          <p className="flex items-center gap-1.5 text-caption font-semibold text-muted">
            <HugeiconsIcon icon={Calendar03Icon} size={14} aria-hidden />
            {table.state === "reserved" || table.state === "held" ? c.booking : c.nextBooking}
          </p>
          <p className="mt-1 text-body font-semibold text-ink">
            {table.booking.name} · {c.guests(table.booking.partySize)} · <span className="tabular">{clock(table.booking.startAt)}</span>
            {multi && <span className="text-muted"> · {table.booking.tableIds.map((id) => codeOf.get(id)).join(" + ")}</span>}
          </p>
          <BookingChips b={table.booking} c={c} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {buttons
          .filter((btn) => btn.show)
          .map((btn) => (
            <button key={btn.a} type="button" disabled={disabled || btn.off} onClick={() => onAction(btn.a)} className={btn.kind === "primary" ? btnPrimary : btn.kind === "danger" ? btnDanger : btnLine}>
              {btn.label}
            </button>
          ))}
      </div>
      {blocker && !held && (
        <p role="note" className="mt-2 text-caption font-semibold text-danger">
          {blocker}
        </p>
      )}

      {v && (
        <div className="mt-5 space-y-4">
          <section>
            <h3 className="text-caption font-bold tracking-wide text-muted uppercase">{c.people}</h3>
            {d && d.people.length ? (
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {d.people.map((p) => (
                  <li key={p.id}>
                    <Pill tone={p.paidOut ? "good" : "neutral"}>
                      {p.name ?? c.guest}
                      {p.isHost && ` · ${c.host}`}
                      {p.paidOut && ` · ${c.paidOut}`}
                    </Pill>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-body text-muted">{c.noPhones}</p>
            )}
          </section>
          <section>
            <h3 className="text-caption font-bold tracking-wide text-muted uppercase">{c.orders}</h3>
            {d && d.rounds.length ? (
              <ul className="mt-1 divide-y divide-line rounded-card border border-line">
                {d.rounds.map((r) => (
                  <li key={r.roundNo} className="flex justify-between gap-3 px-3 py-2 text-body">
                    <span>
                      {c.round(r.roundNo)} · <span className="tabular">{clock(r.placedAt)}</span>
                    </span>
                    <span className="text-muted">
                      {c.items(r.items)} · {c.orderStatus[r.status] ?? r.status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-body text-muted">{c.noOrders}</p>
            )}
          </section>
          <section>
            <h3 className="text-caption font-bold tracking-wide text-muted uppercase">{c.kitchen}</h3>
            {d && d.kitchen.length ? (
              <ul className="mt-1 space-y-0.5 text-body">
                {d.kitchen.map((k, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="truncate">
                      {k.qty} × {k.name}
                    </span>
                    <span className="text-caption text-muted">{c.orderStatus[k.status] ?? k.status}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-body text-muted">{c.nothingCooking}</p>
            )}
          </section>
          {d && d.requests.length > 0 && (
            <section>
              <h3 className="text-caption font-bold tracking-wide text-muted uppercase">{c.serviceRequests}</h3>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {d.requests.map((r) => (
                  <li key={r.id}>
                    <Pill tone={r.escalated ? "bad" : "warn"}>
                      <HugeiconsIcon icon={Notification01Icon} size={12} aria-hidden />
                      {c.requestKinds[r.kind] ?? r.kind} · {c.minutes(r.minutes)}
                      {r.escalated && ` · ${c.escalated}`}
                    </Pill>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {d?.reservation && (
            <section>
              <h3 className="text-caption font-bold tracking-wide text-muted uppercase">{c.booking}</h3>
              <p className="mt-1 text-body">
                {d.reservation.name} · {c.guests(d.reservation.partySize)} · <span className="tabular">{clock(d.reservation.startAt)}</span>
                {d.reservation.occasion && ` · ${d.reservation.occasion}`}
              </p>
              {d.reservation.notes && <p className="text-caption text-muted">{d.reservation.notes}</p>}
            </section>
          )}
        </div>
      )}
      <TableQr tableId={table.id} canSheet={data.roles.some((r) => r === "owner" || r === "manager")} />
    </div>
  );
}

function BookingChips({ b, c }: { b: FloorData["arrivals"][number]; c: S1Copy }) {
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {b.status === "arrived" ? <Pill tone="good">{c.arrived}</Pill> : b.confirmed ? <Pill tone="good">{c.confirmed}</Pill> : b.noReply ? <Pill tone="warn">{c.noReply}</Pill> : <Pill>{c.unconfirmed}</Pill>}
      {b.lateMinutes > 0 && <Pill tone="bad">{c.late(b.lateMinutes)}</Pill>}
      {b.occasion && <Pill tone="info">{b.occasion}</Pill>}
    </span>
  );
}

export function ArrivalsPanel({
  data,
  c,
  clock,
  disabled,
  onCheckIn,
  onSeat,
  onNoShow,
  onReassign,
}: Shared & { data: FloorData; onCheckIn: (id: string) => void; onSeat: (id: string) => void; onNoShow: (id: string) => void; onReassign: (id: string) => void }) {
  const codeOf = new Map(data.tables.map((t) => [t.id, t.code]));
  const may = data.may;
  // Only bookings with tables are checked here; one without tables opens the table picker
  const arrivalBlocker = (a: FloorData["arrivals"][number]) => {
    if (a.tableIds.length === 0) return null;
    const r = bookingTablesReady(a, data);
    return r.ready ? null : r.table ? c.notReady(r.table.code, c.stateLong[r.table.visit ? "seated" : r.table.state]) : c.noTables;
  };
  return (
    <div className="p-4">
      <h2 className="text-caption font-bold tracking-wide text-muted uppercase">{c.arrivals}</h2>
      {data.arrivals.length === 0 ? (
        <p className="mt-3 rounded-card border border-dashed border-line p-6 text-center text-body text-muted">{c.noArrivals}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {data.arrivals.map((a) => (
            <li key={a.id} className={`rounded-card border bg-surface p-3 ${a.lateMinutes > 0 ? "border-danger/40" : "border-line"}`}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 text-body font-bold text-ink">
                  <span className="mr-2 tabular">{clock(a.startAt)}</span>
                  {a.name}
                </p>
                <span className="shrink-0 text-body font-semibold text-ink">{c.guests(a.partySize)}</span>
              </div>
              <p className="mt-0.5 text-caption text-muted">{a.tableIds.length ? a.tableIds.map((id) => codeOf.get(id)).join(" + ") : c.noTable}</p>
              <BookingChips b={a} c={c} />
              {a.notes && <p className="mt-1 text-caption text-ink/80">{a.notes}</p>}
              {may.seat && arrivalBlocker(a) && <p className="mt-1 text-caption font-semibold text-danger">{arrivalBlocker(a)}</p>}
              {may.bookings && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {a.status !== "arrived" && (
                    <button type="button" disabled={disabled} onClick={() => onCheckIn(a.id)} className={btnLine}>
                      {c.actions.checkIn}
                    </button>
                  )}
                  {may.seat && (
                    <button type="button" disabled={disabled || !!arrivalBlocker(a)} onClick={() => onSeat(a.id)} className={btnPrimary}>
                      {a.tableIds.length > 1 ? c.seatOn(a.tableIds.map((id) => codeOf.get(id)).join(" + ")) : c.seatParty}
                    </button>
                  )}
                  <button type="button" disabled={disabled} onClick={() => onReassign(a.id)} className={btnQuiet}>
                    {c.reassign}
                  </button>
                  {a.canNoShow && (
                    <button type="button" disabled={disabled} onClick={() => onNoShow(a.id)} className={btnDanger}>
                      {c.noShow}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {/* Message guest appears only when a real messaging provider is connected */}
    </div>
  );
}

export function WaitlistPanel({
  data,
  c,
  disabled,
  onAdd,
  onSeat,
  onNotify,
  onSkip,
  onLeft,
  onMove,
  onDragStart,
  onDragEnd,
}: Shared & {
  data: FloorData;
  onAdd: () => void;
  onSeat: (id: string) => void;
  onNotify: (id: string) => void;
  onSkip: (id: string) => void;
  onLeft: (id: string) => void;
  onMove: (id: string, toIndex: number) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  const may = data.may.waitlist;
  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-caption font-bold tracking-wide text-muted uppercase">{c.waitlist}</h2>
        {may && (
          <button type="button" disabled={disabled} onClick={onAdd} className={btnPrimary}>
            <HugeiconsIcon icon={PlusSignIcon} size={16} aria-hidden />
            {c.addWalkIn}
          </button>
        )}
      </div>
      {data.waitlist.length === 0 ? (
        <p className="mt-3 rounded-card border border-dashed border-line p-6 text-center text-body text-muted">{c.noWaitlist}</p>
      ) : (
        <>
          <p className="mt-2 text-caption text-muted">{c.dragHint}</p>
          <ol className="mt-2 space-y-2">
            {data.waitlist.map((w, i) => {
              const over = w.quotedMinutes !== null && w.waitedMinutes > w.quotedMinutes;
              return (
                <li
                  key={w.id}
                  draggable={may && !disabled}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/x-waitlist", w.id);
                    e.dataTransfer.effectAllowed = "move";
                    onDragStart(w.id);
                  }}
                  onDragEnd={onDragEnd}
                  className="rounded-card border border-line bg-surface p-3"
                >
                  <div className="flex items-start gap-2">
                    <HugeiconsIcon icon={DragDropVerticalIcon} size={18} className="mt-0.5 shrink-0 cursor-grab text-muted" aria-hidden />
                    <span className="mt-0.5 w-5 shrink-0 text-body font-bold text-muted tabular">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="text-body font-bold text-ink">{w.name}</span>
                        <span className="text-body font-semibold">{c.guests(w.partySize)}</span>
                      </p>
                      <p className={`text-caption ${over ? "font-semibold text-danger" : "text-muted"}`}>
                        {c.waiting(w.waitedMinutes)}
                        {w.quotedMinutes !== null && ` · ${c.quoted(w.quotedMinutes)}`}
                      </p>
                      {w.status === "notified" && (
                        <span className="mt-1 inline-block">
                          <Pill tone="info">{c.notified}</Pill>
                        </span>
                      )}
                      {w.notes && <p className="mt-1 text-caption text-ink/80">{w.notes}</p>}
                    </div>
                  </div>
                  {may && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <button type="button" disabled={disabled} onClick={() => onSeat(w.id)} className={btnPrimary}>
                        {c.seatParty}
                      </button>
                      {w.status === "waiting" && (
                        <button type="button" disabled={disabled} onClick={() => onNotify(w.id)} className={btnLine}>
                          {c.notify}
                        </button>
                      )}
                      <button type="button" disabled={disabled} onClick={() => onSkip(w.id)} className={btnQuiet}>
                        {c.skip}
                      </button>
                      <button type="button" disabled={disabled} onClick={() => onLeft(w.id)} className={btnQuiet}>
                        {c.remove}
                      </button>
                      <span className="ml-auto flex">
                        <button type="button" disabled={disabled || i === 0} onClick={() => onMove(w.id, i - 1)} aria-label={`${c.moveUp}: ${w.name}`} className={`grid size-11 place-items-center rounded-input text-muted hover:bg-ink/5 disabled:opacity-40 ${focus}`}>
                          <HugeiconsIcon icon={ArrowUp01Icon} size={18} aria-hidden />
                        </button>
                        <button type="button" disabled={disabled || i === data.waitlist.length - 1} onClick={() => onMove(w.id, i + 1)} aria-label={`${c.moveDown}: ${w.name}`} className={`grid size-11 place-items-center rounded-input text-muted hover:bg-ink/5 disabled:opacity-40 ${focus}`}>
                          <HugeiconsIcon icon={ArrowDown01Icon} size={18} aria-hidden />
                        </button>
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}

export function TonightPanel({ data, c, clock, now, disabled, onPause, onExtra }: Shared & { data: FloorData; onPause: (paused: boolean) => void; onExtra: (slotStartAt: number) => void }) {
  const p = data.pacing;
  const tone = { normal: "var(--state-available)", near: "var(--state-held)", full: "var(--state-seated)" } as Record<string, string>;
  return (
    <div className="p-4">
      <section className={`rounded-card border p-3 ${p.paused ? "border-[var(--state-held)] bg-[var(--state-held-soft)]" : "border-line bg-surface"}`}>
        <p className="text-caption font-bold tracking-wide text-muted uppercase">{c.online}</p>
        <p className="mt-1 text-body font-bold text-ink">{p.paused ? c.onlinePaused : c.onlineOpen}</p>
        <p className="text-caption text-muted">{c.pauseHint}</p>
        {data.may.pause && (
          <button type="button" disabled={disabled} onClick={() => onPause(!p.paused)} className={`${p.paused ? btnPrimary : btnLine} mt-2`}>
            <HugeiconsIcon icon={p.paused ? PlayIcon : PauseIcon} size={16} aria-hidden />
            {p.paused ? c.resume : c.pause}
          </button>
        )}
      </section>
      <h2 className="mt-4 text-caption font-bold tracking-wide text-muted uppercase">{c.tonight}</h2>
      {p.slots.length === 0 ? (
        <p className="mt-2 text-body text-muted">{c.noSlots}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {/* Tonight from the last hour on; earlier slots are history */}
          {p.slots.filter((s) => s.startAt + 90 * 60_000 > now).map((s) => {
            const past = s.startAt + 30 * 60_000 <= now;
            const share = Math.min(1, s.capacity ? s.covers / s.capacity : 1);
            return (
              <li key={s.startAt} className={`grid grid-cols-[4.75rem_1fr_auto] items-center gap-2 ${past ? "opacity-50" : ""}`}>
                <span className="text-body font-semibold text-ink tabular">{clock(s.startAt)}</span>
                <span className="relative h-6 overflow-hidden rounded-input border border-line bg-paper" role="img" aria-label={`${c.covers(s.covers, s.capacity)} · ${c.pacingStates[s.state]}`}>
                  <span className="absolute inset-y-0 left-0" style={{ width: `${share * 100}%`, background: tone[s.state], opacity: 0.85 }} />
                  <span className="relative flex h-full items-center justify-between px-2 text-caption font-semibold text-ink">
                    <span className="tabular">{c.covers(s.covers, s.capacity)}</span>
                    <span>{past ? c.past : c.pacingStates[s.state]}</span>
                  </span>
                </span>
                {data.may.capacity && !past ? (
                  <button type="button" disabled={disabled} onClick={() => onExtra(s.startAt)} className={`${btnQuiet} min-h-9 px-2 text-caption`} aria-label={`${c.extraCovers} ${clock(s.startAt)}`}>
                    {c.extraCovers}
                  </button>
                ) : (
                  <span />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function combinedSeats(ids: string[], data: FloorData): [number, number] {
  const ts = ids.map((id) => data.tables.find((t) => t.id === id)).filter((t): t is FloorTable => !!t);
  return [ts.reduce((n, t) => n + t.minSeats, 0), ts.reduce((n, t) => n + t.maxSeats, 0)];
}
