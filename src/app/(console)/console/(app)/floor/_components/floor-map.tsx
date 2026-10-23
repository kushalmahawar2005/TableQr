"use client";

import {
  Calendar03Icon,
  Invoice01Icon,
  Notification01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { FloorData, FloorTable } from "@/server/floor/read";
import type { S1Copy } from "../_copy";
import { STATE_STYLE, focus } from "./ui";

/** Grid unit of the floor map in px: tables are drawn from their stored x/y/width/height */
const UNIT = 46;
/** Keep map tiles readable while still fitting typical restaurant floors into the panel. */
const MIN_SCALE = 0.46;

/** Shrinks the drawn floor to the width it is given so the whole room is visible without sideways scrolling. */
function FitCanvas({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      // The measured client width includes the horizontal padding around the canvas.
      const available = Math.max(1, el.clientWidth - 24);
      setScale(Math.max(MIN_SCALE, Math.min(1, available / width)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={box} className="overflow-x-auto p-3">
      <div style={{ width: width * scale, height: height * scale }}>
        <div
          style={{
            width,
            height,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function FloorMap({
  data,
  c,
  zoneId,
  selectedId,
  now,
  clock,
  dropping,
  view = "map",
  stateFilter = null,
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
  view?: "grid" | "map";
  stateFilter?: string | null;
  onSelect: (t: FloorTable) => void;
  onDrop: (t: FloorTable, entryId: string) => void;
}) {
  const zones = data.layout.zones.filter((z) => !zoneId || z.id === zoneId);
  const codeOf = new Map(data.tables.map((t) => [t.id, t.code]));
  if (data.tables.length === 0)
    return (
      <div className="m-4 flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface px-6 py-10 text-center shadow-sm sm:m-6">
        <span className="grid size-12 place-items-center rounded-2xl bg-forest/10 text-forest">
          <HugeiconsIcon icon={Calendar03Icon} size={22} aria-hidden />
        </span>
        <p className="mt-4 max-w-sm text-body font-semibold text-ink">
          {c.emptyFloor}
        </p>
      </div>
    );
  return (
    <div className="space-y-4 p-4">
      {zones.map((zone) => {
        const tables = data.tables.filter((t) => t.zoneId === zone.id);
        if (!tables.length) return null;
        if (view === "grid") {
          const shown = tables
            .filter((t) => !stateFilter || t.state === stateFilter)
            .sort((a, b) =>
              a.code.localeCompare(b.code, undefined, { numeric: true }),
            );
          return (
            <section
              key={zone.id}
              aria-labelledby={`zone-${zone.id}`}
              className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm"
            >
              <h2
                id={`zone-${zone.id}`}
                className="flex min-h-14 items-center justify-between gap-3 border-b border-line bg-paper/55 px-4 py-3 text-body font-bold text-ink"
              >
                {zone.name}
                <span className="text-caption font-semibold text-muted">
                  {tables.filter((t) => t.state === "available").length}{" "}
                  {c.states.available.toLowerCase()} · {tables.length}
                </span>
              </h2>
              {shown.length ? (
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,156px),1fr))] gap-3 p-4 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] sm:gap-4">
                  {shown.map((t) => (
                    <li key={t.id} className="h-[112px]">
                      <Tile
                        t={t}
                        c={c}
                        now={now}
                        clock={clock}
                        selected={selectedId === t.id}
                        dropping={dropping}
                        codeOf={codeOf}
                        onSelect={onSelect}
                        onDrop={onDrop}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-4 rounded-xl border border-dashed border-line bg-paper/50 px-4 py-6 text-center text-body text-muted">
                  No tables in this state.
                </p>
              )}
            </section>
          );
        }
        // Tables keep absolute plan coordinates. Normalize each zone to its own origin so a
        // zone placed far across the editor grid doesn't create a mostly blank map here.
        const minX = Math.min(...tables.map((t) => t.x));
        const minY = Math.min(...tables.map((t) => t.y));
        const cols = Math.max(...tables.map((t) => t.x + t.w)) - minX;
        const rows = Math.max(...tables.map((t) => t.y + t.h)) - minY;
        return (
          <section
            key={zone.id}
            aria-labelledby={`zone-${zone.id}`}
            className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm"
          >
            <h2
              id={`zone-${zone.id}`}
              className="flex min-h-14 items-center justify-between gap-3 border-b border-line bg-paper/55 px-4 py-3 text-body font-bold text-ink"
            >
              {zone.name}
              <span className="text-caption font-semibold text-muted">
                {tables.filter((t) => t.state === "available").length}{" "}
                {c.states.available.toLowerCase()} · {tables.length}
              </span>
            </h2>
            <FitCanvas width={cols * UNIT} height={rows * UNIT}>
              <ul
                className="relative"
                style={{ width: cols * UNIT, height: rows * UNIT }}
              >
                {tables.map((t) => (
                  <li
                    key={t.id}
                    className={`absolute transition-opacity ${stateFilter && t.state !== stateFilter ? "opacity-20" : ""}`}
                    style={{
                      left: (t.x - minX) * UNIT,
                      top: (t.y - minY) * UNIT,
                      width: t.w * UNIT - 8,
                      height: t.h * UNIT - 8,
                    }}
                  >
                    <Tile
                      t={t}
                      c={c}
                      now={now}
                      clock={clock}
                      selected={selectedId === t.id}
                      dropping={dropping}
                      codeOf={codeOf}
                      onSelect={onSelect}
                      onDrop={onDrop}
                    />
                  </li>
                ))}
              </ul>
            </FitCanvas>
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
  const others =
    v && v.tableIds.length > 1
      ? v.tableIds
          .filter((id) => id !== t.id)
          .map((id) => codeOf.get(id))
          .join("+")
      : null;
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
      style={{
        borderColor: st.tone,
        background: st.soft,
        color: st.text,
        borderStyle: t.state === "blocked" ? "dashed" : "solid",
      }}
    >
      <span className="flex items-start justify-between gap-1">
        <span className="font-display text-section leading-none font-bold text-ink">
          {t.code}
        </span>
        {t.assignedWaiter && <span title={t.assignedWaiter.name} aria-label={`Waiter: ${t.assignedWaiter.name}`} className="ml-auto grid size-6 shrink-0 place-items-center rounded-full border border-current/20 bg-surface text-xs font-bold text-ink">{t.assignedWaiter.name.slice(0, 1).toUpperCase()}</span>}
        {v && v.openRequests > 0 && (
          <HugeiconsIcon
            icon={Notification01Icon}
            size={14}
            className="shrink-0 text-danger"
            aria-hidden
          />
        )}
        {t.state === "bill_requested" && (
          <HugeiconsIcon
            icon={Invoice01Icon}
            size={14}
            className="shrink-0"
            aria-hidden
          />
        )}
      </span>
      <span className="min-w-0 text-label leading-tight font-semibold">
        {v ? (
          <>
            <span className="flex items-center gap-1 text-ink">
              <HugeiconsIcon icon={UserGroupIcon} size={11} aria-hidden />
              {v.partySize}
              <span className={`tabular ${overBy > 0 ? "text-danger" : ""}`}>
                ·{" "}
                {minutes < 100
                  ? `${minutes}m`
                  : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`}
              </span>
            </span>
            {others && (
              <span className="block truncate text-muted">+{others}</span>
            )}
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
          <HugeiconsIcon
            icon={st.icon}
            size={11}
            className="shrink-0"
            aria-hidden
          />
          <span className="truncate">{c.states[t.state]}</span>
        </span>
      </span>
    </button>
  );
}
