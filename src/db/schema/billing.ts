import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  tinyint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { at, createdAt, id, ref, sameTenant, tenantId, tenantKey, updatedAt } from "./_columns";
import { orderLines } from "./orders";
import { participants, tableSessions } from "./sessions";
import { outlets, users } from "./tenancy";
import { reservations } from "./booking";

// Bills, split shares, payments, GST invoices and credit notes (PS 3.6, 6).

export const bills = mysqlTable(
  "bills",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    sessionId: ref("session_id").notNull(),
    splitMode: mysqlEnum("split_mode", ["my_items", "equal", "custom"])
      .notNull()
      .default("my_items"),
    subtotalPaise: int("subtotal_paise").notNull().default(0),
    discountPaise: int("discount_paise").notNull().default(0),
    taxPaise: int("tax_paise").notNull().default(0),
    deliveryFeePaise: int("delivery_fee_paise").notNull().default(0),
    serviceChargePaise: int("service_charge_paise").notNull().default(0),
    tipPaise: int("tip_paise").notNull().default(0),
    /** Reservation credit shown as a separate bill adjustment. */
    bookingCreditPaise: int("booking_credit_paise").notNull().default(0),
    bookingCreditReservationId: ref("booking_credit_reservation_id"),
    roundOffPaise: int("round_off_paise").notNull().default(0),
    totalPaise: int("total_paise").notNull().default(0),
    /** Tax by rate, e.g. { "500": 9950 } */
    taxBreakup: json("tax_breakup").$type<Record<string, number>>(),
    /** Service charge rate for this bill, copied from the outlet when the bill is first made */
    serviceChargeBp: int("service_charge_bp").notNull().default(0),
    /** The host removed the optional service charge before anyone paid */
    serviceChargeWaived: boolean("service_charge_waived").notNull().default(false),
    /** Unused: an early item-based Custom split draft. Custom is amount-based (customAmounts). */
    assignments: json("assignments").$type<Record<string, string[]>>(),
    /** Custom split: participant id to the paise the host set for them (whole rupees) */
    customAmounts: json("custom_amounts").$type<Record<string, number>>(),
    /** Set each time the bill is reopened for more ordering; shown to guests as "Your bill changed" */
    reopenedAt: at("reopened_at"),
    status: mysqlEnum("status", ["open", "locked", "paid", "cancelled"])
      .notNull()
      .default("open"),
    requestedAt: at("requested_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    closedAt: at("closed_at"),
  },
  (t) => [
    uniqueIndex("bills_session_uq").on(t.sessionId),
    index("bills_outlet_created_idx").on(t.outletId, t.createdAt),
    // Paid bills by when they closed: the bell, dashboard, day close and reports all ask for a time range
    index("bills_outlet_closed_idx").on(t.outletId, t.closedAt),
    tenantKey("bills", t),
    sameTenant("fk_bills_outlet", t, t.outletId, outlets),
    sameTenant("fk_bills_session", t, t.sessionId, tableSessions),
    sameTenant("fk_bills_booking_credit_reservation", t, t.bookingCreditReservationId, reservations),
  ],
);

export const billShares = mysqlTable(
  "bill_shares",
  {
    id: id(),
    tenantId: tenantId(),
    billId: ref("bill_id").notNull(),
    /** Null for a share settled at the counter with no participant */
    participantId: ref("participant_id"),
    /** What this person owes for food, tax and round-off; recalculated if the bill changes */
    amountPaise: int("amount_paise").notNull(),
    /** Money received against this share so far, excluding tip. Kept when the bill is recalculated. */
    paidPaise: int("paid_paise").notNull().default(0),
    tipPaise: int("tip_paise").notNull().default(0),
    status: mysqlEnum("status", ["unpaid", "paid"]).notNull().default("unpaid"),
    /** Pay for others: who actually paid this share */
    paidByParticipantId: ref("paid_by_participant_id"),
    /** Paid and left: the amount is fixed from here on and later orders exclude this person */
    frozenAt: at("frozen_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("bill_shares_participant_uq").on(t.billId, t.participantId),
    tenantKey("bill_shares", t),
    sameTenant("fk_bill_shares_bill", t, t.billId, bills),
    sameTenant("fk_bill_shares_participant", t, t.participantId, participants),
    sameTenant("fk_bill_shares_paid_by", t, t.paidByParticipantId, participants),
  ],
);

export const paymentMethods = ["upi", "card", "wallet", "cash"] as const;

export type PaymentAllocation = { shareId: string; amountPaise: number };

/** One row per payment attempt. One payment can cover several shares (pay for others). */
export const payments = mysqlTable(
  "payments",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    billId: ref("bill_id").notNull(),
    /** Which shares this payment settles and how much goes to each, fixed when it starts */
    allocations: json("allocations").$type<PaymentAllocation[]>().notNull(),
    /** Participant who paid, if paid from a guest phone */
    payerParticipantId: ref("payer_participant_id"),
    method: mysqlEnum("method", paymentMethods).notNull(),
    /** "counter" for cash or card taken by staff, otherwise the gateway name */
    channel: varchar("channel", { length: 30 }).notNull(),
    gatewayRef: varchar("gateway_ref", { length: 100 }),
    /** Food, tax and round-off; excludes tip */
    amountPaise: int("amount_paise").notNull(),
    tipPaise: int("tip_paise").notNull().default(0),
    status: mysqlEnum("status", ["initiated", "pending", "success", "failed", "refunded"])
      .notNull()
      .default("initiated"),
    failureReason: varchar("failure_reason", { length: 200 }),
    /** The phone's id for one Pay tap; a retry with it returns this same attempt */
    clientRequestId: varchar("client_request_id", { length: 64 }),
    /** Gateway's id for the captured payment (e.g. pay_...), needed for refunds */
    gatewayPaymentId: varchar("gateway_payment_id", { length: 100 }),
    /** Last time the gateway was asked for this attempt's status */
    checkedAt: at("checked_at"),
    takenByUserId: ref("taken_by_user_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payments_outlet_created_idx").on(t.outletId, t.createdAt),
    index("payments_status_idx").on(t.status, t.updatedAt),
    uniqueIndex("payments_gateway_ref_uq").on(t.channel, t.gatewayRef),
    uniqueIndex("payments_request_uq").on(t.tenantId, t.billId, t.clientRequestId),
    tenantKey("payments", t),
    sameTenant("fk_payments_outlet", t, t.outletId, outlets),
    sameTenant("fk_payments_bill", t, t.billId, bills),
    sameTenant("fk_payments_payer", t, t.payerParticipantId, participants),
    sameTenant("fk_payments_taken_by", t, t.takenByUserId, users),
  ],
);

export const refunds = mysqlTable(
  "refunds",
  {
    id: id(),
    tenantId: tenantId(),
    paymentId: ref("payment_id").notNull(),
    /** The share this money came back from, when a bill change made it overpaid */
    shareId: ref("share_id"),
    amountPaise: int("amount_paise").notNull(),
    reason: varchar("reason", { length: 200 }).notNull(),
    byUserId: ref("by_user_id"),
    status: mysqlEnum("status", ["pending", "success", "failed"]).notNull().default("pending"),
    gatewayRef: varchar("gateway_ref", { length: 100 }),
    createdAt: createdAt(),
    /** Set only when the gateway (or staff, for cash) confirms the money went back */
    completedAt: at("completed_at"),
  },
  (t) => [
    index("refunds_payment_idx").on(t.tenantId, t.paymentId),
    sameTenant("fk_refunds_payment", t, t.paymentId, payments),
    sameTenant("fk_refunds_share", t, t.shareId, billShares),
    sameTenant("fk_refunds_by", t, t.byUserId, users),
  ],
);

export const discounts = mysqlTable(
  "discounts",
  {
    id: id(),
    tenantId: tenantId(),
    billId: ref("bill_id").notNull(),
    /** Set for an item-level discount; null for bill-level */
    orderLineId: ref("order_line_id"),
    kind: mysqlEnum("kind", ["percent", "flat", "complimentary"]).notNull(),
    /** Basis points for percent, paise for flat */
    value: int("value").notNull(),
    amountPaise: int("amount_paise").notNull(),
    reason: varchar("reason", { length: 200 }).notNull(),
    appliedByUserId: ref("applied_by_user_id").notNull(),
    approvedByUserId: ref("approved_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [
    sameTenant("fk_discounts_bill", t, t.billId, bills),
    sameTenant("fk_discounts_order_line", t, t.orderLineId, orderLines),
    sameTenant("fk_discounts_applied_by", t, t.appliedByUserId, users),
    sameTenant("fk_discounts_approved_by", t, t.approvedByUserId, users),
  ],
);

/** Gapless counter per outlet per financial year, incremented under a row lock */
export const invoiceSeries = mysqlTable(
  "invoice_series",
  {
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    /** e.g. "26-27" */
    financialYear: varchar("financial_year", { length: 5 }).notNull(),
    lastSeq: int("last_seq").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.outletId, t.financialYear] }),
    sameTenant("fk_invoice_series_outlet", t, t.outletId, outlets),
  ],
);

export const invoices = mysqlTable(
  "invoices",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    billId: ref("bill_id").notNull(),
    /** Set only for per-payer invoices; null for the single table invoice */
    shareId: ref("share_id"),
    financialYear: varchar("financial_year", { length: 5 }).notNull(),
    seq: int("seq").notNull(),
    /** e.g. SRJ01/26/000123 (FY 2026-27); at most 16 characters */
    number: varchar("number", { length: 30 }).notNull(),
    customerGstin: varchar("customer_gstin", { length: 15 }),
    customerName: varchar("customer_name", { length: 120 }),
    /** Frozen copy of lines, taxes and totals as printed */
    snapshot: json("snapshot").notNull(),
    totalPaise: int("total_paise").notNull(),
    issuedAt: createdAt("issued_at"),
  },
  (t) => [
    uniqueIndex("invoices_outlet_fy_seq_uq").on(t.outletId, t.financialYear, t.seq),
    tenantKey("invoices", t),
    sameTenant("fk_invoices_outlet", t, t.outletId, outlets),
    sameTenant("fk_invoices_bill", t, t.billId, bills),
    sameTenant("fk_invoices_share", t, t.shareId, billShares),
  ],
);

/** Cancelling an invoice never deletes it; it issues a linked credit note */
export const creditNotes = mysqlTable(
  "credit_notes",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    invoiceId: ref("invoice_id").notNull(),
    number: varchar("number", { length: 30 }).notNull(),
    amountPaise: int("amount_paise").notNull(),
    reason: varchar("reason", { length: 200 }).notNull(),
    byUserId: ref("by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("credit_notes_number_uq").on(t.outletId, t.number),
    sameTenant("fk_credit_notes_outlet", t, t.outletId, outlets),
    sameTenant("fk_credit_notes_invoice", t, t.invoiceId, invoices),
    sameTenant("fk_credit_notes_by", t, t.byUserId, users),
  ],
);

export const feedback = mysqlTable(
  "feedback",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    sessionId: ref("session_id").notNull(),
    participantId: ref("participant_id"),
    rating: tinyint("rating").notNull(),
    comment: varchar("comment", { length: 500 }),
    /** Two stars or fewer: the manager should recover this guest now (PS 3.8) */
    needsRecovery: boolean("needs_recovery").notNull().default(false),
    recoveredAt: at("recovered_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("feedback_outlet_created_idx").on(t.outletId, t.createdAt),
    uniqueIndex("feedback_session_participant_uq").on(t.sessionId, t.participantId),
    sameTenant("fk_feedback_outlet", t, t.outletId, outlets),
    sameTenant("fk_feedback_session", t, t.sessionId, tableSessions),
    sameTenant("fk_feedback_participant", t, t.participantId, participants),
  ],
);

export const receiptChannels = ["whatsapp", "sms", "email"] as const;

/** Every receipt we tried to send, so nobody is told a receipt went out when it did not */
export const receiptDeliveries = mysqlTable(
  "receipt_deliveries",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    billId: ref("bill_id").notNull(),
    participantId: ref("participant_id"),
    channel: mysqlEnum("channel", receiptChannels).notNull(),
    /** Masked, e.g. +91 98xxxxxx10 */
    destination: varchar("destination", { length: 120 }).notNull(),
    status: mysqlEnum("status", ["queued", "sent", "failed"]).notNull().default("queued"),
    providerRef: varchar("provider_ref", { length: 100 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("receipt_deliveries_bill_idx").on(t.tenantId, t.billId),
    sameTenant("fk_receipt_deliveries_outlet", t, t.outletId, outlets),
    sameTenant("fk_receipt_deliveries_bill", t, t.billId, bills),
    sameTenant("fk_receipt_deliveries_participant", t, t.participantId, participants),
  ],
);
