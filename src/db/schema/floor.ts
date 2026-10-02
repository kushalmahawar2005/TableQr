import {
  boolean,
  char,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { at, createdAt, id, ref, sameTenant, tenantId, tenantKey, updatedAt } from "./_columns";
import { outlets, users } from "./tenancy";

// Zones, tables and QR codes (PS 4.1, 4.2, 3.1).

export const zones = mysqlTable(
  "zones",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    name: varchar("name", { length: 60 }).notNull(),
    sortOrder: int("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [tenantKey("zones", t), sameTenant("fk_zones_outlet", t, t.outletId, outlets)],
);

export const tableStates = [
  "available",
  "held",
  "reserved",
  "seated",
  "bill_requested",
  "paid",
  "needs_cleaning",
  "blocked",
] as const;
export type TableState = (typeof tableStates)[number];

/** Why a manager took a table out of service (S1). "other" needs a note. */
export const blockReasons = ["maintenance", "private_event", "out_of_service", "other"] as const;
export type BlockReason = (typeof blockReasons)[number];

export const diningTables = mysqlTable(
  "dining_tables",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    zoneId: ref("zone_id").notNull(),
    /** Staff-facing code, e.g. T12 */
    code: varchar("code", { length: 12 }).notNull(),
    minSeats: int("min_seats").notNull().default(1),
    maxSeats: int("max_seats").notNull(),
    tableClass: varchar("table_class", { length: 20 }).notNull(), // 2-top, 4-top, booth
    shape: mysqlEnum("shape", ["square", "round", "long"]).notNull().default("square"),
    // Floor map geometry in grid units
    posX: int("pos_x").notNull().default(0),
    posY: int("pos_y").notNull().default(0),
    width: int("width").notNull().default(2),
    height: int("height").notNull().default(2),
    combinableWith: json("combinable_with").$type<string[]>(),
    /** Live table state, the single source of truth for the floor */
    state: mysqlEnum("state", tableStates).notNull().default("available"),
    /** 4-digit code guests type in Host-confirmed mode or when a camera fails */
    joinCode: char("join_code", { length: 4 }).notNull(),
    isBookableOnline: boolean("is_bookable_online").notNull().default(true),
    /** When `state` last changed, for "free for 12 min" and "cleaning since" on the floor */
    stateChangedAt: at("state_changed_at"),
    blockedReason: mysqlEnum("blocked_reason", blockReasons),
    blockedNote: varchar("blocked_note", { length: 120 }),
    /** Null means until someone unblocks it */
    blockedUntil: at("blocked_until"),
    blockedByUserId: ref("blocked_by_user_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("dining_tables_outlet_code_uq").on(t.outletId, t.code),
    tenantKey("dining_tables", t),
    sameTenant("fk_dining_tables_outlet", t, t.outletId, outlets),
    sameTenant("fk_dining_tables_zone", t, t.zoneId, zones),
    sameTenant("fk_dining_tables_blocked_by", t, t.blockedByUserId, users),
  ],
);

export const qrCodes = mysqlTable(
  "qr_codes",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    /** Set for table QRs; null for entrance and booking QRs */
    tableId: ref("table_id"),
    type: mysqlEnum("type", ["table", "entrance", "booking"]).notNull(),
    /** Short, non-sequential code in /r/<outlet>/t/<shortCode> */
    shortCode: varchar("short_code", { length: 12 }).notNull(),
    revokedAt: at("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("qr_codes_outlet_short_uq").on(t.outletId, t.shortCode),
    sameTenant("fk_qr_codes_outlet", t, t.outletId, outlets),
    sameTenant("fk_qr_codes_table", t, t.tableId, diningTables),
  ],
);
