import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { normaliseIndianMobile } from "../broadcast";
import { openWhatsAppToken } from "./meta";
import { sendOptOutAcknowledgement } from "./send";

type PendingReply = { tenantId: string; phoneNumberId: string; token: string; phone: string };
const words = new Set(["stop", "unsubscribe", "band karo"]);
const stamp = (value: unknown) => {
  const n = typeof value === "string" && /^\d{1,12}$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(n) ? new Date(n * 1000) : new Date();
};

export function verifyWhatsAppSignature(raw: string, signature: string | null, secret = process.env.WHATSAPP_APP_SECRET ?? "") {
  if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature) || !secret) return false;
  const supplied = Buffer.from(signature.slice(7), "hex");
  const expected = createHmac("sha256", secret).update(raw, "utf8").digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function updateStatus(tenantId: string, item: Record<string, unknown>, now: Date) {
  const wamid = typeof item.id === "string" ? item.id.slice(0, 80) : "";
  const opaque = typeof item.biz_opaque_callback_data === "string" ? item.biz_opaque_callback_data : "";
  if (!wamid && !/^[0-9a-f-]{36}$/i.test(opaque)) return;
  const rawStatus = typeof item.status === "string" ? item.status.toLowerCase() : "";
  if (!["sent", "delivered", "read", "failed"].includes(rawStatus)) return;
  const errors = Array.isArray(item.errors) ? item.errors[0] as Record<string, unknown> | undefined : undefined;
  const errCode = errors && (typeof errors.code === "number" || typeof errors.code === "string") ? String(errors.code).slice(0, 20) : null;
  const errText = errors && typeof errors.title === "string" ? errors.title.slice(0, 300) : rawStatus === "failed" ? "WhatsApp reported delivery failure after accepting the message" : null;
  const opaqueId = /^[0-9a-f-]{36}$/i.test(opaque) ? opaque : "";
  const [candidate] = opaqueId
    ? await db.select().from(s.broadcastRecipients).where(and(eq(s.broadcastRecipients.tenantId, tenantId), eq(s.broadcastRecipients.id, opaqueId)))
    : wamid ? await db.select().from(s.broadcastRecipients).where(and(eq(s.broadcastRecipients.tenantId, tenantId), eq(s.broadcastRecipients.waMessageId, wamid))) : [];
  if (!candidate) return;
  await db.transaction(async (tx) => {
    await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.id, tenantId)).for("update");
    await tx.select({ id: s.broadcastCampaigns.id }).from(s.broadcastCampaigns).where(and(eq(s.broadcastCampaigns.tenantId, tenantId), eq(s.broadcastCampaigns.id, candidate.campaignId))).for("update");
    const [recipient] = await tx.select().from(s.broadcastRecipients).where(and(eq(s.broadcastRecipients.tenantId, tenantId), eq(s.broadcastRecipients.id, candidate.id))).for("update");
    if (!recipient || ["failed", "skipped"].includes(recipient.status)) return;
    const status = rawStatus as "sent" | "delivered" | "read" | "failed";
    const rank = { unknown: 0, sending: 0, sent: 1, delivered: 2, read: 3, failed: 4 } as const;
    const oldRank = rank[recipient.status as keyof typeof rank] ?? -1;
    const nextRank = rank[status];
    if (status === "failed" && ["delivered", "read"].includes(recipient.status)) return;
    if (status !== "failed" && oldRank >= nextRank) return;
    if (recipient.waMessageId && wamid && recipient.waMessageId !== wamid) return;
    // A webhook can be the first evidence that an ambiguous API request was accepted.
    if (["unknown", "sending"].includes(recipient.status)) {
      await tx.update(s.broadcastCampaigns).set({ creditsUsed: sql`${s.broadcastCampaigns.creditsUsed} + 1` }).where(and(eq(s.broadcastCampaigns.tenantId, tenantId), eq(s.broadcastCampaigns.id, recipient.campaignId)));
    }
    await tx.update(s.broadcastRecipients).set({
      status,
      waMessageId: recipient.waMessageId ?? (wamid || null),
      ...(status === "sent" || status === "delivered" || status === "read" ? { sentAt: recipient.sentAt ?? stamp(item.timestamp) } : {}),
      ...(status === "delivered" ? { deliveredAt: stamp(item.timestamp) } : {}),
      ...(status === "read" ? { deliveredAt: recipient.deliveredAt ?? stamp(item.timestamp), readAt: stamp(item.timestamp) } : {}),
      errorCode: status === "failed" ? errCode : null,
      errorText: status === "failed" ? errText : null,
    }).where(and(eq(s.broadcastRecipients.tenantId, tenantId), eq(s.broadcastRecipients.id, recipient.id)));
    const [campaign] = await tx.select().from(s.broadcastCampaigns).where(and(eq(s.broadcastCampaigns.tenantId, tenantId), eq(s.broadcastCampaigns.id, recipient.campaignId))).for("update");
    if (campaign?.status === "failed" && campaign.failureReason?.includes("results need review")) {
      const [remaining] = await tx.select({ id: s.broadcastRecipients.id }).from(s.broadcastRecipients).where(and(eq(s.broadcastRecipients.tenantId, tenantId), eq(s.broadcastRecipients.campaignId, campaign.id), inArray(s.broadcastRecipients.status, ["unknown", "sending", "queued"]))).limit(1);
      if (!remaining) await tx.update(s.broadcastCampaigns).set({ status: "sent", finishedAt: now, failureReason: null }).where(and(eq(s.broadcastCampaigns.tenantId, tenantId), eq(s.broadcastCampaigns.id, campaign.id)));
    }
  });
}

async function optOut(tenantId: string, account: typeof s.whatsappAccounts.$inferSelect, rawPhone: string, now: Date): Promise<PendingReply | null> {
  const canonical = normaliseIndianMobile(rawPhone);
  if (!canonical) return null;
  return db.transaction(async (tx) => {
    await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.id, tenantId)).for("update");
    const variants = [canonical, `91${canonical}`];
    const matches = await tx.select().from(s.guests).where(and(eq(s.guests.tenantId, tenantId), inArray(sql<string>`regexp_replace(${s.guests.phone}, '[^0-9]', '')`, variants))).orderBy(asc(s.guests.id)).for("update");
    const pending = matches.some((g) => !g.marketingOptOutAt && !g.marketingOptOutReplyAt);
    await tx.update(s.guests).set({ marketingOptOutAt: now, ...(pending ? { marketingOptOutReplyAt: now } : {}) }).where(and(eq(s.guests.tenantId, tenantId), inArray(sql<string>`regexp_replace(${s.guests.phone}, '[^0-9]', '')`, variants), isNull(s.guests.marketingOptOutAt)));
    if (!pending) return null;
    try { return { tenantId, phoneNumberId: account.phoneNumberId, token: openWhatsAppToken(tenantId, account.accessToken), phone: `91${canonical}` }; }
    catch { return null; }
  });
}

async function templateEvent(wabaId: string, value: Record<string, unknown>) {
  const id = typeof value.message_template_id === "string" ? value.message_template_id : "";
  const event = typeof value.event === "string" ? value.event.toUpperCase() : "";
  if (!id || !["APPROVED", "REJECTED", "PAUSED", "DISABLED", "PENDING", "IN_APPEAL"].includes(event)) return;
  // isolation-exempt: verified WABA callbacks identify the tenant before tenant-scoped template mutation.
  const [account] = await db.select().from(s.whatsappAccounts).where(and(eq(s.whatsappAccounts.wabaId, wabaId), inArray(s.whatsappAccounts.status, ["connected", "error"])));
  if (!account) return;
  const status = event === "APPROVED" ? "approved" : event === "REJECTED" ? "rejected" : event === "PAUSED" ? "paused" : event === "DISABLED" ? "disabled" : "pending";
  await db.update(s.whatsappTemplates).set({ status, rejectionReason: typeof value.reason === "string" ? value.reason.slice(0, 300) : null }).where(and(eq(s.whatsappTemplates.tenantId, account.tenantId), eq(s.whatsappTemplates.accountId, account.id), eq(s.whatsappTemplates.metaTemplateId, id)));
}

/** Process one signature-verified Meta webhook. PII is processed but never logged or retained. */
export async function processWhatsAppWebhook(payload: unknown, now = new Date()) {
  let processed = 0;
  const replies: PendingReply[] = [];
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as Record<string, unknown>).entry)) throw new Error("Invalid webhook payload");
  for (const entry of (payload as { entry: unknown[] }).entry) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const wabaId = typeof e.id === "string" ? e.id : "";
    if (!Array.isArray(e.changes)) continue;
    for (const change of e.changes) {
      if (!change || typeof change !== "object") continue;
      const c = change as Record<string, unknown>;
      const value = c.value && typeof c.value === "object" ? c.value as Record<string, unknown> : {};
      if (c.field === "message_template_status_update") {
        await templateEvent(wabaId, value); processed++;
        continue;
      }
      if (c.field !== "messages" || !value.metadata || typeof value.metadata !== "object") continue;
      const phoneNumberId = (value.metadata as Record<string, unknown>).phone_number_id;
      if (typeof phoneNumberId !== "string") continue;
      // isolation-exempt: verified WABA and its globally unique phone-number ID route to the tenant first.
      const [account] = await db.select().from(s.whatsappAccounts).where(and(eq(s.whatsappAccounts.phoneNumberId, phoneNumberId), eq(s.whatsappAccounts.wabaId, wabaId), inArray(s.whatsappAccounts.status, ["connected", "error"])));
      if (!account) continue;
      for (const item of Array.isArray(value.statuses) ? value.statuses : []) {
        if (!item || typeof item !== "object") continue;
        const status = item as Record<string, unknown>;
        await updateStatus(account.tenantId, status, now); processed++;
      }
      for (const item of Array.isArray(value.messages) ? value.messages : []) {
        if (!item || typeof item !== "object") continue;
        const message = item as Record<string, unknown>;
        const textBody = message.text && typeof message.text === "object" ? (message.text as Record<string, unknown>).body : "";
        const command = typeof textBody === "string" ? textBody.trim().toLowerCase() : "";
        if (!words.has(command) || typeof message.from !== "string") continue;
        const reply = await optOut(account.tenantId, account, message.from, now);
        if (reply) replies.push(reply);
        processed++;
      }
    }
  }
  for (const reply of replies) await sendOptOutAcknowledgement(reply.phoneNumberId, reply.token, reply.phone);
  return { processed };
}
