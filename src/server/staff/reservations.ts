import "server-only";
import { and, asc, eq, gte, inArray, like, lt, or } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { localTime, serviceDate } from "@/domain/booking-policy";
import { AppError } from "../errors";
import { audit } from "./audit";
import type { StaffSession } from "./auth";

const roles = ["owner", "manager", "host"] as const;
const ownerManager = (staff: StaffSession) => staff.roles.some((r) => r === "owner" || r === "manager");
const guard = (staff: StaffSession) => { if (!staff.roles.some((r) => roles.includes(r as never))) throw new AppError("forbidden", "Your role cannot view reservations."); };
const addDays = (date: string, days: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

export type CalendarInput = { date?: string; view?: "day" | "week"; search?: string; statuses?: string[]; zoneId?: string; tableId?: string; source?: string; partySize?: number };
export async function getReservationCalendar(staff: StaffSession, input: CalendarInput = {}) {
  guard(staff);
  const date = input.date ?? serviceDate(new Date(), staff.outlet.timezone);
  const days = input.view === "week" ? 7 : 1;
  const from = localTime(date, 0, staff.outlet.timezone);
  const to = localTime(addDays(date, days), 0, staff.outlet.timezone);
  const q = String(input.search ?? "").trim();
  const filters = [eq(s.reservations.outletId, staff.outletId), gte(s.reservations.startAt, from), lt(s.reservations.startAt, to)];
  if (q) filters.push(or(like(s.reservations.name, `%${q}%`), like(s.reservations.phone, `%${q}%`), like(s.reservations.publicReference, `%${q}%`))!);
  if (input.statuses?.length) filters.push(inArray(s.reservations.status, input.statuses as (typeof s.reservationStatuses)[number][]));
  if (input.source) filters.push(eq(s.reservations.source, input.source as (typeof s.reservationSources)[number]));
  if (input.partySize) filters.push(eq(s.reservations.partySize, Number(input.partySize)));
  const rows = await db.select().from(s.reservations).where(and(eq(s.reservations.tenantId, staff.tenantId), ...filters)).orderBy(asc(s.reservations.startAt));
  const ids = rows.map((r) => r.id); const none = ["-"];
  const assignments = await db.select({ reservationId: s.reservationTables.reservationId, tableId: s.reservationTables.tableId, code: s.diningTables.code, zoneId: s.diningTables.zoneId, zoneName: s.zones.name }).from(s.reservationTables).innerJoin(s.diningTables, and(eq(s.diningTables.tenantId, s.reservationTables.tenantId), eq(s.diningTables.id, s.reservationTables.tableId))).innerJoin(s.zones, and(eq(s.zones.tenantId, s.diningTables.tenantId), eq(s.zones.id, s.diningTables.zoneId))).where(and(eq(s.reservationTables.tenantId, staff.tenantId), inArray(s.reservationTables.reservationId, ids.length ? ids : none)));
  const credits = await db.select({ reservationId: s.reservationCredits.reservationId, amountPaise: s.reservationCredits.amountPaise, paidPaise: s.reservationCredits.paidPaise, appliedPaise: s.reservationCredits.appliedPaise, status: s.reservationCredits.status }).from(s.reservationCredits).where(and(eq(s.reservationCredits.tenantId, staff.tenantId), inArray(s.reservationCredits.reservationId, ids.length ? ids : none)));
  const waitlist = await db.select({ id: s.waitlistEntries.id, name: s.waitlistEntries.name, partySize: s.waitlistEntries.partySize, status: s.waitlistEntries.status, sortOrder: s.waitlistEntries.sortOrder, estimateMinutes: s.waitlistEntries.estimateMinutes, quotedMinutes: s.waitlistEntries.quotedMinutes, readyDeadline: s.waitlistEntries.readyDeadline }).from(s.waitlistEntries).where(and(eq(s.waitlistEntries.tenantId, staff.tenantId), eq(s.waitlistEntries.outletId, staff.outletId))).orderBy(asc(s.waitlistEntries.sortOrder));
  const walkIns = await db.select({ sessionId: s.tableSessions.id, tableId: s.tableSessions.tableId, code: s.diningTables.code, partySize: s.tableSessions.partySize, status: s.tableSessions.status, openedAt: s.tableSessions.openedAt }).from(s.tableSessions).innerJoin(s.diningTables, and(eq(s.diningTables.tenantId, s.tableSessions.tenantId), eq(s.diningTables.id, s.tableSessions.tableId))).where(and(eq(s.tableSessions.tenantId, staff.tenantId), eq(s.tableSessions.outletId, staff.outletId), eq(s.tableSessions.source, "walk_in"), gte(s.tableSessions.openedAt, from), lt(s.tableSessions.openedAt, to), eq(s.diningTables.isActive, true)));
  const byId = new Map<string, typeof assignments>(); for (const a of assignments) byId.set(a.reservationId, [...(byId.get(a.reservationId) ?? []), a]);
  const creditBy = new Map(credits.map((c) => [c.reservationId, c]));
  const now = Date.now();
  const reservations = rows.map((r) => ({ id: r.id, publicReference: r.publicReference, name: r.name, phone: r.phone, partySize: r.partySize, startAt: r.startAt.getTime(), expectedEndAt: r.expectedEndAt.getTime(), status: r.status, source: r.source, seatingPreference: r.seatingPreference, requestedZoneId: r.requestedZoneId, requestedTableClass: r.requestedTableClass, occasion: r.occasion, notes: r.notes, confirmedAt: r.confirmedAt?.getTime() ?? null, arrivedAt: r.arrivedAt?.getTime() ?? null, seatedAt: r.seatedAt?.getTime() ?? null, completedAt: r.completedAt?.getTime() ?? null, cancelledAt: r.cancelledAt?.getTime() ?? null, lateMinutes: r.status !== "arrived" && now > r.startAt.getTime() ? Math.floor((now - r.startAt.getTime()) / 60000) : 0, canNoShow: now >= r.startAt.getTime() + 15 * 60000 && !["arrived", "seated", "completed", "cancelled", "no_show"].includes(r.status), assignments: byId.get(r.id) ?? [], credit: creditBy.get(r.id) ?? null }));
  return { date, view: input.view === "week" ? "week" as const : "day" as const, from: from.getTime(), to: to.getTime(), reservations: input.zoneId || input.tableId ? reservations.filter((r) => r.assignments.some((a) => (!input.zoneId || a.zoneId === input.zoneId) && (!input.tableId || a.tableId === input.tableId))) : reservations, zones: [...new Map(assignments.map((a) => [a.zoneId, { id: a.zoneId, name: a.zoneName }])).values()], tables: [...new Map(assignments.map((a) => [a.tableId, { id: a.tableId, code: a.code }])).values()], sources: [...new Set(rows.map((r) => r.source))], waitlist: waitlist.map((w) => ({ ...w, estimateMinutes: w.estimateMinutes ?? w.quotedMinutes, readyDeadline: w.readyDeadline?.getTime() ?? null })), walkIns: walkIns.map((w) => ({ ...w, openedAt: w.openedAt.getTime() })), roles: staff.roles, mayEdit: ownerManager(staff), mayOperate: staff.roles.some((r) => roles.includes(r as never)) };
}

export async function editReservationDetails(staff: StaffSession, id: string, input: { name: string; phone?: string | null; occasion?: string | null; notes?: string | null; seatingPreference?: string | null }) {
  guard(staff); if (!ownerManager(staff)) throw new AppError("forbidden", "Only managers and owners can edit guest details.");
  const [old] = await db.select().from(s.reservations).where(and(eq(s.reservations.tenantId, staff.tenantId), eq(s.reservations.outletId, staff.outletId), eq(s.reservations.id, id))); if (!old) throw new AppError("not_found", "Reservation not found.");
  const values = { name: input.name.trim().slice(0, 80), phone: input.phone?.trim().slice(0, 15) || null, occasion: input.occasion?.trim().slice(0, 40) || null, notes: input.notes?.trim().slice(0, 300) || null, seatingPreference: input.seatingPreference?.trim().slice(0, 40) || null, updatedAt: new Date() };
  await db.transaction(async (tx) => { await tx.update(s.reservations).set(values).where(and(eq(s.reservations.tenantId, staff.tenantId), eq(s.reservations.id, id))); await tx.insert(s.reservationHistory).values({ tenantId: staff.tenantId, reservationId: id, kind: "created", before: old, after: values, reason: "staff_edit", createdAt: new Date() }); await audit(tx, staff, { action: "reservation.edit", entity: "reservation", entityId: id, before: old, after: values, now: new Date() }); });
}
