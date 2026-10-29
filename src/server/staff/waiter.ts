import { requireFeature } from "../plan";
import "server-only";
import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "../errors";
import { publish } from "../realtime/publish";
import { staffRealtimeToken, topics } from "../realtime/token";
import type { StaffContext } from "./context";
import { chooseWaiter } from "@/domain/waiter-routing";
import { waiterCoverage } from "./waiter-coverage";
import { LOCK_THEN_READ } from "../db-types";
import type { StaffSession } from "./auth";
import { seatWalkIn } from "../floor/table-actions";

const staffRoles = ["waiter", "manager", "owner"] as const;

export async function requireStaffRole(ctx: StaffContext, roles: readonly (typeof s.staffRoleNames[number])[] = staffRoles) {
  if (roles.length === 1 && roles[0] === "rider") await requireFeature(ctx.tenantId,"riderTracking",ctx.outletId);
  if (!ctx.userId) throw new AppError("invalid_state", "A signed-in staff member is required.");
  const [users, rolesForUser] = await Promise.all([
    db.select({ id: s.users.id, name: s.users.name, duty: s.users.dutyStatus }).from(s.users).where(and(eq(s.users.tenantId, ctx.tenantId), eq(s.users.id, ctx.userId), eq(s.users.isActive, true))),
    db.select({ role: s.staffRoles.role }).from(s.staffRoles).where(and(eq(s.staffRoles.tenantId, ctx.tenantId), eq(s.staffRoles.userId, ctx.userId), inArray(s.staffRoles.role, roles), or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, ctx.outletId)))),
  ]);
  const user = users[0];
  const role = rolesForUser[0];
  if (!user || !role) throw new AppError("invalid_state", "You cannot use the waiter screen for this outlet.");
  return { ...user, role: role.role, supervisor: rolesForUser.some(r => r.role === "manager" || r.role === "owner") };
}

export async function getWaiterTasks(ctx: StaffContext, now = new Date()) {
  const actor = await requireStaffRole(ctx);
  const coverage = await waiterCoverage(ctx, now);
  const owners = new Map(coverage.visits.map(v => [v.id, v.waiterUserId]));
  const visible = (sessionId: string) => {
    const owner = coverage.activeOwner(owners.get(sessionId));
    return actor.supervisor || owner?.id === ctx.userId;
  };
  const [requests, readyLines] = await Promise.all([
    db.select({
      id: s.serviceRequests.id,
      sessionId: s.serviceRequests.sessionId,
      tableCode: s.diningTables.code,
      kind: s.serviceRequests.kind,
      createdAt: s.serviceRequests.createdAt,
      escalatedAt: s.serviceRequests.escalatedAt,
    }).from(s.serviceRequests)
      .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.serviceRequests.tenantId), eq(s.tableSessions.id, s.serviceRequests.sessionId)))
      .innerJoin(s.diningTables, and(eq(s.diningTables.tenantId, s.tableSessions.tenantId), eq(s.diningTables.id, s.tableSessions.tableId)))
      .where(and(eq(s.serviceRequests.tenantId, ctx.tenantId), eq(s.serviceRequests.outletId, ctx.outletId), eq(s.serviceRequests.status, "open"), ne(s.tableSessions.status, "closed")))
      .orderBy(asc(s.serviceRequests.createdAt), asc(s.serviceRequests.id)),
    db.select({
      line: s.orderLines,
      tableCode: s.diningTables.code,
      roundNo: s.orders.roundNo,
      readyAt: s.orderLines.readyAt,
    }).from(s.orderLines)
      .innerJoin(s.orders, and(eq(s.orders.tenantId, s.orderLines.tenantId), eq(s.orders.id, s.orderLines.orderId)))
      .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.orders.tenantId), eq(s.tableSessions.id, s.orders.sessionId)))
      .innerJoin(s.diningTables, and(eq(s.diningTables.tenantId, s.tableSessions.tenantId), eq(s.diningTables.id, s.tableSessions.tableId)))
      .where(and(eq(s.orderLines.tenantId, ctx.tenantId), eq(s.tableSessions.outletId, ctx.outletId), eq(s.orderLines.status, "ready"), isNull(s.orderLines.voidedAt), ne(s.tableSessions.status, "closed")))
      .orderBy(asc(s.orderLines.readyAt), asc(s.orderLines.id)),
  ]);
  const groups = new Map<string, { id: string; sessionId: string; tableCode: string; roundNo: number; readyAt: Date; lines: { id: string; qty: number; name: string; nameHi: string | null }[] }>();
  for (const row of readyLines) {
    if (!visible(row.line.sessionId)) continue;
    const key = `${row.line.orderId}:${row.roundNo}`;
    const group = groups.get(key) ?? { id: key, sessionId: row.line.sessionId, tableCode: row.tableCode, roundNo: row.roundNo, readyAt: row.readyAt ?? now, lines: [] };
    group.lines.push({ id: row.line.id, qty: row.line.qty, name: row.line.nameEn, nameHi: row.line.nameHi });
    groups.set(key, group);
  }
  return {
    requests: requests.filter(r => visible(r.sessionId)).map((request) => ({ ...request, createdAt: request.createdAt.getTime(), escalated: request.escalatedAt !== null })),
    ready: [...groups.values()].map((group) => ({ ...group, readyAt: group.readyAt.getTime() })),
    realtimeToken: staffRealtimeToken(ctx, [topics.tasks, topics.kitchen, topics.floor]),
  };
}

/** A plain waiter only works on visits they own; managers and owners can open any table. */
export async function requireOwnVisit(ctx: StaffContext & { roles: readonly string[] }, sessionId: string) {
  if (ctx.roles.some(r => r === "manager" || r === "owner")) return;
  const [visit] = await db.select({ waiterUserId: s.tableSessions.waiterUserId }).from(s.tableSessions).where(and(eq(s.tableSessions.tenantId, ctx.tenantId), eq(s.tableSessions.outletId, ctx.outletId), eq(s.tableSessions.id, String(sessionId))));
  if (!visit || visit.waiterUserId !== ctx.userId) throw new AppError("forbidden", "This table is not assigned to you. Ask a manager.");
}

/** Seat a walk-in from the waiter app. A plain waiter may only open a table assigned to them; the visit is theirs. */
export async function waiterSeatTable(staff: StaffSession, tableId: string, partySize: number, now = new Date()) {
  const actor = await requireStaffRole(staff);
  if (!actor.supervisor) {
    if (actor.duty !== "on") throw new AppError("forbidden", "Go on duty before seating a table.");
    const coverage = await waiterCoverage(staff, now);
    if (coverage.shifts.find(a => a.tableId === String(tableId))?.waiterUserId !== staff.userId) throw new AppError("forbidden", "This table is not assigned to you. Ask a manager.");
  }
  // Waiters cannot seat from the floor screen; here the assignment check above stands in for that permission
  const { sessionId } = await seatWalkIn(staff, { tableId: String(tableId), partySize: Number(partySize) }, now, { checkedByPos: true });
  await claimWaiterVisit(staff, sessionId, now);
  return { sessionId };
}

/** Assign a shift default and the current visit in one transaction. Combined tables share their primary table. */
export async function assignWaitersToTables(ctx: StaffContext, inputTableIds: string[], waiterUserId: string | null, periodKey: string, now = new Date()) {
  const actor = await requireStaffRole(ctx, ["host", "manager", "owner"]);
  const tableIds = [...new Set(inputTableIds)].sort();
  if (!tableIds.length || tableIds.length > 200 || tableIds.some(id => typeof id !== "string") || !periodKey || periodKey.length > 40) throw new AppError("invalid_state", "Choose valid tables and a shift period.");
  const affected = await db.transaction(async tx => {
    const tables = await tx.select({ id: s.diningTables.id }).from(s.diningTables).where(and(eq(s.diningTables.tenantId, ctx.tenantId), eq(s.diningTables.outletId, ctx.outletId), inArray(s.diningTables.id, tableIds), eq(s.diningTables.isActive, true))).orderBy(s.diningTables.id).for("update");
    if (tables.length !== tableIds.length) throw new AppError("not_found", "A table is no longer available in this outlet.");
    if (waiterUserId && waiterUserId !== "__auto") {
      const [waiter] = await tx.select({ id: s.users.id, duty: s.users.dutyStatus }).from(s.users).innerJoin(s.staffRoles, and(eq(s.staffRoles.tenantId, s.users.tenantId), eq(s.staffRoles.userId, s.users.id)))
        .where(and(eq(s.users.tenantId, ctx.tenantId), eq(s.users.id, waiterUserId), eq(s.users.isActive, true), eq(s.staffRoles.role, "waiter"), or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, ctx.outletId)))).for("update");
      if (!waiter) throw new AppError("not_found", "This waiter is not available in this outlet.");
      if (waiter.duty !== "on") throw new AppError("invalid_state", "Choose a waiter who is on duty.");
    }
    const bindings = await tx.select({ tableId: s.sessionTables.tableId, sessionId: s.sessionTables.sessionId, primaryId: s.tableSessions.tableId }).from(s.sessionTables)
      .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.sessionTables.tenantId), eq(s.tableSessions.id, s.sessionTables.sessionId)))
      .where(and(eq(s.sessionTables.tenantId, ctx.tenantId), eq(s.sessionTables.outletId, ctx.outletId), inArray(s.sessionTables.activeKey, tableIds)));
    const primaryIds = [...new Set(tableIds.map(id => bindings.find(b => b.tableId === id)?.primaryId ?? id))].sort();
    const sessionIds = [...new Set(bindings.map(b => b.sessionId))].sort();
    const targets = new Map<string, string | null>();
    if (waiterUserId === "__auto") {
      await tx.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, ctx.tenantId), eq(s.users.isActive, true), eq(s.users.dutyStatus, "on"))).orderBy(s.users.id).for("update");
      const coverage = await waiterCoverage(ctx, now, tx);
      const loads = coverage.waiters.map(w => ({ ...w, activeTables: Math.max(w.activeTables, w.tableCount) }));
      for (const tableId of primaryIds) {
        const next = chooseWaiter(loads);
        if (!next) throw new AppError("invalid_state", "No waiter is on duty. Set someone on duty first.");
        targets.set(tableId, next.id);
        next.activeTables++;
      }
    } else for (const tableId of primaryIds) targets.set(tableId, waiterUserId);
    for (const sessionId of sessionIds) {
      const [visit] = await tx.select({ id: s.tableSessions.id, tableId: s.tableSessions.tableId }).from(s.tableSessions).where(and(eq(s.tableSessions.tenantId, ctx.tenantId), eq(s.tableSessions.outletId, ctx.outletId), eq(s.tableSessions.id, sessionId))).for("update");
      if (visit) await tx.update(s.tableSessions).set({ waiterUserId: targets.get(visit.tableId) ?? null }).where(and(eq(s.tableSessions.tenantId, ctx.tenantId), eq(s.tableSessions.outletId, ctx.outletId), eq(s.tableSessions.id, sessionId)));
    }
    for (const tableId of primaryIds) {
      const target = targets.get(tableId) ?? null;
      await tx.update(s.waiterTableAssignments).set({ active: false, activeKey: null, releasedAt: now }).where(and(eq(s.waiterTableAssignments.tenantId, ctx.tenantId), eq(s.waiterTableAssignments.outletId, ctx.outletId), eq(s.waiterTableAssignments.tableId, tableId), eq(s.waiterTableAssignments.active, true)));
      if (target) await tx.insert(s.waiterTableAssignments).values({ tenantId: ctx.tenantId, outletId: ctx.outletId, tableId, waiterUserId: target, assignedByUserId: ctx.userId!, periodKey, activeKey: tableId, expiresAt: new Date(now.getTime() + 12 * 3600_000), assignedAt: now });
    }
    await tx.insert(s.auditLog).values({ tenantId: ctx.tenantId, outletId: ctx.outletId, actorUserId: ctx.userId, actorLabel: actor.name, action: "waiter_assigned", entity: "table", entityId: primaryIds[0], after: { assignments: Object.fromEntries(targets), sessionIds, periodKey } });
    return primaryIds;
  }, LOCK_THEN_READ);
  await publish(ctx, [{ topic: topics.floor, type: "waiter_assignment.changed", data: { tableIds: affected, waiterUserId } }, { topic: topics.tasks, type: "waiter_assignment.changed" }]);
  return { tableIds: affected };
}

export async function assignWaiterToTable(ctx: StaffContext, tableId: string, waiterUserId: string | null, periodKey: string, now = new Date()) {
  return assignWaitersToTables(ctx, [tableId], waiterUserId, periodKey, now);
}

/** Accept shared coverage atomically: two phones cannot both take the same visit. */
export async function claimWaiterVisit(ctx: StaffContext, sessionId: string, now = new Date()) {
  const actor = await requireStaffRole(ctx);
  if (!actor.supervisor && actor.duty !== "on") throw new AppError("forbidden", "Go on duty before taking a table.");
  await db.transaction(async tx => {
    const [visit] = await tx.select().from(s.tableSessions).where(and(eq(s.tableSessions.tenantId, ctx.tenantId), eq(s.tableSessions.outletId, ctx.outletId), eq(s.tableSessions.id, sessionId))).for("update");
    if (!visit || visit.status === "closed") throw new AppError("not_found", "This visit has ended.");
    if (actor.supervisor || visit.waiterUserId === ctx.userId) return;
    if (visit.waiterUserId) {
      const [owner] = await tx.select({ id: s.users.id }).from(s.users).innerJoin(s.staffRoles, and(eq(s.staffRoles.tenantId, s.users.tenantId), eq(s.staffRoles.userId, s.users.id), eq(s.staffRoles.role, "waiter"), or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, ctx.outletId))))
        .where(and(eq(s.users.tenantId, ctx.tenantId), eq(s.users.id, visit.waiterUserId), eq(s.users.isActive, true), eq(s.users.dutyStatus, "on")));
      if (owner) throw new AppError("conflict", "Another waiter is responsible for this table. Ask a manager to hand it over.");
    }
    await tx.update(s.tableSessions).set({ waiterUserId: ctx.userId }).where(and(eq(s.tableSessions.tenantId, ctx.tenantId), eq(s.tableSessions.id, sessionId)));
    await tx.insert(s.auditLog).values({ tenantId: ctx.tenantId, outletId: ctx.outletId, actorUserId: ctx.userId, actorLabel: actor.name, action: "waiter.visit_claimed", entity: "session", entityId: sessionId, before: { waiterUserId: visit.waiterUserId }, after: { waiterUserId: ctx.userId }, createdAt: now });
  }, LOCK_THEN_READ);
  await publish(ctx, [{ topic: topics.floor, type: "waiter_assignment.changed" }, { topic: topics.tasks, type: "waiter_assignment.changed" }]);
}

export async function waiterRealtimeToken(ctx: StaffContext) {
  await requireStaffRole(ctx);
  return staffRealtimeToken(ctx, [topics.tasks, topics.kitchen, topics.floor]);
}
