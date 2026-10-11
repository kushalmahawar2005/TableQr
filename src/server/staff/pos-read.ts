import "server-only";
import { and, desc, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "../errors";
import { loadRefundState } from "../billing/refunds";
import { requireStaffRole } from "./waiter";
import type { StaffSession } from "./auth";
import { billDiscount } from "../billing/discounts";
import { billToken } from "../billing/bill-link";

export const posRoles = ["cashier", "manager", "owner", "accountant"] as const;
async function guard(staff: StaffSession) { await requireStaffRole(staff, posRoles); return staff; }

/** Bills settled in the last 24 hours, whose table is already closed: the way back to a paid bill to refund it */
async function recentlyPaid(staff: StaffSession) {
  const rows = await db.select({ session: s.tableSessions, table: s.diningTables, bill: s.bills })
    .from(s.bills)
    .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.bills.tenantId), eq(s.tableSessions.id, s.bills.sessionId)))
    .innerJoin(s.diningTables, and(eq(s.diningTables.tenantId, s.tableSessions.tenantId), eq(s.diningTables.id, s.tableSessions.tableId)))
    .where(and(eq(s.bills.tenantId, staff.tenantId), eq(s.bills.outletId, staff.outletId), eq(s.bills.status, "paid"), gte(s.bills.closedAt, new Date(Date.now() - 24 * 3600_000))))
    .orderBy(desc(s.bills.closedAt)).limit(20);
  return rows.map(({ session, table, bill }) => ({ sessionId: session.id, tableCode: table.code, status: session.status, billStatus: bill.status as string | null, totalPaise: bill.totalPaise, paidPaise: bill.totalPaise, balancePaise: 0, partySize: session.partySize ?? 0, requestedAt: bill.requestedAt?.getTime() ?? null, pendingOnline: false, paymentMethods: [] as string[] }));
}

export async function posQueue(staff: StaffSession) {
  await guard(staff);
  const sessions = await db.select({ session: s.tableSessions, table: s.diningTables })
    .from(s.tableSessions).innerJoin(s.diningTables, and(eq(s.diningTables.tenantId, s.tableSessions.tenantId), eq(s.diningTables.id, s.tableSessions.tableId)))
    .where(and(eq(s.tableSessions.tenantId, staff.tenantId), eq(s.tableSessions.outletId, staff.outletId), ne(s.tableSessions.status, "closed")))
    .orderBy(desc(s.tableSessions.lastActivityAt));
  const recentPaid = await recentlyPaid(staff);
  const ids = sessions.map(x => x.session.id); if (!ids.length) return { identity: { name: staff.name, roles: staff.roles, outlet: staff.outlet.name }, queue: [], recent: recentPaid, realtimeToken: null };
  const [bills, shares, payments, people, counterReqs] = await Promise.all([
    db.select().from(s.bills).where(and(eq(s.bills.tenantId, staff.tenantId), inArray(s.bills.sessionId, ids))),
    db.select({ share: s.billShares, billSessionId: s.bills.sessionId }).from(s.billShares).innerJoin(s.bills, and(eq(s.bills.tenantId, s.billShares.tenantId), eq(s.bills.id, s.billShares.billId))).where(and(eq(s.billShares.tenantId, staff.tenantId), inArray(s.bills.sessionId, ids))),
    db.select({ payment: s.payments, billSessionId: s.bills.sessionId }).from(s.payments).innerJoin(s.bills, and(eq(s.bills.tenantId, s.payments.tenantId), eq(s.bills.id, s.payments.billId))).where(and(eq(s.payments.tenantId, staff.tenantId), inArray(s.bills.sessionId, ids))),
    db.select({ sessionId: s.participants.sessionId }).from(s.participants).where(and(eq(s.participants.tenantId, staff.tenantId), inArray(s.participants.sessionId, ids), isNull(s.participants.removedAt))),
    db.select({ sessionId: s.serviceRequests.sessionId }).from(s.serviceRequests).where(and(eq(s.serviceRequests.tenantId, staff.tenantId), inArray(s.serviceRequests.sessionId, ids), eq(s.serviceRequests.kind, "pay_at_counter"), eq(s.serviceRequests.status, "open"))),
  ]);
  const counterSessions = new Set(counterReqs.map(r => r.sessionId));
  const cards = sessions.map(({ session, table }) => {
    const bill = bills.find(b => b.sessionId === session.id);
    const sh = shares.filter(x => x.billSessionId === session.id).map(x => x.share);
    const ps = payments.filter(x => x.billSessionId === session.id).map(x => x.payment);
    const due = sh.reduce((n, x) => n + Math.max(0, x.amountPaise - x.paidPaise), 0);
    const paid = sh.reduce((n, x) => n + x.paidPaise, 0);
    return { sessionId: session.id, tableCode: table.code, status: session.status, billStatus: bill?.status ?? null, totalPaise: bill?.totalPaise ?? 0, paidPaise: paid, balancePaise: due, partySize: Math.max(session.partySize ?? 0, people.filter(p => p.sessionId === session.id).length), requestedAt: bill?.requestedAt?.getTime() ?? null, pendingOnline: ps.some(p => ["initiated", "pending"].includes(p.status)), payAtCounter: counterSessions.has(session.id), paymentMethods: [...new Set(ps.map(p => p.method))] };
  });
  const queue = cards.filter(c => c.balancePaise > 0).sort((a, b) => Number(b.payAtCounter) - Number(a.payAtCounter) || Number(b.pendingOnline) - Number(a.pendingOnline) || (b.requestedAt ?? 0) - (a.requestedAt ?? 0));
  const recent = [...cards.filter(c => c.balancePaise === 0 && c.billStatus === "paid"), ...recentPaid].slice(0, 20);
  return { identity: { name: staff.name, roles: staff.roles, outlet: staff.outlet.name }, queue, recent, realtimeToken: null };
}
export type PosQueue = Awaited<ReturnType<typeof posQueue>>;

export async function posBillDetail(staff: StaffSession, sessionId: string) {
  await guard(staff);
  const [row] = await db.select({ session: s.tableSessions, table: s.diningTables, bill: s.bills }).from(s.tableSessions)
    .innerJoin(s.diningTables, and(eq(s.diningTables.tenantId, s.tableSessions.tenantId), eq(s.diningTables.id, s.tableSessions.tableId)))
    .leftJoin(s.bills, and(eq(s.bills.tenantId, s.tableSessions.tenantId), eq(s.bills.sessionId, s.tableSessions.id)))
    .where(and(eq(s.tableSessions.tenantId, staff.tenantId), eq(s.tableSessions.outletId, staff.outletId), eq(s.tableSessions.id, sessionId)));
  if (!row) throw new AppError("not_found", "Bill not found in this outlet.");
  const [people, lines, shares, payments] = await Promise.all([
    db.select({ id: s.participants.id, name: s.participants.displayName, paidOutAt: s.participants.paidOutAt }).from(s.participants).where(and(eq(s.participants.tenantId, staff.tenantId), eq(s.participants.sessionId, sessionId), isNull(s.participants.removedAt))),
    db.select({ id: s.orderLines.id, participantId: s.orderLines.participantId, name: s.orderLines.nameEn, nameHi: s.orderLines.nameHi, qty: s.orderLines.qty, unitPricePaise: s.orderLines.unitPricePaise, status: s.orderLines.status, note: s.orderLines.note, roundNo: s.orders.roundNo }).from(s.orderLines).innerJoin(s.orders, and(eq(s.orders.tenantId, s.orderLines.tenantId), eq(s.orders.id, s.orderLines.orderId))).where(and(eq(s.orderLines.tenantId, staff.tenantId), eq(s.orderLines.sessionId, sessionId))).orderBy(s.orders.roundNo),
    row.bill ? db.select().from(s.billShares).where(and(eq(s.billShares.tenantId, staff.tenantId), eq(s.billShares.billId, row.bill.id))) : Promise.resolve([]),
    row.bill ? db.select().from(s.payments).where(and(eq(s.payments.tenantId, staff.tenantId), eq(s.payments.billId, row.bill.id))).orderBy(desc(s.payments.createdAt)) : Promise.resolve([]),
  ]);
  const refundState = await loadRefundState(staff.tenantId, payments);
  return { sessionId, tableId: row.table.id, tableCode: row.table.code, status: row.session.status, bill: row.bill ? { id: row.bill.id, status: row.bill.status, subtotalPaise: row.bill.subtotalPaise, discountPaise: row.bill.discountPaise, discount: await billDiscount(staff, row.bill.id), taxPaise: row.bill.taxPaise, serviceChargePaise: row.bill.serviceChargePaise, roundOffPaise: row.bill.roundOffPaise, totalPaise: row.bill.totalPaise, shareToken: billToken(row.bill.id) } : null, people, lines, shares: shares.map(x => ({ id: x.id, participantId: x.participantId, amountPaise: x.amountPaise, paidPaise: x.paidPaise, status: x.status, frozenAt: x.frozenAt?.getTime() ?? null })), needsApproval: !staff.roles.some(r => r === "manager" || r === "owner"), payments: payments.map(x => ({ id: x.id, method: x.method, amountPaise: x.amountPaise, tipPaise: x.tipPaise, status: x.status, channel: x.channel, createdAt: x.createdAt.getTime(), refund: refundState.get(x.id)! })) };
}
export type PosBillDetail = Awaited<ReturnType<typeof posBillDetail>>;
