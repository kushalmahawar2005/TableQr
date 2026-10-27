import { char, index, int, json, mysqlEnum, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { at, createdAt, id, ref, sameTenant, tenantId, tenantKey } from "./_columns";
import { guests, tableSessions } from "./sessions";
import { outlets, users } from "./tenancy";

export type DeliveryCartLine = { itemId: string; qty: number; modifierIds: string[] };
export type DeliveryAddress = { line: string; locality: string; pincode: string; instructions: string; /** The exact door, when the guest dropped a pin or shared their location */ lat?: number; lng?: number };

export const deliveryCheckouts = mysqlTable("delivery_checkouts", {
  id: id(), tenantId: tenantId(), outletId: ref("outlet_id").notNull(),
  tokenHash: char("token_hash", { length: 64 }).notNull(), deviceId: varchar("device_id", { length: 64 }).notNull(),
  lines: json("lines").$type<DeliveryCartLine[]>().notNull(), address: json("address").$type<DeliveryAddress>().notNull(),
  guestId: ref("guest_id"), name: varchar("name", { length: 40 }), phone: varchar("phone", { length: 15 }), verifiedAt: at("verified_at"),
  sessionId: ref("session_id"), status: mysqlEnum("status", ["draft", "placed", "dispatched", "delivered", "cancelled"]).notNull().default("draft"),
  paymentMode: mysqlEnum("payment_mode", ["cod", "gateway", "manual_qr"]).notNull().default("cod"),
  paymentProvider: varchar("payment_provider", { length: 30 }), gatewayRef: varchar("gateway_ref", { length: 100 }), gatewayPaymentId: varchar("gateway_payment_id", { length: 100 }),
  manualPaymentQrUrl: varchar("manual_payment_qr_url", { length: 500 }), manualPaymentReference: varchar("manual_payment_reference", { length: 40 }),
  manualPaymentClaimedAt: at("manual_payment_claimed_at"), manualPaymentConfirmedAt: at("manual_payment_confirmed_at"),
  courierName: varchar("courier_name", { length: 80 }), courierPhone: varchar("courier_phone", { length: 16 }), courierAssignedAt: at("courier_assigned_at"),
  /** The team rider carrying it; name and phone above stay as given, for a rider outside the team */
  courierUserId: ref("courier_user_id"), pickedUpAt: at("picked_up_at"), deliveredAt: at("delivered_at"),
  /** Four digits the customer tells the rider at the door; set when the rider picks the food up */
  deliveryPin: varchar("delivery_pin", { length: 4 }), pinAttempts: int("pin_attempts").notNull().default(0),
  /** The rider took the money another way (QR glitch, wrong amount...) and said why; the manager follows up */
  paymentIssue: varchar("payment_issue", { length: 300 }), paymentIssueAt: at("payment_issue_at"),
  /** The customer's 1-5 stars for the rider, once delivered; feeds the rider's average */
  riderRating: int("rider_rating"), riderRatingNote: varchar("rider_rating_note", { length: 200 }), riderRatedAt: at("rider_rated_at"),
  paymentStatus: mysqlEnum("payment_status", ["none", "pending", "paid", "failed", "refund_pending", "refunded", "refund_failed"]).notNull().default("none"),
  paymentFailureReason: varchar("payment_failure_reason", { length: 200 }), refundGatewayRef: varchar("refund_gateway_ref", { length: 100 }),
  refundStatus: mysqlEnum("refund_status", ["none", "pending", "success", "failed"]).notNull().default("none"),
  deliveryFeePaise: int("delivery_fee_paise").notNull().default(0), totalPaise: int("total_paise").notNull().default(0),
  expiresAt: at("expires_at").notNull(), createdAt: createdAt(), placedAt: at("placed_at"),
}, t => [tenantKey("delivery_checkouts", t), uniqueIndex("delivery_token_uq").on(t.tokenHash), uniqueIndex("delivery_gateway_ref_uq").on(t.paymentProvider, t.gatewayRef), uniqueIndex("delivery_refund_gateway_ref_uq").on(t.paymentProvider, t.refundGatewayRef), uniqueIndex("delivery_manual_reference_uq").on(t.tenantId, t.manualPaymentReference), index("delivery_device_idx").on(t.tenantId, t.deviceId, t.createdAt), index("delivery_outlet_idx").on(t.outletId, t.status, t.createdAt), index("delivery_courier_idx").on(t.tenantId, t.courierUserId, t.status), index("delivery_rider_rating_idx").on(t.tenantId, t.courierUserId, t.riderRating), index("delivery_payment_status_idx").on(t.tenantId, t.paymentStatus, t.createdAt), index("delivery_manual_pending_idx").on(t.tenantId, t.outletId, t.paymentMode, t.paymentStatus, t.manualPaymentClaimedAt), sameTenant("fk_delivery_outlet", t, t.outletId, outlets), sameTenant("fk_delivery_guest", t, t.guestId, guests), sameTenant("fk_delivery_session", t, t.sessionId, tableSessions)]);

export const deliveryOtpChallenges = mysqlTable("delivery_otp_challenges", {
  id: id(), tenantId: tenantId(), outletId: ref("outlet_id").notNull(), checkoutId: ref("checkout_id").notNull(),
  deviceId: varchar("device_id", { length: 64 }).notNull(), phone: varchar("phone", { length: 15 }).notNull(), codeHash: char("code_hash", { length: 64 }).notNull(),
  attempts: int("attempts").notNull().default(0), expiresAt: at("expires_at").notNull(), resendAt: at("resend_at").notNull(), lockedUntil: at("locked_until"), verifiedAt: at("verified_at"), deadAt: at("dead_at"), createdAt: createdAt(),
}, t => [index("delivery_otp_phone_idx").on(t.tenantId, t.phone, t.createdAt), index("delivery_otp_device_idx").on(t.tenantId, t.deviceId, t.createdAt), sameTenant("fk_delivery_otp_checkout", t, t.checkoutId, deliveryCheckouts), sameTenant("fk_delivery_otp_outlet", t, t.outletId, outlets)]);

/**
 * A rider's identity check. The Aadhaar photos are encrypted before they are stored (only the
 * object keys are here) and can be deleted once the owner verifies; only the last four digits
 * of the number are ever kept, never the full number.
 */
export const riderDocuments = mysqlTable("rider_documents", {
  id: id(), tenantId: tenantId(), userId: ref("user_id").notNull(),
  status: mysqlEnum("status", ["pending", "verified", "rejected"]).notNull().default("pending"),
  aadhaarLast4: char("aadhaar_last4", { length: 4 }),
  frontKey: varchar("front_key", { length: 200 }), backKey: varchar("back_key", { length: 200 }),
  consentAt: at("consent_at").notNull(), submittedAt: at("submitted_at").notNull(),
  reviewedAt: at("reviewed_at"), reviewedByUserId: ref("reviewed_by_user_id"), note: varchar("note", { length: 200 }),
  createdAt: createdAt(),
}, t => [uniqueIndex("rider_documents_user_uq").on(t.tenantId, t.userId), tenantKey("rider_documents", t), sameTenant("fk_rider_documents_user", t, t.userId, users)]);

/** A customer's phone that asked for updates on their delivery or booking (the latest of each it follows) */
export const guestPushSubscriptions = mysqlTable("guest_push_subscriptions", {
  id: id(), tenantId: tenantId(), outletId: ref("outlet_id").notNull(),
  endpointHash: char("endpoint_hash", { length: 64 }).notNull(), endpoint: varchar("endpoint", { length: 2048 }).notNull(),
  p256dh: varchar("p256dh", { length: 256 }).notNull(), auth: varchar("auth", { length: 256 }).notNull(),
  deliveryCheckoutId: ref("delivery_checkout_id"), reservationId: ref("reservation_id"), createdAt: createdAt(),
}, t => [uniqueIndex("guest_push_endpoint_uq").on(t.tenantId, t.endpointHash), index("guest_push_checkout_idx").on(t.tenantId, t.deliveryCheckoutId), index("guest_push_reservation_idx").on(t.tenantId, t.reservationId), tenantKey("guest_push_subscriptions", t), sameTenant("fk_guest_push_outlet", t, t.outletId, outlets)]);
