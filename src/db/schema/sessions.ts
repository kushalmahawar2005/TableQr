import {
  boolean,
  char,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { at, createdAt, id, ref, sameTenant, tenantId, tenantKey, updatedAt } from "./_columns";
import { diningTables } from "./floor";
import { menuItems } from "./menu";
import { outlets, sessionModes, tenants, users } from "./tenancy";

// Guests and the table session, the object everything else hangs off (PS 3.6, 8.3).

export const sessionSources = ["qr", "walk_in", "reservation", "waitlist"] as const;

/** Verified guests, per tenant; never shared across tenants */
export const guests = mysqlTable(
  "guests",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    phone: varchar("phone", { length: 15 }).notNull(),
    name: varchar("name", { length: 80 }),
    consentMarketing: boolean("consent_marketing").notNull().default(false),
    consentPersonalisation: boolean("consent_personalisation").notNull().default(false),
    consentVersion: varchar("consent_version", { length: 20 }),
    consentAt: at("consent_at"),
    dietaryFlags: json("dietary_flags").$type<string[]>(),
    noShowCount: int("no_show_count").notNull().default(0),
    firstSeenAt: createdAt("first_seen_at"),
    lastSeenAt: at("last_seen_at"),
  },
  (t) => [uniqueIndex("guests_tenant_phone_uq").on(t.tenantId, t.phone), tenantKey("guests", t)],
);

export const tableSessions = mysqlTable(
  "table_sessions",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    tableId: ref("table_id").notNull(),
    mode: mysqlEnum("mode", sessionModes).notNull(),
    status: mysqlEnum("status", ["open", "bill_requested", "closed"]).notNull().default("open"),
    /** How the party sat down: a guest scan, or staff seating a walk-in, booking or waitlist party */
    source: mysqlEnum("source", sessionSources).notNull().default("qr"),
    /** Party size given by staff when seating; guests who scan are counted as participants */
    partySize: int("party_size"),
    /** Name given by staff for a walk-in, booking or waitlist party */
    guestName: varchar("guest_name", { length: 80 }),
    /** When the table is expected back, from the dining-duration policy plus any extensions */
    expectedEndAt: at("expected_end_at"),
    openedByUserId: ref("opened_by_user_id"),
    /** Visit owner: stays with the party when it moves to another physical table. */
    waiterUserId: ref("waiter_user_id"),
    reservationId: ref("reservation_id"),
    /** No FK: participants reference the session, so this would be circular */
    hostParticipantId: ref("host_participant_id"),
    orderingLocked: boolean("ordering_locked").notNull().default(false),
    /**
     * Equals tableId while the session is not closed, null once closed.
     * The unique index on it enforces one open session per table (PS 3.3).
     */
    openKey: ref("open_key"),
    openedAt: createdAt("opened_at"),
    lastActivityAt: at("last_activity_at")
      .notNull()
      .$defaultFn(() => new Date()),
    closedAt: at("closed_at"),
  },
  (t) => [
    uniqueIndex("table_sessions_open_key_uq").on(t.openKey),
    index("table_sessions_outlet_idx").on(t.outletId, t.openedAt),
    tenantKey("table_sessions", t),
    sameTenant("fk_sessions_outlet", t, t.outletId, outlets),
    sameTenant("fk_sessions_table", t, t.tableId, diningTables),
    sameTenant("fk_sessions_opened_by", t, t.openedByUserId, users),
    sameTenant("fk_sessions_waiter", t, t.waiterUserId, users),
  ],
);

/**
 * Which physical tables a visit occupies (S1). A visit has one primary table (also
 * table_sessions.table_id) and, when tables are combined, more. Rows are kept after release, so
 * a phone that sat at a table before a move still finds its visit. active_key equals table_id
 * while the assignment is live and is null after: its unique index means a physical table belongs
 * to at most one live visit.
 */
export const sessionTables = mysqlTable(
  "session_tables",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    sessionId: ref("session_id").notNull(),
    tableId: ref("table_id").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    activeKey: ref("active_key"),
    assignedAt: createdAt("assigned_at"),
    releasedAt: at("released_at"),
    assignedByUserId: ref("assigned_by_user_id"),
  },
  (t) => [
    uniqueIndex("session_tables_active_uq").on(t.activeKey),
    index("session_tables_session_idx").on(t.tenantId, t.sessionId),
    index("session_tables_table_idx").on(t.tenantId, t.tableId),
    sameTenant("fk_session_tables_outlet", t, t.outletId, outlets),
    sameTenant("fk_session_tables_session", t, t.sessionId, tableSessions),
    sameTenant("fk_session_tables_table", t, t.tableId, diningTables),
    sameTenant("fk_session_tables_by", t, t.assignedByUserId, users),
  ],
);

export const participants = mysqlTable(
  "participants",
  {
    id: id(),
    tenantId: tenantId(),
    sessionId: ref("session_id").notNull(),
    guestId: ref("guest_id"),
    displayName: varchar("display_name", { length: 40 }).notNull(),
    /** Random id kept in a cookie so the same phone rejoins as the same person */
    deviceId: varchar("device_id", { length: 64 }),
    /** Set when a waiter orders for a guest without a phone */
    addedByUserId: ref("added_by_user_id"),
    joinedAt: createdAt("joined_at"),
    paidOutAt: at("paid_out_at"),
    removedAt: at("removed_at"),
  },
  (t) => [
    index("participants_device_idx").on(t.deviceId),
    tenantKey("participants", t),
    sameTenant("fk_participants_session", t, t.sessionId, tableSessions),
    sameTenant("fk_participants_guest", t, t.guestId, guests),
    sameTenant("fk_participants_added_by", t, t.addedByUserId, users),
  ],
);

/**
 * One-time codes for Verified mode (G2). Only a keyed hash of the code is stored. A code belongs
 * to one phone (device) at one table; a newer code for that phone and table kills the older one.
 */
export const otpChallenges = mysqlTable(
  "otp_challenges",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    tableId: ref("table_id").notNull(),
    deviceId: varchar("device_id", { length: 64 }).notNull(),
    /** E.164, e.g. +919876543210 */
    phone: varchar("phone", { length: 15 }).notNull(),
    codeHash: char("code_hash", { length: 64 }).notNull(),
    attempts: int("attempts").notNull().default(0),
    expiresAt: at("expires_at").notNull(),
    /** A new code for the same number is not sent before this */
    resendAt: at("resend_at").notNull(),
    /** Set by the third wrong code; blocks this number and this phone until then */
    lockedUntil: at("locked_until"),
    verifiedAt: at("verified_at"),
    /** Replaced by a newer code, or the SMS could not be sent */
    deadAt: at("dead_at"),
    guestId: ref("guest_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("otp_challenges_phone_idx").on(t.tenantId, t.phone, t.createdAt),
    index("otp_challenges_device_idx").on(t.tenantId, t.deviceId, t.createdAt),
    index("otp_challenges_table_idx").on(t.tenantId, t.tableId, t.createdAt),
    tenantKey("otp_challenges", t),
    sameTenant("fk_otp_outlet", t, t.outletId, outlets),
    sameTenant("fk_otp_table", t, t.tableId, diningTables),
    sameTenant("fk_otp_guest", t, t.guestId, guests),
  ],
);

/**
 * Wrong table join codes (Host-confirmed mode, G1). Only failures are kept: they rate-limit
 * guessing per phone and per table. The code itself is never stored here.
 */
export const joinCodeAttempts = mysqlTable(
  "join_code_attempts",
  {
    id: id(),
    tenantId: tenantId(),
    tableId: ref("table_id").notNull(),
    deviceId: varchar("device_id", { length: 64 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("join_code_attempts_table_idx").on(t.tenantId, t.tableId, t.createdAt),
    index("join_code_attempts_device_idx").on(t.tenantId, t.deviceId, t.createdAt),
    sameTenant("fk_join_code_attempts_table", t, t.tableId, diningTables),
  ],
);

export type ModifierChoice = { modifierId: string; groupId: string };

/** Per-person cart inside the table session; prices are resolved on the server */
export const cartLines = mysqlTable(
  "cart_lines",
  {
    id: id(),
    tenantId: tenantId(),
    sessionId: ref("session_id").notNull(),
    participantId: ref("participant_id").notNull(),
    itemId: ref("item_id").notNull(),
    qty: int("qty").notNull().default(1),
    modifiers: json("modifiers").$type<ModifierChoice[]>(),
    note: varchar("note", { length: 140 }),
    /** Participant ids sharing this line; null means not shared */
    sharedWith: json("shared_with").$type<string[]>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    sameTenant("fk_cart_lines_session", t, t.sessionId, tableSessions),
    sameTenant("fk_cart_lines_participant", t, t.participantId, participants),
    sameTenant("fk_cart_lines_item", t, t.itemId, menuItems),
  ],
);
