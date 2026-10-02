import type { FloorData, FloorTable } from "@/server/floor/read";

// Small, pure rules the floor UI uses to decide which actions to offer. The server re-checks all.

type Booking = FloorData["arrivals"][number];

/** Free tables configured as combinable with any table of this party (or this table) */
export function combinableFree(table: FloorTable, data: FloorData): FloorTable[] {
  const mine = table.visit?.tableIds ?? [table.id];
  const linked = new Set(mine.flatMap((id) => data.tables.find((t) => t.id === id)?.combinableWith ?? []));
  for (const t of data.tables) if (t.combinableWith.some((id) => mine.includes(id))) linked.add(t.id);
  return data.tables.filter((t) => linked.has(t.id) && !mine.includes(t.id) && t.state === "available" && !t.visit);
}

/** An online guest is still completing this booking: nothing to check in or seat yet */
export const inProgress = (b: Pick<Booking, "held">) => b.held;

/**
 * Whether a booking can be seated now on every table it holds. A table counts as ready when it
 * is free or held/reserved for this booking, with nobody at it. Returns the first table that is not.
 */
export function bookingTablesReady(b: Booking, data: FloorData): { ready: true } | { ready: false; table: FloorTable | null } {
  if (b.tableIds.length === 0) return { ready: false, table: null };
  const seats = b.tableIds.reduce((n, id) => n + (data.tables.find((t) => t.id === id)?.maxSeats ?? 0), 0);
  for (const id of b.tableIds) {
    const t = data.tables.find((x) => x.id === id);
    if (!t) return { ready: false, table: null };
    const mine = t.booking?.id === b.id;
    const ok = !t.visit && (t.state === "available" || ((t.state === "reserved" || t.state === "held") && mine));
    if (!ok) return { ready: false, table: t };
  }
  if (seats < b.partySize) return { ready: false, table: null };
  return { ready: true };
}
