import {
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
    serviceChargePaise: int("service_charge_paise").notNull().default(0),
    tipPaise: int("tip_paise").notNull().default(0),
    roundOffPaise: int("round_off_paise").notNull().default(0),
    totalPaise: int("total_paise").notNull().default(0),
    /** Tax by rate, e.g. { "500": 9950 } */
    taxBreakup: json("tax_breakup").$type<Record<string, number>>(),
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
    tenantKey("bills", t),
    sameTenant("fk_bills_outlet", t, t.outletId, outlets),
    sameTenant("fk_bills_session", t, t.sessionId, tableSessions),
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
    takenByUserId: ref("taken_by_user_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payments_outlet_created_idx").on(t.outletId, t.createdAt),
    index("payments_status_idx").on(t.status, t.updatedAt),
    uniqueIndex("payments_gateway_ref_uq").on(t.channel, t.gatewayRef),
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
    amountPaise: int("amount_paise").notNull(),
    reason: varchar("reason", { length: 200 }).notNull(),
    byUserId: ref("by_user_id"),
    status: mysqlEnum("status", ["pending", "success", "failed"]).notNull().default("pending"),
    gatewayRef: varchar("gateway_ref", { length: 100 }),
    createdAt: createdAt(),
  },
  (t) => [
    sameTenant("fk_refunds_payment", t, t.paymentId, payments),
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
    /** e.g. SRJ01/26-27/000123 */
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
    createdAt: createdAt(),
  },
  (t) => [
    index("feedback_outlet_created_idx").on(t.outletId, t.createdAt),
    sameTenant("fk_feedback_outlet", t, t.outletId, outlets),
    sameTenant("fk_feedback_session", t, t.sessionId, tableSessions),
    sameTenant("fk_feedback_participant", t, t.participantId, participants),
  ],
);
