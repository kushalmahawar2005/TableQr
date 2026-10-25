import { boolean, index, int, json, mysqlEnum, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { at, createdAt, id, ref, sameTenant, tenantId, tenantKey, updatedAt } from "./_columns";
import { outlets, users } from "./tenancy";

// Printer management (see docs/printing-architecture.md). Printers belong to an outlet and are
// shared by every staff device there; which one a single device uses is kept on that device.
// A print job is the record of one print: what, where, and how far it honestly got.

export const printJobStatuses = ["queued", "sent", "confirmed", "failed", "cancelled"] as const;

/** A printer an outlet prints on. Removed printers are switched off, never deleted, so old jobs keep their name. */
export const printers = mysqlTable(
  "printers",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    name: varchar("name", { length: 60 }).notNull(),
    /** Width of the roll in mm: 58 or 80 */
    paperMm: int("paper_mm").notNull().default(80),
    /** How jobs reach it: "browser" today; later bluetooth, network, cloud, desktop bridge */
    transport: varchar("transport", { length: 30 }).notNull().default("browser"),
    /** What that transport needs (an address, a device name); never a secret */
    config: json("config").$type<Record<string, string | number | boolean>>(),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: ref("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("printers_outlet_name_uq").on(t.tenantId, t.outletId, t.name),
    index("printers_outlet_idx").on(t.tenantId, t.outletId, t.isActive),
    tenantKey("printers", t),
    sameTenant("fk_printers_outlet", t, t.outletId, outlets),
    sameTenant("fk_printers_created_by", t, t.createdBy, users),
  ],
);

/** Which printer an outlet uses for customer slips and which for the kitchen, until a device says otherwise */
export const printSettings = mysqlTable(
  "print_settings",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    receiptPrinterId: ref("receipt_printer_id"),
    kitchenPrinterId: ref("kitchen_printer_id"),
    updatedBy: ref("updated_by"),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("print_settings_outlet_uq").on(t.tenantId, t.outletId),
    sameTenant("fk_print_settings_outlet", t, t.outletId, outlets),
    sameTenant("fk_print_settings_receipt", t, t.receiptPrinterId, printers),
    sameTenant("fk_print_settings_kitchen", t, t.kitchenPrinterId, printers),
    sameTenant("fk_print_settings_by", t, t.updatedBy, users),
  ],
);

/**
 * One print. `request_id` comes from the screen that printed, so a double tap or a retry after a
 * timeout is the same job. "sent" means handed to the print system; "confirmed" is only ever set
 * for a transport whose printer can say it printed.
 */
export const printJobs = mysqlTable(
  "print_jobs",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    printerId: ref("printer_id"),
    /** receipt, bill, kot, order_slip, day_close or test */
    kind: varchar("kind", { length: 20 }).notNull(),
    /** What was printed: a bill's table session, a kitchen ticket, an order, a business date */
    subjectType: varchar("subject_type", { length: 20 }),
    subjectId: varchar("subject_id", { length: 40 }),
    requestId: varchar("request_id", { length: 64 }).notNull(),
    transport: varchar("transport", { length: 30 }).notNull(),
    paperMm: int("paper_mm").notNull(),
    status: mysqlEnum("status", printJobStatuses).notNull().default("queued"),
    failureCode: varchar("failure_code", { length: 40 }),
    failureDetail: varchar("failure_detail", { length: 200 }),
    attempts: int("attempts").notNull().default(1),
    /** Set when someone prints a slip again on purpose */
    reprintOf: ref("reprint_of"),
    actorUserId: ref("actor_user_id"),
    /** A kitchen wall screen that printed on its own */
    deviceId: ref("device_id"),
    statusAt: at("status_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("print_jobs_request_uq").on(t.tenantId, t.requestId),
    index("print_jobs_outlet_created_idx").on(t.tenantId, t.outletId, t.createdAt),
    index("print_jobs_subject_idx").on(t.tenantId, t.subjectType, t.subjectId),
    index("print_jobs_created_idx").on(t.createdAt),
    sameTenant("fk_print_jobs_outlet", t, t.outletId, outlets),
    sameTenant("fk_print_jobs_printer", t, t.printerId, printers),
    sameTenant("fk_print_jobs_actor", t, t.actorUserId, users),
  ],
);
