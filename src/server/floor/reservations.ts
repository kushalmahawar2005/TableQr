import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import type { ReservationStatus } from "@/db/schema";
import { diningMinutesFor } from "@/domain/booking-policy";
import { LOCK_THEN_READ, type Tx } from "../db-types";
import { AppError } from "../errors";
import { publish, type RealtimeEvent } from "../realtime/publish";
import { topics } from "../realtime/token";
import { assertMay } from "../staff/auth";
import { audit } from "../staff/audit";
import { tableStateEvents, visitChanged } from "./assignments";
import { loadPolicy } from "./policy";
import { LIVE_BOOKING, syncEvents, syncTableHolds } from "./sync";
import type { FloorActor } from "./table-actions";
import { assertCombinable, assertFreeForSeating, assertSeats, bookingConflictError, bookingConflicts, expectedEnd, lockTables, openVisit, visitAt, type Scope } from "./visits";

// Reservations (PS 4.4): Requested → Confirmed → Reminded → Arrived → Seated → Completed, or
// Cancelled / No-show. The floor's Arrivals panel works on these; B1–B4 will create them online.

const reservationEvent = (type: "reservation.created" | "reservation.updated", reservationId: string): RealtimeEvent => ({ topic: topics.floor, type, data: { reservationId } });
const scopeOf = (staff: FloorActor): Scope => ({ tenantId: staff.tenantId, outletId: staff.outletId });

async function lockReservation(tx: Tx, scope: Scope, id: string) {
  const [row] = await tx
    .select()
    .from(s.reservations)
    .where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.outletId, scope.outletId), eq(s.reservations.id, String(id))))
    .for("update");
  if (!row) throw new AppError("not_found", "This booking was not found.");
  return row;
}

/** An online slot hold that has not become a booking yet */
const isInProgress = (r: { status: string; holdExpiresAt: Date | null }, now: Date) => r.status === "requested" && !!r.holdExpiresAt && r.holdExpiresAt > now;
const inProgressError = () => new AppError("conflict", "This online booking is still in progress.", { reason: "held" });

async function tablesOf(tx: Tx, scope: Scope, reservationId: string) {
  const rows = await tx
    .select({ tableId: s.reservationTables.tableId })
    .from(s.reservationTables)
    .where(and(eq(s.reservationTables.tenantId, scope.tenantId), eq(s.reservationTables.reservationId, reservationId)));
  return rows.map((r) => r.tableId);
}

/** Checks tables can take the booking: seats, combinable, no other booking or visit in the way */
async function assertTablesFit(tx: Tx, scope: Scope, staff: FloorActor, tableIds: string[], booking: { id: string | null; partySize: number; startAt: Date; endAt: Date }, now: Date) {
  const policy = await loadPolicy(tx, scope);
  const tables = await lockTables(tx, scope, tableIds);
  const list = tableIds.map((id) => tables.get(id)!);
  assertSeats(list, booking.partySize);
  assertCombinable(list);
  const blocked = list.find((t) => t.state === "blocked" && (!t.blockedUntil || t.blockedUntil > booking.startAt));
  if (blocked) throw new AppError("conflict", `${blocked.code} is blocked.`, { reason: "blocked" });
  const [clash] = await bookingConflicts(tx, scope, tableIds, booking.startAt, booking.endAt, policy, booking.id);
  if (clash) throw bookingConflictError(clash, staff.outlet.timezone);
  // A party already at the table must be expected to leave in time
  for (const t of list) {
    const visit = await visitAt(tx, scope, t.id);
    if (visit && booking.startAt.getTime() < now.getTime() + 6 * 3600_000) {
      const leaves = expectedEnd(visit.session, visit.people, policy).getTime() + policy.turnoverBufferMinutes * 60_000;
      if (leaves > booking.startAt.getTime()) throw new AppError("conflict", `${t.code} has a party until after this booking.`, { reason: "occupied", tableId: t.id });
    }
  }
  return { policy, list };
}

async function setTables(tx: Tx, scope: Scope, reservationId: string, tableIds: string[]) {
  await tx.delete(s.reservationTables).where(and(eq(s.reservationTables.tenantId, scope.tenantId), eq(s.reservationTables.reservationId, reservationId)));
  if (tableIds.length) {
    await tx.insert(s.reservationTables).values(tableIds.map((tableId) => ({ id: uuidv7(), tenantId: scope.tenantId, reservationId, tableId })));
  }
}

/** A booking taken by staff (phone or in person). Confirmed straight away. */
export async function createReservation(
  staff: FloorActor,
  input: { name: string; phone?: string | null; partySize: number; startAt: number; tableIds?: string[]; occasion?: string | null; notes?: string | null; source?: "phone" | "walk_in" | "staff" },
  now = new Date(),
) {
  assertMay(staff, "booking.manage");
  const scope = scopeOf(staff);
  const name = String(input.name ?? "").trim().slice(0, 80);
  if (!name) throw new AppError("invalid_state", "Enter the guest's name.", { reason: "name" });
  const partySize = Number(input.partySize);
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 50) throw new AppError("invalid_state", "Enter how many guests.", { reason: "party_size" });
  const startAt = new Date(Number(input.startAt));
  if (Number.isNaN(startAt.getTime()) || startAt.getTime() < now.getTime() - 15 * 60_000) throw new AppError("invalid_state", "Choose a time from now on.", { reason: "start" });
  const tableIds = [...new Set(input.tableIds ?? [])];
  const { id, events } = await db.transaction(async (tx) => {
    const policy = await loadPolicy(tx, scope);
    const endAt = new Date(startAt.getTime() + diningMinutesFor(partySize, policy) * 60_000);
    if (tableIds.length) await assertTablesFit(tx, scope, staff, tableIds, { id: null, partySize, startAt, endAt }, now);
    const id = uuidv7();
    await tx.insert(s.reservations).values({
      id,
      tenantId: scope.tenantId,
      outletId: scope.outletId,
      name,
      phone: input.phone?.replace(/[^\d+]/g, "").slice(0, 15) || null,
      partySize,
      startAt,
      expectedEndAt: endAt,
      status: "confirmed",
      source: input.source ?? "phone",
      occasion: input.occasion?.trim().slice(0, 40) || null,
      notes: input.notes?.trim().slice(0, 300) || null,
      confirmedAt: now,
      createdByUserId: staff.userId,
      createdAt: now,
    });
    await setTables(tx, scope, id, tableIds);
    const sync = await syncTableHolds(tx, scope, now, tableIds);
    await audit(tx, staff, { action: "reservation.create", entity: "reservation", entityId: id, after: { name, partySize, startAt, tableIds }, now });
    return { id, events: [reservationEvent("reservation.created", id), ...syncEvents(sync)] };
  }, LOCK_THEN_READ);
  await publish(scope, events);
  return { reservationId: id };
}

const FROM: Record<string, ReservationStatus[]> = {
  confirm: ["requested"],
  check_in: ["requested", "confirmed", "reminded"],
  no_show: ["requested", "confirmed", "reminded"],
  cancel: ["requested", "confirmed", "reminded", "arrived"],
};

async function transition(staff: FloorActor, id: string, step: keyof typeof FROM, now: Date, reason?: string | null) {
  assertMay(staff, "booking.manage");
  const scope = scopeOf(staff);
  const events = await db.transaction(async (tx) => {
    const policy = await loadPolicy(tx, scope);
    const r = await lockReservation(tx, scope, id);
    if (!FROM[step].includes(r.status)) throw new AppError("invalid_state", `This booking is ${r.status.replace("_", " ")}.`, { status: r.status });
    // An online guest still completing a booking holds the slot; it is not a booking to check in yet
    if (step === "check_in" && isInProgress(r, now)) throw inProgressError();
    let to: ReservationStatus;
    const patch: Partial<typeof s.reservations.$inferInsert> = {};
    if (step === "confirm") {
      to = "confirmed";
      patch.confirmedAt = now;
      patch.holdExpiresAt = null;
    } else if (step === "check_in") {
      to = "arrived";
      patch.arrivedAt = now;
    } else if (step === "no_show") {
      // Never early: the party has the grace period to arrive
      const allowedAt = r.startAt.getTime() + policy.graceMinutes * 60_000;
      if (now.getTime() < allowedAt) throw new AppError("conflict", `Wait until ${policy.graceMinutes} minutes after the booking time.`, { reason: "grace", allowedAt });
      to = "no_show";
      patch.noShowAt = now;
      if (r.guestId) {
        await tx.update(s.guests).set({ noShowCount: sql`${s.guests.noShowCount} + 1` }).where(and(eq(s.guests.tenantId, scope.tenantId), eq(s.guests.id, r.guestId)));
      }
    } else {
      to = "cancelled";
      patch.cancelledAt = now;
    }
    await tx.update(s.reservations).set({ status: to, ...patch }).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, r.id)));
    const sync = await syncTableHolds(tx, scope, now, await tablesOf(tx, scope, r.id));
    await audit(tx, staff, { action: `reservation.${step}`, entity: "reservation", entityId: r.id, before: { status: r.status }, after: { status: to }, reason: reason ?? null, now });
    return [reservationEvent("reservation.updated", r.id), ...syncEvents(sync)];
  }, LOCK_THEN_READ);
  await publish(scope, events);
}

export const confirmReservation = (staff: FloorActor, id: string, now = new Date()) => transition(staff, id, "confirm", now);
export const checkInReservation = (staff: FloorActor, id: string, now = new Date()) => transition(staff, id, "check_in", now);
export const markNoShow = (staff: FloorActor, id: string, now = new Date()) => transition(staff, id, "no_show", now);
export const cancelReservation = (staff: FloorActor, id: string, reason?: string | null, now = new Date()) => transition(staff, id, "cancel", now, reason);

/** Give a booking different tables (one, or a configured combination) */
export async function reassignReservation(staff: FloorActor, input: { reservationId: string; tableIds: string[] }, now = new Date()) {
  assertMay(staff, "booking.manage");
  const scope = scopeOf(staff);
  const tableIds = [...new Set((input.tableIds ?? []).map(String))];
  if (tableIds.length === 0) throw new AppError("invalid_state", "Choose a table.");
  const events = await db.transaction(async (tx) => {
    const r = await lockReservation(tx, scope, input.reservationId);
    if (!LIVE_BOOKING.includes(r.status)) throw new AppError("invalid_state", `This booking is ${r.status.replace("_", " ")}.`, { status: r.status });
    const before = await tablesOf(tx, scope, r.id);
    await assertTablesFit(tx, scope, staff, tableIds, { id: r.id, partySize: r.partySize, startAt: r.startAt, endAt: r.expectedEndAt }, now);
    await setTables(tx, scope, r.id, tableIds);
    const sync = await syncTableHolds(tx, scope, now, [...new Set([...before, ...tableIds])]);
    await audit(tx, staff, { action: "reservation.reassign", entity: "reservation", entityId: r.id, before: { tableIds: before }, after: { tableIds }, now });
    return [reservationEvent("reservation.updated", r.id), ...syncEvents(sync)];
  }, LOCK_THEN_READ);
  await publish(scope, events);
}

/** Seat a booked party at its tables (or the tables given): opens the visit and links it */
export async function seatReservation(staff: FloorActor, input: { reservationId: string; tableIds?: string[] }, now = new Date()) {
  assertMay(staff, "floor.seat");
  const scope = scopeOf(staff);
  const { sessionId, events } = await db.transaction(async (tx) => {
    const policy = await loadPolicy(tx, scope);
    const r = await lockReservation(tx, scope, input.reservationId);
    if (!["requested", "confirmed", "reminded", "arrived"].includes(r.status)) throw new AppError("invalid_state", `This booking is ${r.status.replace("_", " ")}.`, { status: r.status });
    if (isInProgress(r, now)) throw inProgressError();
    const assigned = await tablesOf(tx, scope, r.id);
    const tableIds = input.tableIds?.length ? [...new Set(input.tableIds.map(String))] : assigned;
    // A booking on combined tables is seated on all of them, never quietly on one part
    if (assigned.length > 1 && tableIds.length < assigned.length && tableIds.every((t) => assigned.includes(t))) {
      throw new AppError("conflict", "This booking needs all its tables. Seat it on all of them or reassign it first.", { reason: "partial_tables" });
    }
    if (tableIds.length === 0) throw new AppError("invalid_state", "Choose a table for this booking.", { reason: "no_table" });
    const tables = await lockTables(tx, scope, tableIds);
    const list = tableIds.map((id) => tables.get(id)!);
    for (const t of list) await assertFreeForSeating(tx, scope, t, { reservationId: assigned.includes(t.id) ? r.id : null });
    assertSeats(list, r.partySize);
    assertCombinable(list);
    const until = new Date(now.getTime() + diningMinutesFor(r.partySize, policy) * 60_000);
    const [clash] = await bookingConflicts(tx, scope, tableIds, now, until, policy, r.id);
    if (clash) throw bookingConflictError(clash, staff.outlet.timezone);
    const sessionId = await openVisit(tx, scope, list, { source: "reservation", partySize: r.partySize, guestName: r.name, expectedEndAt: until, reservationId: r.id, userId: staff.userId, now });
    await tx
      .update(s.reservations)
      .set({ status: "seated", seatedAt: now, arrivedAt: r.arrivedAt ?? now, sessionId })
      .where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, r.id)));
    if (tableIds.join() !== assigned.join()) await setTables(tx, scope, r.id, tableIds);
    const sync = await syncTableHolds(tx, scope, now, assigned.filter((id) => !tableIds.includes(id)));
    await audit(tx, staff, { action: "reservation.seat", entity: "reservation", entityId: r.id, before: { status: r.status }, after: { status: "seated", sessionId, tableIds }, now });
    return { sessionId, events: [reservationEvent("reservation.updated", r.id), ...tableStateEvents(tableIds, "seated"), visitChanged(sessionId, "seated"), ...syncEvents(sync)] };
  }, LOCK_THEN_READ);
  await publish(scope, events);
  return { sessionId };
}


/** Live bookings for a set of tables, used by the floor read */
export async function liveBookingsOn(run: Tx | typeof db, scope: Scope, tableIds: string[]) {
  if (!tableIds.length) return [];
  return run
    .select({ id: s.reservations.id, tableId: s.reservationTables.tableId, name: s.reservations.name, partySize: s.reservations.partySize, startAt: s.reservations.startAt, status: s.reservations.status })
    .from(s.reservationTables)
    .innerJoin(s.reservations, and(eq(s.reservations.tenantId, s.reservationTables.tenantId), eq(s.reservations.id, s.reservationTables.reservationId)))
    .where(and(eq(s.reservationTables.tenantId, scope.tenantId), eq(s.reservations.outletId, scope.outletId), inArray(s.reservationTables.tableId, tableIds), inArray(s.reservations.status, LIVE_BOOKING)));
}
