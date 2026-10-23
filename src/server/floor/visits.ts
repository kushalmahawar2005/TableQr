import "server-only";
import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { diningMinutesFor, overlaps, type BookingPolicy } from "@/domain/booking-policy";
import type { Tx } from "../db-types";
import { AppError } from "../errors";
import { assignTable } from "./assignments";
import { LIVE_BOOKING } from "./sync";
import { shiftWaiterId } from "../staff/waiter-coverage";

// Building blocks for floor actions: locking tables, finding the visit at a table, checking
// capacity and bookings, and opening a staff-seated visit. Everything runs inside the caller's
// transaction and is scoped by tenant and outlet.

export type Scope = { tenantId: string; outletId: string };
export type TableRow = typeof s.diningTables.$inferSelect;

/** Locks tables in id order (so two actions never deadlock); throws if any is not on this outlet's floor */
export async function lockTables(tx: Tx, scope: Scope, ids: string[]): Promise<Map<string, TableRow>> {
  const unique = [...new Set(ids.map(String))];
  if (unique.length === 0) throw new AppError("not_found", "Choose a table.");
  const rows = await tx
    .select()
    .from(s.diningTables)
    .where(and(eq(s.diningTables.tenantId, scope.tenantId), eq(s.diningTables.outletId, scope.outletId), inArray(s.diningTables.id, unique)))
    .orderBy(s.diningTables.id)
    .for("update");
  if (rows.length !== unique.length) throw new AppError("not_found", "That table is not on this floor.");
  return new Map(rows.map((r) => [r.id, r]));
}

/** The live visit holding a table, with all its tables; null if the table is free */
export async function visitAt(tx: Tx, scope: Scope, tableId: string) {
  const [row] = await tx
    .select({ session: s.tableSessions })
    .from(s.sessionTables)
    .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.sessionTables.tenantId), eq(s.tableSessions.id, s.sessionTables.sessionId)))
    .where(and(eq(s.sessionTables.tenantId, scope.tenantId), eq(s.sessionTables.outletId, scope.outletId), eq(s.sessionTables.activeKey, tableId), ne(s.tableSessions.status, "closed")));
  if (!row) return null;
  const assigned = await tx
    .select({ tableId: s.sessionTables.tableId, isPrimary: s.sessionTables.isPrimary })
    .from(s.sessionTables)
    .where(and(eq(s.sessionTables.tenantId, scope.tenantId), eq(s.sessionTables.sessionId, row.session.id), isNotNull(s.sessionTables.activeKey)));
  const people = await tx
    .select({ id: s.participants.id })
    .from(s.participants)
    .where(and(eq(s.participants.tenantId, scope.tenantId), eq(s.participants.sessionId, row.session.id), isNull(s.participants.removedAt)));
  return { session: row.session, tableIds: assigned.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).map((a) => a.tableId), people: people.length };
}

/** Guests in a visit for capacity checks: the size staff gave, or the phones that joined */
export const partyOf = (v: { session: { partySize: number | null }; people: number }) => Math.max(v.session.partySize ?? 0, v.people, 1);

/** When a visit is expected to free its tables */
export function expectedEnd(session: { expectedEndAt: Date | null; openedAt: Date; partySize: number | null }, people: number, policy: BookingPolicy): Date {
  return session.expectedEndAt ?? new Date(session.openedAt.getTime() + diningMinutesFor(Math.max(session.partySize ?? 0, people, 1), policy) * 60_000);
}

export function assertSeats(tables: TableRow[], partySize: number) {
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 50) throw new AppError("invalid_state", "Enter how many guests.", { reason: "party_size" });
  const seats = tables.reduce((n, t) => n + t.maxSeats, 0);
  if (partySize > seats) {
    throw new AppError("conflict", `${tables.map((t) => t.code).join(" + ")} seats ${seats}. Choose a bigger table or combine tables.`, { reason: "capacity", seats });
  }
}

/** Tables may be used together only as configured: each joined to the group by combinableWith */
export function assertCombinable(tables: TableRow[]) {
  if (tables.length < 2) return;
  const linked = (a: TableRow, b: TableRow) => (a.combinableWith ?? []).includes(b.id) || (b.combinableWith ?? []).includes(a.id);
  const group = [tables[0]];
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of tables) {
      if (!group.includes(t) && group.some((g) => linked(g, t))) {
        group.push(t);
        grew = true;
      }
    }
  }
  if (group.length !== tables.length) throw new AppError("conflict", "These tables are not set up to be combined.", { reason: "not_combinable" });
}

export type BookingConflict = { reservationId: string; name: string; partySize: number; startAt: Date; tableId: string };

/**
 * Bookings on these tables that a party sitting from `from` until `until` would run into, keeping
 * the turnover gap. `exceptReservationId` is the booking being seated or moved itself.
 */
export async function bookingConflicts(tx: Tx, scope: Scope, tableIds: string[], from: Date, until: Date, policy: BookingPolicy, exceptReservationId?: string | null) {
  if (tableIds.length === 0) return [];
  const rows = await tx
    .select({ reservationId: s.reservations.id, name: s.reservations.name, partySize: s.reservations.partySize, startAt: s.reservations.startAt, endAt: s.reservations.expectedEndAt, tableId: s.reservationTables.tableId })
    .from(s.reservationTables)
    .innerJoin(s.reservations, and(eq(s.reservations.tenantId, s.reservationTables.tenantId), eq(s.reservations.id, s.reservationTables.reservationId)))
    .where(and(eq(s.reservationTables.tenantId, scope.tenantId), eq(s.reservations.outletId, scope.outletId), inArray(s.reservationTables.tableId, tableIds), inArray(s.reservations.status, LIVE_BOOKING)));
  const gap = policy.turnoverBufferMinutes * 60_000;
  return rows
    .filter((r) => r.reservationId !== exceptReservationId && overlaps(from.getTime(), until.getTime(), r.startAt.getTime(), r.endAt.getTime(), gap))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .map((r): BookingConflict => ({ reservationId: r.reservationId, name: r.name, partySize: r.partySize, startAt: r.startAt, tableId: r.tableId }));
}

export const bookingConflictError = (c: BookingConflict, timeZone: string, extra: Record<string, unknown> = {}) =>
  new AppError("conflict", `Booked for ${c.name} (${c.partySize}) at ${clock(c.startAt, timeZone)}.`, {
    reason: "booking",
    reservationId: c.reservationId,
    name: c.name,
    startAt: c.startAt.getTime(),
    ...extra,
  });

export const clock = (at: Date, timeZone: string) => new Intl.DateTimeFormat("en-IN", { timeZone, hour: "numeric", minute: "2-digit" }).format(at);

/**
 * Staff seat a party: one visit across the given tables, with nobody in it yet. The first phone
 * that scans any of these tables joins it and becomes host (session.ts).
 */
export async function openVisit(
  tx: Tx,
  scope: Scope,
  tables: TableRow[],
  opts: {
    source: "walk_in" | "reservation" | "waitlist";
    partySize: number;
    guestName: string | null;
    expectedEndAt: Date;
    reservationId?: string | null;
    userId: string;
    now: Date;
  },
) {
  const [outlet] = await tx
    .select({ mode: s.outlets.sessionMode })
    .from(s.outlets)
    .where(and(eq(s.outlets.tenantId, scope.tenantId), eq(s.outlets.id, scope.outletId)));
  const primary = tables[0];
  const sessionId = uuidv7();
  await tx.insert(s.tableSessions).values({
    id: sessionId,
    tenantId: scope.tenantId,
    outletId: scope.outletId,
    tableId: primary.id,
    waiterUserId: await shiftWaiterId(tx, scope, primary.id, opts.now),
    mode: outlet.mode,
    status: "open",
    source: opts.source,
    partySize: opts.partySize,
    guestName: opts.guestName?.trim().slice(0, 80) || null,
    expectedEndAt: opts.expectedEndAt,
    openedByUserId: opts.userId,
    reservationId: opts.reservationId ?? null,
    hostParticipantId: null,
    openKey: primary.id,
    openedAt: opts.now,
    lastActivityAt: opts.now,
  });
  for (const [i, t] of tables.entries()) {
    await assignTable(tx, { ...scope, sessionId }, t.id, { primary: i === 0, userId: opts.userId, now: opts.now });
  }
  await tx
    .update(s.diningTables)
    .set({ state: "seated", stateChangedAt: opts.now })
    .where(and(eq(s.diningTables.tenantId, scope.tenantId), inArray(s.diningTables.id, tables.map((t) => t.id))));
  return sessionId;
}

/** A table staff may seat a new party at: free, or held or reserved for the booking being seated */
export async function assertFreeForSeating(tx: Tx, scope: Scope, table: TableRow, opts: { reservationId?: string | null } = {}) {
  if (await visitAt(tx, scope, table.id)) throw new AppError("conflict", `${table.code} already has a party.`, { reason: "occupied", tableId: table.id });
  if (table.state === "available") return;
  if ((table.state === "reserved" || table.state === "held") && opts.reservationId) {
    const [mine] = await tx
      .select({ id: s.reservationTables.id })
      .from(s.reservationTables)
      .where(and(eq(s.reservationTables.tenantId, scope.tenantId), eq(s.reservationTables.reservationId, opts.reservationId), eq(s.reservationTables.tableId, table.id)));
    if (mine) return;
  }
  const why: Record<string, string> = {
    held: "is held for an online booking",
    reserved: "is reserved",
    seated: "already has a party",
    bill_requested: "already has a party",
    paid: "needs to be cleared first",
    needs_cleaning: "needs cleaning first",
    blocked: "is blocked",
  };
  throw new AppError("conflict", `${table.code} ${why[table.state] ?? "is not free"}.`, { reason: table.state, tableId: table.id });
}
