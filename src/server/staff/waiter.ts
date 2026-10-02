import "server-only";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "../errors";
import { publish } from "../realtime/publish";
import { staffRealtimeToken, topics } from "../realtime/token";
import type { StaffContext } from "./context";

const staffRoles = ["waiter", "manager", "owner"] as const;

export async function requireStaffRole(ctx: StaffContext, roles: readonly (typeof s.staffRoleNames[number])[] = staffRoles) {
  if (!ctx.userId) throw new AppError("invalid_state", "A signed-in staff member is required.");
  const [users, rolesForUser] = await Promise.all([
    db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(and(eq(s.users.tenantId, ctx.tenantId), eq(s.users.id, ctx.userId), eq(s.users.isActive, true))),
    db.select({ role: s.staffRoles.role }).from(s.staffRoles).where(and(eq(s.staffRoles.tenantId, ctx.tenantId), eq(s.staffRoles.userId, ctx.userId), inArray(s.staffRoles.role, roles), or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, ctx.outletId)))).limit(1),
  ]);
  const user = users[0];
  const role = rolesForUser[0];
  if (!user || !role) throw new AppError("invalid_state", "You cannot use the waiter screen for this outlet.");
  return { ...user, role: role.role };
}

export async function getWaiterTasks(ctx: StaffContext, now = new Date()) {
  await requireStaffRole(ctx);
  const [requests, readyLines] = await Promise.all([
    db.select({
      id: s.serviceRequests.id,
      tableCode: s.diningTables.code,
      kind: s.serviceRequests.kind,
      createdAt: s.serviceRequests.createdAt,
      escalatedAt: s.serviceRequests.escalatedAt,
    }).from(s.serviceRequests)
      .innerJoin(s.diningTables, and(eq(s.diningTables.tenantId, s.serviceRequests.tenantId), eq(s.diningTables.id, s.serviceRequests.tableId)))
      .where(and(eq(s.serviceRequests.tenantId, ctx.tenantId), eq(s.serviceRequests.outletId, ctx.outletId), eq(s.serviceRequests.status, "open")))
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
      .where(and(eq(s.orderLines.tenantId, ctx.tenantId), eq(s.tableSessions.outletId, ctx.outletId), eq(s.orderLines.status, "ready"), isNull(s.orderLines.voidedAt)))
      .orderBy(asc(s.orderLines.readyAt), asc(s.orderLines.id)),
  ]);
  const groups = new Map<string, { id: string; tableCode: string; roundNo: number; readyAt: Date; lines: { id: string; qty: number; name: string; nameHi: string | null }[] }>();
  for (const row of readyLines) {
    const key = `${row.line.orderId}:${row.roundNo}`;
    const group = groups.get(key) ?? { id: key, tableCode: row.tableCode, roundNo: row.roundNo, readyAt: row.readyAt ?? now, lines: [] };
    group.lines.push({ id: row.line.id, qty: row.line.qty, name: row.line.nameEn, nameHi: row.line.nameHi });
    groups.set(key, group);
  }
  return {
    requests: requests.map((request) => ({ ...request, createdAt: request.createdAt.getTime(), escalated: request.escalatedAt !== null })),
    ready: [...groups.values()].map((group) => ({ ...group, readyAt: group.readyAt.getTime() })),
    realtimeToken: staffRealtimeToken(ctx, [topics.tasks, topics.kitchen, topics.floor]),
  };
}

export async function assignWaiterToTable(ctx: StaffContext, tableId: string, waiterUserId: string | null, periodKey: string, now = new Date()) {
  const actor = await requireStaffRole(ctx, ["host", "manager", "owner"]);
  if (!periodKey || periodKey.length > 40) throw new AppError("invalid_state", "A valid shift period is required.");
  const [waiter] = await db.select({ id: s.users.id }).from(s.users)
    .innerJoin(s.staffRoles, and(eq(s.staffRoles.tenantId, s.users.tenantId), eq(s.staffRoles.userId, s.users.id)))
    .where(and(eq(s.users.tenantId, ctx.tenantId), eq(s.users.id, waiterUserId ?? "-"), eq(s.users.isActive, true), eq(s.staffRoles.role, "waiter"), or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, ctx.outletId))));
  const [table] = await db.select({ id: s.diningTables.id }).from(s.diningTables).where(and(eq(s.diningTables.tenantId, ctx.tenantId), eq(s.diningTables.outletId, ctx.outletId), eq(s.diningTables.id, tableId)));
  if ((waiterUserId && !waiter) || !table) throw new AppError("not_found", "The waiter or table is not available in this outlet.");
  await db.transaction(async (tx) => {
    await tx.select({ id: s.diningTables.id }).from(s.diningTables).where(and(eq(s.diningTables.tenantId, ctx.tenantId), eq(s.diningTables.outletId, ctx.outletId), eq(s.diningTables.id, tableId))).for("update");
    await tx.update(s.waiterTableAssignments).set({ active: false, activeKey: null, releasedAt: now }).where(and(eq(s.waiterTableAssignments.tenantId, ctx.tenantId), eq(s.waiterTableAssignments.outletId, ctx.outletId), eq(s.waiterTableAssignments.tableId, tableId), eq(s.waiterTableAssignments.active, true)));
    if (waiterUserId) await tx.insert(s.waiterTableAssignments).values({ tenantId: ctx.tenantId, outletId: ctx.outletId, tableId, waiterUserId, assignedByUserId: ctx.userId!, periodKey, activeKey: tableId, expiresAt: new Date(now.getTime() + 12 * 3600_000), assignedAt: now });
    await tx.insert(s.auditLog).values({ tenantId: ctx.tenantId, outletId: ctx.outletId, actorUserId: ctx.userId, actorLabel: actor.name, action: "waiter_assigned", entity: "table", entityId: tableId, after: { waiterUserId, periodKey } });
  });
  await publish(ctx, [{ topic: topics.floor, type: "waiter_assignment.changed", data: { tableId, waiterUserId, periodKey } }]);
}

export async function waiterRealtimeToken(ctx: StaffContext) {
  await requireStaffRole(ctx);
  return staffRealtimeToken(ctx, [topics.tasks, topics.kitchen, topics.floor]);
}