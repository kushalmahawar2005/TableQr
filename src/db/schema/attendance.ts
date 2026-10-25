import { index, mysqlEnum, uniqueIndex, varchar, mysqlTable } from "drizzle-orm/mysql-core";
import { createdAt, id, ref, sameTenant, tenantId, updatedAt } from "./_columns";
import { outlets, users } from "./tenancy";

// A simple attendance register: one mark per person per day, set by a manager or owner.
export const attendanceStatuses = ["present", "half_day", "absent", "leave", "week_off"] as const;

export const attendanceMarks = mysqlTable(
  "attendance_marks",
  {
    id: id(),
    tenantId: tenantId(),
    /** The outlet whose register it was marked in */
    outletId: ref("outlet_id").notNull(),
    userId: ref("user_id").notNull(),
    /** The day, as the outlet's local date (YYYY-MM-DD) */
    markDate: varchar("mark_date", { length: 10 }).notNull(),
    status: mysqlEnum("status", attendanceStatuses).notNull(),
    note: varchar("note", { length: 200 }),
    markedBy: ref("marked_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One status per person per day, whichever outlet's register it was marked in
    uniqueIndex("attendance_marks_person_day_uq").on(t.tenantId, t.userId, t.markDate),
    index("attendance_marks_outlet_day_idx").on(t.tenantId, t.outletId, t.markDate),
    sameTenant("fk_attendance_marks_outlet", t, t.outletId, outlets),
    sameTenant("fk_attendance_marks_user", t, t.userId, users),
    sameTenant("fk_attendance_marks_by", t, t.markedBy, users),
  ],
);
