import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { blockReasons, type BlockReason, type TableState } from "@/db/schema";
import { diningMinutesFor, EXTEND_STEP_MINUTES } from "@/domain/booking-policy";
import { LOCK_THEN_READ, type Tx } from "../db-types";
import { AppError } from "../errors";
import { publish, type RealtimeEvent } from "../realtime/publish";
import { assertMay, type StaffSession } from "../staff/auth";
import { audit } from "../staff/audit";
import { assignTable, releaseVisitTables, tableStateEvents, visitChanged } from "./assignments";
import { ATTEMPT_WINDOW_MS, lockSession, syncBill } from "../billing/bill";
import { syncOrderStatus, syncTickets } from "../kitchen/order-state";
import { topics } from "../realtime/token";
import { can } from "@/lib/staff-permissions";
import { loadPolicy } from "./policy";
import { syncEvents, syncTableHolds } from "./sync";
import {
  assertCombinable,
  assertFreeForSeating,
  assertSeats,
  bookingConflictError,
  bookingConflicts,
  clock,
  expectedEnd,
  lockTables,
  openVisit,
  partyOf,
  visitAt,
  type Scope,
  type TableRow,
} from "./visits";

// Host floor table actions (S1). Each one: role check, one transaction with the tables locked,
// an audit row, and realtime hints published after commit. The database is the truth.

export type FloorActor = Pick<StaffSession, "tenantId" | "outletId" | "userId" | "name" | "roles"> & { outlet: { timezone: string } };

const scopeOf = (staff: FloorActor): Scope => ({ tenantId: staff.tenantId, outletId: staff.outletId });

async function run<T>(staff: FloorActor, work: (tx: Tx) => Promise<{ result: T; events: RealtimeEvent[] }>) {
  const { result, events } = await db.transaction(work, LOCK_THEN_READ);
  await publish(scopeOf(staff), events);
  return result;
}

async function setState(tx: Tx, scope: Scope, ids: string[], state: TableState, now: Date) {
  for (const id of ids) {
    await tx.update(s.diningTables).set({ state, stateChangedAt: now }).where(and(eq(s.diningTables.tenantId, scope.tenantId), eq(s.diningTables.id, id)));
  }
}

/** Seat a walk-in at a free table: an open visit with nobody in it until someone scans */
export async function seatWalkIn(staff: FloorActor, input: { tableId: string; partySize: number; guestName?: string | null; endBy?: number | null }, now = new Date(), opts: { checkedByPos?: boolean } = {}) {
  // The POS opens a table for its own billing roles and checks them itself (see staff/pos-terminal.ts)
  if (!opts.checkedByPos) assertMay(staff, "floor.seat");
  const scope = scopeOf(staff);
  return run(staff, async (tx) => {
    const policy = await loadPolicy(tx, scope);
    const table = (await lockTables(tx, scope, [input.tableId])).get(input.tableId)!;
    await assertFreeForSeating(tx, scope, table);
    const partySize = Number(input.partySize);
    assertSeats([table], partySize);
    let until = new Date(now.getTime() + diningMinutesFor(partySize, policy) * 60_000);
    const [clash] = await bookingConflicts(tx, scope, [table.id], now, until, policy);
    if (clash) {
      // The host may seat a short turn that ends before the booking, never over it
      const latest = clash.startAt.getTime() - policy.turnoverBufferMinutes * 60_000;
      const endBy = input.endBy ? Number(input.endBy) : null;
      if (!endBy || endBy > latest || endBy < now.getTime() + 30 * 60_000) {
        throw bookingConflictError(clash, staff.outlet.timezone, { latestEndAt: latest > now.getTime() + 30 * 60_000 ? latest : null });
      }
      until = new Date(endBy);
    }
    const sessionId = await openVisit(tx, scope, [table], { source: "walk_in", partySize, guestName: input.guestName ?? null, expectedEndAt: until, userId: staff.userId, now });
    await audit(tx, staff, { action: "table.seat_walk_in", entity: "table", entityId: table.id, before: { state: table.state }, after: { state: "seated", sessionId, partySize, expectedEndAt: until }, now });
    return { result: { sessionId }, events: [...tableStateEvents([table.id], "seated"), visitChanged(sessionId, "seated")] };
  });
}

/** Paid → Needs cleaning, when the party has left */
export async function markNeedsCleaning(staff: FloorActor, tableId: string, now = new Date()) {
  assertMay(staff, "floor.reset");
  const scope = scopeOf(staff);
  return run(staff, async (tx) => {
    const table = (await lockTables(tx, scope, [tableId])).get(tableId)!;
    if (table.state !== "paid") throw new AppError("invalid_state", `${table.code} is not waiting after payment.`, { state: table.state });
    await setState(tx, scope, [table.id], "needs_cleaning", now);
    await audit(tx, staff, { action: "table.needs_cleaning", entity: "table", entityId: table.id, before: { state: "paid" }, after: { state: "needs_cleaning" }, now });
    return { result: null, events: tableStateEvents([table.id], "needs_cleaning") };
  });
}

/**
 * Clear table: Paid or Needs cleaning → Available (or Held/Reserved if a booking is due), once
 * nothing holds the table. Paid tables can go straight back; the cleaning step is optional.
 */
export async function markReady(staff: FloorActor, tableId: string, now = new Date()) {
  assertMay(staff, "floor.clean");
  const scope = scopeOf(staff);
  return run(staff, async (tx) => {
    const table = (await lockTables(tx, scope, [tableId])).get(tableId)!;
    if (table.state !== "needs_cleaning" && table.state !== "paid") throw new AppError("invalid_state", `${table.code} is not waiting to be cleared.`, { state: table.state });
    if (await visitAt(tx, scope, table.id)) throw new AppError("conflict", `${table.code} still has a party.`, { reason: "occupied" });
    await setState(tx, scope, [table.id], "available", now);
    const sync = await syncTableHolds(tx, scope, now, [table.id]);
    const state = sync.changes.find((c) => c.tableId === table.id)?.state ?? "available";
    await audit(tx, staff, { action: "table.ready", entity: "table", entityId: table.id, before: { state: table.state }, after: { state }, now });
    return { result: { state }, events: [...tableStateEvents([table.id], "available"), ...syncEvents(sync)] };
  });
}

/** Take a table out of service. Managers and owners only; never over a party or a booking. */
export async function blockTable(staff: FloorActor, input: { tableId: string; reason: BlockReason; note?: string | null; until?: number | null }, now = new Date()) {
  assertMay(staff, "floor.block");
  const scope = scopeOf(staff);
  if (!blockReasons.includes(input.reason)) throw new AppError("invalid_state", "Choose a reason.", { reason: "reason" });
  const note = input.note?.trim().slice(0, 120) || null;
  if (input.reason === "other" && !note) throw new AppError("invalid_state", "Add a short note for Other.", { reason: "note" });
  const until = input.until ? new Date(Number(input.until)) : null;
  if (until && until <= now) throw new AppError("invalid_state", "Choose a time later than now.", { reason: "until" });
  return run(staff, async (tx) => {
    const policy = await loadPolicy(tx, scope);
    const table = (await lockTables(tx, scope, [input.tableId])).get(input.tableId)!;
    if (await visitAt(tx, scope, table.id)) throw new AppError("conflict", `${table.code} has a party. Move them first.`, { reason: "occupied" });
    if (!["available", "held", "reserved", "needs_cleaning", "paid", "blocked"].includes(table.state)) throw new AppError("invalid_state", `${table.code} can't be blocked now.`);
    const [clash] = await bookingConflicts(tx, scope, [table.id], now, until ?? new Date(now.getTime() + 24 * 3600_000), policy);
    if (clash) throw bookingConflictError(clash, staff.outlet.timezone, { hint: "reassign" });
    await tx
      .update(s.diningTables)
      .set({ state: "blocked", stateChangedAt: now, blockedReason: input.reason, blockedNote: note, blockedUntil: until, blockedByUserId: staff.userId })
      .where(and(eq(s.diningTables.tenantId, scope.tenantId), eq(s.diningTables.id, table.id)));
    await audit(tx, staff, { action: "table.block", entity: "table", entityId: table.id, before: { state: table.state }, after: { state: "blocked", reason: input.reason, until }, reason: note, now });
    return { result: null, events: tableStateEvents([table.id], "blocked") };
  });
}

export async function unblockTable(staff: FloorActor, tableId: string, now = new Date()) {
  assertMay(staff, "floor.block");
  const scope = scopeOf(staff);
  return run(staff, async (tx) => {
    const table = (await lockTables(tx, scope, [tableId])).get(tableId)!;
    if (table.state !== "blocked") throw new AppError("invalid_state", `${table.code} is not blocked.`);
    await tx
      .update(s.diningTables)
      .set({ state: "available", stateChangedAt: now, blockedReason: null, blockedNote: null, blockedUntil: null, blockedByUserId: null })
      .where(and(eq(s.diningTables.tenantId, scope.tenantId), eq(s.diningTables.id, table.id)));
    const sync = await syncTableHolds(tx, scope, now, [table.id]);
    await audit(tx, staff, { action: "table.unblock", entity: "table", entityId: table.id, before: { state: "blocked", reason: table.blockedReason }, after: { state: "available" }, now });
    return { result: null, events: [...tableStateEvents([table.id], "available"), ...syncEvents(sync)] };
  });
}

async function liveVisit(tx: Tx, scope: Scope, table: TableRow) {
  const visit = await visitAt(tx, scope, table.id);
  if (!visit) throw new AppError("conflict", `${table.code} has no party.`, { reason: "empty" });
  return visit;
}

/** Re-point a visit's primary table (session.table_id and the one-open-visit key) */
async function setPrimary(tx: Tx, scope: Scope, sessionId: string, tableId: string | null) {
  await tx
    .update(s.tableSessions)
    .set(tableId ? { tableId, openKey: tableId } : { openKey: null })
    .where(and(eq(s.tableSessions.tenantId, scope.tenantId), eq(s.tableSessions.id, sessionId)));
}

async function release(tx: Tx, scope: Scope, sessionId: string, tableId: string, now: Date) {
  await tx
    .update(s.sessionTables)
    .set({ activeKey: null, releasedAt: now })
    .where(and(eq(s.sessionTables.tenantId, scope.tenantId), eq(s.sessionTables.sessionId, sessionId), eq(s.sessionTables.tableId, tableId), isNotNull(s.sessionTables.activeKey)));
}

/**
 * Move a party to a free table. People, orders and bill stay with the visit; phones keep working
 * (they find the visit by its table history). The old table needs cleaning.
 */
export async function moveParty(staff: FloorActor, input: { fromTableId: string; toTableId: string }, now = new Date()) {
  assertMay(staff, "floor.seat");
  const scope = scopeOf(staff);
  if (input.fromTableId === input.toTableId) throw new AppError("invalid_state", "Choose a different table.");
  return run(staff, async (tx) => {
    const policy = await loadPolicy(tx, scope);
    const tables = await lockTables(tx, scope, [input.fromTableId, input.toTableId]);
    const from = tables.get(input.fromTableId)!;
    const to = tables.get(input.toTableId)!;
    const visit = await liveVisit(tx, scope, from);
    if (visit.tableIds.length > 1) throw new AppError("conflict", "Uncombine these tables before moving the party.", { reason: "combined" });
    await assertFreeForSeating(tx, scope, to);
    assertSeats([to], partyOf(visit));
    const [clash] = await bookingConflicts(tx, scope, [to.id], now, expectedEnd(visit.session, visit.people, policy), policy, visit.session.reservationId);
    if (clash) throw bookingConflictError(clash, staff.outlet.timezone);

    const state: TableState = visit.session.status === "bill_requested" ? "bill_requested" : "seated";
    await release(tx, scope, visit.session.id, from.id, now);
    await assignTable(tx, { ...scope, sessionId: visit.session.id }, to.id, { primary: true, userId: staff.userId, now });
    await setPrimary(tx, scope, visit.session.id, to.id);
    await setState(tx, scope, [to.id], state, now);
    await setState(tx, scope, [from.id], "needs_cleaning", now);
    await audit(tx, staff, { action: "table.move", entity: "session", entityId: visit.session.id, before: { tableId: from.id, code: from.code }, after: { tableId: to.id, code: to.code }, now });
    return {
      result: { sessionId: visit.session.id },
      events: [...tableStateEvents([to.id], state), ...tableStateEvents([from.id], "needs_cleaning"), visitChanged(visit.session.id, "moved")],
    };
  });
}

/** Two seated parties trade tables. Each keeps its own people, orders and bill. */
export async function swapTables(staff: FloorActor, input: { tableId: string; otherTableId: string }, now = new Date()) {
  assertMay(staff, "floor.seat");
  const scope = scopeOf(staff);
  if (input.tableId === input.otherTableId) throw new AppError("invalid_state", "Choose a different table.");
  return run(staff, async (tx) => {
    const policy = await loadPolicy(tx, scope);
    const tables = await lockTables(tx, scope, [input.tableId, input.otherTableId]);
    const a = tables.get(input.tableId)!;
    const b = tables.get(input.otherTableId)!;
    const va = await liveVisit(tx, scope, a);
    const vb = await liveVisit(tx, scope, b);
    if (va.tableIds.length > 1 || vb.tableIds.length > 1) throw new AppError("conflict", "Uncombine tables before swapping.", { reason: "combined" });
    assertSeats([b], partyOf(va));
    assertSeats([a], partyOf(vb));
    const [clashA] = await bookingConflicts(tx, scope, [b.id], now, expectedEnd(va.session, va.people, policy), policy, va.session.reservationId);
    if (clashA) throw bookingConflictError(clashA, staff.outlet.timezone);
    const [clashB] = await bookingConflicts(tx, scope, [a.id], now, expectedEnd(vb.session, vb.people, policy), policy, vb.session.reservationId);
    if (clashB) throw bookingConflictError(clashB, staff.outlet.timezone);

    await release(tx, scope, va.session.id, a.id, now);
    await release(tx, scope, vb.session.id, b.id, now);
    // Free the one-open-visit key first, then hand each table to the other party
    await setPrimary(tx, scope, va.session.id, null);
    await setPrimary(tx, scope, vb.session.id, a.id);
    await setPrimary(tx, scope, va.session.id, b.id);
    await assignTable(tx, { ...scope, sessionId: va.session.id }, b.id, { primary: true, userId: staff.userId, now });
    await assignTable(tx, { ...scope, sessionId: vb.session.id }, a.id, { primary: true, userId: staff.userId, now });
    await setState(tx, scope, [b.id], a.state, now);
    await setState(tx, scope, [a.id], b.state, now);
    await audit(tx, staff, { action: "table.swap", entity: "table", entityId: a.id, before: { [a.code]: va.session.id, [b.code]: vb.session.id }, after: { [a.code]: vb.session.id, [b.code]: va.session.id }, now });
    return {
      result: null,
      events: [...tableStateEvents([b.id], a.state), ...tableStateEvents([a.id], b.state), visitChanged(va.session.id, "swapped"), visitChanged(vb.session.id, "swapped")],
    };
  });
}

/** Add a configured combinable table to a seated party: one visit, one bill, any QR joins it */
export async function combineTables(staff: FloorActor, input: { tableId: string; addTableId: string }, now = new Date()) {
  assertMay(staff, "floor.seat");
  const scope = scopeOf(staff);
  return run(staff, async (tx) => {
    const policy = await loadPolicy(tx, scope);
    const first = await lockTables(tx, scope, [input.tableId]);
    const visit = await liveVisit(tx, scope, first.get(input.tableId)!);
    const tables = await lockTables(tx, scope, [...visit.tableIds, input.addTableId]);
    if (visit.tableIds.includes(input.addTableId)) throw new AppError("invalid_state", "That table is already part of this party.");
    const add = tables.get(input.addTableId)!;
    await assertFreeForSeating(tx, scope, add);
    assertCombinable([...visit.tableIds.map((id) => tables.get(id)!), add]);
    const [clash] = await bookingConflicts(tx, scope, [add.id], now, expectedEnd(visit.session, visit.people, policy), policy, visit.session.reservationId);
    if (clash) throw bookingConflictError(clash, staff.outlet.timezone);
    const state: TableState = visit.session.status === "bill_requested" ? "bill_requested" : "seated";
    await assignTable(tx, { ...scope, sessionId: visit.session.id }, add.id, { primary: false, userId: staff.userId, now });
    await setState(tx, scope, [add.id], state, now);
    await audit(tx, staff, { action: "table.combine", entity: "session", entityId: visit.session.id, before: { tableIds: visit.tableIds }, after: { tableIds: [...visit.tableIds, add.id] }, now });
    return { result: null, events: [...tableStateEvents([add.id], state), visitChanged(visit.session.id, "combined")] };
  });
}

/** Take a joined table back off a party, when the rest still seats everyone and the bill is not out */
export async function uncombineTable(staff: FloorActor, tableId: string, now = new Date()) {
  assertMay(staff, "floor.seat");
  const scope = scopeOf(staff);
  return run(staff, async (tx) => {
    const first = await lockTables(tx, scope, [tableId]);
    const visit = await liveVisit(tx, scope, first.get(tableId)!);
    const tables = await lockTables(tx, scope, visit.tableIds);
    const table = tables.get(tableId)!;
    if (visit.tableIds.length < 2) throw new AppError("invalid_state", `${table.code} is not combined.`);
    if (visit.tableIds[0] === tableId) throw new AppError("conflict", `${table.code} is the party's main table. Uncombine the other table instead.`, { reason: "primary" });
    if (visit.session.status !== "open") throw new AppError("conflict", "The bill is out. Uncombine after it is settled or reopened.", { reason: "bill" });
    const rest = visit.tableIds.filter((id) => id !== tableId).map((id) => tables.get(id)!);
    assertSeats(rest, partyOf(visit));
    await release(tx, scope, visit.session.id, tableId, now);
    await setState(tx, scope, [tableId], "needs_cleaning", now);
    await audit(tx, staff, { action: "table.uncombine", entity: "session", entityId: visit.session.id, before: { tableIds: visit.tableIds }, after: { tableIds: rest.map((t) => t.id) }, now });
    return { result: null, events: [...tableStateEvents([tableId], "needs_cleaning"), visitChanged(visit.session.id, "uncombined")] };
  });
}

/** +15 minutes on the expected end, refused if it would run into a booking on any of its tables */
export async function extendTime(staff: FloorActor, input: { tableId: string; minutes?: number }, now = new Date()) {
  assertMay(staff, "floor.seat");
  const scope = scopeOf(staff);
  const minutes = Number(input.minutes ?? EXTEND_STEP_MINUTES);
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes % EXTEND_STEP_MINUTES !== 0 || minutes > 120) {
    throw new AppError("invalid_state", "Extend in 15-minute steps.", { reason: "minutes" });
  }
  return run(staff, async (tx) => {
    const policy = await loadPolicy(tx, scope);
    const first = await lockTables(tx, scope, [input.tableId]);
    const visit = await liveVisit(tx, scope, first.get(input.tableId)!);
    await lockTables(tx, scope, visit.tableIds);
    const before = expectedEnd(visit.session, visit.people, policy);
    const after = new Date(Math.max(before.getTime(), now.getTime()) + minutes * 60_000);
    const [clash] = await bookingConflicts(tx, scope, visit.tableIds, now, after, policy, visit.session.reservationId);
    if (clash) throw bookingConflictError(clash, staff.outlet.timezone, { until: clock(after, staff.outlet.timezone) });
    await tx.update(s.tableSessions).set({ expectedEndAt: after }).where(and(eq(s.tableSessions.tenantId, scope.tenantId), eq(s.tableSessions.id, visit.session.id)));
    await audit(tx, staff, { action: "table.extend", entity: "session", entityId: visit.session.id, before: { expectedEndAt: before }, after: { expectedEndAt: after }, now });
    return { result: { expectedEndAt: after.getTime() }, events: [visitChanged(visit.session.id, "extended")] };
  });
}

/**
 * A staff-seated party left without ordering or paying anything: close the visit and send the
 * table to cleaning. Anything ordered goes through the bill instead.
 */
export async function clearEmptyVisit(staff: FloorActor, tableId: string, now = new Date()) {
  assertMay(staff, "floor.seat");
  const scope = scopeOf(staff);
  return run(staff, async (tx) => {
    const first = await lockTables(tx, scope, [tableId]);
    const visit = await liveVisit(tx, scope, first.get(tableId)!);
    await lockTables(tx, scope, visit.tableIds);
    const [order] = await tx
      .select({ id: s.orders.id })
      .from(s.orders)
      .where(and(eq(s.orders.tenantId, scope.tenantId), eq(s.orders.sessionId, visit.session.id)))
      .limit(1);
    const [payment] = await tx
      .select({ id: s.payments.id })
      .from(s.payments)
      .innerJoin(s.bills, and(eq(s.bills.tenantId, s.payments.tenantId), eq(s.bills.id, s.payments.billId)))
      .where(and(eq(s.payments.tenantId, scope.tenantId), eq(s.bills.sessionId, visit.session.id)))
      .limit(1);
    if (order || payment) throw new AppError("conflict", "This party has orders. Settle the bill instead.", { reason: "has_orders" });
    await tx
      .update(s.tableSessions)
      .set({ status: "closed", openKey: null, closedAt: now })
      .where(and(eq(s.tableSessions.tenantId, scope.tenantId), eq(s.tableSessions.id, visit.session.id)));
    await setState(tx, scope, visit.tableIds, "needs_cleaning", now);
    await tx
      .update(s.sessionTables)
      .set({ activeKey: null, releasedAt: now })
      .where(and(eq(s.sessionTables.tenantId, scope.tenantId), eq(s.sessionTables.sessionId, visit.session.id), isNotNull(s.sessionTables.activeKey)));
    if (visit.session.reservationId) {
      await tx
        .update(s.reservations)
        .set({ status: "completed", completedAt: now })
        .where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, visit.session.reservationId), eq(s.reservations.status, "seated")));
    }
    await audit(tx, staff, { action: "table.clear_empty", entity: "session", entityId: visit.session.id, before: { tableIds: visit.tableIds }, after: { state: "needs_cleaning" }, now });
    return { result: null, events: [...tableStateEvents(visit.tableIds, "needs_cleaning"), visitChanged(visit.session.id, "closed")] };
  });
}

/**
 * Clear a table that still has a party: the party is done and gone. When nothing is left to pay
 * (a ₹0 bill, or everyone paid) the visit simply closes. When money is still owed it closes only
 * with a reason ("left without paying"), by a manager or owner, and the bill is cancelled, not
 * marked paid. Open requests at the table are closed too; the table is free straight away.
 */
export async function closeVisit(staff: FloorActor, input: { tableId: string; reason?: string | null }, now = new Date()) {
  assertMay(staff, "floor.seat");
  const scope = scopeOf(staff);
  return run(staff, async (tx) => {
    const first = await lockTables(tx, scope, [input.tableId]);
    const visit = await liveVisit(tx, scope, first.get(input.tableId)!);
    await lockTables(tx, scope, visit.tableIds);
    const billScope = { ...scope, sessionId: visit.session.id };
    await lockSession(tx, billScope);
    const { billId } = await syncBill(tx, billScope, now);
    const shares = await tx.select({ amountPaise: s.billShares.amountPaise, paidPaise: s.billShares.paidPaise }).from(s.billShares).where(and(eq(s.billShares.tenantId, scope.tenantId), eq(s.billShares.billId, billId)));
    const [moving] = await tx
      .select({ id: s.payments.id, createdAt: s.payments.createdAt })
      .from(s.payments)
      .where(and(eq(s.payments.tenantId, scope.tenantId), eq(s.payments.billId, billId), inArray(s.payments.status, ["initiated", "pending"])))
      .limit(1);
    if (moving) {
      // Within the first minutes the guest may still be paying. After that nobody is: say where the way out is
      const stuck = now.getTime() - moving.createdAt.getTime() >= ATTEMPT_WINDOW_MS;
      throw new AppError("conflict", stuck
        ? "An online payment has had no answer from the payment gateway for a while. Open Billing for this table, tap Check again, or ask a manager to release it as not paid, then clear the table."
        : "An online payment is still being checked. Wait a moment, then try again.", { reason: "payment_in_flight", stuck });
    }
    const duePaise = shares.reduce((n, sh) => n + Math.max(0, sh.amountPaise - sh.paidPaise), 0);
    const reason = String(input.reason ?? "").trim().slice(0, 200);
    if (duePaise > 0) {
      if (!reason) throw new AppError("invalid_state", `₹${(duePaise / 100).toLocaleString("en-IN")} is still to pay. Take the payment, or write why the table is closed unpaid.`, { reason: "unpaid", duePaise });
      if (!can(staff.roles, "floor.block")) throw new AppError("forbidden", "Only a manager or owner can close a table that has not paid.", { reason: "unpaid" });
    }
    await tx.update(s.bills).set({ status: duePaise > 0 ? "cancelled" : "paid", closedAt: now }).where(and(eq(s.bills.tenantId, scope.tenantId), eq(s.bills.id, billId)));
    await tx.update(s.tableSessions).set({ status: "closed", openKey: null, closedAt: now }).where(and(eq(s.tableSessions.tenantId, scope.tenantId), eq(s.tableSessions.id, visit.session.id)));
    await releaseVisitTables(tx, scope.tenantId, visit.session.id, now);
    await tx
      .update(s.serviceRequests)
      .set({ status: "done", doneAt: now, doneByUserId: staff.userId })
      .where(and(eq(s.serviceRequests.tenantId, scope.tenantId), eq(s.serviceRequests.sessionId, visit.session.id), eq(s.serviceRequests.status, "open")));
    await tx
      .update(s.reservations)
      .set({ status: "completed", completedAt: now })
      .where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.sessionId, visit.session.id), eq(s.reservations.status, "seated")));
    // The party is gone: whatever the kitchen or the floor still had open for it is done
    const leftover = await tx
      .select({ orderId: s.orderLines.orderId })
      .from(s.orderLines)
      .where(and(eq(s.orderLines.tenantId, scope.tenantId), eq(s.orderLines.sessionId, visit.session.id), inArray(s.orderLines.status, ["placed", "accepted", "preparing", "ready"])));
    const openOrders = [...new Set(leftover.map((l) => l.orderId))];
    if (openOrders.length) {
      await tx
        .update(s.orderLines)
        .set({ status: "served", servedAt: now })
        .where(and(eq(s.orderLines.tenantId, scope.tenantId), eq(s.orderLines.sessionId, visit.session.id), inArray(s.orderLines.status, ["placed", "accepted", "preparing", "ready"])));
      for (const orderId of openOrders) {
        await syncTickets(tx, scope.tenantId, orderId, now);
        await syncOrderStatus(tx, scope.tenantId, orderId, now);
      }
    }
    await setState(tx, scope, visit.tableIds, "available", now);
    const sync = await syncTableHolds(tx, scope, now, visit.tableIds);
    await audit(tx, staff, {
      action: duePaise > 0 ? "table.closed_unpaid" : "table.closed",
      entity: "session",
      entityId: visit.session.id,
      before: { tableIds: visit.tableIds, duePaise },
      after: { state: "available", bill: duePaise > 0 ? "cancelled" : "paid" },
      reason: reason || null,
      now,
    });
    const kitchen = openOrders.map((orderId) => ({ topic: topics.kitchen, type: "ticket.updated", data: { orderId } }));
    return { result: { duePaise }, events: [...tableStateEvents(visit.tableIds, "available"), ...syncEvents(sync), visitChanged(visit.session.id, "closed"), ...kitchen] };
  });
}
