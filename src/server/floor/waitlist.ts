import "server-only";
import { and, eq, inArray, max } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { diningMinutesFor } from "@/domain/booking-policy";
import { LOCK_THEN_READ, type Tx } from "../db-types";
import { AppError } from "../errors";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import { assertMay } from "../staff/auth";
import { audit } from "../staff/audit";
import { tableStateEvents, visitChanged } from "./assignments";
import { loadPolicy } from "./policy";
import { queueBookingNotification } from "../booking/notifications";
import type { FloorActor } from "./table-actions";
import { assertCombinable, assertFreeForSeating, assertSeats, bookingConflictError, bookingConflicts, lockTables, openVisit, type Scope } from "./visits";

// Waitlist (PS 4.6): an ordered queue of walk-in parties. Waiting → Notified → Seated, or Skipped /
// Left. "Notify" records that the guest was told; no message is sent until a provider exists.

const QUEUED = ["waiting", "notified"] as const;
const scopeOf = (staff: FloorActor): Scope => ({ tenantId: staff.tenantId, outletId: staff.outletId });
const changed = (entryId?: string) => ({ topic: topics.floor, type: "waitlist.updated", data: entryId ? { entryId } : {} });

async function lockQueue(tx: Tx, scope: Scope) {
  return tx
    .select()
    .from(s.waitlistEntries)
    .where(and(eq(s.waitlistEntries.tenantId, scope.tenantId), eq(s.waitlistEntries.outletId, scope.outletId), inArray(s.waitlistEntries.status, [...QUEUED])))
    .orderBy(s.waitlistEntries.sortOrder, s.waitlistEntries.joinedAt)
    .for("update");
}

async function lockEntry(tx: Tx, scope: Scope, id: string) {
  const [row] = await tx
    .select()
    .from(s.waitlistEntries)
    .where(and(eq(s.waitlistEntries.tenantId, scope.tenantId), eq(s.waitlistEntries.outletId, scope.outletId), eq(s.waitlistEntries.id, String(id))))
    .for("update");
  if (!row) throw new AppError("not_found", "This party is not on the waitlist.");
  return row;
}

export async function addToWaitlist(staff: FloorActor, input: { name: string; phone?: string | null; partySize: number; quotedMinutes?: number | null; notes?: string | null; seatingPreference?: string | null }, now = new Date()) {
  assertMay(staff, "waitlist.manage");
  const scope = scopeOf(staff);
  const name = String(input.name ?? "").trim().slice(0, 80);
  if (!name) throw new AppError("invalid_state", "Enter the party's name.", { reason: "name" });
  const partySize = Number(input.partySize);
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 50) throw new AppError("invalid_state", "Enter how many guests.", { reason: "party_size" });
  const quoted = input.quotedMinutes == null || input.quotedMinutes === ("" as unknown) ? null : Number(input.quotedMinutes);
  if (quoted !== null && (!Number.isInteger(quoted) || quoted < 0 || quoted > 240)) throw new AppError("invalid_state", "Quote 0 to 240 minutes.", { reason: "quote" });
  const id = await db.transaction(async (tx) => {
    await lockQueue(tx, scope);
    const [{ last }] = await tx
      .select({ last: max(s.waitlistEntries.sortOrder) })
      .from(s.waitlistEntries)
      .where(and(eq(s.waitlistEntries.tenantId, scope.tenantId), eq(s.waitlistEntries.outletId, scope.outletId)));
    const id = uuidv7();
    await tx.insert(s.waitlistEntries).values({
      id,
      tenantId: scope.tenantId,
      outletId: scope.outletId,
      name,
      phone: input.phone?.replace(/[^\d+]/g, "").slice(0, 15) || null,
      partySize,
      seatingPreference: input.seatingPreference?.trim().slice(0, 40) || null,
      joinedAt: now,
      quotedMinutes: quoted,
      estimateMinutes: quoted,
      estimateSource: quoted == null ? "fallback" : "staff",
      notes: input.notes?.trim().slice(0, 200) || null,
      sortOrder: (last ?? 0) + 1,
      createdByUserId: staff.userId,
    });
    await audit(tx, staff, { action: "waitlist.add", entity: "waitlist", entityId: id, after: { name, partySize, quoted }, now });
    return id;
  }, LOCK_THEN_READ);
  await publish(scope, [changed(id)]);
  return { entryId: id };
}

async function close(staff: FloorActor, id: string, to: "notified" | "skipped" | "left", now: Date) {
  assertMay(staff, "waitlist.manage");
  const scope = scopeOf(staff);
  await db.transaction(async (tx) => {
    const e = await lockEntry(tx, scope, id);
    const allowed = to === "notified" ? ["waiting"] : [...QUEUED];
    if (!allowed.includes(e.status)) throw new AppError("conflict", `${e.name} is already ${e.status}.`, { status: e.status });
    const policy = await loadPolicy(tx, scope);
    await tx
      .update(s.waitlistEntries)
      .set(to === "notified" ? { status: to, notifiedAt: now, readyDeadline: new Date(now.getTime() + policy.readyWindowMinutes * 60_000), updatedAt: now } : { status: to, closedAt: now, updatedAt: now })
      .where(and(eq(s.waitlistEntries.tenantId, scope.tenantId), eq(s.waitlistEntries.id, e.id)));
    await audit(tx, staff, { action: `waitlist.${to}`, entity: "waitlist", entityId: e.id, before: { status: e.status }, after: { status: to }, now });
  }, LOCK_THEN_READ);
  await publish(scope, [changed(id)]);
  if (to === "notified") {
    const [entry] = await db.select({ phone: s.waitlistEntries.phone }).from(s.waitlistEntries).where(and(eq(s.waitlistEntries.tenantId, scope.tenantId), eq(s.waitlistEntries.outletId, scope.outletId), eq(s.waitlistEntries.id, id)));
    if (entry?.phone) await queueBookingNotification({ tenantId: scope.tenantId, outletId: scope.outletId, waitlistEntryId: id, type: "waitlist_ready", recipient: entry.phone, channel: "sms", idempotencyKey: `waitlist-ready:${id}` });
  }
}

export const notifyWaitlist = (staff: FloorActor, id: string, now = new Date()) => close(staff, id, "notified", now);
export const skipWaitlist = (staff: FloorActor, id: string, now = new Date()) => close(staff, id, "skipped", now);
export const removeFromWaitlist = (staff: FloorActor, id: string, now = new Date()) => close(staff, id, "left", now);

export async function restoreWaitlist(staff: FloorActor, id: string, now = new Date()) {
  assertMay(staff, "waitlist.manage");
  const scope = scopeOf(staff);
  await db.transaction(async (tx) => {
    const e = await lockEntry(tx, scope, id);
    if (!["skipped", "expired", "left"].includes(e.status)) throw new AppError("conflict", `${e.name} cannot be restored from ${e.status}.`);
    const [{ last }] = await tx.select({ last: max(s.waitlistEntries.sortOrder) }).from(s.waitlistEntries).where(and(eq(s.waitlistEntries.tenantId, scope.tenantId), eq(s.waitlistEntries.outletId, scope.outletId)));
    await tx.update(s.waitlistEntries).set({ status: "waiting", sortOrder: (last ?? 0) + 1, closedAt: null, readyDeadline: null, updatedAt: now }).where(and(eq(s.waitlistEntries.tenantId, scope.tenantId), eq(s.waitlistEntries.id, id)));
    await audit(tx, staff, { action: "waitlist.restore", entity: "waitlist", entityId: id, before: { status: e.status }, after: { status: "waiting" }, now });
  }, LOCK_THEN_READ);
  await publish(scope, [changed(id)]);
}

/** Move a party to a new place in the queue (0 = next) */
export async function reorderWaitlist(staff: FloorActor, input: { entryId: string; toIndex: number }, now = new Date()) {
  assertMay(staff, "waitlist.manage");
  const scope = scopeOf(staff);
  await db.transaction(async (tx) => {
    const queue = await lockQueue(tx, scope);
    const from = queue.findIndex((e) => e.id === input.entryId);
    if (from === -1) throw new AppError("conflict", "This party is no longer waiting.");
    const to = Math.max(0, Math.min(queue.length - 1, Math.trunc(Number(input.toIndex))));
    const [moved] = queue.splice(from, 1);
    queue.splice(to, 0, moved);
    for (const [i, e] of queue.entries()) {
      if (e.sortOrder !== i + 1) {
        await tx.update(s.waitlistEntries).set({ sortOrder: i + 1 }).where(and(eq(s.waitlistEntries.tenantId, scope.tenantId), eq(s.waitlistEntries.id, e.id)));
      }
    }
    await audit(tx, staff, { action: "waitlist.reorder", entity: "waitlist", entityId: moved.id, before: { position: from + 1 }, after: { position: to + 1 }, now });
  }, LOCK_THEN_READ);
  await publish(scope, [changed(input.entryId)]);
}

/** Seat a waiting party at a free table (button or drag onto a table: the same mutation) */
export async function seatWaitlist(staff: FloorActor, input: { entryId: string; tableIds: string[] }, now = new Date()) {
  assertMay(staff, "floor.seat");
  const scope = scopeOf(staff);
  const tableIds = [...new Set((input.tableIds ?? []).map(String))];
  const { sessionId } = await db.transaction(async (tx) => {
    const policy = await loadPolicy(tx, scope);
    const e = await lockEntry(tx, scope, input.entryId);
    if (!QUEUED.includes(e.status as (typeof QUEUED)[number])) throw new AppError("conflict", `${e.name} is already ${e.status}.`, { status: e.status });
    const tables = await lockTables(tx, scope, tableIds);
    const list = tableIds.map((id) => tables.get(id)!);
    for (const t of list) await assertFreeForSeating(tx, scope, t);
    assertSeats(list, e.partySize);
    assertCombinable(list);
    const until = new Date(now.getTime() + diningMinutesFor(e.partySize, policy) * 60_000);
    const [clash] = await bookingConflicts(tx, scope, tableIds, now, until, policy);
    if (clash) throw bookingConflictError(clash, staff.outlet.timezone);
    const sessionId = await openVisit(tx, scope, list, { source: "waitlist", partySize: e.partySize, guestName: e.name, expectedEndAt: until, userId: staff.userId, now });
    await tx
      .update(s.waitlistEntries)
      .set({ status: "seated", seatedAt: now, closedAt: now, sessionId })
      .where(and(eq(s.waitlistEntries.tenantId, scope.tenantId), eq(s.waitlistEntries.id, e.id)));
    await audit(tx, staff, { action: "waitlist.seat", entity: "waitlist", entityId: e.id, before: { status: e.status }, after: { status: "seated", sessionId, tableIds }, now });
    return { sessionId };
  }, LOCK_THEN_READ);
  await publish(scope, [changed(input.entryId), ...tableStateEvents(tableIds, "seated"), visitChanged(sessionId, "seated")]);
  return { sessionId };
}
