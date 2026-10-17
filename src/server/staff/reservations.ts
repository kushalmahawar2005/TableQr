import "server-only";
import { and, asc, desc, eq, gte, inArray, like, lt, or } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { localTime, parseLocalDateTime, serviceDate } from "@/domain/booking-policy";
import { AppError } from "../errors";
import { createReservation } from "../floor/reservations";
import { loadPolicy } from "../floor/policy";
import { audit } from "./audit";
import type { StaffSession } from "./auth";
import { requireFeature } from "../plan";

// Reservation Calendar read model and guest-detail edits. Every range is the outlet's own calendar
// day or week; the browser's clock and time zone never decide what is shown or stored.

const roles = ["owner", "manager", "host"] as const;
const ownerManager = (staff: StaffSession) => staff.roles.some((r) => r === "owner" || r === "manager");
const guard = (staff: StaffSession) => {
  if (!staff.roles.some((r) => roles.includes(r as never))) throw new AppError("forbidden", "Your role cannot view reservations.");
};
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && addDays(v, 0) === v;
const QUEUED = ["waiting", "notified"] as const;
const NO_SHOW_FROM = ["requested", "confirmed", "reminded"];

export type CalendarInput = { date?: string; view?: "day" | "week"; search?: string; statuses?: string[]; zoneId?: string; tableId?: string; source?: string; partySize?: number };

export async function getReservationCalendar(staff: StaffSession, input: CalendarInput = {}, now = new Date()) {
  guard(staff);
  const tz = staff.outlet.timezone;
  const today = serviceDate(now, tz);
  const date = isDate(input.date) ? input.date : today;
  const view = input.view === "week" ? ("week" as const) : ("day" as const);
  const from = localTime(date, 0, tz);
  const to = localTime(addDays(date, view === "week" ? 7 : 1), 0, tz);
  const scoped = and(eq(s.reservations.tenantId, staff.tenantId), eq(s.reservations.outletId, staff.outletId));

  const filters = [scoped, gte(s.reservations.startAt, from), lt(s.reservations.startAt, to)];
  const q = String(input.search ?? "").trim();
  if (q) filters.push(or(like(s.reservations.name, `%${q}%`), like(s.reservations.phone, `%${q}%`), like(s.reservations.publicReference, `%${q}%`)));
  const statuses = (input.statuses ?? []).filter((x): x is s.ReservationStatus => (s.reservationStatuses as readonly string[]).includes(x));
  if (statuses.length) filters.push(inArray(s.reservations.status, statuses));
  if (input.source && (s.reservationSources as readonly string[]).includes(input.source)) filters.push(eq(s.reservations.source, input.source as (typeof s.reservationSources)[number]));
  if (input.partySize) filters.push(eq(s.reservations.partySize, Number(input.partySize)));

  const [policy, rows, zones, tables] = await Promise.all([
    loadPolicy(db, staff),
    db.select().from(s.reservations).where(and(...filters)).orderBy(asc(s.reservations.startAt)),
    db
      .select({ id: s.zones.id, name: s.zones.name })
      .from(s.zones)
      .where(and(eq(s.zones.tenantId, staff.tenantId), eq(s.zones.outletId, staff.outletId), eq(s.zones.isActive, true)))
      .orderBy(asc(s.zones.sortOrder), asc(s.zones.name)),
    db
      .select({ id: s.diningTables.id, code: s.diningTables.code, zoneId: s.diningTables.zoneId, maxSeats: s.diningTables.maxSeats })
      .from(s.diningTables)
      .where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.outletId, staff.outletId), eq(s.diningTables.isActive, true)))
      .orderBy(asc(s.diningTables.code)),
  ]);

  const ids = rows.map((r) => r.id);
  const none = ["-"];
  const [assignments, credits, waitlist, walkIns] = await Promise.all([
    db
      .select({ reservationId: s.reservationTables.reservationId, tableId: s.reservationTables.tableId, code: s.diningTables.code, zoneId: s.diningTables.zoneId, zoneName: s.zones.name })
      .from(s.reservationTables)
      .innerJoin(s.diningTables, and(eq(s.diningTables.tenantId, s.reservationTables.tenantId), eq(s.diningTables.id, s.reservationTables.tableId)))
      .innerJoin(s.zones, and(eq(s.zones.tenantId, s.diningTables.tenantId), eq(s.zones.id, s.diningTables.zoneId)))
      .where(and(eq(s.reservationTables.tenantId, staff.tenantId), inArray(s.reservationTables.reservationId, ids.length ? ids : none))),
    db
      .select({ reservationId: s.reservationCredits.reservationId, amountPaise: s.reservationCredits.amountPaise, paidPaise: s.reservationCredits.paidPaise, appliedPaise: s.reservationCredits.appliedPaise, status: s.reservationCredits.status })
      .from(s.reservationCredits)
      .where(and(eq(s.reservationCredits.tenantId, staff.tenantId), inArray(s.reservationCredits.reservationId, ids.length ? ids : none))),
    // The live queue (as on the floor) when the range covers today, plus parties who joined in the range
    db
      .select({ id: s.waitlistEntries.id, name: s.waitlistEntries.name, partySize: s.waitlistEntries.partySize, status: s.waitlistEntries.status, sortOrder: s.waitlistEntries.sortOrder, estimateMinutes: s.waitlistEntries.estimateMinutes, quotedMinutes: s.waitlistEntries.quotedMinutes, readyDeadline: s.waitlistEntries.readyDeadline, joinedAt: s.waitlistEntries.joinedAt })
      .from(s.waitlistEntries)
      .where(
        and(
          eq(s.waitlistEntries.tenantId, staff.tenantId),
          eq(s.waitlistEntries.outletId, staff.outletId),
          from <= now && now < to
            ? or(inArray(s.waitlistEntries.status, [...QUEUED]), and(gte(s.waitlistEntries.joinedAt, from), lt(s.waitlistEntries.joinedAt, to)))
            : and(gte(s.waitlistEntries.joinedAt, from), lt(s.waitlistEntries.joinedAt, to)),
        ),
      )
      .orderBy(asc(s.waitlistEntries.sortOrder), desc(s.waitlistEntries.joinedAt))
      .limit(200),
    db
      .select({ sessionId: s.tableSessions.id, tableId: s.tableSessions.tableId, code: s.diningTables.code, partySize: s.tableSessions.partySize, status: s.tableSessions.status, openedAt: s.tableSessions.openedAt })
      .from(s.tableSessions)
      .innerJoin(s.diningTables, and(eq(s.diningTables.tenantId, s.tableSessions.tenantId), eq(s.diningTables.id, s.tableSessions.tableId)))
      .where(and(eq(s.tableSessions.tenantId, staff.tenantId), eq(s.tableSessions.outletId, staff.outletId), eq(s.tableSessions.source, "walk_in"), gte(s.tableSessions.openedAt, from), lt(s.tableSessions.openedAt, to), eq(s.diningTables.isActive, true))),
  ]);

  const byId = new Map<string, typeof assignments>();
  for (const a of assignments) byId.set(a.reservationId, [...(byId.get(a.reservationId) ?? []), a]);
  const creditBy = new Map(credits.map((c) => [c.reservationId, c]));
  const nowMs = now.getTime();
  const graceMs = policy.graceMinutes * 60_000;
  const reservations = rows
    .map((r) => ({
      id: r.id,
      publicReference: r.publicReference,
      name: r.name,
      phone: r.phone,
      partySize: r.partySize,
      startAt: r.startAt.getTime(),
      expectedEndAt: r.expectedEndAt.getTime(),
      status: r.status,
      source: r.source,
      seatingPreference: r.seatingPreference,
      requestedZoneId: r.requestedZoneId,
      requestedTableClass: r.requestedTableClass,
      occasion: r.occasion,
      notes: r.notes,
      confirmedAt: r.confirmedAt?.getTime() ?? null,
      arrivedAt: r.arrivedAt?.getTime() ?? null,
      seatedAt: r.seatedAt?.getTime() ?? null,
      completedAt: r.completedAt?.getTime() ?? null,
      cancelledAt: r.cancelledAt?.getTime() ?? null,
      lateMinutes: NO_SHOW_FROM.includes(r.status) && nowMs > r.startAt.getTime() ? Math.floor((nowMs - r.startAt.getTime()) / 60_000) : 0,
      // Same rule as the no-show transition: only after the outlet's grace period
      canNoShow: NO_SHOW_FROM.includes(r.status) && nowMs >= r.startAt.getTime() + graceMs,
      assignments: byId.get(r.id) ?? [],
      credit: creditBy.get(r.id) ?? null,
    }))
    .filter((r) => (!input.zoneId && !input.tableId) || r.assignments.some((a) => (!input.zoneId || a.zoneId === input.zoneId) && (!input.tableId || a.tableId === input.tableId)));

  return {
    date,
    today,
    view,
    timezone: tz,
    from: from.getTime(),
    to: to.getTime(),
    graceMinutes: policy.graceMinutes,
    reservations,
    zones,
    tables,
    sources: [...s.reservationSources],
    waitlist: waitlist.map((w) => ({ id: w.id, name: w.name, partySize: w.partySize, status: w.status, sortOrder: w.sortOrder, estimateMinutes: w.estimateMinutes ?? w.quotedMinutes, readyDeadline: w.readyDeadline?.getTime() ?? null, joinedAt: w.joinedAt.getTime() })),
    walkIns: walkIns.map((w) => ({ ...w, openedAt: w.openedAt.getTime() })),
    roles: staff.roles,
    mayEdit: ownerManager(staff),
    mayOperate: staff.roles.some((r) => roles.includes(r as never)),
  };
}

export type CalendarData = Awaited<ReturnType<typeof getReservationCalendar>>;

/** Fields staff may change on a booking's guest details. Omitted = unchanged; null or "" = cleared. */
export type ReservationDetailsPatch = { name?: string; phone?: string | null; occasion?: string | null; notes?: string | null; seatingPreference?: string | null };

const clean = (v: unknown, max: number) => (v === null ? null : String(v).trim().slice(0, max) || null);

/** Guest-detail edit with patch semantics: only the fields sent are touched */
export async function editReservationDetails(staff: StaffSession, id: string, input: ReservationDetailsPatch, now = new Date()) {
  guard(staff);
  if (!ownerManager(staff)) throw new AppError("forbidden", "Only managers and owners can edit guest details.");
  const patch: Partial<Record<keyof ReservationDetailsPatch, string | null>> = {};
  if (input.name !== undefined) {
    const name = String(input.name ?? "").trim().slice(0, 80);
    if (!name) throw new AppError("invalid_state", "Enter the guest's name.", { reason: "name" });
    patch.name = name;
  }
  if (input.phone !== undefined) patch.phone = input.phone === null ? null : String(input.phone).replace(/[^\d+]/g, "").slice(0, 15) || null;
  if (input.occasion !== undefined) patch.occasion = clean(input.occasion, 40);
  if (input.notes !== undefined) patch.notes = clean(input.notes, 300);
  if (input.seatingPreference !== undefined) patch.seatingPreference = clean(input.seatingPreference, 40);

  await db.transaction(async (tx) => {
    const [old] = await tx
      .select()
      .from(s.reservations)
      .where(and(eq(s.reservations.tenantId, staff.tenantId), eq(s.reservations.outletId, staff.outletId), eq(s.reservations.id, String(id))))
      .for("update");
    if (!old) throw new AppError("not_found", "Reservation not found.");
    const changed = (Object.keys(patch) as (keyof typeof patch)[]).filter((k) => patch[k] !== old[k]);
    if (!changed.length) return;
    const before = Object.fromEntries(changed.map((k) => [k, old[k]]));
    const after = Object.fromEntries(changed.map((k) => [k, patch[k]]));
    await tx
      .update(s.reservations)
      .set({ ...after, updatedAt: now })
      .where(and(eq(s.reservations.tenantId, staff.tenantId), eq(s.reservations.id, old.id)));
    // Guest details are not a lifecycle step, so they go to the staff audit trail, not booking history
    await audit(tx, staff, { action: "reservation.edit", entity: "reservation", entityId: old.id, before, after, now });
  });
}

/** Staff booking from the calendar: the time is the outlet's wall clock, converted here */
export async function createCalendarReservation(
  staff: StaffSession,
  input: { name: string; phone?: string | null; partySize: number; localDateTime: string; tableIds?: string[]; occasion?: string | null; notes?: string | null; source?: "phone" | "walk_in" | "staff" },
  now = new Date(),
) {
  guard(staff);
  await requireFeature(staff.tenantId, "reservations");
  const startAt = parseLocalDateTime(input.localDateTime, staff.outlet.timezone);
  if (!startAt) throw new AppError("invalid_state", "Choose a valid date and time.", { reason: "start" });
  const { name, phone, partySize, tableIds, occasion, notes, source } = input;
  return createReservation(staff, { name, phone, partySize, startAt: startAt.getTime(), tableIds, occasion, notes, source }, now);
}
