import { boolean, char, date, index, int, json, mysqlEnum, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { at, createdAt, id, ref, sameTenant, tenantId, tenantKey, updatedAt } from "./_columns";
import { diningTables, zones } from "./floor";
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
    maxPartySize: int("max_party_size").notNull().default(12),
    slotIntervalMinutes: int("slot_interval_minutes").notNull().default(30),
    /** A slot picked online is held this long while the guest finishes booking */
    holdMinutes: int("hold_minutes").notNull().default(5),
    /** [[up to N guests, minutes], ...] ascending; the last entry covers larger parties */
    diningMinutes: json("dining_minutes").$type<[number, number][]>(),
    /** Gap kept free between one party leaving and the next booking */
    turnoverBufferMinutes: int("turnover_buffer_minutes").notNull().default(10),
    /** How late a booked party can arrive before the host may mark a no-show */
    graceMinutes: int("grace_minutes").notNull().default(15),
    /** The table shows Reserved from this long before the booking */
    reserveAheadMinutes: int("reserve_ahead_minutes").notNull().default(30),
    /** Guests the kitchen and room take per 30-minute slot */
    pacingCoversPerSlot: int("pacing_covers_per_slot").notNull().default(40),
    freeCancellationMinutes: int("free_cancellation_minutes").notNull().default(120),
    lateExtensionMinutes: int("late_extension_minutes").notNull().default(10),
    readyWindowMinutes: int("ready_window_minutes").notNull().default(10),
    fallbackWaitMinutes: int("fallback_wait_minutes").notNull().default(30),
    minimumHistoryParties: int("minimum_history_parties").notNull().default(30),
    peakCreditPaise: int("peak_credit_paise").notNull().default(0),
    repeatNoShowCreditPaise: int("repeat_no_show_credit_paise").notNull().default(0),
    repeatNoShowThreshold: int("repeat_no_show_threshold").notNull().default(2),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("booking_policies_outlet_uq").on(t.outletId), sameTenant("fk_booking_policies_outlet", t, t.outletId, outlets)],
);

export const reservationStatuses = ["requested", "confirmed", "reminded", "arrived", "seated", "completed", "cancelled", "no_show"] as const;
export type ReservationStatus = (typeof reservationStatuses)[number];
export const reservationSources = ["online", "phone", "walk_in", "staff"] as const;

export const groupRequestStatuses = ["requested", "contacted", "converted", "cancelled"] as const;

export const reservations = mysqlTable(
  "reservations",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    guestId: ref("guest_id"),
    name: varchar("name", { length: 80 }).notNull(),
    phone: varchar("phone", { length: 15 }),
    /** Public reference is display-only; management requires the hashed token below. */
    publicReference: varchar("public_reference", { length: 20 }),
    manageTokenHash: char("manage_token_hash", { length: 64 }),
    manageTokenExpiresAt: at("manage_token_expires_at"),
    bookingRequestId: varchar("booking_request_id", { length: 64 }),
    partySize: int("party_size").notNull(),
    startAt: at("start_at").notNull(),
    expectedEndAt: at("expected_end_at").notNull(),
    status: mysqlEnum("status", reservationStatuses).notNull().default("requested"),
    source: mysqlEnum("source", reservationSources).notNull().default("staff"),
    seatingPreference: varchar("seating_preference", { length: 40 }),
    requestedZoneId: ref("requested_zone_id"),
    requestedTableClass: varchar("requested_table_class", { length: 20 }),
    /** Free text the guest chose or typed, e.g. Birthday, Anniversary */
    occasion: varchar("occasion", { length: 40 }),
    notes: varchar("notes", { length: 300 }),
    /** An online slot being booked holds its table until this time (shown as Held) */
    holdExpiresAt: at("hold_expires_at"),
    holdOwnerHash: char("hold_owner_hash", { length: 64 }),
    holdReleasedAt: at("hold_released_at"),
    holdReleaseReason: varchar("hold_release_reason", { length: 80 }),
    sessionId: ref("session_id"),
    confirmedAt: at("confirmed_at"),
    remindedAt: at("reminded_at"),
    arrivedAt: at("arrived_at"),
    seatedAt: at("seated_at"),
    completedAt: at("completed_at"),
    cancelledAt: at("cancelled_at"),
    restaurantCancelledAt: at("restaurant_cancelled_at"),
    restaurantCancelReason: varchar("restaurant_cancel_reason", { length: 200 }),
    creditRequiredPaise: int("credit_required_paise").notNull().default(0),
    creditPaidPaise: int("credit_paid_paise").notNull().default(0),
    creditAppliedPaise: int("credit_applied_paise").notNull().default(0),
    creditStatus: mysqlEnum("credit_status", ["none", "required", "pending", "paid", "applied", "refunded", "forfeited", "failed"]).notNull().default("none"),
    noShowAt: at("no_show_at"),
    createdByUserId: ref("created_by_user_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("reservations_outlet_start_idx").on(t.tenantId, t.outletId, t.startAt),
    uniqueIndex("reservations_public_reference_uq").on(t.tenantId, t.publicReference),
    uniqueIndex("reservations_booking_request_uq").on(t.tenantId, t.bookingRequestId),
    tenantKey("reservations", t),
    sameTenant("fk_reservations_outlet", t, t.outletId, outlets),
    sameTenant("fk_reservations_zone", t, t.requestedZoneId, zones),
    sameTenant("fk_reservations_guest", t, t.guestId, guests),
    sameTenant("fk_reservations_session", t, t.sessionId, tableSessions),
    sameTenant("fk_reservations_created_by", t, t.createdByUserId, users),
  ],
);

export const groupRequests = mysqlTable(
  "group_requests",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    publicReference: varchar("public_reference", { length: 20 }).notNull(),
    requestId: varchar("request_id", { length: 64 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    phone: varchar("phone", { length: 15 }).notNull(),
    partySize: int("party_size").notNull(),
    desiredDate: date("desired_date", { mode: "string" }).notNull(),
    desiredStartAt: at("desired_start_at").notNull(),
    notes: varchar("notes", { length: 500 }),
    status: mysqlEnum("status", groupRequestStatuses).notNull().default("requested"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("group_requests_reference_uq").on(t.tenantId, t.publicReference),
    uniqueIndex("group_requests_request_uq").on(t.tenantId, t.requestId),
    index("group_requests_outlet_date_idx").on(t.tenantId, t.outletId, t.desiredDate, t.status),
    tenantKey("group_requests", t),
    sameTenant("fk_group_requests_outlet", t, t.outletId, outlets),
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

export const reservationHistoryKinds = [
  "created", "hold_created", "hold_released", "confirmed", "cancelled", "restaurant_cancelled",
  "rescheduled", "late_extended", "arrived", "seated", "completed", "no_show",
] as const;

export const reservationHistory = mysqlTable(
  "reservation_history",
  {
    id: id(),
    tenantId: tenantId(),
    reservationId: ref("reservation_id").notNull(),
    kind: mysqlEnum("kind", reservationHistoryKinds).notNull(),
    actorUserId: ref("actor_user_id"),
    before: json("before"),
    after: json("after"),
    reason: varchar("reason", { length: 200 }),
    createdAt: createdAt(),
  },
  (t) => [
    index("reservation_history_idx").on(t.tenantId, t.reservationId, t.createdAt),
    sameTenant("fk_reservation_history_reservation", t, t.reservationId, reservations),
    sameTenant("fk_reservation_history_actor", t, t.actorUserId, users),
  ],
);

export const reservationCreditStatuses = ["required", "pending", "paid", "applied", "refunded", "forfeited", "failed"] as const;

export const reservationCredits = mysqlTable(
  "reservation_credits",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    reservationId: ref("reservation_id").notNull(),
    clientRequestId: varchar("client_request_id", { length: 64 }).notNull(),
    provider: varchar("provider", { length: 30 }),
    gatewayRef: varchar("gateway_ref", { length: 100 }),
    gatewayPaymentId: varchar("gateway_payment_id", { length: 100 }),
    amountPaise: int("amount_paise").notNull(),
    paidPaise: int("paid_paise").notNull().default(0),
    appliedPaise: int("applied_paise").notNull().default(0),
    status: mysqlEnum("status", reservationCreditStatuses).notNull().default("required"),
    refundGatewayRef: varchar("refund_gateway_ref", { length: 100 }),
    refundStatus: mysqlEnum("refund_status", ["none", "pending", "success", "failed"]).notNull().default("none"),
    failureReason: varchar("failure_reason", { length: 200 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("reservation_credits_request_uq").on(t.tenantId, t.reservationId, t.clientRequestId),
    uniqueIndex("reservation_credits_gateway_uq").on(t.provider, t.gatewayRef),
    index("reservation_credits_status_idx").on(t.tenantId, t.status, t.updatedAt),
    tenantKey("reservation_credits", t),
    sameTenant("fk_reservation_credits_outlet", t, t.outletId, outlets),
    sameTenant("fk_reservation_credits_reservation", t, t.reservationId, reservations),
  ],
);

export const bookingExceptionKinds = ["holiday", "blackout", "special_event"] as const;

export const bookingCalendarExceptions = mysqlTable(
  "booking_calendar_exceptions",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    serviceDate: date("service_date", { mode: "string" }).notNull(),
    kind: mysqlEnum("kind", bookingExceptionKinds).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    onlineBookingsPaused: boolean("online_bookings_paused").notNull().default(true),
    opensAt: varchar("opens_at", { length: 5 }),
    closesAt: varchar("closes_at", { length: 5 }),
    createdByUserId: ref("created_by_user_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("booking_calendar_exceptions_uq").on(t.outletId, t.serviceDate),
    sameTenant("fk_booking_exceptions_outlet", t, t.outletId, outlets),
    sameTenant("fk_booking_exceptions_by", t, t.createdByUserId, users),
  ],
);

export const waitlistStatuses = ["waiting", "notified", "seated", "skipped", "left", "expired"] as const;
export type WaitlistStatus = (typeof waitlistStatuses)[number];

export const waitlistEntries = mysqlTable(
  "waitlist_entries",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    guestId: ref("guest_id"),
    name: varchar("name", { length: 80 }).notNull(),
    phone: varchar("phone", { length: 15 }),
    partySize: int("party_size").notNull(),
    seatingPreference: varchar("seating_preference", { length: 40 }),
    joinedAt: createdAt("joined_at"),
    quotedMinutes: int("quoted_minutes"),
    status: mysqlEnum("status", waitlistStatuses).notNull().default("waiting"),
    /** Queue position among waiting and notified parties; lower is sooner */
    sortOrder: int("sort_order").notNull(),
    notes: varchar("notes", { length: 200 }),
    notifiedAt: at("notified_at"),
    readyDeadline: at("ready_deadline"),
    estimateMinutes: int("estimate_minutes"),
    estimateSource: mysqlEnum("estimate_source", ["historical", "fallback", "staff"]),
    manageTokenHash: char("manage_token_hash", { length: 64 }),
    manageTokenExpiresAt: at("manage_token_expires_at"),
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
    sameTenant("fk_waitlist_guest", t, t.guestId, guests),
    sameTenant("fk_waitlist_session", t, t.sessionId, tableSessions),
    sameTenant("fk_waitlist_created_by", t, t.createdByUserId, users),
  ],
);

export const notificationStatuses = ["pending", "processing", "sent", "failed", "cancelled"] as const;
export const notificationTypes = [
  "otp", "booking_confirmation", "booking_reminder_24h", "booking_reminder_2h", "waitlist_joined",
  "waitlist_two_ahead", "waitlist_ready", "waitlist_expired", "booking_cancelled", "refund_update",
] as const;

export const bookingNotifications = mysqlTable(
  "booking_notifications",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    reservationId: ref("reservation_id"),
    waitlistEntryId: ref("waitlist_entry_id"),
    type: mysqlEnum("type", notificationTypes).notNull(),
    recipient: varchar("recipient", { length: 160 }).notNull(),
    channel: varchar("channel", { length: 30 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 120 }).notNull(),
    providerRef: varchar("provider_ref", { length: 120 }),
    status: mysqlEnum("status", notificationStatuses).notNull().default("pending"),
    attempts: int("attempts").notNull().default(0),
    lastError: varchar("last_error", { length: 200 }),
    scheduledAt: at("scheduled_at").notNull(),
    sentAt: at("sent_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("booking_notifications_idempotency_uq").on(t.tenantId, t.idempotencyKey),
    index("booking_notifications_due_idx").on(t.status, t.scheduledAt),
    sameTenant("fk_booking_notifications_outlet", t, t.outletId, outlets),
    sameTenant("fk_booking_notifications_reservation", t, t.reservationId, reservations),
    sameTenant("fk_booking_notifications_waitlist", t, t.waitlistEntryId, waitlistEntries),
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
