import "server-only";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { diningMinutesFor, localTime, overlaps, pacingState, serviceDate, type BookingPolicy } from "@/domain/booking-policy";
import { localClock, toMinutes, type WeeklyHours } from "@/domain/hours";
import type { Runner } from "../db-types";
import { AppError } from "../errors";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import { assertMay } from "../staff/auth";
import { audit } from "../staff/audit";
import { loadPolicy } from "./policy";
import { LIVE_BOOKING } from "./sync";
import type { FloorActor } from "./table-actions";

// Tonight's pacing (PS 4.5): covers booked per 30-minute slot against what the kitchen and room
// take, plus the host's switch to pause online bookings for the day.

type Scope = { tenantId: string; outletId: string };
const COUNTED = [...LIVE_BOOKING, "seated", "completed"] as const;

/** Slot starts (minutes after local midnight) for a service day, from opening hours */
function slotMinutes(hours: WeeklyHours | null, date: string, timeZone: string, step: number): number[] {
  const day = localClock(localTime(date, 12 * 60, timeZone), timeZone).day;
  const windows = hours && Object.keys(hours).length ? (hours[day] ?? []) : [["18:00", "23:00"] as [string, string]];
  const out: number[] = [];
  for (const [from, to] of windows) {
    const a = toMinutes(from);
    let b = toMinutes(to);
    if (b <= a) b += 24 * 60;
    // Last seating one slot before close
    for (let m = Math.ceil(a / step) * step; m + step <= b; m += step) out.push(m);
  }
  return [...new Set(out)].sort((x, y) => x - y);
}

export async function getPacing(run: Runner, scope: Scope, opts: { date: string; timeZone: string; hours: WeeklyHours | null; policy: BookingPolicy }) {
  const step = 30;
  const starts = slotMinutes(opts.hours, opts.date, opts.timeZone, step).map((m) => localTime(opts.date, m, opts.timeZone));
  const [day] = await run
    .select()
    .from(s.serviceDayOverrides)
    .where(and(eq(s.serviceDayOverrides.tenantId, scope.tenantId), eq(s.serviceDayOverrides.outletId, scope.outletId), eq(s.serviceDayOverrides.serviceDate, opts.date)));
  if (starts.length === 0) return { date: opts.date, slots: [], paused: !!day?.onlineBookingsPaused, pausedAt: day?.updatedAt.getTime() ?? null };
  const first = starts[0];
  const last = new Date(starts[starts.length - 1].getTime() + step * 60_000);
  const [bookings, extra] = await Promise.all([
    run
      .select({ startAt: s.reservations.startAt, partySize: s.reservations.partySize })
      .from(s.reservations)
      .where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.outletId, scope.outletId), gte(s.reservations.startAt, first), lt(s.reservations.startAt, last), inArray(s.reservations.status, [...COUNTED]))),
    run
      .select()
      .from(s.slotCapacityOverrides)
      .where(and(eq(s.slotCapacityOverrides.tenantId, scope.tenantId), eq(s.slotCapacityOverrides.outletId, scope.outletId), gte(s.slotCapacityOverrides.slotStartAt, first), lt(s.slotCapacityOverrides.slotStartAt, last))),
  ]);
  const slots = starts.map((startAt) => {
    const end = startAt.getTime() + step * 60_000;
    const covers = bookings.filter((b) => b.startAt.getTime() >= startAt.getTime() && b.startAt.getTime() < end).reduce((n, b) => n + b.partySize, 0);
    const extraCovers = extra.find((x) => x.slotStartAt.getTime() === startAt.getTime())?.extraCovers ?? 0;
    const capacity = opts.policy.pacingCoversPerSlot + extraCovers;
    return { startAt: startAt.getTime(), covers, capacity, extraCovers, state: pacingState(covers, capacity) };
  });
  return { date: opts.date, slots, paused: !!day?.onlineBookingsPaused, pausedAt: day?.updatedAt.getTime() ?? null };
}

async function outletInfo(run: Runner, scope: Scope) {
  const [o] = await run
    .select({ timezone: s.outlets.timezone, openingHours: s.outlets.openingHours })
    .from(s.outlets)
    .where(and(eq(s.outlets.tenantId, scope.tenantId), eq(s.outlets.id, scope.outletId)));
  return o;
}

/** Pause or resume new online bookings for today's service. Bookings already made are untouched. */
export async function setOnlineBookingsPaused(staff: FloorActor, input: { paused: boolean; reason?: string | null }, now = new Date()) {
  assertMay(staff, "booking.pause");
  const scope = { tenantId: staff.tenantId, outletId: staff.outletId };
  const date = serviceDate(now, staff.outlet.timezone);
  const paused = input.paused === true;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(s.serviceDayOverrides)
      .where(and(eq(s.serviceDayOverrides.tenantId, scope.tenantId), eq(s.serviceDayOverrides.outletId, scope.outletId), eq(s.serviceDayOverrides.serviceDate, date)))
      .for("update");
    const values = { onlineBookingsPaused: paused, reason: input.reason?.trim().slice(0, 120) || null, updatedByUserId: staff.userId, updatedAt: now };
    if (row) await tx.update(s.serviceDayOverrides).set(values).where(and(eq(s.serviceDayOverrides.tenantId, scope.tenantId), eq(s.serviceDayOverrides.id, row.id)));
    else await tx.insert(s.serviceDayOverrides).values({ id: uuidv7(), tenantId: scope.tenantId, outletId: scope.outletId, serviceDate: date, ...values });
    await audit(tx, staff, { action: paused ? "booking.pause" : "booking.resume", entity: "service_day", entityId: null, before: { paused: !!row?.onlineBookingsPaused }, after: { paused, date }, reason: values.reason, now });
  });
  await publish(scope, [{ topic: topics.floor, type: "pacing.updated", data: { date, paused } }]);
}

/** Open extra covers in one slot (or take them back with 0) */
export async function setSlotCapacity(staff: FloorActor, input: { slotStartAt: number; extraCovers: number; reason?: string | null }, now = new Date()) {
  assertMay(staff, "booking.capacity");
  const scope = { tenantId: staff.tenantId, outletId: staff.outletId };
  const extra = Number(input.extraCovers);
  if (!Number.isInteger(extra) || extra < 0 || extra > 200) throw new AppError("invalid_state", "Enter 0 to 200 extra covers.");
  const slot = new Date(Number(input.slotStartAt));
  if (Number.isNaN(slot.getTime()) || slot.getUTCMinutes() % 30 !== 0 || slot.getUTCSeconds() !== 0) throw new AppError("invalid_state", "Choose a slot.");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(s.slotCapacityOverrides)
      .where(and(eq(s.slotCapacityOverrides.tenantId, scope.tenantId), eq(s.slotCapacityOverrides.outletId, scope.outletId), eq(s.slotCapacityOverrides.slotStartAt, slot)))
      .for("update");
    const values = { extraCovers: extra, reason: input.reason?.trim().slice(0, 120) || null, updatedByUserId: staff.userId, updatedAt: now };
    if (row) await tx.update(s.slotCapacityOverrides).set(values).where(and(eq(s.slotCapacityOverrides.tenantId, scope.tenantId), eq(s.slotCapacityOverrides.id, row.id)));
    else await tx.insert(s.slotCapacityOverrides).values({ id: uuidv7(), tenantId: scope.tenantId, outletId: scope.outletId, slotStartAt: slot, ...values });
    await audit(tx, staff, { action: "booking.slot_capacity", entity: "slot", entityId: null, before: { extra: row?.extraCovers ?? 0 }, after: { extra, slot }, reason: values.reason, now });
  });
  await publish(scope, [{ topic: topics.floor, type: "pacing.updated", data: { slotStartAt: slot.getTime() } }]);
}

/**
 * What online booking may offer (B1 will call this): nothing when paused for the day, otherwise
 * slots inside the booking window and cutoff with pacing room and a free bookable table.
 */
export async function getOnlineAvailability(scope: Scope, input: { date: string; partySize: number }, now = new Date()) {
  const policy = await loadPolicy(db, scope);
  const o = await outletInfo(db, scope);
  const pacing = await getPacing(db, scope, { date: input.date, timeZone: o.timezone, hours: o.openingHours, policy });
  if (pacing.paused) return { paused: true, slots: [] as number[] };
  const party = Number(input.partySize);
  if (!Number.isInteger(party) || party < policy.minPartySize || party > policy.maxPartySize) return { paused: false, slots: [] };
  const tables = await db
    .select({ id: s.diningTables.id, maxSeats: s.diningTables.maxSeats, state: s.diningTables.state })
    .from(s.diningTables)
    .where(and(eq(s.diningTables.tenantId, scope.tenantId), eq(s.diningTables.outletId, scope.outletId), eq(s.diningTables.isBookableOnline, true)));
  const fits = tables.filter((t) => t.maxSeats >= party && t.state !== "blocked");
  const claims = fits.length
    ? await db
        .select({ tableId: s.reservationTables.tableId, startAt: s.reservations.startAt, endAt: s.reservations.expectedEndAt })
        .from(s.reservationTables)
        .innerJoin(s.reservations, and(eq(s.reservations.tenantId, s.reservationTables.tenantId), eq(s.reservations.id, s.reservationTables.reservationId)))
        .where(and(eq(s.reservationTables.tenantId, scope.tenantId), inArray(s.reservationTables.tableId, fits.map((t) => t.id)), inArray(s.reservations.status, LIVE_BOOKING)))
    : [];
  const latest = now.getTime() + policy.bookingWindowDays * 86_400_000;
  const gap = policy.turnoverBufferMinutes * 60_000;
  const slots = pacing.slots
    .filter((slot) => slot.startAt >= now.getTime() + policy.onlineCutoffMinutes * 60_000 && slot.startAt <= latest && slot.covers + party <= slot.capacity)
    .filter((slot) => {
      const end = slot.startAt + diningMinutesFor(party, policy) * 60_000;
      return fits.some((t) => !claims.some((c) => c.tableId === t.id && overlaps(slot.startAt, end, c.startAt.getTime(), c.endAt.getTime(), gap)));
    })
    .map((slot) => slot.startAt);
  return { paused: false, slots };
}
