import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { localClock, type WeeklyHours } from "@/domain/hours";
import { diningMinutesFor, localTime, overlaps, serviceDate, type BookingPolicy } from "@/domain/booking-policy";
import { LOCK_THEN_READ, type Runner } from "../db-types";
import { AppError } from "../errors";
import { loadPolicy } from "../floor/policy";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import { queueBookingNotification } from "./notifications";

export const BOOKING_HOLD_MINUTES = 5;
const LIVE = ["requested", "confirmed", "reminded", "arrived"] as const;

export type BookingPreference = { seatingPreference?: string | null; tableClass?: string | null; zoneId?: string | null };
export type BookingSlot = {
  startAt: number;
  endAt: number;
  available: boolean;
  reason: "available" | "full" | "closed" | "cutoff" | "paused" | "blackout" | "outside_window";
  alternatives: number[];
  creditRequiredPaise: number;
  creditReason: string | null;
};

type OutletScope = { tenantId: string; outletId: string; outletCode: string; timezone: string; openingHours: WeeklyHours | null; name: string; address: string; city: string };

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const publicRef = () => `TQ-${randomBytes(5).toString("hex").toUpperCase()}`;
const liveStatuses = [...LIVE];

async function outletScope(run: Runner, outletCode: string): Promise<OutletScope> {
  // isolation-exempt: the tenant is resolved from the public outlet code before scoped queries.
  const [o] = await run.select({ tenantId: s.outlets.tenantId, outletId: s.outlets.id, outletCode: s.outlets.code, timezone: s.outlets.timezone, openingHours: s.outlets.openingHours, name: s.outlets.name, address: s.outlets.address, city: s.outlets.city })
    .from(s.outlets).where(eq(s.outlets.code, String(outletCode).trim().toUpperCase()));
  if (!o) throw new AppError("not_found", "We could not find this restaurant.");
  return o;
}

const policyWithFallback = (row: BookingPolicy): BookingPolicy => ({ ...row, holdMinutes: BOOKING_HOLD_MINUTES });

async function exceptionFor(run: Runner, scope: OutletScope, date: string) {
  const [row] = await run.select().from(s.bookingCalendarExceptions).where(and(eq(s.bookingCalendarExceptions.tenantId, scope.tenantId), eq(s.bookingCalendarExceptions.outletId, scope.outletId), eq(s.bookingCalendarExceptions.serviceDate, date)));
  return row ?? null;
}

function slotStarts(date: string, scope: OutletScope, policy: BookingPolicy) {
  const day = localClock(localTime(date, 12 * 60, scope.timezone), scope.timezone).day;
  const windows = scope.openingHours && Object.keys(scope.openingHours).length ? (scope.openingHours[day] ?? []) : [["00:00", "24:00"] as [string, string]];
  const result: Date[] = [];
  for (const [from, to] of windows) {
    const [fh, fm] = from.split(":").map(Number);
    const [th, tm] = to.split(":").map(Number);
    const begin = fh * 60 + fm;
    let end = th * 60 + tm;
    if (end <= begin) end += 24 * 60;
    for (let m = Math.ceil(begin / policy.slotIntervalMinutes) * policy.slotIntervalMinutes; m + policy.slotIntervalMinutes <= end; m += policy.slotIntervalMinutes) {
      result.push(localTime(date, m, scope.timezone));
    }
  }
  return [...new Map(result.map((x) => [x.getTime(), x])).values()].sort((a, b) => a.getTime() - b.getTime());
}

async function liveClaims(run: Runner, scope: OutletScope, exceptReservationId?: string) {
  return run.select({ reservationId: s.reservations.id, tableId: s.reservationTables.tableId, startAt: s.reservations.startAt, endAt: s.reservations.expectedEndAt })
    .from(s.reservationTables)
    .innerJoin(s.reservations, and(eq(s.reservations.tenantId, s.reservationTables.tenantId), eq(s.reservations.id, s.reservationTables.reservationId)))
    .where(and(eq(s.reservationTables.tenantId, scope.tenantId), eq(s.reservations.outletId, scope.outletId), inArray(s.reservations.status, liveStatuses), exceptReservationId ? ne(s.reservations.id, exceptReservationId) : undefined));
}

async function activeSessions(run: Runner, scope: OutletScope, now: Date) {
  return run.select({ tableId: s.sessionTables.tableId, expectedEndAt: s.tableSessions.expectedEndAt, openedAt: s.tableSessions.openedAt, partySize: s.tableSessions.partySize })
    .from(s.sessionTables)
    .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.sessionTables.tenantId), eq(s.tableSessions.id, s.sessionTables.sessionId)))
    .where(and(eq(s.sessionTables.tenantId, scope.tenantId), eq(s.sessionTables.outletId, scope.outletId), isNull(s.sessionTables.releasedAt), ne(s.tableSessions.status, "closed"), lte(s.tableSessions.openedAt, now)));
}

type Table = typeof s.diningTables.$inferSelect;
function combinations(tables: Table[], party: number): Table[][] {
  const single = tables.filter((t) => t.maxSeats >= party && party >= t.minSeats).map((t) => [t]);
  if (single.length) return single;
  const byId = new Map(tables.map((t) => [t.id, t]));
  const out: Table[][] = [];
  for (const a of tables) for (const id of a.combinableWith ?? []) {
    const b = byId.get(id);
    if (b && a.id < b.id && a.maxSeats + b.maxSeats >= party) out.push([a, b]);
  }
  return out;
}

function preferenceRank(group: Table[], pref: BookingPreference) {
  const zone = pref.zoneId ? group.every((t) => t.zoneId === pref.zoneId) : true;
  const cls = pref.tableClass ? group.every((t) => t.tableClass === pref.tableClass) : true;
  return (zone && cls ? 0 : 1) + (zone ? 0 : 2) + (cls ? 0 : 1);
}

async function chooseTables(run: Runner, scope: OutletScope, startAt: Date, endAt: Date, party: number, pref: BookingPreference, now: Date, lock = false, exceptReservationId?: string) {
  const q = run.select().from(s.diningTables).where(and(eq(s.diningTables.tenantId, scope.tenantId), eq(s.diningTables.outletId, scope.outletId), eq(s.diningTables.isBookableOnline, true), ne(s.diningTables.state, "blocked"))).orderBy(asc(s.diningTables.id));
  const tables = lock ? await q.for("update") : await q;
  const claims = await liveClaims(run, scope, exceptReservationId);
  const sessions = await activeSessions(run, scope, now);
  const blocked = new Set<string>();
  for (const c of claims) if (overlaps(startAt.getTime(), endAt.getTime(), c.startAt.getTime(), c.endAt.getTime(), 0)) blocked.add(c.tableId);
  for (const v of sessions) {
    const until = v.expectedEndAt ?? new Date(v.openedAt.getTime() + diningMinutesFor(Math.max(1, v.partySize ?? 1), await loadPolicy(run, scope)) * 60_000);
    if (until.getTime() + (await loadPolicy(run, scope)).turnoverBufferMinutes * 60_000 > startAt.getTime()) blocked.add(v.tableId);
  }
  const available = tables.filter((t) => !blocked.has(t.id));
  return combinations(available, party).sort((a, b) => preferenceRank(a, pref) - preferenceRank(b, pref) || a.length - b.length || a[0].id.localeCompare(b[0].id))[0] ?? null;
}

async function slotCredit(run: Runner, scope: OutletScope, policy: BookingPolicy, startAt: Date) {
  if (policy.peakCreditPaise <= 0 && policy.repeatNoShowCreditPaise <= 0) return { amountPaise: 0, reason: null as string | null };
  const claims = await liveClaims(run, scope);
  const end = new Date(startAt.getTime() + 30 * 60_000);
  const covers = claims.filter((x) => x.startAt >= startAt && x.startAt < end).length;
  if (policy.peakCreditPaise > 0 && covers >= Math.floor(policy.pacingCoversPerSlot * 0.8)) return { amountPaise: policy.peakCreditPaise, reason: "Peak slot booking credit" };
  return { amountPaise: 0, reason: null };
}

export async function getBookingAvailability(outletCode: string, input: { date: string; partySize: number; preference?: BookingPreference }, now = new Date()) {
  const scope = await outletScope(db, outletCode);
  const policy = policyWithFallback(await loadPolicy(db, scope));
  const date = String(input.date);
  const party = Number(input.partySize);
  if (!Number.isInteger(party) || party < policy.minPartySize || party > policy.maxPartySize) return { date, partySize: party, groupRequest: party > policy.maxPartySize, paused: false, slots: [] as BookingSlot[], policy };
  const exception = await exceptionFor(db, scope, date);
  const today = serviceDate(now, scope.timezone);
  const latest = new Date(now.getTime() + policy.bookingWindowDays * 86_400_000);
  const starts = slotStarts(date, scope, policy);
  const slots: BookingSlot[] = [];
  for (const start of starts) {
    const end = new Date(start.getTime() + diningMinutesFor(party, policy) * 60_000);
    const tooSoon = start.getTime() < now.getTime() + policy.onlineCutoffMinutes * 60_000;
    const outside = date < today || start > latest;
    const paused = exception?.onlineBookingsPaused === true;
    const credit = await slotCredit(db, scope, policy, start);
    const chosen = !tooSoon && !outside && !paused ? await chooseTables(db, scope, start, end, party, input.preference ?? {}, now) : null;
    slots.push({ startAt: start.getTime(), endAt: end.getTime(), available: !!chosen, reason: paused ? "blackout" : tooSoon ? "cutoff" : outside ? "outside_window" : chosen ? "available" : "full", alternatives: [], creditRequiredPaise: credit.amountPaise, creditReason: credit.reason });
  }
  const available = slots.filter((x) => x.available).map((x) => x.startAt);
  for (const slot of slots) if (!slot.available) slot.alternatives = available.sort((a, b) => Math.abs(a - slot.startAt) - Math.abs(b - slot.startAt)).slice(0, 3);
  return { date, partySize: party, groupRequest: false, paused: !!exception?.onlineBookingsPaused, slots, policy };
}

export async function createBookingHold(outletCode: string, input: { date: string; startAt: number; partySize: number; preference?: BookingPreference; requestId: string; holdToken: string }, now = new Date()) {
  const scope = await outletScope(db, outletCode);
  const policy = policyWithFallback(await loadPolicy(db, scope));
  const startAt = new Date(Number(input.startAt));
  const endAt = new Date(startAt.getTime() + diningMinutesFor(Number(input.partySize), policy) * 60_000);
  const holdExpiresAt = new Date(now.getTime() + BOOKING_HOLD_MINUTES * 60_000);
  const tokenHash = hash(input.holdToken);
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(s.reservations).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.bookingRequestId, input.requestId))).for("update");
    if (existing && existing.holdExpiresAt && existing.holdExpiresAt > now && existing.manageTokenHash === hash(input.holdToken)) return existing;
    const chosen = await chooseTables(tx, scope, startAt, endAt, Number(input.partySize), input.preference ?? {}, now, true);
    if (!chosen) throw new AppError("conflict", "That time is no longer available.", { reason: "full" });
    const credit = await slotCredit(tx, scope, policy, startAt);
    const id = uuidv7();
    const manage = input.holdToken;
    const reference = publicRef();
    await tx.insert(s.reservations).values({ id, tenantId: scope.tenantId, outletId: scope.outletId, name: "Pending guest", publicReference: reference, manageTokenHash: hash(manage), manageTokenExpiresAt: new Date(now.getTime() + 90 * 86_400_000), bookingRequestId: input.requestId, partySize: Number(input.partySize), startAt, expectedEndAt: endAt, status: "requested", source: "online", seatingPreference: input.preference?.seatingPreference ?? null, requestedZoneId: input.preference?.zoneId ?? null, requestedTableClass: input.preference?.tableClass ?? null, holdExpiresAt, holdOwnerHash: tokenHash, creditRequiredPaise: credit.amountPaise, creditPaidPaise: 0, creditAppliedPaise: 0, creditStatus: credit.amountPaise ? "required" : "none", createdAt: now, updatedAt: now });
    await tx.insert(s.reservationTables).values(chosen.map((t) => ({ id: uuidv7(), tenantId: scope.tenantId, reservationId: id, tableId: t.id })));
    await tx.insert(s.reservationHistory).values({ tenantId: scope.tenantId, reservationId: id, kind: "hold_created", after: { startAt, endAt, tableIds: chosen.map((t) => t.id) }, createdAt: now });
    return { ...(await tx.select().from(s.reservations).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, id))))[0], manageToken: manage } as typeof s.reservations.$inferSelect & { manageToken: string };
  }, LOCK_THEN_READ);
  await publish(scope, [{ topic: topics.floor, type: "booking.hold_created", data: { reservationId: result.id } }]);
  return { reservationId: result.id, publicReference: result.publicReference, manageToken: (result as { manageToken?: string }).manageToken ?? input.holdToken, holdExpiresAt: result.holdExpiresAt?.getTime() ?? holdExpiresAt.getTime(), creditRequiredPaise: result.creditRequiredPaise };
}

export async function bookingByToken(outletCode: string, token: string) {
  const scope = await outletScope(db, outletCode);
  const [row] = await db.select().from(s.reservations).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.manageTokenHash, hash(token))));
  if (!row) throw new AppError("not_found", "This booking link is not valid.");
  return { row, scope };
}

export async function confirmBooking(outletCode: string, token: string, input: { name: string; phone: string; guestId?: string | null; marketingConsent?: boolean }, now = new Date()) {
  const scope = await outletScope(db, outletCode);
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(s.reservations).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.manageTokenHash, hash(token)))).for("update");
    if (!row) throw new AppError("not_found", "This booking link is not valid.");
    if (row.status === "cancelled" || row.status === "no_show") throw new AppError("invalid_state", "This booking is no longer active.");
    if (row.status === "requested" && (!row.holdExpiresAt || row.holdExpiresAt <= now)) throw new AppError("conflict", "Your booking hold expired. Please choose another time.", { reason: "hold_expired" });
    if (row.creditRequiredPaise > row.creditPaidPaise) throw new AppError("payment_required", "Booking credit payment is required before confirmation.");
    const guestId = input.guestId ?? null;
    await tx.update(s.reservations).set({ name: input.name.trim().slice(0, 80), phone: input.phone, guestId, status: "confirmed", confirmedAt: now, holdExpiresAt: null, holdReleasedAt: null, updatedAt: now }).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, row.id)));
    await tx.insert(s.reservationHistory).values({ tenantId: scope.tenantId, reservationId: row.id, kind: "confirmed", before: { status: row.status }, after: { status: "confirmed", guestId }, createdAt: now });
    return row.id;
  }, LOCK_THEN_READ);
  await publish(scope, [{ topic: topics.floor, type: "booking.updated", data: { reservationId: result } }]);
  const confirmed = (await bookingByToken(outletCode, token)).row;
  if (confirmed.phone) {
    await queueBookingNotification({ tenantId: scope.tenantId, outletId: scope.outletId, reservationId: confirmed.id, type: "booking_confirmation", recipient: confirmed.phone, channel: "sms", idempotencyKey: `booking-confirmed:${confirmed.id}`, scheduledAt: now });
    await queueBookingNotification({ tenantId: scope.tenantId, outletId: scope.outletId, reservationId: confirmed.id, type: "booking_reminder_24h", recipient: confirmed.phone, channel: "sms", idempotencyKey: `booking-reminder-24h:${confirmed.id}`, scheduledAt: new Date(confirmed.startAt.getTime() - 24 * 3600_000) });
    await queueBookingNotification({ tenantId: scope.tenantId, outletId: scope.outletId, reservationId: confirmed.id, type: "booking_reminder_2h", recipient: confirmed.phone, channel: "sms", idempotencyKey: `booking-reminder-2h:${confirmed.id}`, scheduledAt: new Date(confirmed.startAt.getTime() - 2 * 3600_000) });
  }
  return { row: confirmed, scope };
}

export async function cancelBookingPublic(outletCode: string, token: string, reason = "guest_cancelled", now = new Date()) {
  const { row, scope } = await bookingByToken(outletCode, token);
  if (["cancelled", "no_show"].includes(row.status)) return { status: row.status };
  const free = now.getTime() <= row.startAt.getTime() - 120 * 60_000;
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(s.reservations).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, row.id))).for("update");
    if (!locked) throw new AppError("not_found", "This booking is no longer available.");
    await tx.update(s.reservations).set({ status: "cancelled", cancelledAt: now, holdExpiresAt: null, holdReleasedAt: now, holdReleaseReason: reason, updatedAt: now }).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, row.id)));
    await tx.insert(s.reservationHistory).values({ tenantId: scope.tenantId, reservationId: row.id, kind: "cancelled", before: { status: locked.status }, after: { status: "cancelled", free, reason }, reason, createdAt: now });
  }, LOCK_THEN_READ);
  await publish(scope, [{ topic: topics.floor, type: "booking.cancelled", data: { reservationId: row.id } }]);
  return { status: "cancelled", freeCancellation: free };
}

export async function lateBookingPublic(outletCode: string, token: string, now = new Date()) {
  const { row, scope } = await bookingByToken(outletCode, token);
  if (row.status !== "confirmed" && row.status !== "arrived") throw new AppError("invalid_state", "This booking cannot be extended now.");
  const [used] = await db.select({ id: s.reservationHistory.id }).from(s.reservationHistory).where(and(eq(s.reservationHistory.tenantId, scope.tenantId), eq(s.reservationHistory.reservationId, row.id), eq(s.reservationHistory.kind, "late_extended"))).limit(1);
  if (used) throw new AppError("conflict", "The late-arrival extension has already been used.");
  const policy = policyWithFallback(await loadPolicy(db, scope));
  await db.insert(s.reservationHistory).values({ tenantId: scope.tenantId, reservationId: row.id, kind: "late_extended", after: { minutes: policy.lateExtensionMinutes }, createdAt: now });
  await publish(scope, [{ topic: topics.floor, type: "booking.updated", data: { reservationId: row.id } }]);
  return { minutes: policy.lateExtensionMinutes };
}

export async function rescheduleBookingPublic(outletCode: string, token: string, input: { date: string; startAt: number }, now = new Date()) {
  const scope = await outletScope(db, outletCode);
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(s.reservations).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.manageTokenHash, hash(token)))).for("update");
    if (!row || ["cancelled", "no_show", "completed", "seated"].includes(row.status)) throw new AppError("invalid_state", "This booking cannot be rescheduled now.");
    const policy = policyWithFallback(await loadPolicy(tx, scope));
    const startAt = new Date(Number(input.startAt)); const endAt = new Date(startAt.getTime() + diningMinutesFor(row.partySize, policy) * 60_000);
    const chosen = await chooseTables(tx, scope, startAt, endAt, row.partySize, { seatingPreference: row.seatingPreference, tableClass: row.requestedTableClass, zoneId: row.requestedZoneId }, now, true, row.id);
    if (!chosen) throw new AppError("conflict", "That new time is no longer available.", { reason: "full" });
    await tx.delete(s.reservationTables).where(and(eq(s.reservationTables.tenantId, scope.tenantId), eq(s.reservationTables.reservationId, row.id)));
    await tx.insert(s.reservationTables).values(chosen.map((t) => ({ id: uuidv7(), tenantId: scope.tenantId, reservationId: row.id, tableId: t.id })));
    await tx.update(s.reservations).set({ startAt, expectedEndAt: endAt, status: "confirmed", updatedAt: now }).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, row.id)));
    await tx.insert(s.reservationHistory).values({ tenantId: scope.tenantId, reservationId: row.id, kind: "rescheduled", before: { startAt: row.startAt, endAt: row.expectedEndAt }, after: { startAt, endAt, tableIds: chosen.map((t) => t.id) }, createdAt: now });
    return row.id;
  }, LOCK_THEN_READ);
  await publish(scope, [{ topic: topics.floor, type: "booking.updated", data: { reservationId: result } }]);
  return bookingByToken(outletCode, token);
}

export async function arriveBookingPublic(outletCode: string, token: string, now = new Date()) {
  const { row, scope } = await bookingByToken(outletCode, token);
  if (row.status !== "confirmed" && row.status !== "arrived") throw new AppError("invalid_state", "This booking is not ready for arrival.");
  if (row.status === "arrived") return { status: "arrived" as const };
  await db.update(s.reservations).set({ status: "arrived", arrivedAt: now, updatedAt: now }).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, row.id)));
  await db.insert(s.reservationHistory).values({ tenantId: scope.tenantId, reservationId: row.id, kind: "arrived", before: { status: row.status }, after: { status: "arrived" }, createdAt: now });
  await publish(scope, [{ topic: topics.floor, type: "booking.updated", data: { reservationId: row.id } }]);
  return { status: "arrived" as const };
}

export type BookingCore = typeof s.reservations.$inferSelect;
