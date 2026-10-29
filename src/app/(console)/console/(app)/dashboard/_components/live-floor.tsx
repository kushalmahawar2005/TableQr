import { Calendar, ChevronRight, Lock, Receipt, User, Utensils, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import type { DashboardData, TableTileItem } from "@/server/staff/dashboard";
import { focusRing, money, viewAllClass } from "./dashboard-shared";

/** How many tiles the dashboard previews before handing over to the full floor (spec §9) */
export const FLOOR_PREVIEW_LIMIT = 12;

/** Operationally relevant first: bill/seated, then reserved/held, available, blocked */
const stateRank = (state: string) =>
  state === "bill_requested" ? 0 : state === "seated" ? 1 : state === "reserved" || state === "held" ? 2 : state === "blocked" ? 4 : 3;

export function floorPreview(tiles: TableTileItem[]): TableTileItem[] {
  return tiles
    .map((t, i) => ({ t, i }))
    .sort((a, b) => stateRank(a.t.state) - stateRank(b.t.state) || a.i - b.i)
    .slice(0, FLOOR_PREVIEW_LIMIT)
    .map(({ t }) => t);
}

/** A small floor gets larger tiles; the dashboard stays readable as the table count grows. */
export function floorGridClass(count: number): string {
  if (count <= 1) return "grid-cols-1 max-w-sm";
  if (count === 2) return "grid-cols-2 max-w-xl";
  if (count <= 4) return "grid-cols-2";
  if (count <= 6) return "grid-cols-2 sm:grid-cols-3";
  return "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4";
}

export function floorTileClass(count: number): string {
  return count <= 4 ? "min-h-[124px] p-3.5" : "min-h-[106px] p-3";
}

/**
 * Live Floor, sized by the tables that actually exist:
 * - few tables → fewer, larger tiles and a compact card (no invented filler, no empty void)
 * - many tables → bounded preview of the most relevant tables + a clear way to the full floor
 * Column counts follow the tile count, so a 4-table café never gets a 5-column skeleton.
 */
export function LiveFloor({ data }: { data: DashboardData }) {
  const t = data.operations.tables;
  const tiles = data.operations.tableTiles || [];
  const preview = floorPreview(tiles);
  const hidden = tiles.length - preview.length;
  const n = preview.length;
  const gridClass = floorGridClass(n);
  const tileClass = floorTileClass(n);

  return (
    <section className="rounded-card border border-line bg-surface p-3 sm:p-5" aria-label="Live Floor">
      <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h2 className="font-display text-section font-bold text-ink">Live Floor</h2>
          <div className="sm:hidden">
            <Link href="/console/floor" className={viewAllClass}>
              <span>View all</span>
              <ChevronRight className="size-3.5 text-muted" aria-hidden="true" />
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-ink">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-1.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: "var(--state-available)" }} aria-hidden="true" />
            Available <strong className="tabular font-bold">{t.available}</strong>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-1.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: "var(--state-seated)" }} aria-hidden="true" />
            Occupied <strong className="tabular font-bold">{t.seated + t.billRequested}</strong>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-1.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: "var(--state-reserved)" }} aria-hidden="true" />
            Reserved <strong className="tabular font-bold">{t.reserved}</strong>
          </span>
          {t.blocked > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-1.5">
              <span className="size-2 rounded-full" style={{ backgroundColor: "var(--state-blocked)" }} aria-hidden="true" />
              Blocked <strong className="tabular font-bold">{t.blocked}</strong>
            </span>
          )}
        </div>
        <div className="hidden sm:block">
          <Link href="/console/floor" className={viewAllClass}>
            <span>View all</span>
            <ChevronRight className="size-3.5 text-muted" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <div className="mt-4">
        {tiles.length === 0 ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 py-1 text-[13px] font-medium text-muted">
            <span className="inline-flex items-center gap-2">
              <UtensilsCrossed className="size-4 text-muted/60" aria-hidden="true" />
              No tables set up on the floor yet.
            </span>
            <Link href="/console/floor" className={`font-semibold text-forest hover:underline underline-offset-4 ${focusRing}`}>Open Floor Plan</Link>
          </p>
        ) : (
          <>
            <div className={`grid gap-3 ${gridClass}`}>
              {preview.map((table) => {
                const isOccupied = table.state === "seated" || table.state === "bill_requested";
                const isBillReq = table.state === "bill_requested";
                const isReserved = table.state === "reserved" || table.state === "held";
                const isBlocked = table.state === "blocked";
                const isCleaning = table.state === "cleaning";
                const isPaid = table.state === "paid";

                let stateVar = "available";
                let statusLabel = "Available";
                let Icon = Utensils;
                if (isBillReq) { stateVar = "bill"; statusLabel = "Bill requested"; Icon = Receipt; }
                else if (isOccupied) { stateVar = "seated"; statusLabel = "Seated"; Icon = User; }
                else if (isReserved) { stateVar = "reserved"; statusLabel = table.state === "held" ? "Held" : "Reserved"; Icon = Calendar; }
                else if (isCleaning) { stateVar = "cleaning"; statusLabel = "Cleaning"; Icon = UtensilsCrossed; }
                else if (isPaid) { stateVar = "paid"; statusLabel = "Paid"; Icon = Receipt; }
                else if (isBlocked) { stateVar = "blocked"; statusLabel = "Blocked"; Icon = Lock; }

                return (
                  <Link
                    key={table.id}
                    href="/console/floor"
                    aria-label={`Table ${table.code}, ${statusLabel}, ${table.seats} seats${table.runningPaise !== undefined ? `, ${table.runningAmountKind === "bill" ? "bill due" : "orders so far"} ${money(table.runningPaise)}` : ""}`}
                    className={`group flex flex-col justify-between rounded-input border transition-shadow hover:shadow-float ${tileClass} ${focusRing}`}
                    style={{
                      backgroundColor: `var(--state-${stateVar}-soft)`,
                      borderColor: `var(--state-${stateVar})`,
                      color: `var(--state-${stateVar}-text)`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      <span className="font-display text-base font-bold text-ink">{table.code}</span>
                    </div>
                    <div>
                      <p className="text-xs font-bold leading-tight">{statusLabel}</p>
                      <p className="mt-0.5 text-xs font-medium leading-tight text-ink/70">
                        {table.seats} seats{isOccupied && table.guests ? ` · ${table.guests} guests` : ""}
                      </p>
                      {isOccupied && table.runningPaise !== undefined && (
                        <p className="mt-1 text-xs font-semibold leading-tight text-ink tabular">
                          {table.runningAmountKind === "bill" ? "Bill due" : table.runningPaise > 0 ? "Orders so far" : "No orders yet"}
                          {(table.runningPaise > 0 || table.runningAmountKind === "bill") && <> · {money(table.runningPaise)}</>}
                        </p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
            {hidden > 0 && (
              <p className="mt-3 text-[13px] font-medium text-muted">
                + {hidden} more {hidden === 1 ? "table" : "tables"} on the floor ·{" "}
                <Link href="/console/floor" className={`font-semibold text-forest hover:underline underline-offset-4 ${focusRing}`}>View all</Link>
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
