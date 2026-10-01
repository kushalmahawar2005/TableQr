"use client";

import { Calendar03Icon, Invoice01Icon, Notification01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { FloorData, FloorTable } from "@/server/floor/read";
import type { S1Copy } from "../_copy";
import { STATE_STYLE, focus } from "./ui";

/** Grid unit of the floor map in px: tables are drawn from their stored x/y/width/height */
const UNIT = 46;

export function FloorMap({
  data,
  c,
  zoneId,
  selectedId,
  now,
  clock,
  dropping,
  onSelect,
  onDrop,
}: {
  data: FloorData;
  c: S1Copy;
  zoneId: string | null;
  selectedId: string | null;
  now: number;
  clock: (ms: number) => string;
  dropping: boolean;
  onSelect: (t: FloorTable) => void;
  onDrop: (t: FloorTable, entryId: string) => void;
}) {
  const zones = data.layout.zones.filter((z) => !zoneId || z.id === zoneId);
  const codeOf = new Map(data.tables.map((t) => [t.id, t.code]));
  if (data.tables.length === 0) return <p className="m-6 rounded-card border border-dashed border-line bg-surface p-8 text-center text-body text-muted">{c.emptyFloor}</p>;
  return (
    <div className="space-y-4 p-4">
      {zones.map((zone) => {
        const tables = data.tables.filter((t) => t.zoneId === zone.id);
        if (!tables.length) return null;
        const cols = Math.max(...tables.map((t) => t.x + t.w));
        const rows = Math.max(...tables.map((t) => t.y + t.h));
        return (
          <section key={zone.id} aria-labelledby={`zone-${zone.id}`} className="rounded-card border border-line bg-surface">
            <h2 id={`zone-${zone.id}`} className="flex items-center justify-between border-b border-line px-4 py-2 text-body font-bold text-ink">
              {zone.name}
              <span className="text-caption font-semibold text-muted">
                {tables.filter((t) => t.state === "available").length} {c.states.available.toLowerCase()} · {tables.length}
              </span>
            </h2>
            <div className="overflow-x-auto p-3">
              <ul className="relative" style={{ width: cols * UNIT, height: rows * UNIT }}>
                {tables.map((t) => (
                  <li key={t.id} className="absolute" style={{ left: t.x * UNIT, top: t.y * UNIT, width: t.w * UNIT - 8, height: t.h * UNIT - 8 }}>
                    <Tile t={t} c={c} now={now} clock={clock} selected={selectedId === t.id} dropping={dropping} codeOf={codeOf} onSelect={onSelect} onDrop={onDrop} />
                  </li>
                ))}
              </ul>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Tile({
  t,
  c,
  now,
  clock,
  selected,
  dropping,
  codeOf,
  onSelect,
  onDrop,
}: {
  t: FloorTable;
  c: S1Copy;
  now: number;
  clock: (ms: number) => string;
  selected: boolean;
  dropping: boolean;
  codeOf: Map<string, string>;
  onSelect: (t: FloorTable) => void;
  onDrop: (t: FloorTable, entryId: string) => void;
}) {
  const st = STATE_STYLE[t.state] ?? STATE_STYLE.available;
  const v = t.visit;
  const minutes = v ? Math.max(0, Math.floor((now - v.openedAt) / 60_000)) : 0;
  const overBy = v ? Math.floor((now - v.expectedEndAt) / 60_000) : 0;
  const others = v && v.tableIds.length > 1 ? v.tableIds.filter((id) => id !== t.id).map((id) => codeOf.get(id)).join("+") : null;
  const canDrop = dropping && t.state === "available";
  const summary = [
    t.code,
    c.stateLong[t.state],
    v ? c.guests(v.partySize) : c.seats(t.minSeats, t.maxSeats),
    v ? `${c.seatedFor} ${c.minutes(minutes)}` : null,
    t.booking && !v ? `${t.booking.name} ${clock(t.booking.startAt)}` : null,
    others ? c.combinedWith(others) : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={summary}
      onClick={() => onSelect(t)}
      onDragOver={(e) => {
        if (canDrop) e.preventDefault();
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData("text/x-waitlist");
        if (canDrop && id) {
          e.preventDefault();
          onDrop(t, id);
        }
      }}
      className={`flex size-full flex-col justify-between overflow-hidden border-2 p-1.5 text-left transition-shadow ${focus} ${t.shape === "round" ? "rounded-[22px] px-2" : "rounded-card"} ${selected ? "shadow-[0_0_0_3px_var(--surface),0_0_0_6px_var(--ink)]" : ""} ${canDrop ? "outline-2 outline-offset-2 outline-dashed outline-ink" : ""}`}
      style={{ borderColor: st.tone, background: st.soft, color: st.text, borderStyle: t.state === "blocked" ? "dashed" : "solid" }}
    >
      <span className="flex items-start justify-between gap-1">
        <span className="font-display text-section leading-none font-bold text-ink">{t.code}</span>
        {v && v.openRequests > 0 && <HugeiconsIcon icon={Notification01Icon} size={14} className="shrink-0 text-danger" aria-hidden />}
        {t.state === "bill_requested" && <HugeiconsIcon icon={Invoice01Icon} size={14} className="shrink-0" aria-hidden />}
      </span>
      <span className="min-w-0 text-label leading-tight font-semibold">
        {v ? (
          <>
            <span className="flex items-center gap-1 text-ink">
              <HugeiconsIcon icon={UserGroupIcon} size={11} aria-hidden />
              {v.partySize}
              <span className={`tabular ${overBy > 0 ? "text-danger" : ""}`}>· {minutes < 100 ? `${minutes}m` : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`}</span>
            </span>
            {others && <span className="block truncate text-muted">+{others}</span>}
          </>
        ) : t.booking && (t.state === "reserved" || t.state === "held") ? (
          <span className="flex items-center gap-1 truncate text-ink">
            <HugeiconsIcon icon={Calendar03Icon} size={11} aria-hidden />
            <span className="tabular">{clock(t.booking.startAt)}</span>
          </span>
        ) : (
          <span className="block text-muted">{t.maxSeats}</span>
        )}
        <span className="mt-0.5 flex min-w-0 items-center gap-1">
          <HugeiconsIcon icon={st.icon} size={11} className="shrink-0" aria-hidden />
          <span className="truncate">{c.states[t.state]}</span>
        </span>
      </span>
    </button>
  );
}
