import {
  boolean,
  index,
  tinyint,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { at, createdAt, id, ref, sameTenant, tenantId, tenantKey } from "./_columns";
import { diningTables } from "./floor";
import { menuItems } from "./menu";
import { participants, tableSessions } from "./sessions";
import { outlets, users } from "./tenancy";

// Orders, kitchen tickets and service requests (PS 5).

export const orderStatuses = [
  "placed",
  "accepted",
  "preparing",
  "ready",
  "served",
  "cancelled",
] as const;

/** One order per round; later rounds never edit an earlier one */
export const orders = mysqlTable(
  "orders",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    sessionId: ref("session_id").notNull(),
    roundNo: int("round_no").notNull(),
    placedByParticipantId: ref("placed_by_participant_id"),
    placedByUserId: ref("placed_by_user_id"),
    status: mysqlEnum("status", orderStatuses).notNull().default("placed"),
    note: varchar("note", { length: 140 }),
    /** Handed over at the billing counter for one person (water, a chocolate): stays theirs even in an equal split */
    atCounter: boolean("at_counter").notNull().default(false),
    /** Set by the guest's phone, one per Place-order attempt; a retry with it returns this order */
    clientRequestId: varchar("client_request_id", { length: 64 }),
    // Timestamp per state so kitchen speed can be measured
    placedAt: createdAt("placed_at"),
    acceptedAt: at("accepted_at"),
    /** First time any line started cooking (S2) */
    preparingAt: at("preparing_at"),
    readyAt: at("ready_at"),
    servedAt: at("served_at"),
    cancelledAt: at("cancelled_at"),
  },
  (t) => [
    uniqueIndex("orders_session_round_uq").on(t.sessionId, t.roundNo),
    uniqueIndex("orders_request_uq").on(t.tenantId, t.sessionId, t.clientRequestId),
    index("orders_outlet_placed_idx").on(t.outletId, t.placedAt),
    tenantKey("orders", t),
    sameTenant("fk_orders_outlet", t, t.outletId, outlets),
    sameTenant("fk_orders_session", t, t.sessionId, tableSessions),
    sameTenant("fk_orders_participant", t, t.placedByParticipantId, participants),
    sameTenant("fk_orders_user", t, t.placedByUserId, users),
  ],
);

export type ModifierSnapshot = { nameEn: string; nameHi: string | null; priceDeltaPaise: number };
export type ModifierChoiceSnapshot = { groupId: string; modifierId: string };

export const orderLines = mysqlTable(
  "order_lines",
  {
    id: id(),
    tenantId: tenantId(),
    orderId: ref("order_id").notNull(),
    sessionId: ref("session_id").notNull(),
    /** The person this line belongs to for the split */
    participantId: ref("participant_id"),
    itemId: ref("item_id").notNull(),
    // Snapshots: later menu changes never alter an open table (PS 6.1)
    nameEn: varchar("name_en", { length: 100 }).notNull(),
    nameHi: varchar("name_hi", { length: 100 }),
    modifiers: json("modifiers").$type<ModifierSnapshot[]>(),
    /** Stable option IDs for safely rebuilding a guest's previous order in the cart. */
    modifierChoices: json("modifier_choices").$type<ModifierChoiceSnapshot[]>(),
    /** Item price plus modifier deltas, per unit */
    unitPricePaise: int("unit_price_paise").notNull(),
    qty: int("qty").notNull(),
    taxRateBp: int("tax_rate_bp").notNull(),
    station: varchar("station", { length: 30 }).notNull(),
    /** Target at placement: later menu edits must not move an existing order's late threshold. */
    prepMinutes: int("prep_minutes").notNull().default(15),
    note: varchar("note", { length: 140 }),
    // Food-safety snapshots taken when the order is placed (S2). NULL on rows placed before they
    // existed means unknown, never "none": [] is only ever a restaurant's own declaration.
    allergensSnapshot: json("allergens_snapshot").$type<string[]>(),
    isJainSnapshot: boolean("is_jain_snapshot"),
    spiceLevelSnapshot: tinyint("spice_level_snapshot"),
    sharedWith: json("shared_with").$type<string[]>(),
    /** Packed for this diner to take away; remains theirs even under an equal split */
    personalForPickup: boolean("personal_for_pickup").notNull().default(false),
    status: mysqlEnum("status", [...orderStatuses, "voided"]).notNull().default("placed"),
    voidReason: varchar("void_reason", { length: 200 }),
    voidedByUserId: ref("voided_by_user_id"),
    preparingAt: at("preparing_at"),
    readyAt: at("ready_at"),
    servedAt: at("served_at"),
    voidedAt: at("voided_at"),
    createdAt: createdAt(),
  },
  (t) => [
    tenantKey("order_lines", t),
    sameTenant("fk_order_lines_order", t, t.orderId, orders),
    sameTenant("fk_order_lines_session", t, t.sessionId, tableSessions),
    sameTenant("fk_order_lines_participant", t, t.participantId, participants),
    sameTenant("fk_order_lines_item", t, t.itemId, menuItems),
    sameTenant("fk_order_lines_voided_by", t, t.voidedByUserId, users),
  ],
);

/** What the kitchen sees: one ticket per station per order */
export const tickets = mysqlTable(
  "tickets",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    orderId: ref("order_id").notNull(),
    station: varchar("station", { length: 30 }).notNull(),
    status: mysqlEnum("status", ["new", "in_progress", "done"]).notNull().default("new"),
    printedAt: at("printed_at"),
    bumpedAt: at("bumped_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("tickets_outlet_station_idx").on(t.outletId, t.station, t.status),
    // One ticket per station per order; adding this fails loudly if duplicates exist
    uniqueIndex("tickets_order_station_uq").on(t.orderId, t.station),
    sameTenant("fk_tickets_outlet", t, t.outletId, outlets),
    sameTenant("fk_tickets_order", t, t.orderId, orders),
  ],
);

export const serviceRequestKinds = [
  "water",
  "cutlery",
  "call_waiter",
  "clean_table",
  "request_bill",
] as const;

/** Not a grid button: the guest chose to pay at the counter on the bill (G8) */
export const storedServiceRequestKinds = [...serviceRequestKinds, "pay_at_counter"] as const;

export const serviceRequests = mysqlTable(
  "service_requests",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    sessionId: ref("session_id").notNull(),
    tableId: ref("table_id").notNull(),
    participantId: ref("participant_id"),
    kind: mysqlEnum("kind", storedServiceRequestKinds).notNull(),
    clientRequestId: varchar("client_request_id", { length: 64 }),
    status: mysqlEnum("status", ["open", "done"]).notNull().default("open"),
    escalatedAt: at("escalated_at"),
    createdAt: createdAt(),
    doneAt: at("done_at"),
    doneByUserId: ref("done_by_user_id"),
  },
  (t) => [
    index("service_requests_outlet_status_idx").on(t.outletId, t.status),
    index("service_requests_session_kind_idx").on(t.tenantId, t.sessionId, t.kind, t.createdAt),
    uniqueIndex("service_requests_request_uq").on(t.tenantId, t.sessionId, t.clientRequestId),
    sameTenant("fk_service_requests_outlet", t, t.outletId, outlets),
    sameTenant("fk_service_requests_session", t, t.sessionId, tableSessions),
    sameTenant("fk_service_requests_table", t, t.tableId, diningTables),
    sameTenant("fk_service_requests_participant", t, t.participantId, participants),
    sameTenant("fk_service_requests_done_by", t, t.doneByUserId, users),
  ],
);

/**
 * A wall-mounted kitchen screen (S2). Set up by a manager or owner with their PIN; the screen
 * then keeps a 30-day device token (only its hash is stored), pinned to one station or to the
 * expeditor's All view. Revoking it signs the screen out at once.
 */
export const kdsDevices = mysqlTable(
  "kds_devices",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    /** Null only for an expeditor screen */
    station: varchar("station", { length: 30 }),
    expeditor: boolean("expeditor").notNull().default(false),
    lang: mysqlEnum("lang", ["en", "hi"]).notNull().default("en"),
    createdByUserId: ref("created_by_user_id").notNull(),
    updatedByUserId: ref("updated_by_user_id"),
    createdAt: createdAt(),
    expiresAt: at("expires_at").notNull(),
    lastSeenAt: at("last_seen_at"),
    revokedAt: at("revoked_at"),
  },
  (t) => [
    uniqueIndex("kds_devices_token_uq").on(t.tokenHash),
    index("kds_devices_outlet_idx").on(t.tenantId, t.outletId),
    sameTenant("fk_kds_devices_outlet", t, t.outletId, outlets),
    sameTenant("fk_kds_devices_created_by", t, t.createdByUserId, users),
    sameTenant("fk_kds_devices_updated_by", t, t.updatedByUserId, users),
  ],
);
