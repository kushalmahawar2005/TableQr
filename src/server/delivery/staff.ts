import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { LOCK_THEN_READ } from "../db-types";
import { AppError } from "../errors";
import { audit } from "../staff/audit";
import type { StaffSession } from "../staff/auth";
import { requireStaffRole } from "../staff/waiter";

export const deliveryStaffRoles = ["owner", "manager", "cashier"] as const;
export async function deliveryQueue(staff: StaffSession) {
  await requireStaffRole(staff, deliveryStaffRoles);
  // Historical orders remain manageable if the package is downgraded or delivery is paused.
  return db.select({ id: s.deliveryCheckouts.id, status: s.deliveryCheckouts.status, sessionId: s.deliveryCheckouts.sessionId, name: s.deliveryCheckouts.name, phone: s.deliveryCheckouts.phone, address: s.deliveryCheckouts.address, totalPaise: s.bills.totalPaise, paid: s.bills.status, placedAt: s.deliveryCheckouts.placedAt })
    .from(s.deliveryCheckouts).innerJoin(s.bills, and(eq(s.bills.tenantId, s.deliveryCheckouts.tenantId), eq(s.bills.sessionId, s.deliveryCheckouts.sessionId)))
    .where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.outletId, staff.outletId), inArray(s.deliveryCheckouts.status, ["placed", "dispatched", "delivered"])))
    .orderBy(desc(s.deliveryCheckouts.placedAt)).limit(100);
}
export async function advanceDelivery(staff: StaffSession, id: string, next: "dispatched" | "delivered", now = new Date()) {
  await requireStaffRole(staff, deliveryStaffRoles);
  if (!["dispatched", "delivered"].includes(next)) throw new AppError("invalid_state", "Choose a valid delivery status.");
  await db.transaction(async tx => {
    const [row] = await tx.select().from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.outletId, staff.outletId), eq(s.deliveryCheckouts.id, String(id)))).for("update");
    if (!row?.sessionId) throw new AppError("not_found", "Delivery order not found.");
    if (row.status === next) return;
    if (next === "dispatched") {
      if (row.status !== "placed") throw new AppError("invalid_state", "Only a packed order can be dispatched.");
      const lines = await tx.select({ status: s.orderLines.status }).from(s.orderLines).where(and(eq(s.orderLines.tenantId, staff.tenantId), eq(s.orderLines.sessionId, row.sessionId)));
      const live = lines.filter(line => !["voided", "cancelled"].includes(line.status));
      if (!live.length || live.some(line => !["ready", "served"].includes(line.status))) throw new AppError("invalid_state", "Wait until the kitchen has packed every item.");
    } else {
      if (row.status !== "dispatched") throw new AppError("invalid_state", "Dispatch this order before marking it delivered.");
      const [bill] = await tx.select({ status: s.bills.status }).from(s.bills).where(and(eq(s.bills.tenantId, staff.tenantId), eq(s.bills.sessionId, row.sessionId)));
      if (bill?.status !== "paid") throw new AppError("invalid_state", "Record the payment in Billing before completing delivery.");
    }
    await tx.update(s.deliveryCheckouts).set({ status: next }).where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.id, row.id)));
    await audit(tx, staff, { action: `delivery.${next}`, entity: "delivery", entityId: row.id, before: { status: row.status }, after: { status: next }, now });
  }, LOCK_THEN_READ);
}
