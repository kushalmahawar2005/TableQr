import "server-only";
import { and, asc, count, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { broadcastTemplatePayload, broadcastTemplateSignature, isBroadcastQuietTime } from "@/domain/broadcast";
import { normaliseIndianMobile } from "../broadcast";
import { tenantAccess } from "../access";
import { tenantFeatures } from "../plan";
import { activateCampaign, dueCampaigns, stopCampaign, templateSnapshot, type BroadcastTx } from "./campaigns";
import { openWhatsAppToken, metaConfig } from "./meta";
import { sendWhatsAppTemplate } from "./send";

/** Tenant row lock is always acquired before campaign/account/recipient locks. */
async function refundOne(tx: BroadcastTx, tenantId: string, campaignId: string, recipientId: string, code: string, now: Date) {
  const [tenant] = await tx.select({ balance: s.tenants.messageCredits }).from(s.tenants).where(eq(s.tenants.id, tenantId));
  const balance = tenant.balance + 1;
  await tx.update(s.tenants).set({ messageCredits: balance }).where(eq(s.tenants.id, tenantId));
  await tx.update(s.broadcastRecipients).set({ status: code === "CONSENT_OR_FREQUENCY" ? "skipped" : "failed", refunded: true, errorCode: code, errorText: code === "CONSENT_OR_FREQUENCY" ? "Consent, phone or frequency eligibility changed before sending" : "WhatsApp rejected this message before accepting it" }).where(and(eq(s.broadcastRecipients.tenantId, tenantId), eq(s.broadcastRecipients.id, recipientId)));
  await tx.insert(s.messageCreditLedger).values({ tenantId, delta: 1, balanceAfter: balance, reason: "broadcast_refund", campaignId, actorLabel: "broadcast", note: `Unaccepted recipient ${recipientId}: ${code}`.slice(0, 200), createdAt: now });
}

async function claimRecipient(tenantId: string, campaignId: string, now: Date) {
  const allowed = (await tenantFeatures(tenantId)).broadcast && (await tenantAccess(tenantId, now)).state !== "blocked";
  return db.transaction(async (tx) => {
    const [tenant] = await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.id, tenantId)).for("update");
    if (!tenant) return null;
    let [campaign] = await tx.select().from(s.broadcastCampaigns).where(and(eq(s.broadcastCampaigns.tenantId, tenantId), eq(s.broadcastCampaigns.id, campaignId))).for("update");
    if (!campaign) return null;
    // Crashed/incomplete claims stay charged and are never automatically retried.
    await tx.update(s.broadcastRecipients).set({ status: "unknown", errorCode: "RESULT_UNKNOWN", errorText: "Sending stopped before its result was recorded, needs review" }).where(and(eq(s.broadcastRecipients.tenantId, tenantId), eq(s.broadcastRecipients.campaignId, campaignId), eq(s.broadcastRecipients.status, "sending"), lt(s.broadcastRecipients.attemptedAt, new Date(now.getTime() - 120_000))));
    if (!["scheduled", "sending"].includes(campaign.status)) return null;
    if (!allowed) { await stopCampaign(tx, campaign, "failed", "Broadcast access is paused for this restaurant", now); return null; }
    if (isBroadcastQuietTime(now, campaign.timezone) || (campaign.scheduledAt && campaign.scheduledAt > now)) return null;
    if (campaign.status === "scheduled") {
      // No nested transaction; a failed audience/credit validation leaves the schedule actionable.
      try { await activateCampaign(tx, campaign, now); }
      catch (error) {
        // Validation precedes inserts/debit in activateCampaign; unexpected DB failures roll back.
        const { AppError } = await import("../errors");
        if (!(error instanceof AppError)) throw error;
        await stopCampaign(tx, campaign, "failed", error.message, now); return null;
      }
      [campaign] = await tx.select().from(s.broadcastCampaigns).where(and(eq(s.broadcastCampaigns.tenantId, tenantId), eq(s.broadcastCampaigns.id, campaignId)));
    }
    const [template] = await tx.select().from(s.whatsappTemplates).where(and(eq(s.whatsappTemplates.tenantId, tenantId), eq(s.whatsappTemplates.id, campaign.templateId))).for("update");
    const [account] = template ? await tx.select().from(s.whatsappAccounts).where(and(eq(s.whatsappAccounts.tenantId, tenantId), eq(s.whatsappAccounts.id, template.accountId))).for("update") : [];
    if (!template || template.status !== "approved" || !account || account.status !== "connected" || broadcastTemplateSignature(templateSnapshot(template)) !== broadcastTemplateSignature(campaign.templateSnapshot)) {
      await stopCampaign(tx, campaign, "failed", "The WhatsApp connection or approved template changed", now); return null;
    }
    if (account.nextSendAt && account.nextSendAt > now) return null;
    let token: string;
    try { metaConfig(); token = openWhatsAppToken(tenantId, account.accessToken); }
    catch { await stopCampaign(tx, campaign, "failed", "WhatsApp credentials need reconnecting", now); return null; }
    const [recipient] = await tx.select().from(s.broadcastRecipients).where(and(eq(s.broadcastRecipients.tenantId, tenantId), eq(s.broadcastRecipients.campaignId, campaignId), eq(s.broadcastRecipients.status, "queued"))).orderBy(asc(s.broadcastRecipients.id)).limit(1).for("update");
    if (!recipient) {
      const unfinished = await tx.select({ status: s.broadcastRecipients.status, n: count() }).from(s.broadcastRecipients).where(and(eq(s.broadcastRecipients.tenantId, tenantId), eq(s.broadcastRecipients.campaignId, campaignId), inArray(s.broadcastRecipients.status, ["sending", "unknown"]))).groupBy(s.broadcastRecipients.status);
      if (!unfinished.some((row) => row.status === "sending" && Number(row.n))) {
        const unknown = unfinished.some((row) => row.status === "unknown" && Number(row.n));
        await tx.update(s.broadcastCampaigns).set({ status: unknown ? "failed" : "sent", finishedAt: now, failureReason: unknown ? "Some message results need review. Their credits remain reserved until acceptance is confirmed." : null }).where(and(eq(s.broadcastCampaigns.tenantId, tenantId), eq(s.broadcastCampaigns.id, campaignId)));
      }
      return null;
    }
    const aliases = [recipient.phone, `91${recipient.phone}`];
    const phoneMatches = inArray(sql<string>`regexp_replace(${s.guests.phone}, '[^0-9]', '')`, aliases);
    const guests = await tx.select().from(s.guests).where(and(eq(s.guests.tenantId, tenantId), phoneMatches)).orderBy(asc(s.guests.id)).for("update");
    const guest = guests.find((g) => g.id === recipient.guestId);
    const cutoff = new Date(now.getTime() - 2 * 86_400_000);
    if (!guest?.consentMarketing || normaliseIndianMobile(guest.phone) !== recipient.phone || guests.some((g) => !!g.marketingOptOutAt || (!!g.lastMarketingAt && g.lastMarketingAt >= cutoff))) {
      await refundOne(tx, tenantId, campaignId, recipient.id, "CONSENT_OR_FREQUENCY", now); return { kind: "skipped" as const };
    }
    let payload;
    try { payload = broadcastTemplatePayload(campaign.templateSnapshot!, campaign, { name: recipient.name }, recipient.id); }
    catch { await stopCampaign(tx, campaign, "failed", "Template values need review", now); return null; }
    // Persist before the external API call. Another worker cannot claim this recipient again.
    await tx.update(s.broadcastRecipients).set({ status: "sending", attemptedAt: now }).where(and(eq(s.broadcastRecipients.tenantId, tenantId), eq(s.broadcastRecipients.id, recipient.id)));
    // Conservatively hold the cap even on lost replies, across aliases and overlapping campaigns.
    await tx.update(s.guests).set({ lastMarketingAt: now }).where(and(eq(s.guests.tenantId, tenantId), phoneMatches));
    await tx.update(s.whatsappAccounts).set({ nextSendAt: new Date(now.getTime() + 1000) }).where(and(eq(s.whatsappAccounts.tenantId, tenantId), eq(s.whatsappAccounts.id, account.id)));
    return { kind: "send" as const, recipientId: recipient.id, phoneNumberId: account.phoneNumberId, accountId: account.id, token, payload: { ...payload, to: `91${recipient.phone}` } };
  });
}

export async function processBroadcastCampaign(tenantId: string, campaignId: string, now = new Date()) {
  const claim = await claimRecipient(tenantId, campaignId, now);
  if (!claim || claim.kind === "skipped") return claim?.kind ?? "waiting";
  // The claim is the cancellation boundary: an already claimed request can finish after cancel.
  const result = await sendWhatsAppTemplate(claim.phoneNumberId, claim.token, claim.payload);
  await db.transaction(async (tx) => {
    await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.id, tenantId)).for("update");
    const [campaign] = await tx.select().from(s.broadcastCampaigns).where(and(eq(s.broadcastCampaigns.tenantId, tenantId), eq(s.broadcastCampaigns.id, campaignId))).for("update");
    const [recipient] = await tx.select().from(s.broadcastRecipients).where(and(eq(s.broadcastRecipients.tenantId, tenantId), eq(s.broadcastRecipients.id, claim.recipientId))).for("update");
    if (!campaign || !recipient || !["sending", "unknown"].includes(recipient.status)) return;
    if (result.kind === "accepted") {
      await tx.update(s.broadcastRecipients).set({ status: "sent", waMessageId: result.messageId, sentAt: now, errorCode: null, errorText: null }).where(and(eq(s.broadcastRecipients.tenantId, tenantId), eq(s.broadcastRecipients.id, recipient.id)));
      await tx.update(s.broadcastCampaigns).set({ creditsUsed: sql`${s.broadcastCampaigns.creditsUsed} + 1` }).where(and(eq(s.broadcastCampaigns.tenantId, tenantId), eq(s.broadcastCampaigns.id, campaignId)));
    } else if (result.kind === "rejected") {
      await refundOne(tx, tenantId, campaignId, recipient.id, result.code, now);
      if (result.throttled) await tx.update(s.whatsappAccounts).set({ nextSendAt: new Date(now.getTime() + 60_000) }).where(and(eq(s.whatsappAccounts.tenantId, tenantId), eq(s.whatsappAccounts.id, claim.accountId)));
      if (result.fatal && campaign.status === "sending") await stopCampaign(tx, campaign, "failed", `WhatsApp rejected sending (code ${result.code}); reconnect or review the template`, now);
    } else {
      await tx.update(s.broadcastRecipients).set({ status: "unknown", errorCode: "RESULT_UNKNOWN", errorText: "WhatsApp may have accepted this message. No automatic retry or refund." }).where(and(eq(s.broadcastRecipients.tenantId, tenantId), eq(s.broadcastRecipients.id, recipient.id)));
    }
  });
  return result.kind;
}

/** Bounded cron batch. The database applies the account-wide one-message/second safety cap. */
export async function processBroadcastBatch() {
  const started = Date.now();
  const scopes = await dueCampaigns(new Date());
  const totals = { accepted: 0, rejected: 0, unknown: 0, skipped: 0, errors: 0 };
  for (let round = 0; round < 15 && Date.now() - started < 35_000; round++) {
    let progressed = false;
    for (const scope of scopes) {
      if (Date.now() - started >= 35_000) break;
      try {
        const result = await processBroadcastCampaign(scope.tenantId, scope.id);
        if (result !== "waiting") { totals[result]++; progressed = true; }
      } catch { totals.errors++; }
    }
    if (!progressed) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return totals;
}
