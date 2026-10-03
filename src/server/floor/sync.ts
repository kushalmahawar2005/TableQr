import "server-only";
import { and, eq, inArray, lte, or } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import type { TableState } from "@/db/schema";
import { LOCK_THEN_READ, type Tx } from "../db-types";
import { publish, type RealtimeEvent } from "../realtime/publish";
import { topics } from "../realtime/token";
import { tableStateEvents } from "./assignments";
import { loadPolicy } from "./policy";

// Held and Reserved follow the booking book (S1): a free table shows Held while an online slot is
// being booked on it, and Reserved from shortly before a booking until it is seated, cancelled or
// marked a no-show. Seated, Bill requested, Paid, Needs cleaning and Blocked are never touched here.

/** Bookings that still claim their table */
export const LIVE_BOOKING: (typeof s.reservationStatuses)[number][] = ["requested", "confirmed", "reminded", "arrived"];

type Scope = { tenantId: string; outletId: string };

/**
 * Inside a transaction: expire online holds, lift timed blocks, then set each free table to Held,
 * Reserved or Available. Locks the tables it may change. Returns the state changes made.
 */
export async function syncTableHolds(tx: Tx, scope: Scope, now: Date, onlyTableIds?: string[]) {
  const policy = await loadPolicy(tx, scope);
  const changes: { tableId: string; state: TableState }[] = [];
  const reservationsChanged: string[] = [];

  // An online hold that ran out without being completed lets go of its table
  const expired = await tx
    .select({ id: s.reservations.id })
    .from(s.reservations)
    .where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.outletId, scope.outletId), eq(s.reservations.status, "requested"), lte(s.reservations.holdExpiresAt, now)))
    .for("update");
  if (expired.length) {
    await tx
      .update(s.reservations)
      .set({ status: "cancelled", cancelledAt: now })
      .where(and(eq(s.reservations.tenantId, scope.tenantId), inArray(s.reservations.id, expired.map((r) => r.id))));
    reservationsChanged.push(...expired.map((r) => r.id));
  }

  const tables = await tx
    .select({ id: s.diningTables.id, state: s.diningTables.state, blockedUntil: s.diningTables.blockedUntil })
    .from(s.diningTables)
    .where(
      and(
        eq(s.diningTables.tenantId, scope.tenantId),
        eq(s.diningTables.outletId, scope.outletId),
        eq(s.diningTables.isActive, true),
        onlyTableIds ? inArray(s.diningTables.id, onlyTableIds.length ? onlyTableIds : ["-"]) : undefined,
        or(inArray(s.diningTables.state, ["available", "held", "reserved"]), and(eq(s.diningTables.state, "blocked"), lte(s.diningTables.blockedUntil, now))),
      ),
    )
    .orderBy(s.diningTables.id)
    .for("update");
  if (tables.length === 0) return { changes, reservationsChanged };

  const claims = await tx
    .select({ tableId: s.reservationTables.tableId, status: s.reservations.status, startAt: s.reservations.startAt, holdExpiresAt: s.reservations.holdExpiresAt })
    .from(s.reservationTables)
    .innerJoin(s.reservations, and(eq(s.reservations.tenantId, s.reservationTables.tenantId), eq(s.reservations.id, s.reservationTables.reservationId)))
    .where(and(eq(s.reservationTables.tenantId, scope.tenantId), inArray(s.reservationTables.tableId, tables.map((t) => t.id)), inArray(s.reservations.status, LIVE_BOOKING)));

  const aheadMs = policy.reserveAheadMinutes * 60_000;
  for (const t of tables) {
    const mine = claims.filter((c) => c.tableId === t.id);
    const held = mine.some((c) => c.status === "requested" && c.holdExpiresAt && c.holdExpiresAt > now);
    // Late bookings keep the table until the host seats them or marks a no-show; old ones from an
    // earlier service day do not
    const reserved = mine.some((c) => !(c.status === "requested" && c.holdExpiresAt) && c.startAt.getTime() - aheadMs <= now.getTime() && now.getTime() - c.startAt.getTime() < 6 * 3600_000);
    const want: TableState = held ? "held" : reserved ? "reserved" : "available";
    const unblock = t.state === "blocked";
    if (want !== t.state || unblock) {
      await tx
        .update(s.diningTables)
        .set({ state: want, stateChangedAt: now, ...(unblock ? { blockedReason: null, blockedNote: null, blockedUntil: null, blockedByUserId: null } : {}) })
        .where(and(eq(s.diningTables.tenantId, scope.tenantId), eq(s.diningTables.id, t.id)));
      changes.push({ tableId: t.id, state: want });
    }
  }
  return { changes, reservationsChanged };
}

export function syncEvents(res: Awaited<ReturnType<typeof syncTableHolds>>): RealtimeEvent[] {
  return [
    ...res.changes.flatMap((c) => tableStateEvents([c.tableId], c.state)),
    ...res.reservationsChanged.map((id) => ({ topic: topics.floor, type: "reservation.updated", data: { reservationId: id } })),
  ];
}

/** Scheduled and on floor load: bring Held/Reserved in line with the clock */
export async function reconcileFloor(scope: Scope, now = new Date()) {
  const res = await db.transaction((tx) => syncTableHolds(tx, scope, now), LOCK_THEN_READ);
  await publish(scope, syncEvents(res));
  return res;
}
