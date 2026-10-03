import {
  boolean,
  char,
  int,
  index,
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
    isActive: boolean("is_active").notNull().default(true),
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
    isActive: boolean("is_active").notNull().default(true),
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

/** Versioned O2 editor data. Canonical zones/dining_tables remain the published runtime source. */
export const floorLayoutStatuses = ["draft", "published", "archived"] as const;
export type FloorLayoutStatus = (typeof floorLayoutStatuses)[number];

export const floorLayoutVersions = mysqlTable(
  "floor_layout_versions",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    versionNumber: int("version_number").notNull(),
    status: mysqlEnum("status", floorLayoutStatuses).notNull().default("draft"),
    /** NULL for immutable published history; "active" only on the one editable draft. */
    draftKey: varchar("draft_key", { length: 12 }),
    revision: int("revision").notNull().default(0),
    createdBy: ref("created_by").notNull(),
    publishedBy: ref("published_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    publishedAt: at("published_at"),
  },
  (t) => [
    uniqueIndex("floor_layout_versions_outlet_version_uq").on(t.tenantId, t.outletId, t.versionNumber),
    uniqueIndex("floor_layout_versions_draft_uq").on(t.tenantId, t.outletId, t.draftKey),
    index("floor_layout_versions_outlet_idx").on(t.tenantId, t.outletId, t.status),
    tenantKey("floor_layout_versions", t),
    sameTenant("fk_floor_layout_versions_outlet", t, t.outletId, outlets),
    sameTenant("fk_floor_layout_versions_created_by", t, t.createdBy, users),
    sameTenant("fk_floor_layout_versions_published_by", t, t.publishedBy, users),
  ],
);

export const floorLayoutZones = mysqlTable(
  "floor_layout_zones",
  {
    id: id(),
    tenantId: tenantId(),
    versionId: ref("version_id").notNull(),
    logicalZoneId: ref("logical_zone_id"),
    name: varchar("name", { length: 60 }).notNull(),
    sortOrder: int("sort_order").notNull().default(0),
    posX: int("pos_x").notNull().default(0),
    posY: int("pos_y").notNull().default(0),
    width: int("width").notNull().default(12),
    height: int("height").notNull().default(8),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("floor_layout_zones_version_idx").on(t.tenantId, t.versionId, t.sortOrder),
    tenantKey("floor_layout_zones", t),
    sameTenant("fk_floor_layout_zones_version", t, t.versionId, floorLayoutVersions),
  ],
);

export const floorLayoutTables = mysqlTable(
  "floor_layout_tables",
  {
    id: id(),
    tenantId: tenantId(),
    versionId: ref("version_id").notNull(),
    logicalTableId: ref("logical_table_id"),
    logicalZoneId: ref("logical_zone_id"),
    code: varchar("code", { length: 12 }).notNull(),
    minSeats: int("min_seats").notNull().default(1),
    maxSeats: int("max_seats").notNull(),
    tableClass: varchar("table_class", { length: 20 }).notNull(),
    shape: mysqlEnum("shape", ["square", "round", "long"]).notNull().default("square"),
    posX: int("pos_x").notNull().default(0),
    posY: int("pos_y").notNull().default(0),
    width: int("width").notNull().default(2),
    height: int("height").notNull().default(2),
    isBookableOnline: boolean("is_bookable_online").notNull().default(true),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("floor_layout_tables_version_idx").on(t.tenantId, t.versionId),
    uniqueIndex("floor_layout_tables_version_code_uq").on(t.tenantId, t.versionId, t.code),
    tenantKey("floor_layout_tables", t),
    sameTenant("fk_floor_layout_tables_version", t, t.versionId, floorLayoutVersions),
    sameTenant("fk_floor_layout_tables_zone", t, t.logicalZoneId, floorLayoutZones),
  ],
);

export const floorLayoutCombinations = mysqlTable(
  "floor_layout_combinations",
  {
    id: id(),
    tenantId: tenantId(),
    versionId: ref("version_id").notNull(),
    tableId: ref("table_id").notNull(),
    combinedTableId: ref("combined_table_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("floor_layout_combinations_pair_uq").on(t.tenantId, t.versionId, t.tableId, t.combinedTableId),
    index("floor_layout_combinations_version_idx").on(t.tenantId, t.versionId),
    tenantKey("floor_layout_combinations", t),
    sameTenant("fk_floor_layout_combinations_version", t, t.versionId, floorLayoutVersions),
    sameTenant("fk_floor_layout_combinations_table", t, t.tableId, floorLayoutTables),
    sameTenant("fk_floor_layout_combinations_combined", t, t.combinedTableId, floorLayoutTables),
  ],
);
