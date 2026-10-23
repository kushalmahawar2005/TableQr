import "server-only";
import { and, eq, gt, isNull, ne, or } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import type { Runner } from "../db-types";
import { chooseWaiter } from "@/domain/waiter-routing";
import { LOCK_THEN_READ } from "../db-types";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";

export type OutletScope = { tenantId: string; outletId: string };

/** Batch read shared by Floor, the waiter app and alert routing. */
export async function waiterCoverage(scope: OutletScope, now = new Date(), runner: Runner = db) {
  const [rows, shifts, visits, requests, ready] = await Promise.all([
    runner.select({ id: s.users.id, name: s.users.name, duty: s.users.dutyStatus, seen: s.users.lastSeenAt })
      .from(s.users).innerJoin(s.staffRoles, and(eq(s.staffRoles.tenantId, s.users.tenantId), eq(s.staffRoles.userId, s.users.id)))
      .where(and(eq(s.users.tenantId, scope.tenantId), eq(s.users.isActive, true), eq(s.staffRoles.role, "waiter"), or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, scope.outletId)))),
    runner.select().from(s.waiterTableAssignments).where(and(eq(s.waiterTableAssignments.tenantId, scope.tenantId), eq(s.waiterTableAssignments.outletId, scope.outletId), eq(s.waiterTableAssignments.active, true), gt(s.waiterTableAssignments.expiresAt, now))),
    runner.select({ id: s.tableSessions.id, tableId: s.tableSessions.tableId, waiterUserId: s.tableSessions.waiterUserId }).from(s.tableSessions)
      .where(and(eq(s.tableSessions.tenantId, scope.tenantId), eq(s.tableSessions.outletId, scope.outletId), ne(s.tableSessions.status, "closed"))),
    runner.select({ sessionId: s.serviceRequests.sessionId }).from(s.serviceRequests).where(and(eq(s.serviceRequests.tenantId, scope.tenantId), eq(s.serviceRequests.outletId, scope.outletId), eq(s.serviceRequests.status, "open"))),
    runner.select({ sessionId: s.orderLines.sessionId, orderId: s.orderLines.orderId }).from(s.orderLines).innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.orderLines.tenantId), eq(s.tableSessions.id, s.orderLines.sessionId))).where(and(eq(s.orderLines.tenantId, scope.tenantId), eq(s.tableSessions.outletId, scope.outletId), ne(s.tableSessions.status, "closed"), eq(s.orderLines.status, "ready"))),
  ]);
  const ownerByVisit = new Map(visits.map(v => [v.id, v.waiterUserId]));
  const work = new Map<string, { activeTables: number; pendingRequests: number; orders: Set<string>; tables: Set<string> }>();
  const load = (id: string) => { let w = work.get(id); if (!w) { w = { activeTables: 0, pendingRequests: 0, orders: new Set(), tables: new Set() }; work.set(id, w); } return w; };
  for (const visit of visits) if (visit.waiterUserId) { load(visit.waiterUserId).activeTables++; load(visit.waiterUserId).tables.add(visit.tableId); }
  for (const shift of shifts) load(shift.waiterUserId).tables.add(shift.tableId);
  for (const request of requests) { const id = ownerByVisit.get(request.sessionId); if (id) load(id).pendingRequests++; }
  for (const line of ready) { const id = ownerByVisit.get(line.sessionId); if (id) load(id).orders.add(line.orderId); }
  const waiters = [...new Map(rows.map(row => [row.id, row])).values()].map(row => ({
    id: row.id, name: row.name, duty: row.duty,
    online: !!row.seen && now.getTime() - row.seen.getTime() < 120_000,
    tableCount: work.get(row.id)?.tables.size ?? 0,
    activeTables: work.get(row.id)?.activeTables ?? 0,
    pendingRequests: work.get(row.id)?.pendingRequests ?? 0,
    readyOrders: work.get(row.id)?.orders.size ?? 0,
  })).sort((a, b) => Number(b.duty === "on") - Number(a.duty === "on") || a.tableCount - b.tableCount || a.name.localeCompare(b.name));
  const byId = new Map(waiters.map(w => [w.id, w]));
  const owner = (id: string | null | undefined) => id ? byId.get(id) ?? null : null;
  return { waiters, shifts, visits, owner, activeOwner: (id: string | null | undefined) => { const waiter = owner(id); return waiter?.duty === "on" ? waiter : null; } };
}

/** Snapshot the shift waiter when a visit opens. Later table moves keep that visit's owner. */
export async function shiftWaiterId(runner: Runner, scope: OutletScope, tableId: string, now: Date) {
  // Serialize competing seating requests across the small on-duty waiter set before reading load.
  await runner.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, scope.tenantId), eq(s.users.dutyStatus, "on"), eq(s.users.isActive, true))).orderBy(s.users.id).for("update");
  const [row] = await runner.select({ userId: s.users.id }).from(s.waiterTableAssignments)
    .innerJoin(s.users, and(eq(s.users.tenantId, s.waiterTableAssignments.tenantId), eq(s.users.id, s.waiterTableAssignments.waiterUserId)))
    .innerJoin(s.staffRoles, and(eq(s.staffRoles.tenantId, s.users.tenantId), eq(s.staffRoles.userId, s.users.id), eq(s.staffRoles.role, "waiter"), or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, scope.outletId))))
    .where(and(eq(s.waiterTableAssignments.tenantId, scope.tenantId), eq(s.waiterTableAssignments.outletId, scope.outletId), eq(s.waiterTableAssignments.tableId, tableId), eq(s.waiterTableAssignments.active, true), gt(s.waiterTableAssignments.expiresAt, now), eq(s.users.isActive, true), eq(s.users.dutyStatus, "on"))).limit(1);
  const coverage = await waiterCoverage(scope, now, runner);
  return chooseWaiter(coverage.waiters, row?.userId)?.id ?? null;
}

export async function sessionOwner(scope: OutletScope, sessionId: string) {
  const [owner] = await db.select({ id: s.users.id }).from(s.tableSessions)
    .innerJoin(s.users, and(eq(s.users.tenantId, s.tableSessions.tenantId), eq(s.users.id, s.tableSessions.waiterUserId)))
    .innerJoin(s.staffRoles, and(eq(s.staffRoles.tenantId, s.users.tenantId), eq(s.staffRoles.userId, s.users.id), eq(s.staffRoles.role, "waiter"), or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, scope.outletId))))
    .where(and(eq(s.tableSessions.tenantId, scope.tenantId), eq(s.tableSessions.outletId, scope.outletId), eq(s.tableSessions.id, sessionId), ne(s.tableSessions.status, "closed"), eq(s.users.isActive, true), eq(s.users.dutyStatus, "on"))).limit(1);
  return owner?.id ?? null;
}

/** Reassign once a request becomes overdue, or immediately when its waiter is away.
 * Shift defaults stay intact; only this customer's current visit moves to the backup. */
export async function rebalanceWaiterVisit(scope: OutletScope, sessionId: string, now = new Date(), overdue = false) {
  if (!overdue && await sessionOwner(scope, sessionId)) return;
  const changed = await db.transaction(async tx => {
    await tx.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, scope.tenantId), eq(s.users.isActive, true), eq(s.users.dutyStatus, "on"))).orderBy(s.users.id).for("update");
    const [visit] = await tx.select({ id: s.tableSessions.id, waiterUserId: s.tableSessions.waiterUserId, status: s.tableSessions.status }).from(s.tableSessions).where(and(eq(s.tableSessions.tenantId, scope.tenantId), eq(s.tableSessions.outletId, scope.outletId), eq(s.tableSessions.id, sessionId))).for("update");
    if (!visit || visit.status === "closed") return false;
    const coverage = await waiterCoverage(scope, now, tx);
    if (coverage.activeOwner(visit.waiterUserId) && !overdue) return false;
    const next = chooseWaiter(coverage.waiters, null, overdue ? visit.waiterUserId : null);
    if (!next || next.id === visit.waiterUserId) return false;
    await tx.update(s.tableSessions).set({ waiterUserId: next.id }).where(and(eq(s.tableSessions.tenantId, scope.tenantId), eq(s.tableSessions.id, sessionId)));
    await tx.insert(s.auditLog).values({ tenantId: scope.tenantId, outletId: scope.outletId, actorLabel: "Automatic coverage", action: "waiter.auto_routed", entity: "session", entityId: sessionId, before: { waiterUserId: visit.waiterUserId }, after: { waiterUserId: next.id, reason: overdue ? "overdue" : "unavailable" }, createdAt: now });
    return true;
  }, LOCK_THEN_READ);
  if (changed) await publish(scope, [{ topic: topics.floor, type: "waiter_assignment.changed" }, { topic: topics.tasks, type: "waiter_assignment.changed" }]);
}
