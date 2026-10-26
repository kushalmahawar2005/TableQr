import "server-only";
import { and, count, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { formatRupees } from "@/domain/menu-price";
import type { StaffSession } from "./auth";

// Console notifications: what happened at this outlet since the screen last asked. Read straight
// from the tables that record it, so it works with or without the realtime hub, and a phone that
// slept still catches up. Nothing is stored per person; the screen keeps its own "seen" time.

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "outlet">;

export type ConsoleNotice = {
  id: string;
  kind: "order" | "request" | "bill_requested" | "paid" | "booking" | "waitlist";
  title: string;
  body: string;
  at: number;
  href: string;
};

const REQUEST_TEXT: Record<string, string> = {
  water: "asks for water",
  cutlery: "asks for cutlery",
  call_waiter: "is calling a waiter",
  clean_table: "asks to clean the table",
  request_bill: "asked for the bill",
  pay_at_counter: "will pay at the counter",
  paid_upi: "says they paid by UPI: check your UPI app and settle",
};
const LIMIT = 20;

/** Everything new at this outlet after `since`, newest first, at most a screenful */
export async function getConsoleNotices(staff: Staff, since: Date): Promise<ConsoleNotice[]> {
  const [orders, requests, paid, bookings, waitlist] = await Promise.all([
    db
      .select({ id: s.orders.id, roundNo: s.orders.roundNo, at: s.orders.placedAt, table: s.diningTables.code })
      .from(s.orders)
      .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.orders.tenantId), eq(s.tableSessions.id, s.orders.sessionId)))
      .innerJoin(s.diningTables, and(eq(s.diningTables.tenantId, s.orders.tenantId), eq(s.diningTables.id, s.tableSessions.tableId)))
      .where(and(eq(s.orders.tenantId, staff.tenantId), eq(s.orders.outletId, staff.outletId), gt(s.orders.placedAt, since)))
      .orderBy(desc(s.orders.placedAt))
      .limit(LIMIT),
    db
      .select({ id: s.serviceRequests.id, kind: s.serviceRequests.kind, at: s.serviceRequests.createdAt, table: s.diningTables.code })
      .from(s.serviceRequests)
      .innerJoin(s.diningTables, and(eq(s.diningTables.tenantId, s.serviceRequests.tenantId), eq(s.diningTables.id, s.serviceRequests.tableId)))
      .where(and(eq(s.serviceRequests.tenantId, staff.tenantId), eq(s.serviceRequests.outletId, staff.outletId), gt(s.serviceRequests.createdAt, since)))
      .orderBy(desc(s.serviceRequests.createdAt))
      .limit(LIMIT),
    db
      .select({ id: s.bills.id, total: s.bills.totalPaise, at: s.bills.closedAt, table: s.diningTables.code })
      .from(s.bills)
      .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.bills.tenantId), eq(s.tableSessions.id, s.bills.sessionId)))
      .innerJoin(s.diningTables, and(eq(s.diningTables.tenantId, s.bills.tenantId), eq(s.diningTables.id, s.tableSessions.tableId)))
      .where(and(eq(s.bills.tenantId, staff.tenantId), eq(s.bills.outletId, staff.outletId), eq(s.bills.status, "paid"), gt(s.bills.closedAt, since)))
      .orderBy(desc(s.bills.closedAt))
      .limit(LIMIT),
    db
      .select({ id: s.reservations.id, name: s.reservations.name, party: s.reservations.partySize, startAt: s.reservations.startAt, at: s.reservations.confirmedAt })
      .from(s.reservations)
      .where(and(eq(s.reservations.tenantId, staff.tenantId), eq(s.reservations.outletId, staff.outletId), gt(s.reservations.confirmedAt, since)))
      .orderBy(desc(s.reservations.confirmedAt))
      .limit(LIMIT),
    db
      .select({ id: s.waitlistEntries.id, name: s.waitlistEntries.name, party: s.waitlistEntries.partySize, at: s.waitlistEntries.joinedAt })
      .from(s.waitlistEntries)
      .where(and(eq(s.waitlistEntries.tenantId, staff.tenantId), eq(s.waitlistEntries.outletId, staff.outletId), gt(s.waitlistEntries.joinedAt, since)))
      .orderBy(desc(s.waitlistEntries.joinedAt))
      .limit(LIMIT),
  ]);

  const items = orders.length
    ? await db
        .select({ orderId: s.orderLines.orderId, n: count() })
        .from(s.orderLines)
        .where(and(eq(s.orderLines.tenantId, staff.tenantId), inArray(s.orderLines.orderId, orders.map((o) => o.id))))
        .groupBy(s.orderLines.orderId)
    : [];
  const lines = new Map(items.map((i) => [i.orderId, Number(i.n)]));

  const when = new Intl.DateTimeFormat("en-IN", { timeZone: staff.outlet.timezone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const notices: ConsoleNotice[] = [
    ...orders.map((o) => ({
      id: `order:${o.id}`,
      kind: "order" as const,
      title: `New order · Table ${o.table}`,
      body: `Round ${o.roundNo} · ${lines.get(o.id) ?? 0} dish${lines.get(o.id) === 1 ? "" : "es"}`,
      at: o.at.getTime(),
      href: "/console/orders",
    })),
    ...requests.map((r) => ({
      id: `request:${r.id}`,
      kind: r.kind === "request_bill" ? ("bill_requested" as const) : ("request" as const),
      title: `Table ${r.table} ${REQUEST_TEXT[r.kind] ?? "needs something"}`,
      body: r.kind === "request_bill" || r.kind === "pay_at_counter" || r.kind === "paid_upi" ? "Open billing to settle" : "Someone on the floor should go",
      at: r.at.getTime(),
      href: r.kind === "request_bill" || r.kind === "pay_at_counter" || r.kind === "paid_upi" ? "/console/billing" : "/console/floor",
    })),
    ...paid.map((b) => ({
      id: `paid:${b.id}`,
      kind: "paid" as const,
      title: `Table ${b.table} paid ${formatRupees(b.total)}`,
      body: "Bill settled",
      at: b.at!.getTime(),
      href: "/console/billing",
    })),
    ...bookings.map((r) => ({
      id: `booking:${r.id}`,
      kind: "booking" as const,
      title: `New booking · ${r.name}`,
      body: `${r.party} ${r.party === 1 ? "person" : "people"} · ${when.format(r.startAt)}`,
      at: r.at!.getTime(),
      href: "/console/reservations",
    })),
    ...waitlist.map((w) => ({
      id: `waitlist:${w.id}`,
      kind: "waitlist" as const,
      title: `Joined the waitlist · ${w.name}`,
      body: `${w.party} ${w.party === 1 ? "person" : "people"}`,
      at: w.at.getTime(),
      href: "/console/waitlist",
    })),
  ];
  return notices.sort((a, b) => b.at - a.at).slice(0, LIMIT);
}
