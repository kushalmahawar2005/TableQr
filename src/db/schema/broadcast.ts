import { boolean, char, index, int, json, mysqlEnum, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { at, createdAt, id, ref, sameTenant, tenantId, tenantKey, updatedAt } from "./_columns";
import { guests } from "./sessions";
import { feePayments, outlets, tenants, users } from "./tenancy";

// WhatsApp broadcasts (docs/BROADCAST-MODEL.md): each restaurant sends approved templates from its
// own WhatsApp Business number; Tableeqr charges prepaid credits, one per recipient message.

export const whatsappAccountStatuses = ["connected", "disconnected", "error"] as const;

/** The restaurant's own WhatsApp Business number, connected through Meta Embedded Signup */
export const whatsappAccounts = mysqlTable(
  "whatsapp_accounts",
  {
    id: id(),
    tenantId: tenantId(),
    wabaId: varchar("waba_id", { length: 40 }).notNull(),
    phoneNumberId: varchar("phone_number_id", { length: 40 }).notNull(),
    displayPhone: varchar("display_phone", { length: 30 }),
    verifiedName: varchar("verified_name", { length: 120 }),
    /** AES-GCM sealed business token; never sent to a browser */
    accessToken: text("access_token").notNull(),
    status: mysqlEnum("status", whatsappAccountStatuses).notNull().default("connected"),
    qualityRating: varchar("quality_rating", { length: 20 }),
    messagingTier: varchar("messaging_tier", { length: 30 }),
    lastError: varchar("last_error", { length: 300 }),
    nextSendAt: at("next_send_at"),
    connectedAt: at("connected_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("whatsapp_accounts_tenant_uq").on(t.tenantId),
    uniqueIndex("whatsapp_accounts_phone_uq").on(t.phoneNumberId),
    tenantKey("whatsapp_accounts", t),
  ],
);

export const templateCategories = ["MARKETING", "UTILITY"] as const;
export const templateHeaders = ["none", "image", "video"] as const;
export const templateStatuses = ["draft", "pending", "approved", "rejected", "paused", "disabled"] as const;

export type TemplateButton = { type: "URL" | "QUICK_REPLY" | "COPY_CODE"; text: string; url?: string };

/** A message template; Meta must approve it before a broadcast can use it */
export const whatsappTemplates = mysqlTable(
  "whatsapp_templates",
  {
    id: id(),
    tenantId: tenantId(),
    accountId: ref("account_id").notNull(),
    metaTemplateId: varchar("meta_template_id", { length: 40 }),
    name: varchar("name", { length: 512 }).notNull(),
    language: varchar("language", { length: 10 }).notNull().default("en"),
    category: mysqlEnum("category", templateCategories).notNull().default("MARKETING"),
    header: mysqlEnum("header", templateHeaders).notNull().default("none"),
    /** Body text with {{1}}, {{2}} … placeholders */
    body: text("body").notNull(),
    footer: varchar("footer", { length: 60 }),
    buttons: json("buttons").$type<TemplateButton[]>(),
    status: mysqlEnum("status", templateStatuses).notNull().default("draft"),
    rejectionReason: varchar("rejection_reason", { length: 300 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("whatsapp_templates_name_uq").on(t.tenantId, t.accountId, t.name, t.language),
    tenantKey("whatsapp_templates", t),
    sameTenant("fk_whatsapp_templates_account", t, t.accountId, whatsappAccounts),
  ],
);

export const campaignStatuses = ["draft", "scheduled", "sending", "sent", "cancelled", "failed"] as const;

/** Who a campaign goes to; every rule must match. Consent, opt-out and the frequency cap always apply. */
export type BroadcastSegment = {
  outletId?: string | null;
  visitedWithinDays?: number | null;
  notSeenForDays?: number | null;
  minSpendPaise?: number | null;
  minVisits?: number | null;
  firstTimersOnly?: boolean;
  birthday?: "week" | "month" | null;
  channel?: "dine_in" | "delivery" | "booking" | null;
};

export type BroadcastTemplateSnapshot = {
  name: string; language: string; body: string; header: "none" | "image" | "video";
  buttons: TemplateButton[] | null;
};

export const broadcastCampaigns = mysqlTable(
  "broadcast_campaigns",
  {
    id: id(),
    tenantId: tenantId(),
    name: varchar("name", { length: 120 }).notNull(),
    templateId: ref("template_id").notNull(),
    outletId: ref("outlet_id"),
    headerMediaUrl: varchar("header_media_url", { length: 500 }),
    /** Values for {{1}}, {{2}} …; "{name}" is replaced with the guest's first name */
    variables: json("variables").$type<string[]>().notNull(),
    offerCode: varchar("offer_code", { length: 30 }),
    linkUrl: varchar("link_url", { length: 500 }),
    segment: json("segment").$type<BroadcastSegment>().notNull(),
    status: mysqlEnum("status", campaignStatuses).notNull().default("draft"),
    scheduledAt: at("scheduled_at"),
    startedAt: at("started_at"),
    finishedAt: at("finished_at"),
    audienceCount: int("audience_count").notNull().default(0),
    creditsReserved: int("credits_reserved").notNull().default(0),
    creditsUsed: int("credits_used").notNull().default(0),
    createdBy: ref("created_by"),
    /** Browser request key makes a lost create/start response safe to retry. */
    requestId: varchar("request_id", { length: 64 }),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }),
    /** Owner-approved maximum; a scheduled audience must not grow past this silently. */
    audienceLimit: int("audience_limit").notNull().default(0),
    timezone: varchar("timezone", { length: 40 }).notNull().default("Asia/Kolkata"),
    templateSnapshot: json("template_snapshot").$type<BroadcastTemplateSnapshot>(),
    failureReason: varchar("failure_reason", { length: 300 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("broadcast_campaigns_due_idx").on(t.status, t.scheduledAt),
    index("broadcast_campaigns_tenant_idx").on(t.tenantId, t.createdAt),
    uniqueIndex("broadcast_campaigns_request_uq").on(t.tenantId, t.requestId),
    tenantKey("broadcast_campaigns", t),
    sameTenant("fk_broadcast_campaigns_template", t, t.templateId, whatsappTemplates),
    sameTenant("fk_broadcast_campaigns_outlet", t, t.outletId, outlets),
    sameTenant("fk_broadcast_campaigns_by", t, t.createdBy, users),
  ],
);

export const recipientStatuses = ["queued", "sending", "unknown", "sent", "delivered", "read", "failed", "skipped"] as const;

/** The frozen audience: one row per guest per campaign */
export const broadcastRecipients = mysqlTable(
  "broadcast_recipients",
  {
    id: id(),
    tenantId: tenantId(),
    campaignId: ref("campaign_id").notNull(),
    guestId: ref("guest_id").notNull(),
    phone: varchar("phone", { length: 15 }).notNull(),
    name: varchar("name", { length: 80 }),
    status: mysqlEnum("status", recipientStatuses).notNull().default("queued"),
    waMessageId: varchar("wa_message_id", { length: 80 }),
    errorCode: varchar("error_code", { length: 20 }),
    errorText: varchar("error_text", { length: 300 }),
    /** True once its credit went back to the balance */
    refunded: boolean("refunded").notNull().default(false),
    attemptedAt: at("attempted_at"),
    sentAt: at("sent_at"),
    deliveredAt: at("delivered_at"),
    readAt: at("read_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("broadcast_recipients_guest_uq").on(t.campaignId, t.guestId),
    uniqueIndex("broadcast_recipients_phone_uq").on(t.campaignId, t.phone),
    uniqueIndex("broadcast_recipients_wamid_uq").on(t.waMessageId),
    index("broadcast_recipients_queue_idx").on(t.campaignId, t.status),
    tenantKey("broadcast_recipients", t),
    sameTenant("fk_broadcast_recipients_campaign", t, t.campaignId, broadcastCampaigns),
    sameTenant("fk_broadcast_recipients_guest", t, t.guestId, guests),
  ],
);

export const creditReasons = ["purchase", "grant", "adjust", "broadcast_reserve", "broadcast_refund"] as const;

/** Append-only; the balance is the sum, cached on tenants.message_credits */
export const messageCreditLedger = mysqlTable(
  "message_credit_ledger",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    delta: int("delta").notNull(),
    balanceAfter: int("balance_after").notNull(),
    reason: mysqlEnum("reason", creditReasons).notNull(),
    campaignId: ref("campaign_id"),
    outletId: ref("outlet_id"),
    feeId: ref("fee_id"),
    actorLabel: varchar("actor_label", { length: 80 }).notNull(),
    note: varchar("note", { length: 200 }),
    createdAt: createdAt(),
  },
  (t) => [
    index("message_credit_ledger_tenant_idx").on(t.tenantId, t.createdAt),
    sameTenant("fk_message_credit_ledger_campaign", t, t.campaignId, broadcastCampaigns),
    sameTenant("fk_message_credit_ledger_outlet", t, t.outletId, outlets),
    sameTenant("fk_message_credit_ledger_fee", t, t.feeId, feePayments),
  ],
);

/** Platform-wide service pricing. Missing row means online credit purchases are not enabled. */
export const messageCreditPricing = mysqlTable("message_credit_pricing", {
  id: char("id", { length: 20 }).primaryKey(),
  pricePerCreditPaise: int("price_per_credit_paise").notNull(),
  packSizes: json("pack_sizes").$type<number[]>().notNull(),
  lowBalanceThreshold: int("low_balance_threshold").notNull().default(20),
  updatedAt: updatedAt(),
});

export const messageCreditPurchases = mysqlTable("message_credit_purchases", {
  id: id(),
  tenantId: tenantId().references(() => tenants.id),
  credits: int("credits").notNull(),
  amountPaise: int("amount_paise").notNull(),
  status: mysqlEnum("status", ["claimed", "confirmed", "rejected"]).notNull().default("claimed"),
  requestId: varchar("request_id", { length: 64 }).notNull(),
  gatewayRef: varchar("gateway_ref", { length: 100 }),
  gatewayPaymentId: varchar("gateway_payment_id", { length: 100 }),
  failureReason: varchar("failure_reason", { length: 200 }),
  createdAt: createdAt(),
  settledAt: at("settled_at"),
}, (t) => [
  uniqueIndex("message_credit_purchases_request_uq").on(t.tenantId, t.requestId),
  uniqueIndex("message_credit_purchases_gateway_uq").on(t.gatewayRef),
  index("message_credit_purchases_tenant_created_idx").on(t.tenantId, t.createdAt),
  tenantKey("message_credit_purchases", t),
]);
