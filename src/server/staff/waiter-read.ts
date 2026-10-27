import "server-only";
import { checkIn, myDuty } from "./duty";
import { and, asc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requireStaffRole, requireOwnVisit, getWaiterTasks } from "./waiter";
import type { StaffSession } from "./auth";
import { AppError } from "../errors";
import { waiterCoverage } from "./waiter-coverage";
import { loadItems, isWithinCategoryWindow } from "../guest/menu";

/** A fixed set of batch reads. No floor reconciliation or per-table reads. */
export async function waiterBoard(staff: StaffSession, now = new Date()) {
  await requireStaffRole(staff);
  const [tasks, tables, coverage, sessions, bindings, duty] = await Promise.all([
    getWaiterTasks(staff, now),
    db.select().from(s.diningTables).where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.outletId, staff.outletId))).orderBy(s.diningTables.code),
    waiterCoverage(staff, now),
    db.select().from(s.tableSessions).where(and(eq(s.tableSessions.tenantId, staff.tenantId), eq(s.tableSessions.outletId, staff.outletId), ne(s.tableSessions.status, "closed"))),
    db.select().from(s.sessionTables).where(and(eq(s.sessionTables.tenantId, staff.tenantId), eq(s.sessionTables.outletId, staff.outletId), isNotNull(s.sessionTables.activeKey))),
    // The app is open: this counts as "online now"
    checkIn(staff, now).then(() => myDuty(staff)),
  ]);
  const ids = sessions.map(x => x.id); if (!ids.length) ids.push("-");
  const [people, lines, bills, shares] = await Promise.all([
    db.select({ sessionId: s.participants.sessionId }).from(s.participants).where(and(eq(s.participants.tenantId, staff.tenantId), inArray(s.participants.sessionId, ids), isNull(s.participants.removedAt))),
    db.select({ sessionId: s.orderLines.sessionId, qty: s.orderLines.qty }).from(s.orderLines).where(and(eq(s.orderLines.tenantId, staff.tenantId), inArray(s.orderLines.sessionId, ids), eq(s.orderLines.status, "ready"))),
    db.select().from(s.bills).where(and(eq(s.bills.tenantId, staff.tenantId), inArray(s.bills.sessionId, ids))),
    db.select({ sessionId: s.bills.sessionId, amount: s.billShares.amountPaise, paid: s.billShares.paidPaise }).from(s.billShares).innerJoin(s.bills, and(eq(s.bills.tenantId, s.billShares.tenantId), eq(s.bills.id, s.billShares.billId))).where(and(eq(s.billShares.tenantId, staff.tenantId), inArray(s.bills.sessionId, ids))),
  ]);
  const cards = tables.map(t => {
    const binding = bindings.find(b => b.tableId === t.id);
    const visit = sessions.find(v => v.id === binding?.sessionId);
    const mainId = visit?.tableId ?? t.id;
    const owner = visit ? coverage.owner(visit.waiterUserId) : coverage.owner(coverage.shifts.find(a => a.tableId === mainId)?.waiterUserId);
    const assigned = owner?.id === staff.userId;
    const shared = !!visit && !coverage.activeOwner(visit.waiterUserId);
    const label = visit ? bindings.filter(b => b.sessionId === visit.id).sort((a,b) => Number(b.isPrimary)-Number(a.isPrimary)).map(b => tables.find(x => x.id === b.tableId)?.code).join(" + ") : t.code;
    return { id: t.id, code: t.code, label, assigned, shared, primary: mainId === t.id, state: t.state, sessionId: visit?.id ?? null, partySize: visit ? Math.max(visit.partySize ?? 0, people.filter(p => p.sessionId === visit.id).length) : 0, openedAt: visit?.openedAt.getTime() ?? null, expectedEndAt: visit?.expectedEndAt?.getTime() ?? null, orderingPaused: visit?.orderingLocked ?? false, readyCount: lines.filter(l => l.sessionId === visit?.id).reduce((n,l)=>n+l.qty,0), requestCount: tasks.requests.filter(r => r.tableCode === t.code).length, unpaidPaise: bills.some(b => b.sessionId === visit?.id) ? shares.filter(sh => sh.sessionId === visit?.id).reduce((n,sh)=>n+Math.max(0,sh.amount-sh.paid),0) : null };
  });
  // A plain waiter sees only their own tables; managers and owners see the whole floor
  const supervisor = staff.roles.some(r => r === "manager" || r === "owner");
  return { renderedAt: now.getTime(), identity: { name: staff.name, roles: staff.roles, outlet: staff.outlet.name, duty: duty.status }, requests: tasks.requests, ready: tasks.ready, tables: cards.filter(t => t.assigned && t.primary), unassignedTables: supervisor ? cards.filter(t => t.shared && t.primary) : [], orderTables: cards.filter(t => t.sessionId && t.primary && (supervisor || t.assigned)) };
}
export type WaiterBoard = Awaited<ReturnType<typeof waiterBoard>>;

export async function waiterDetail(staff: StaffSession, sessionId: string) {
  await requireStaffRole(staff);
  await requireOwnVisit(staff, sessionId);
  const [session] = await db.select().from(s.tableSessions).where(and(eq(s.tableSessions.tenantId, staff.tenantId), eq(s.tableSessions.outletId, staff.outletId), eq(s.tableSessions.id, sessionId)));
  if (!session) throw new AppError("not_found", "Table session not found in this outlet.");
  const [people, lines, requests, shares] = await Promise.all([
    db.select({ id: s.participants.id, name: s.participants.displayName, paidOutAt: s.participants.paidOutAt }).from(s.participants).where(and(eq(s.participants.tenantId, staff.tenantId), eq(s.participants.sessionId, sessionId), isNull(s.participants.removedAt))).orderBy(asc(s.participants.joinedAt), asc(s.participants.id)),
    db.select({ id: s.orderLines.id, participantId: s.orderLines.participantId, name: s.orderLines.nameEn, nameHi: s.orderLines.nameHi, qty: s.orderLines.qty, status: s.orderLines.status, roundNo: s.orders.roundNo }).from(s.orderLines).innerJoin(s.orders, and(eq(s.orders.tenantId, s.orderLines.tenantId), eq(s.orders.id, s.orderLines.orderId))).where(and(eq(s.orderLines.tenantId, staff.tenantId), eq(s.orderLines.sessionId, sessionId))).orderBy(s.orders.roundNo),
    db.select({ id: s.serviceRequests.id, kind: s.serviceRequests.kind }).from(s.serviceRequests).where(and(eq(s.serviceRequests.tenantId, staff.tenantId), eq(s.serviceRequests.sessionId, sessionId), eq(s.serviceRequests.status, "open"))),
    db.select({ participantId: s.billShares.participantId, amount: s.billShares.amountPaise, paid: s.billShares.paidPaise, frozenAt: s.billShares.frozenAt }).from(s.billShares).innerJoin(s.bills, and(eq(s.bills.tenantId, s.billShares.tenantId), eq(s.bills.id, s.billShares.billId))).where(and(eq(s.billShares.tenantId, staff.tenantId), eq(s.bills.sessionId, sessionId))),
  ]);
  return { sessionId, tableId: session.tableId, status: session.status, orderingPaused: session.orderingLocked, people: people.map(p=>({id:p.id,name:p.name,paidOut:!!p.paidOutAt})), lines, requests, shares: shares.map(sh=>({...sh,frozenAt:sh.frozenAt?.getTime()??null})) };
}
export type WaiterDetail = Awaited<ReturnType<typeof waiterDetail>>;
export async function waiterMenu(staff: StaffSession, now = new Date(), roles?: Parameters<typeof requireStaffRole>[1]) {
  await requireStaffRole(staff, roles);
  const [outlet] = await db.select().from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId)));
  const items = await loadItems(db, {...staff,brandId:outlet.brandId}, now);
  return items.map(x=>({id:x.item.id,name:x.item.nameEn,nameHi:x.item.nameHi,pricing:{...x.pricing,isAvailable:x.pricing.isAvailable && isWithinCategoryWindow(x.categoryWindow,outlet.timezone,now)}}));
}
export type WaiterMenu = Awaited<ReturnType<typeof waiterMenu>>;
