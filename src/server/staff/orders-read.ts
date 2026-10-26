import "server-only";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { canSee } from "@/lib/staff-permissions";
import { AppError } from "../errors";
import type { StaffSession } from "./auth";
import { isDeliveryTable } from "@/domain/delivery";
import { TAKEAWAY_CLASS } from "../floor/takeaway-class";

// Orders board (read-only): the signed-in outlet's orders from the last 24 hours. Plain SELECTs
// scoped to the tenant and outlet. Prices are the snapshots taken when the order was placed.
// Once the table's visit is over (paid or cleared) its orders count as done, whatever the kitchen
// last marked, so the board only lists what is still on the floor.

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "roles">;

export type OrderRow = {
  id: string;
  sessionId: string;
  roundNo: number;
  note: string | null;
  placedAt: string;
  acceptedAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  table: string;
  status: (typeof s.orderStatuses)[number];
  items: { name: string; qty: number }[];
  totalPaise: number;
  /** Plates the kitchen has finished that nobody marked served yet */
  readyLineIds: string[];
  /** A parcel order from the counter, not a table */
  takeaway: boolean;
  /** A home delivery order, with the name the guest gave */
  delivery: { name: string | null } | null;
};

export async function getRecentOrders(staff: Staff, now: Date): Promise<OrderRow[]> {
  if (!canSee(staff, "orders")) throw new AppError("forbidden", "Your role cannot view orders.");
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const orders = await db
    .select({ id: s.orders.id, sessionId: s.orders.sessionId, roundNo: s.orders.roundNo, note: s.orders.note, placedAt: s.orders.placedAt, acceptedAt: s.orders.acceptedAt, readyAt: s.orders.readyAt, servedAt: s.orders.servedAt, status: s.orders.status, sessionStatus: s.tableSessions.status, tableCode: s.diningTables.code, tableClass: s.diningTables.tableClass, guestName: s.tableSessions.guestName })
    .from(s.orders)
    .innerJoin(s.tableSessions, and(eq(s.orders.sessionId, s.tableSessions.id), eq(s.orders.tenantId, s.tableSessions.tenantId)))
    .innerJoin(s.diningTables, and(eq(s.tableSessions.tableId, s.diningTables.id), eq(s.tableSessions.tenantId, s.diningTables.tenantId)))
    .where(and(eq(s.orders.tenantId, staff.tenantId), eq(s.orders.outletId, staff.outletId), gte(s.orders.placedAt, since)))
    .orderBy(desc(s.orders.placedAt))
    .limit(150);
  if (!orders.length) return [];
  const lines = await db
    .select({ id: s.orderLines.id, orderId: s.orderLines.orderId, name: s.orderLines.nameEn, qty: s.orderLines.qty, unit: s.orderLines.unitPricePaise, status: s.orderLines.status })
    .from(s.orderLines)
    .where(and(eq(s.orderLines.tenantId, staff.tenantId), inArray(s.orderLines.orderId, orders.map((o) => o.id))));
  const byOrder = new Map<string, OrderRow["items"]>();
  const totals = new Map<string, number>();
  const ready = new Map<string, string[]>();
  for (const l of lines) {
    if (l.status === "voided" || l.status === "cancelled") continue;
    if (l.status === "ready") ready.set(l.orderId, [...(ready.get(l.orderId) ?? []), l.id]);
    byOrder.set(l.orderId, [...(byOrder.get(l.orderId) ?? []), { name: l.name, qty: l.qty }]);
    totals.set(l.orderId, (totals.get(l.orderId) ?? 0) + l.unit * l.qty);
  }
  return orders.map((o) => {
    // A paid takeaway is still being cooked and handed over, so it stays on the board
    const takeaway = o.tableClass === TAKEAWAY_CLASS;
    const done = o.sessionStatus === "closed" && o.status !== "cancelled" && !takeaway;
    return { id: o.id, sessionId: o.sessionId, roundNo: o.roundNo, note: o.note, placedAt: o.placedAt.toISOString(), acceptedAt: o.acceptedAt?.toISOString() ?? null, readyAt: o.readyAt?.toISOString() ?? null, servedAt: o.servedAt?.toISOString() ?? null, table: o.tableCode, status: done ? "served" : o.status, items: byOrder.get(o.id) ?? [], totalPaise: totals.get(o.id) ?? 0, readyLineIds: done ? [] : (ready.get(o.id) ?? []), takeaway, delivery: isDeliveryTable(o.tableCode) ? { name: o.guestName } : null };
  });
}
