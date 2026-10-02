import { boolean, index, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { at, createdAt, id, ref, sameTenant, tenantId } from "./_columns";
import { diningTables } from "./floor";
import { outlets, users } from "./tenancy";

/** One primary waiter for a physical table during a shift/session period. */
export const waiterTableAssignments = mysqlTable(
  "waiter_table_assignments",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    tableId: ref("table_id").notNull(),
    waiterUserId: ref("waiter_user_id").notNull(),
    assignedByUserId: ref("assigned_by_user_id").notNull(),
    periodKey: varchar("period_key", { length: 40 }).notNull(),
    activeKey: ref("active_key"),
    expiresAt: at("expires_at").notNull(),
    active: boolean("active").notNull().default(true),
    assignedAt: createdAt("assigned_at"),
    releasedAt: at("released_at"),
  },
  (t) => [
    uniqueIndex("waiter_assignments_active_uq").on(t.tenantId, t.activeKey),
    index("waiter_assignments_table_active_idx").on(t.tenantId, t.outletId, t.tableId, t.active),
    index("waiter_assignments_waiter_active_idx").on(t.tenantId, t.outletId, t.waiterUserId, t.active),
    sameTenant("fk_waiter_assignments_outlet", t, t.outletId, outlets),
    sameTenant("fk_waiter_assignments_table", t, t.tableId, diningTables),
    sameTenant("fk_waiter_assignments_waiter", t, t.waiterUserId, users),
    sameTenant("fk_waiter_assignments_assigned_by", t, t.assignedByUserId, users),
  ],
);