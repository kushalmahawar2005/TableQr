import { boolean, date, index, int, json, mysqlEnum, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { at, createdAt, id, ref, sameTenant, tenantId, tenantKey, updatedAt } from "./_columns";
import { diningTables } from "./floor";
import { guests, tableSessions } from "./sessions";
import { outlets, users } from "./tenancy";

// Reservations, waitlist and pacing (PS 4.3 to 4.6), the backend S1 Arrivals, Waitlist and
// Tonight read from. The guest booking screens (B1 to B4) come later and use the same tables.

/** Booking rules per outlet. No row means the defaults in src/domain/booking-policy.ts. */
export const bookingPolicies = mysqlTable(
  "booking_policies",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    /** How far ahead guests can book online */
    bookingWindowDays: int("booking_window_days").notNull().default(30),
    /** Online bookings close this long before a slot */
    onlineCutoffMinutes: int("online_cutoff_minutes").notNull().default(60),
    minPartySize: int("min_party_size").notNull().default(1),
    /** Largest party that can book online; larger parties call the restaurant */
    maxPartySize: int("max_party_size").notNull().default(8),
    slotIntervalMinutes: int("slot_interval_minutes").notNull().default(30),
    /** A slot picked online is held this long while the guest finishes booking */
    holdMinutes: int("hold_minutes").notNull().default(10),
    /** [[up to N guests, minutes], ...] ascending; the last entry covers larger parties */
    diningMinutes: json("dining_minutes").$type<[number, number][]>(),
    /** Gap kept free between one party leaving and the next booking */
    turnoverBufferMinutes: int("turnover_buffer_minutes").notNull().default(15),
    /** How late a booked party can arrive before the host may mark a no-show */
    graceMinutes: int("grace_minutes").notNull().default(15),
    /** The table shows Reserved from this long before the booking */
    reserveAheadMinutes: int("reserve_ahead_minutes").notNull().default(30),
    /** Guests the kitchen and room take per 30-minute slot */
    pacingCoversPerSlot: int("pacing_covers_per_slot").notNull().default(40),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("booking_policies_outlet_uq").on(t.outletId), sameTenant("fk_booking_policies_outlet", t, t.outletId, outlets)],
);

export const reservationStatuses = ["requested", "confirmed", "reminded", "arrived", "seated", "completed", "cancelled", "no_show"] as const;
export type ReservationStatus = (typeof reservationStatuses)[number];
export const reservationSources = ["online", "phone", "walk_in", "staff"] as const;

export const reservations = mysqlTable(
  "reservations",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    guestId: ref("guest_id"),
    name: varchar("name", { length: 80 }).notNull(),
    phone: varchar("phone", { length: 15 }),
    partySize: int("party_size").notNull(),
    startAt: at("start_at").notNull(),
    expectedEndAt: at("expected_end_at").notNull(),
    status: mysqlEnum("status", reservationStatuses).notNull().default("requested"),
    source: mysqlEnum("source", reservationSources).notNull().default("staff"),
    /** Free text the guest chose or typed, e.g. Birthday, Anniversary */
    occasion: varchar("occasion", { length: 40 }),
    notes: varchar("notes", { length: 300 }),
    /** An online slot being booked holds its table until this time (shown as Held) */
    holdExpiresAt: at("hold_expires_at"),
    sessionId: ref("session_id"),
    confirmedAt: at("confirmed_at"),
    remindedAt: at("reminded_at"),
    arrivedAt: at("arrived_at"),
    seatedAt: at("seated_at"),
    completedAt: at("completed_at"),
    cancelledAt: at("cancelled_at"),
    noShowAt: at("no_show_at"),
    createdByUserId: ref("created_by_user_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("reservations_outlet_start_idx").on(t.tenantId, t.outletId, t.startAt),
    tenantKey("reservations", t),
    sameTenant("fk_reservations_outlet", t, t.outletId, outlets),
    sameTenant("fk_reservations_guest", t, t.guestId, guests),
    sameTenant("fk_reservations_session", t, t.sessionId, tableSessions),
    sameTenant("fk_reservations_created_by", t, t.createdByUserId, users),
  ],
);

/** The table or tables a reservation is assigned to; several only for combinable tables */
export const reservationTables = mysqlTable(
  "reservation_tables",
  {
    id: id(),
    tenantId: tenantId(),
    reservationId: ref("reservation_id").notNull(),
    tableId: ref("table_id").notNull(),
  },
  (t) => [
    uniqueIndex("reservation_tables_uq").on(t.reservationId, t.tableId),
    index("reservation_tables_table_idx").on(t.tenantId, t.tableId),
    sameTenant("fk_reservation_tables_reservation", t, t.reservationId, reservations),
    sameTenant("fk_reservation_tables_table", t, t.tableId, diningTables),
  ],
);

export const waitlistStatuses = ["waiting", "notified", "seated", "skipped", "left"] as const;
export type WaitlistStatus = (typeof waitlistStatuses)[number];

export const waitlistEntries = mysqlTable(
  "waitlist_entries",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    phone: varchar("phone", { length: 15 }),
    partySize: int("party_size").notNull(),
    joinedAt: createdAt("joined_at"),
    quotedMinutes: int("quoted_minutes"),
    status: mysqlEnum("status", waitlistStatuses).notNull().default("waiting"),
    /** Queue position among waiting and notified parties; lower is sooner */
    sortOrder: int("sort_order").notNull(),
    notes: varchar("notes", { length: 200 }),
    notifiedAt: at("notified_at"),
    seatedAt: at("seated_at"),
    closedAt: at("closed_at"),
    sessionId: ref("session_id"),
    createdByUserId: ref("created_by_user_id"),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("waitlist_outlet_status_idx").on(t.tenantId, t.outletId, t.status, t.sortOrder),
    tenantKey("waitlist_entries", t),
    sameTenant("fk_waitlist_outlet", t, t.outletId, outlets),
    sameTenant("fk_waitlist_session", t, t.sessionId, tableSessions),
    sameTenant("fk_waitlist_created_by", t, t.createdByUserId, users),
  ],
);

/** Per service day: online bookings paused by the host or manager (S1 Tonight) */
export const serviceDayOverrides = mysqlTable(
  "service_day_overrides",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    /** Outlet-local date, YYYY-MM-DD */
    serviceDate: date("service_date", { mode: "string" }).notNull(),
    onlineBookingsPaused: boolean("online_bookings_paused").notNull().default(false),
    reason: varchar("reason", { length: 120 }),
    updatedByUserId: ref("updated_by_user_id"),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("service_day_overrides_uq").on(t.outletId, t.serviceDate),
    sameTenant("fk_service_day_overrides_outlet", t, t.outletId, outlets),
    sameTenant("fk_service_day_overrides_by", t, t.updatedByUserId, users),
  ],
);

/** Extra covers opened for one pacing slot, on top of the policy's covers per slot */
export const slotCapacityOverrides = mysqlTable(
  "slot_capacity_overrides",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    slotStartAt: at("slot_start_at").notNull(),
    extraCovers: int("extra_covers").notNull(),
    reason: varchar("reason", { length: 120 }),
    updatedByUserId: ref("updated_by_user_id"),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("slot_capacity_overrides_uq").on(t.outletId, t.slotStartAt),
    sameTenant("fk_slot_capacity_outlet", t, t.outletId, outlets),
    sameTenant("fk_slot_capacity_by", t, t.updatedByUserId, users),
  ],
);
