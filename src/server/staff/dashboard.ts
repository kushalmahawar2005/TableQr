import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  BILL_REQUESTED_ALERT_MINUTES,
  LATE_LOOKBACK_HOURS,
  TOP_ITEMS,
  UPCOMING_WINDOW_MINUTES,
  averageOf,
  bucketOf,
  coversOf,
  greeting,
  lastDays,
  lateness,
  todayAndYesterday,
  waitedMinutes,
  type DayRange,
} from "@/domain/dashboard";
import { isPlaceholderName } from "@/domain/guest-name";
import { canSee } from "@/lib/staff-permissions";
import { AppError } from "../errors";
import { loadPolicy } from "../floor/policy";
import { isItemAvailable } from "../guest/menu";
import type { StaffSession } from "./auth";

// O1 Owner Dashboard read model. Read-only: plain SELECTs scoped to the tenant and the signed-in
// outlet, never the S1 floor read (that one reconciles holds and writes). Revenue is net sales from
// paid bills: bills.total_paise, which already has discounts and applied booking credit taken off
// and never includes tips. Money is integer paise; days are outlet-local calendar days.

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "roles" | "outlet">;
type Scope = { tenantId: string; outletId: string };

function guard(staff: Staff) {
  if (!canSee(staff.roles, "dashboard")) throw new AppError("forbidden", "Your role cannot view the dashboard.");
}

const OPEN_TABLE_STATES = ["seated", "bill_requested"] as const;
const DEAD_LINES = ["cancelled", "voided"] as const;
/** Valid bookings: confirmed by the guest or staff. Online holds (requested) never count. */
const BOOKED = ["confirmed", "reminded"] as const;

type PaidBill = { sessionId: string; closedAt: Date; totalPaise: number; taxPaise: number; serviceChargePaise: number; tipPaise: number };

/** Paid bills closed inside [from, to) at this outlet */
async function paidBills(scope: Scope, from: Date, to: Date): Promise<PaidBill[]> {
  const rows = await db
    .select({
      sessionId: s.bills.sessionId,
      closedAt: s.bills.closedAt,
      totalPaise: s.bills.totalPaise,
      taxPaise: s.bills.taxPaise,
      serviceChargePaise: s.bills.serviceChargePaise,
      tipPaise: s.bills.tipPaise,
    })
    .from(s.bills)
    .where(and(eq(s.bills.tenantId, scope.tenantId), eq(s.bills.outletId, scope.outletId), eq(s.bills.status, "paid"), gte(s.bills.closedAt, from), lt(s.bills.closedAt, to)));
  return rows.filter((r): r is PaidBill => r.closedAt !== null);
}

export type DayMoney = { revenuePaise: number; paidBills: number; taxPaise: number; serviceChargePaise: number; tipPaise: number };

/** Net sales per day: the same formula for today, yesterday and every trend bucket */
export function revenueByDay(bills: PaidBill[], ranges: readonly DayRange[]): DayMoney[] {
  const out = ranges.map(() => ({ revenuePaise: 0, paidBills: 0, taxPaise: 0, serviceChargePaise: 0, tipPaise: 0 }));
  for (const b of bills) {
    const i = bucketOf(b.closedAt, ranges);
    if (i < 0) continue;
    out[i].revenuePaise += b.totalPaise;
    out[i].paidBills += 1;
    out[i].taxPaise += b.taxPaise;
    out[i].serviceChargePaise += b.serviceChargePaise;
    out[i].tipPaise += b.tipPaise;
  }
  return out;
}

/** Covers per day for visits whose bill was paid in that day. One bill per visit, so a visit over combined tables counts once. */
async function coversByDay(scope: Scope, bills: PaidBill[], ranges: readonly DayRange[]) {
  const out = ranges.map(() => 0);
  const ids = [...new Set(bills.map((b) => b.sessionId))];
  if (ids.length === 0) return out;
  const [sessions, joined] = await Promise.all([
    db
      .select({ id: s.tableSessions.id, partySize: s.tableSessions.partySize })
      .from(s.tableSessions)
      .where(and(eq(s.tableSessions.tenantId, scope.tenantId), eq(s.tableSessions.outletId, scope.outletId), inArray(s.tableSessions.id, ids))),
    db
      .select({ sessionId: s.participants.sessionId, n: count() })
      .from(s.participants)
      .where(and(eq(s.participants.tenantId, scope.tenantId), inArray(s.participants.sessionId, ids), isNull(s.participants.removedAt)))
      .groupBy(s.participants.sessionId),
  ]);
  const party = new Map(sessions.map((x) => [x.id, x.partySize]));
  const people = new Map(joined.map((x) => [x.sessionId, Number(x.n)]));
  for (const b of bills) {
    const i = bucketOf(b.closedAt, ranges);
    if (i >= 0 && party.has(b.sessionId)) out[i] += coversOf(party.get(b.sessionId) ?? null, people.get(b.sessionId) ?? 0);
  }
  return out;
}

/** Orders placed in the range that are not cancelled (an order is cancelled once every line is) */
async function ordersIn(scope: Scope, range: DayRange) {
  const [row] = await db
    .select({ n: count() })
    .from(s.orders)
    .where(and(eq(s.orders.tenantId, scope.tenantId), eq(s.orders.outletId, scope.outletId), gte(s.orders.placedAt, range.start), lt(s.orders.placedAt, range.end), ne(s.orders.status, "cancelled")));
  return Number(row?.n ?? 0);
}

/** Top items by quantity from order-line snapshots; cancelled and voided lines never count */
export async function topItems(scope: Scope, range: DayRange, limit = TOP_ITEMS) {
  const qty = sql<string>`sum(${s.orderLines.qty})`;
  const rows = await db
    .select({
      itemId: s.orderLines.itemId,
      // The name as printed on the newest line, so a later menu rename never rewrites history
      name: sql<string>`substring_index(group_concat(${s.orderLines.nameEn} order by ${s.orderLines.createdAt} desc separator '\\n'), '\\n', 1)`,
      qty,
      grossPaise: sql<string>`sum(${s.orderLines.unitPricePaise} * ${s.orderLines.qty})`,
    })
    .from(s.orderLines)
    .innerJoin(s.orders, and(eq(s.orders.tenantId, s.orderLines.tenantId), eq(s.orders.id, s.orderLines.orderId)))
    .where(
      and(
        eq(s.orderLines.tenantId, scope.tenantId),
        eq(s.orders.outletId, scope.outletId),
        gte(s.orders.placedAt, range.start),
        lt(s.orders.placedAt, range.end),
        notInArray(s.orderLines.status, [...DEAD_LINES]),
      ),
    )
    .groupBy(s.orderLines.itemId)
    .orderBy(desc(qty), asc(s.orderLines.itemId))
    .limit(limit);
  return rows.map((r) => ({ itemId: r.itemId, name: r.name, qty: Number(r.qty), grossPaise: Number(r.grossPaise) }));
}

/** Last 7 outlet-local days of net sales, oldest first */
export async function getRevenueTrend(staff: Staff, now = new Date()) {
  guard(staff);
  const scope = { tenantId: staff.tenantId, outletId: staff.outletId };
  const days = lastDays(now, staff.outlet.timezone);
  const money = revenueByDay(await paidBills(scope, days[0].start, days[days.length - 1].end), days);
  return days.map((d, i) => ({ date: d.date, revenuePaise: money[i].revenuePaise }));
}

export type RevenueTrend = Awaited<ReturnType<typeof getRevenueTrend>>;

/** Everything on the dashboard except the 7-day trend, which refreshes on its own slower cadence */
export async function getDashboard(staff: Staff, now = new Date()) {
  guard(staff);
  const scope = { tenantId: staff.tenantId, outletId: staff.outletId };
  const tz = staff.outlet.timezone;
  const { today, yesterday } = todayAndYesterday(now, tz);
  const ranges = [today, yesterday];
  const upcomingEnd = new Date(now.getTime() + UPCOMING_WINDOW_MINUTES * 60_000);
  const lateSince = new Date(now.getTime() - LATE_LOOKBACK_HOURS * 3600_000);
  const billAlertBefore = new Date(now.getTime() - BILL_REQUESTED_ALERT_MINUTES * 60_000);

  const [bills, ordersToday, ordersYesterday, tableStates, waitlist, outstanding, waitingBills, bookings, refunds, top, policy, [outlet]] = await Promise.all([
    paidBills(scope, yesterday.start, today.end),
    ordersIn(scope, today),
    ordersIn(scope, yesterday),
    db
      .select({ state: s.diningTables.state, n: count() })
      .from(s.diningTables)
      .where(and(eq(s.diningTables.tenantId, scope.tenantId), eq(s.diningTables.outletId, scope.outletId), eq(s.diningTables.isActive, true)))
      .groupBy(s.diningTables.state),
    db
      .select({ status: s.waitlistEntries.status, n: count() })
      .from(s.waitlistEntries)
      .where(and(eq(s.waitlistEntries.tenantId, scope.tenantId), eq(s.waitlistEntries.outletId, scope.outletId), inArray(s.waitlistEntries.status, ["waiting", "notified"])))
      .groupBy(s.waitlistEntries.status),
    // What tables still owe: each share's unpaid balance, on bills of visits that are not closed
    db
      .select({ paise: sql<string>`coalesce(sum(greatest(0, ${s.billShares.amountPaise} - ${s.billShares.paidPaise})), 0)` })
      .from(s.billShares)
      .innerJoin(s.bills, and(eq(s.bills.tenantId, s.billShares.tenantId), eq(s.bills.id, s.billShares.billId)))
      .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.bills.tenantId), eq(s.tableSessions.id, s.bills.sessionId)))
      .where(and(eq(s.billShares.tenantId, scope.tenantId), eq(s.bills.outletId, scope.outletId), ne(s.bills.status, "paid"), ne(s.tableSessions.status, "closed"))),
    db
      .select({ sessionId: s.tableSessions.id, tableCode: s.diningTables.code, requestedAt: s.bills.requestedAt })
      .from(s.tableSessions)
      .innerJoin(s.bills, and(eq(s.bills.tenantId, s.tableSessions.tenantId), eq(s.bills.sessionId, s.tableSessions.id)))
      .innerJoin(s.diningTables, and(eq(s.diningTables.tenantId, s.tableSessions.tenantId), eq(s.diningTables.id, s.tableSessions.tableId)))
      .where(and(eq(s.tableSessions.tenantId, scope.tenantId), eq(s.tableSessions.outletId, scope.outletId), eq(s.tableSessions.status, "bill_requested"), isNotNull(s.bills.requestedAt)))
      .orderBy(asc(s.bills.requestedAt)),
    db
      .select({ id: s.reservations.id, name: s.reservations.name, partySize: s.reservations.partySize, startAt: s.reservations.startAt, status: s.reservations.status })
      .from(s.reservations)
      .where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.outletId, scope.outletId), inArray(s.reservations.status, [...BOOKED]), gte(s.reservations.startAt, lateSince), lte(s.reservations.startAt, upcomingEnd)))
      .orderBy(asc(s.reservations.startAt)),
    // Refunds owed: created by the billing flow and still pending (none is ever marked done here)
    db
      .select({ n: count(), paise: sql<string>`coalesce(sum(${s.refunds.amountPaise}), 0)` })
      .from(s.refunds)
      .innerJoin(s.payments, and(eq(s.payments.tenantId, s.refunds.tenantId), eq(s.payments.id, s.refunds.paymentId)))
      .where(and(eq(s.refunds.tenantId, scope.tenantId), eq(s.payments.outletId, scope.outletId), eq(s.refunds.status, "pending"))),
    topItems(scope, today),
    loadPolicy(db, scope),
    db.select({ name: s.outlets.name, brandId: s.outlets.brandId }).from(s.outlets).where(and(eq(s.outlets.tenantId, scope.tenantId), eq(s.outlets.id, scope.outletId))),
  ]);

  const [soldOut, bookingTables] = await Promise.all([
    soldOutCount(scope, outlet?.brandId ?? "-", now),
    bookings.length
      ? db
          .select({ reservationId: s.reservationTables.reservationId, code: s.diningTables.code })
          .from(s.reservationTables)
          .innerJoin(s.diningTables, and(eq(s.diningTables.tenantId, s.reservationTables.tenantId), eq(s.diningTables.id, s.reservationTables.tableId)))
          .where(and(eq(s.reservationTables.tenantId, scope.tenantId), inArray(s.reservationTables.reservationId, bookings.map((b) => b.id))))
          .orderBy(asc(s.diningTables.code))
      : Promise.resolve([]),
  ]);

  const [moneyToday, moneyYesterday] = revenueByDay(bills, ranges);
  const [coversToday, coversYesterday] = await coversByDay(scope, bills, ranges);

  const states = Object.fromEntries(tableStates.map((r) => [r.state, Number(r.n)])) as Partial<Record<(typeof s.tableStates)[number], number>>;
  const totalTables = tableStates.reduce((n, r) => n + Number(r.n), 0);
  const queue = Object.fromEntries(waitlist.map((r) => [r.status, Number(r.n)])) as Partial<Record<"waiting" | "notified", number>>;
  const codesOf = (id: string) => bookingTables.filter((t) => t.reservationId === id).map((t) => t.code);
  // Guest name, time, party, status and table only: never a phone or a token
  const bookingRow = (b: (typeof bookings)[number]) => ({ id: b.id, name: isPlaceholderName(b.name) ? null : b.name, partySize: b.partySize, startAt: b.startAt.getTime(), status: b.status, tables: codesOf(b.id) });
  const upcoming = bookings.filter((b) => b.startAt.getTime() >= now.getTime()).map(bookingRow);
  const late = bookings
    .filter((b) => b.startAt.getTime() < now.getTime())
    .map((b) => ({ ...bookingRow(b), ...lateness(b.startAt.getTime(), now.getTime(), policy.graceMinutes) }))
    .filter((b) => b.lateMinutes > 0);
  const slowBills = waitingBills
    // Strictly longer than the threshold: a bill asked for exactly ten minutes ago is not late yet
    .filter((b) => b.requestedAt! < billAlertBefore)
    .map((b) => ({ sessionId: b.sessionId, tableCode: b.tableCode, waitedMinutes: waitedMinutes(b.requestedAt!.getTime(), now.getTime()) }));

  return {
    outletName: outlet?.name ?? staff.outlet.name,
    timezone: tz,
    date: today.date,
    greeting: greeting(now, tz),
    generatedAt: now.getTime(),
    kpis: {
      revenue: { today: moneyToday.revenuePaise, yesterday: moneyYesterday.revenuePaise },
      orders: { today: ordersToday, yesterday: ordersYesterday },
      covers: { today: coversToday, yesterday: coversYesterday },
      averageBill: { today: averageOf(moneyToday.revenuePaise, moneyToday.paidBills), yesterday: averageOf(moneyYesterday.revenuePaise, moneyYesterday.paidBills) },
      paidBills: moneyToday.paidBills,
      openTables: { open: OPEN_TABLE_STATES.reduce((n, st) => n + (states[st] ?? 0), 0), total: totalTables },
      upcomingReservations: upcoming.length,
      waitlist: (queue.waiting ?? 0) + (queue.notified ?? 0),
      outstandingPaise: Number(outstanding[0]?.paise ?? 0),
    },
    /** Shown beside revenue, never added to it */
    secondary: { taxPaise: moneyToday.taxPaise, serviceChargePaise: moneyToday.serviceChargePaise, tipPaise: moneyToday.tipPaise },
    operations: {
      tables: { available: states.available ?? 0, reserved: (states.reserved ?? 0) + (states.held ?? 0), seated: states.seated ?? 0, billRequested: states.bill_requested ?? 0, blocked: states.blocked ?? 0, total: totalTables },
      waitlist: { waiting: queue.waiting ?? 0, notified: queue.notified ?? 0 },
      upcoming,
      billRequestedTables: waitingBills.length,
    },
    alerts: {
      slowBills,
      soldOut,
      late,
      pendingRefunds: { count: Number(refunds[0]?.n ?? 0), paise: Number(refunds[0]?.paise ?? 0) },
      blockedTables: states.blocked ?? 0,
    },
    topItems: top,
  };
}

/** Active items of this outlet's menu that guests cannot order now, by the guest menu's own rule */
async function soldOutCount(scope: Scope, brandId: string, now: Date) {
  const rows = await db
    .select({ override: s.outletItemOverrides })
    .from(s.outletItemOverrides)
    .innerJoin(s.menuItems, and(eq(s.menuItems.tenantId, s.outletItemOverrides.tenantId), eq(s.menuItems.id, s.outletItemOverrides.itemId)))
    .where(and(eq(s.outletItemOverrides.tenantId, scope.tenantId), eq(s.outletItemOverrides.outletId, scope.outletId), eq(s.menuItems.brandId, brandId), eq(s.menuItems.isActive, true)));
  return rows.filter((r) => !isItemAvailable(r.override, now)).length;
}

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;
