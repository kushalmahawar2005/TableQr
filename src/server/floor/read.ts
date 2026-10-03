import "server-only";
import { and, asc, count, eq, gte, inArray, isNotNull, isNull, lt, ne, notInArray, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { isPlaceholderName } from "@/domain/guest-name";
import { ARRIVALS_WINDOW_MINUTES, serviceDate } from "@/domain/booking-policy";
import type { StaffRole } from "@/lib/staff-permissions";
import { can } from "@/lib/staff-permissions";
import { configuredReceiptChannels } from "../receipts/channels";
import { getPacing } from "./pacing";
import { loadPolicy } from "./policy";
import { LIVE_BOOKING, reconcileFloor } from "./sync";
import { expectedEnd } from "./visits";

// Everything S1 Host Floor shows, read in one call (staff-scoped, never through guest APIs).
// The layout read is the active floor: today the live zones and tables; O2 will publish
// versioned layouts and this is the one place that will read the published version.

type Staff = { tenantId: string; outletId: string; roles: StaffRole[]; outlet: { code: string; name: string; timezone: string } };

/** The published floor layout S1 draws. O2 owns drafts and versions; S1 only reads. */
export async function getActiveLayout(scope: { tenantId: string; outletId: string }) {
  const [zones, tables] = await Promise.all([
    db.select({ id: s.zones.id, name: s.zones.name }).from(s.zones).where(and(eq(s.zones.tenantId, scope.tenantId), eq(s.zones.outletId, scope.outletId), eq(s.zones.isActive, true))).orderBy(s.zones.sortOrder, s.zones.name),
    db.select().from(s.diningTables).where(and(eq(s.diningTables.tenantId, scope.tenantId), eq(s.diningTables.outletId, scope.outletId), eq(s.diningTables.isActive, true))).orderBy(s.diningTables.code),
  ]);
  return { version: "live" as const, zones, tables };
}

export async function getFloor(staff: Staff, now = new Date()) {
  const scope = { tenantId: staff.tenantId, outletId: staff.outletId };
  await reconcileFloor(scope, now);
  const policy = await loadPolicy(db, scope);
  const layout = await getActiveLayout(scope);
  const [outlet] = await db.select({ openingHours: s.outlets.openingHours }).from(s.outlets).where(and(eq(s.outlets.tenantId, scope.tenantId), eq(s.outlets.id, scope.outletId)));

  const assignments = await db
    .select({ tableId: s.sessionTables.tableId, isPrimary: s.sessionTables.isPrimary, session: s.tableSessions })
    .from(s.sessionTables)
    .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.sessionTables.tenantId), eq(s.tableSessions.id, s.sessionTables.sessionId)))
    .where(and(eq(s.sessionTables.tenantId, scope.tenantId), eq(s.sessionTables.outletId, scope.outletId), isNotNull(s.sessionTables.activeKey), ne(s.tableSessions.status, "closed")));
  const sessionIds = [...new Set(assignments.map((a) => a.session.id))];
  const none = ["-"];
  const ids = sessionIds.length ? sessionIds : none;
  const [people, rounds, openItems, ordered, bills, requests] = await Promise.all([
    db.select({ sessionId: s.participants.sessionId, n: count() }).from(s.participants).where(and(eq(s.participants.tenantId, scope.tenantId), inArray(s.participants.sessionId, ids), isNull(s.participants.removedAt))).groupBy(s.participants.sessionId),
    db.select({ sessionId: s.orders.sessionId, n: count() }).from(s.orders).where(and(eq(s.orders.tenantId, scope.tenantId), inArray(s.orders.sessionId, ids), ne(s.orders.status, "cancelled"))).groupBy(s.orders.sessionId),
    db.select({ sessionId: s.orderLines.sessionId, n: sum(s.orderLines.qty) }).from(s.orderLines).where(and(eq(s.orderLines.tenantId, scope.tenantId), inArray(s.orderLines.sessionId, ids), inArray(s.orderLines.status, ["placed", "accepted", "preparing", "ready"]))).groupBy(s.orderLines.sessionId),
    db.select({ sessionId: s.orderLines.sessionId, paise: sql<string>`sum(${s.orderLines.unitPricePaise} * ${s.orderLines.qty})` }).from(s.orderLines).where(and(eq(s.orderLines.tenantId, scope.tenantId), inArray(s.orderLines.sessionId, ids), notInArray(s.orderLines.status, ["cancelled", "voided"]))).groupBy(s.orderLines.sessionId),
    db.select({ sessionId: s.bills.sessionId, totalPaise: s.bills.totalPaise }).from(s.bills).where(and(eq(s.bills.tenantId, scope.tenantId), inArray(s.bills.sessionId, ids))),
    db.select({ sessionId: s.serviceRequests.sessionId, n: count() }).from(s.serviceRequests).where(and(eq(s.serviceRequests.tenantId, scope.tenantId), inArray(s.serviceRequests.sessionId, ids), eq(s.serviceRequests.status, "open"))).groupBy(s.serviceRequests.sessionId),
  ]);
  const by = <T extends { sessionId: string }>(rows: T[]) => new Map(rows.map((r) => [r.sessionId, r]));
  const [pM, rM, oM, dM, bM, qM] = [by(people), by(rounds), by(openItems), by(ordered), by(bills), by(requests)];

  const visits = new Map<string, ReturnType<typeof visitOf>>();
  function visitOf(session: typeof s.tableSessions.$inferSelect) {
    const joined = pM.get(session.id)?.n ?? 0;
    const tableIds = assignments.filter((a) => a.session.id === session.id).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).map((a) => a.tableId);
    return {
      sessionId: session.id,
      tableIds,
      status: session.status,
      source: session.source,
      partySize: Math.max(session.partySize ?? 0, joined),
      joined,
      guestName: session.guestName,
      openedAt: session.openedAt.getTime(),
      expectedEndAt: expectedEnd(session, joined, policy).getTime(),
      rounds: rM.get(session.id)?.n ?? 0,
      openItems: Number(oM.get(session.id)?.n ?? 0),
      orderedPaise: Number(dM.get(session.id)?.paise ?? 0),
      billTotalPaise: session.status === "bill_requested" ? (bM.get(session.id)?.totalPaise ?? null) : null,
      openRequests: qM.get(session.id)?.n ?? 0,
    };
  }
  for (const a of assignments) if (!visits.has(a.session.id)) visits.set(a.session.id, visitOf(a.session));

  // Bookings: what holds each table, and the next 90 minutes (late parties stay until handled)
  const date = serviceDate(now, staff.outlet.timezone);
  const windowEnd = new Date(now.getTime() + ARRIVALS_WINDOW_MINUTES * 60_000);
  const since = new Date(now.getTime() - 6 * 3600_000);
  const [bookingRows, bookingTables] = await Promise.all([
    db
      .select()
      .from(s.reservations)
      .where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.outletId, scope.outletId), inArray(s.reservations.status, LIVE_BOOKING), gte(s.reservations.startAt, since), lt(s.reservations.startAt, new Date(now.getTime() + 24 * 3600_000))))
      .orderBy(asc(s.reservations.startAt)),
    db
      .select({ reservationId: s.reservationTables.reservationId, tableId: s.reservationTables.tableId })
      .from(s.reservationTables)
      .innerJoin(s.reservations, and(eq(s.reservations.tenantId, s.reservationTables.tenantId), eq(s.reservations.id, s.reservationTables.reservationId)))
      .where(and(eq(s.reservationTables.tenantId, scope.tenantId), eq(s.reservations.outletId, scope.outletId), inArray(s.reservations.status, LIVE_BOOKING))),
  ]);
  const tablesFor = (id: string) => bookingTables.filter((t) => t.reservationId === id).map((t) => t.tableId);
  const booking = (r: (typeof bookingRows)[number]) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    partySize: r.partySize,
    startAt: r.startAt.getTime(),
    status: r.status,
    held: r.status === "requested" && !!r.holdExpiresAt,
    holdUntil: r.status === "requested" ? (r.holdExpiresAt?.getTime() ?? null) : null,
    confirmed: r.status === "confirmed" || r.status === "arrived",
    noReply: r.status === "reminded",
    lateMinutes: r.status !== "arrived" && now > r.startAt ? Math.floor((now.getTime() - r.startAt.getTime()) / 60_000) : 0,
    canNoShow: now.getTime() >= r.startAt.getTime() + policy.graceMinutes * 60_000 && r.status !== "arrived",
    occasion: r.occasion,
    notes: r.notes,
    tableIds: tablesFor(r.id),
  });
  const arrivals = bookingRows.filter((r) => r.startAt <= windowEnd && !(r.status === "requested" && r.holdExpiresAt)).map(booking);

  const tiles = layout.tables.map((t) => {
    const a = assignments.find((x) => x.tableId === t.id);
    const next = bookingRows.filter((r) => tablesFor(r.id).includes(t.id) && r.startAt.getTime() > now.getTime() - 6 * 3600_000)[0];
    return {
      id: t.id,
      code: t.code,
      zoneId: t.zoneId,
      minSeats: t.minSeats,
      maxSeats: t.maxSeats,
      tableClass: t.tableClass,
      shape: t.shape,
      x: t.posX,
      y: t.posY,
      w: t.width,
      h: t.height,
      combinableWith: t.combinableWith ?? [],
      state: t.state,
      stateChangedAt: t.stateChangedAt?.getTime() ?? null,
      blocked: t.state === "blocked" ? { reason: t.blockedReason, note: t.blockedNote, until: t.blockedUntil?.getTime() ?? null } : null,
      visit: a ? { ...visits.get(a.session.id)!, isPrimary: a.isPrimary } : null,
      booking: next ? booking(next) : null,
    };
  });

  const waitlist = await db
    .select()
    .from(s.waitlistEntries)
    .where(and(eq(s.waitlistEntries.tenantId, scope.tenantId), eq(s.waitlistEntries.outletId, scope.outletId), inArray(s.waitlistEntries.status, ["waiting", "notified"])))
    .orderBy(s.waitlistEntries.sortOrder, s.waitlistEntries.joinedAt);
  const pacing = await getPacing(db, scope, { date, timeZone: staff.outlet.timezone, hours: outlet?.openingHours ?? null, policy });

  return {
    renderedAt: now.getTime(),
    outlet: staff.outlet,
    serviceDate: date,
    roles: staff.roles,
    may: {
      seat: can(staff.roles, "floor.seat"),
      reset: can(staff.roles, "floor.reset"),
      block: can(staff.roles, "floor.block"),
      bookings: can(staff.roles, "booking.manage"),
      pause: can(staff.roles, "booking.pause"),
      capacity: can(staff.roles, "booking.capacity"),
      waitlist: can(staff.roles, "waitlist.manage"),
    },
    layout: { version: layout.version, zones: layout.zones },
    tables: tiles,
    arrivals,
    waitlist: waitlist.map((w) => ({
      id: w.id,
      name: w.name,
      phone: w.phone,
      partySize: w.partySize,
      joinedAt: w.joinedAt.getTime(),
      waitedMinutes: Math.max(0, Math.floor((now.getTime() - w.joinedAt.getTime()) / 60_000)),
      quotedMinutes: w.quotedMinutes,
      estimateMinutes: w.estimateMinutes ?? w.quotedMinutes,
      estimateSource: w.estimateSource,
      seatingPreference: w.seatingPreference,
      readyDeadline: w.readyDeadline?.getTime() ?? null,
      status: w.status as "waiting" | "notified",
      notes: w.notes,
    })),
    pacing,
    policy: { graceMinutes: policy.graceMinutes, turnoverBufferMinutes: policy.turnoverBufferMinutes },
    // Guest messaging needs a real provider; none is connected, so no Message buttons
    messaging: configuredReceiptChannels().includes("sms") || configuredReceiptChannels().includes("whatsapp"),
  };
}

export type FloorData = Awaited<ReturnType<typeof getFloor>>;
export type FloorTable = FloorData["tables"][number];

/** The selected-table drawer: people, rounds, kitchen items, bill and requests for one visit */
export async function getTableDetail(staff: Staff, tableId: string, now = new Date()) {
  const scope = { tenantId: staff.tenantId, outletId: staff.outletId };
  const [row] = await db
    .select({ session: s.tableSessions })
    .from(s.sessionTables)
    .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.sessionTables.tenantId), eq(s.tableSessions.id, s.sessionTables.sessionId)))
    .where(and(eq(s.sessionTables.tenantId, scope.tenantId), eq(s.sessionTables.outletId, scope.outletId), eq(s.sessionTables.activeKey, String(tableId))));
  if (!row) return { tableId, visit: null };
  const sid = row.session.id;
  const [people, orders, lines, requests, [bill], [reservation]] = await Promise.all([
    db.select({ id: s.participants.id, name: s.participants.displayName, isHost: sql<number>`${s.participants.id} = ${row.session.hostParticipantId ?? ""}`, paidOut: s.participants.paidOutAt }).from(s.participants).where(and(eq(s.participants.tenantId, scope.tenantId), eq(s.participants.sessionId, sid), isNull(s.participants.removedAt))).orderBy(s.participants.joinedAt),
    db.select({ id: s.orders.id, roundNo: s.orders.roundNo, status: s.orders.status, placedAt: s.orders.placedAt }).from(s.orders).where(and(eq(s.orders.tenantId, scope.tenantId), eq(s.orders.sessionId, sid))).orderBy(s.orders.roundNo),
    db.select({ orderId: s.orderLines.orderId, nameEn: s.orderLines.nameEn, qty: s.orderLines.qty, status: s.orderLines.status, unitPricePaise: s.orderLines.unitPricePaise }).from(s.orderLines).where(and(eq(s.orderLines.tenantId, scope.tenantId), eq(s.orderLines.sessionId, sid))).orderBy(s.orderLines.id),
    db.select({ id: s.serviceRequests.id, kind: s.serviceRequests.kind, createdAt: s.serviceRequests.createdAt, escalated: s.serviceRequests.escalatedAt }).from(s.serviceRequests).where(and(eq(s.serviceRequests.tenantId, scope.tenantId), eq(s.serviceRequests.sessionId, sid), eq(s.serviceRequests.status, "open"))).orderBy(s.serviceRequests.createdAt),
    db.select({ totalPaise: s.bills.totalPaise, status: s.bills.status, requestedAt: s.bills.requestedAt }).from(s.bills).where(and(eq(s.bills.tenantId, scope.tenantId), eq(s.bills.sessionId, sid))),
    row.session.reservationId
      ? db.select({ id: s.reservations.id, name: s.reservations.name, partySize: s.reservations.partySize, startAt: s.reservations.startAt, occasion: s.reservations.occasion, notes: s.reservations.notes }).from(s.reservations).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, row.session.reservationId)))
      : Promise.resolve([]),
  ]);
  const live = lines.filter((l) => l.status !== "cancelled" && l.status !== "voided");
  return {
    tableId,
    visit: {
      sessionId: sid,
      status: row.session.status,
      people: people.map((p) => ({ id: p.id, name: isPlaceholderName(p.name) ? null : p.name, isHost: !!Number(p.isHost), paidOut: !!p.paidOut })),
      rounds: orders.map((o) => ({ roundNo: o.roundNo, status: o.status, placedAt: o.placedAt.getTime(), items: lines.filter((l) => l.orderId === o.id).reduce((n, l) => n + l.qty, 0) })),
      kitchen: live.filter((l) => ["placed", "accepted", "preparing", "ready"].includes(l.status)).map((l) => ({ name: l.nameEn, qty: l.qty, status: l.status })),
      orderedPaise: live.reduce((n, l) => n + l.unitPricePaise * l.qty, 0),
      bill: bill ? { totalPaise: bill.totalPaise, requestedAt: bill.requestedAt?.getTime() ?? null } : null,
      requests: requests.map((r) => ({ id: r.id, kind: r.kind, minutes: Math.floor((now.getTime() - r.createdAt.getTime()) / 60_000), escalated: !!r.escalated })),
      reservation: reservation ? { ...reservation, startAt: reservation.startAt.getTime() } : null,
    },
  };
}

export type TableDetail = Awaited<ReturnType<typeof getTableDetail>>;
