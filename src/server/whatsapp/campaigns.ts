import "server-only";
import { createHash } from "node:crypto";
import { and, asc, count, countDistinct, desc, eq, exists, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { uuidv7 } from "@/db/id";
import { localDateTimeValue, parseLocalDateTime } from "@/domain/booking-policy";
import { broadcastTemplatePayload, broadcastTemplateSignature, isBroadcastQuietTime, publicBroadcastUrl } from "@/domain/broadcast";
import { cleanSegment, MAX_AUDIENCE, previewBroadcastAudience } from "../broadcast";
import { AppError } from "../errors";
import { tenantAccess } from "../access";
import { requireFeature } from "../plan";
import type { StaffSession } from "../staff/auth";

export type BroadcastTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type CampaignInput = { requestId: string; name: string; templateId: string; outletId: string | null; variables: string[]; headerMediaUrl: string | null; offerCode: string | null; linkUrl: string | null; segment: s.BroadcastSegment; audienceLimit: number; intent: "draft" | "send" | "schedule"; scheduledLocal: string | null };
type Campaign = typeof s.broadcastCampaigns.$inferSelect;

export const templateSnapshot = (template: typeof s.whatsappTemplates.$inferSelect): s.BroadcastTemplateSnapshot => ({ name: template.name, language: template.language, body: template.body, header: template.header, buttons: template.buttons });
export async function broadcastWorkspace(staff: StaffSession) {
  const tenantId = staff.tenantId;
  const [tenant] = await db.select({ credits: s.tenants.messageCredits }).from(s.tenants).where(eq(s.tenants.id, tenantId));
  const campaigns = await db.select().from(s.broadcastCampaigns).where(and(eq(s.broadcastCampaigns.tenantId, tenantId), staff.roles.includes("owner") ? undefined : eq(s.broadcastCampaigns.outletId, staff.outletId))).orderBy(desc(s.broadcastCampaigns.createdAt)).limit(50);
  const ids = campaigns.map((c) => c.id);
  const counts = ids.length ? await db.select({ campaignId: s.broadcastRecipients.campaignId, status: s.broadcastRecipients.status, n: count() }).from(s.broadcastRecipients).where(and(eq(s.broadcastRecipients.tenantId, tenantId), inArray(s.broadcastRecipients.campaignId, ids))).groupBy(s.broadcastRecipients.campaignId, s.broadcastRecipients.status) : [];
  const reports = ids.length ? await db.select({ campaignId: s.broadcastCampaigns.id, optedOut: countDistinct(sql`case when ${s.guests.marketingOptOutAt} > ${s.broadcastCampaigns.startedAt} then ${s.broadcastRecipients.guestId} end`), returningGuests: countDistinct(sql`case when ${s.orders.placedAt} > ${s.broadcastCampaigns.startedAt} and ${s.orders.placedAt} < date_add(${s.broadcastCampaigns.startedAt}, interval 7 day) then ${s.broadcastRecipients.guestId} end`) }).from(s.broadcastCampaigns).leftJoin(s.broadcastRecipients, and(eq(s.broadcastRecipients.tenantId, s.broadcastCampaigns.tenantId), eq(s.broadcastRecipients.campaignId, s.broadcastCampaigns.id))).leftJoin(s.guests, and(eq(s.guests.tenantId, s.broadcastRecipients.tenantId), eq(s.guests.id, s.broadcastRecipients.guestId))).leftJoin(s.participants, and(eq(s.participants.tenantId, s.broadcastRecipients.tenantId), eq(s.participants.guestId, s.broadcastRecipients.guestId))).leftJoin(s.orders, and(eq(s.orders.tenantId, s.participants.tenantId), eq(s.orders.placedByParticipantId, s.participants.id))).where(and(eq(s.broadcastCampaigns.tenantId, tenantId), inArray(s.broadcastCampaigns.id, ids))).groupBy(s.broadcastCampaigns.id) : [];
  const offerReports = ids.length ? await db.select({ campaignId: s.broadcastOfferRedemptions.campaignId, redeemedBills: countDistinct(s.broadcastOfferRedemptions.billId) }).from(s.broadcastOfferRedemptions).innerJoin(s.broadcastRecipients, and(eq(s.broadcastRecipients.tenantId, s.broadcastOfferRedemptions.tenantId), eq(s.broadcastRecipients.id, s.broadcastOfferRedemptions.recipientId))).innerJoin(s.bills, and(eq(s.bills.tenantId, s.broadcastOfferRedemptions.tenantId), eq(s.bills.id, s.broadcastOfferRedemptions.billId))).where(and(eq(s.broadcastOfferRedemptions.tenantId, tenantId), inArray(s.broadcastOfferRedemptions.campaignId, ids), isNull(s.broadcastOfferRedemptions.reversedAt), eq(s.bills.status, "paid"), gt(s.bills.closedAt, s.broadcastRecipients.sentAt), lte(s.bills.closedAt, sql`date_add(${s.broadcastRecipients.sentAt}, interval 7 day)`))).groupBy(s.broadcastOfferRedemptions.campaignId) : [];
  const outlets = await db.select({ id: s.outlets.id, name: s.outlets.name, timezone: s.outlets.timezone }).from(s.outlets).where(and(eq(s.outlets.tenantId, tenantId), staff.roles.includes("owner") ? undefined : eq(s.outlets.id, staff.outletId))).orderBy(asc(s.outlets.name));
  return { credits: tenant?.credits ?? 0, outlets, campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status, audienceCount: c.audienceCount, creditsReserved: c.creditsReserved, creditsUsed: c.creditsUsed, scheduledAt: c.scheduledAt?.toISOString() ?? null, startedAt: c.startedAt?.toISOString() ?? null, timezone: c.timezone, failureReason: c.failureReason, report: { optedOut: Number(reports.find((r) => r.campaignId === c.id)?.optedOut ?? 0), returningGuests: Number(reports.find((r) => r.campaignId === c.id)?.returningGuests ?? 0), offerRedemptions: Number(offerReports.find((r) => r.campaignId === c.id)?.redeemedBills ?? 0) }, counts: Object.fromEntries(counts.filter((row) => row.campaignId === c.id).map((row) => [row.status, Number(row.n)])) })) };
}

/** Freezes recipients and debits credits in the caller's tenant/campaign-locked transaction. */
export async function activateCampaign(tx: BroadcastTx, campaign: Campaign, now: Date) {
  const tenantId = campaign.tenantId;
  if (campaign.creditsReserved > 0 || campaign.status === "sending") return;
  if (!["draft", "scheduled"].includes(campaign.status)) throw new AppError("invalid_state", "This campaign cannot be started.");
  const [template] = await tx.select().from(s.whatsappTemplates).where(and(eq(s.whatsappTemplates.tenantId, tenantId), eq(s.whatsappTemplates.id, campaign.templateId))).for("update");
  const [account] = template ? await tx.select({ id: s.whatsappAccounts.id }).from(s.whatsappAccounts).where(and(eq(s.whatsappAccounts.tenantId, tenantId), eq(s.whatsappAccounts.id, template.accountId), eq(s.whatsappAccounts.status, "connected"))).for("update") : [];
  if (!template || template.status !== "approved" || template.category !== "MARKETING" || !account) throw new AppError("invalid_state", "Connect WhatsApp and choose an approved marketing template.");
  if (broadcastTemplateSignature(templateSnapshot(template)) !== broadcastTemplateSignature(campaign.templateSnapshot)) throw new AppError("conflict", "The template changed. Create a new campaign after reviewing it.");
  const preview = await previewBroadcastAudience(tenantId, { segment: campaign.segment, now, timezone: campaign.timezone }, tx);
  if (!preview.count) throw new AppError("invalid_state", "No eligible customers remain for this campaign.");
  if (preview.count > campaign.audienceLimit) throw new AppError("conflict", "The audience grew beyond your approved maximum. Review it and create a new campaign.");
  const [tenant] = await tx.select({ balance: s.tenants.messageCredits }).from(s.tenants).where(eq(s.tenants.id, tenantId)).for("update");
  if (!tenant || tenant.balance < preview.count) throw new AppError("invalid_state", `This campaign needs ${preview.count} message credits. Add credits before sending.`);
  // All rows are new. Bounded chunks keep inserts below packet/placeholder limits.
  for (let offset = 0; offset < preview.audience.length; offset += 250) await tx.insert(s.broadcastRecipients).values(preview.audience.slice(offset, offset + 250).map((guest) => ({ tenantId, campaignId: campaign.id, guestId: guest.id, phone: guest.phone, name: guest.name, createdAt: now })));
  const balance = tenant.balance - preview.count;
  await tx.update(s.tenants).set({ messageCredits: balance }).where(eq(s.tenants.id, tenantId));
  await tx.insert(s.messageCreditLedger).values({ tenantId, delta: -preview.count, balanceAfter: balance, reason: "broadcast_reserve", campaignId: campaign.id, actorLabel: "broadcast", note: `${preview.count} frozen recipients`, createdAt: now });
  await tx.update(s.broadcastCampaigns).set({ status: "sending", audienceCount: preview.count, creditsReserved: preview.count, startedAt: now, failureReason: null }).where(and(eq(s.broadcastCampaigns.tenantId, tenantId), eq(s.broadcastCampaigns.id, campaign.id)));
}

export async function createBroadcastCampaign(staff: StaffSession, input: CampaignInput, now = new Date()) {
  const tenantId = staff.tenantId;
  await requireFeature(tenantId, "broadcast");
  if (!staff.roles.some((role) => role === "owner" || role === "manager")) throw new AppError("forbidden", "Only the owner or a manager can send campaigns.");
  if ((await tenantAccess(tenantId, now)).state === "blocked") throw new AppError("forbidden", "Restaurant access is paused.");
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(input.requestId) || !input.name?.trim() || input.name.length > 120 || !["draft", "send", "schedule"].includes(input.intent)) throw new AppError("invalid_state", "Campaign details are invalid.");
  if (!staff.roles.includes("owner") && input.outletId !== staff.outletId) throw new AppError("forbidden", "Choose your current outlet.");
  if (!Number.isSafeInteger(input.audienceLimit) || input.audienceLimit < 1 || input.audienceLimit > MAX_AUDIENCE) throw new AppError("invalid_state", "Preview the audience and confirm its maximum credit cost.");
  if (!Array.isArray(input.variables) || input.variables.length > 20 || input.variables.some((v) => typeof v !== "string" || v.length > 900)) throw new AppError("invalid_state", "Template values are invalid.");
  if (input.offerCode && !/^[a-zA-Z0-9_-]{1,30}$/.test(input.offerCode)) throw new AppError("invalid_state", "Offer code can contain up to 30 letters, numbers, hyphens or underscores.");
  for (const value of [input.headerMediaUrl, input.linkUrl]) if (value) { try { publicBroadcastUrl(value); if (value.length > 500) throw new Error(); } catch { throw new AppError("invalid_state", "Use a public HTTPS link shorter than 500 characters."); } }
  const segment = cleanSegment({ ...input.segment, outletId: input.outletId });
  const fingerprint = createHash("sha256").update(JSON.stringify({ ...input, segment })).digest("hex");
  return db.transaction(async (tx) => {
    await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.id, tenantId)).for("update");
    const [existing] = await tx.select().from(s.broadcastCampaigns).where(and(eq(s.broadcastCampaigns.tenantId, tenantId), eq(s.broadcastCampaigns.requestId, input.requestId)));
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) throw new AppError("conflict", "This request already created a different campaign. Refresh before trying again.");
      return existing.id;
    }
    const [outlet] = await tx.select({ timezone: s.outlets.timezone }).from(s.outlets).where(and(eq(s.outlets.tenantId, tenantId), eq(s.outlets.id, input.outletId ?? staff.outletId)));
    if (!outlet) throw new AppError("not_found", "Outlet not found.");
    const [template] = await tx.select().from(s.whatsappTemplates).where(and(eq(s.whatsappTemplates.tenantId, tenantId), eq(s.whatsappTemplates.id, input.templateId))).for("update");
    if (!template || template.status !== "approved" || template.category !== "MARKETING") throw new AppError("invalid_state", "Choose an approved marketing template.");
    const snapshot = templateSnapshot(template);
    try { broadcastTemplatePayload(snapshot, input, { name: "Customer" }, "preview"); } catch (error) { throw new AppError("invalid_state", error instanceof Error ? error.message : "Check the template values."); }
    const scheduledAt = input.intent === "schedule" ? parseLocalDateTime(input.scheduledLocal ?? "", outlet.timezone) : now;
    if (!scheduledAt || (input.intent === "schedule" && (scheduledAt <= now || scheduledAt.getTime() > now.getTime() + 365 * 86_400_000 || localDateTimeValue(scheduledAt, outlet.timezone) !== input.scheduledLocal))) throw new AppError("invalid_state", "Choose a future schedule within one year, using the outlet's time zone.");
    const campaignId = uuidv7();
    const values = { id: campaignId, tenantId, name: input.name.trim(), templateId: template.id, outletId: input.outletId, variables: input.variables, headerMediaUrl: input.headerMediaUrl || null, offerCode: input.offerCode || null, linkUrl: input.linkUrl || null, segment, requestId: input.requestId, requestFingerprint: fingerprint, audienceLimit: input.audienceLimit, timezone: outlet.timezone, templateSnapshot: snapshot, status: input.intent === "draft" ? "draft" as const : "scheduled" as const, scheduledAt: input.intent === "draft" ? null : scheduledAt, createdBy: staff.userId, createdAt: now, updatedAt: now };
    await tx.insert(s.broadcastCampaigns).values({ ...values, tenantId });
    if (input.intent === "send" && !isBroadcastQuietTime(now, outlet.timezone)) await activateCampaign(tx, { ...values, audienceCount: 0, creditsReserved: 0, creditsUsed: 0, startedAt: null, finishedAt: null, failureReason: null }, now);
    await tx.insert(s.auditLog).values({ tenantId, actorUserId: staff.userId, actorLabel: `staff:${staff.name}`.slice(0, 80), action: "broadcast.created", entity: "broadcast_campaign", entityId: campaignId, after: { intent: input.intent, maximumCredits: input.audienceLimit }, createdAt: now });
    return campaignId;
  });
}

/** Called under tenant/campaign locks. Only an unsent queue is refundable. */
export async function stopCampaign(tx: BroadcastTx, campaign: Campaign, status: "cancelled" | "failed", reason: string, now: Date) {
  const tenantId = campaign.tenantId;
  const queued = await tx.select({ id: s.broadcastRecipients.id }).from(s.broadcastRecipients).where(and(eq(s.broadcastRecipients.tenantId, tenantId), eq(s.broadcastRecipients.campaignId, campaign.id), eq(s.broadcastRecipients.status, "queued"), eq(s.broadcastRecipients.refunded, false), isNull(s.broadcastRecipients.waMessageId))).for("update");
  if (queued.length && campaign.creditsReserved > 0) {
    const [tenant] = await tx.select({ balance: s.tenants.messageCredits }).from(s.tenants).where(eq(s.tenants.id, tenantId)).for("update");
    const balance = tenant.balance + queued.length;
    await tx.update(s.tenants).set({ messageCredits: balance }).where(eq(s.tenants.id, tenantId));
    await tx.update(s.broadcastRecipients).set({ status: "skipped", refunded: true, errorCode: "CAMPAIGN_STOPPED", errorText: reason.slice(0, 300) }).where(and(eq(s.broadcastRecipients.tenantId, tenantId), eq(s.broadcastRecipients.campaignId, campaign.id), eq(s.broadcastRecipients.status, "queued"), eq(s.broadcastRecipients.refunded, false)));
    await tx.insert(s.messageCreditLedger).values({ tenantId, delta: queued.length, balanceAfter: balance, reason: "broadcast_refund", campaignId: campaign.id, actorLabel: "broadcast", note: reason.slice(0, 200), createdAt: now });
  }
  await tx.update(s.broadcastCampaigns).set({ status, finishedAt: now, failureReason: reason.slice(0, 300) }).where(and(eq(s.broadcastCampaigns.tenantId, tenantId), eq(s.broadcastCampaigns.id, campaign.id)));
}

export async function cancelBroadcastCampaign(staff: StaffSession, campaignId: string, now = new Date()) {
  if (!staff.roles.some((role) => role === "owner" || role === "manager")) throw new AppError("forbidden", "Only the owner or a manager can cancel campaigns.");
  const tenantId = staff.tenantId;
  await db.transaction(async (tx) => {
    await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.id, tenantId)).for("update");
    const [campaign] = await tx.select().from(s.broadcastCampaigns).where(and(eq(s.broadcastCampaigns.tenantId, tenantId), eq(s.broadcastCampaigns.id, campaignId))).for("update");
    if (!campaign || (!staff.roles.includes("owner") && campaign.outletId !== staff.outletId)) throw new AppError("not_found", "Campaign not found.");
    if (["cancelled", "failed", "sent"].includes(campaign.status)) return;
    await stopCampaign(tx, campaign, "cancelled", "Cancelled by restaurant staff", now);
    await tx.insert(s.auditLog).values({ tenantId, actorUserId: staff.userId, actorLabel: `staff:${staff.name}`.slice(0, 80), action: "broadcast.cancelled", entity: "broadcast_campaign", entityId: campaignId, createdAt: now });
  });
}

export async function dueCampaigns(now: Date) {
  // isolation-exempt: authenticated system worker enumerates due campaign scopes; mutations always include tenantId.
  return db.select({ id: s.broadcastCampaigns.id, tenantId: s.broadcastCampaigns.tenantId }).from(s.broadcastCampaigns).where(or(
    and(eq(s.broadcastCampaigns.status, "scheduled"), lte(s.broadcastCampaigns.scheduledAt, now)),
    eq(s.broadcastCampaigns.status, "sending"),
    and(inArray(s.broadcastCampaigns.status, ["cancelled", "failed"]), exists(db.select({ id: s.broadcastRecipients.id }).from(s.broadcastRecipients).where(and(eq(s.broadcastRecipients.tenantId, s.broadcastCampaigns.tenantId), eq(s.broadcastRecipients.campaignId, s.broadcastCampaigns.id), eq(s.broadcastRecipients.status, "sending"), lt(s.broadcastRecipients.attemptedAt, new Date(now.getTime() - 120_000)))))),
  )).orderBy(asc(s.broadcastCampaigns.updatedAt)).limit(100);
}

export async function startDraftCampaign(staff: StaffSession, campaignId: string, now = new Date()) {
  const tenantId = staff.tenantId;
  await requireFeature(tenantId, "broadcast");
  if (!staff.roles.some((r) => r === "owner" || r === "manager") || (await tenantAccess(tenantId, now)).state === "blocked") throw new AppError("forbidden", "Campaign sending is not available.");
  await db.transaction(async (tx) => {
    await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.id, tenantId)).for("update");
    const [campaign] = await tx.select().from(s.broadcastCampaigns).where(and(eq(s.broadcastCampaigns.tenantId, tenantId), eq(s.broadcastCampaigns.id, campaignId))).for("update");
    if (!campaign || (!staff.roles.includes("owner") && campaign.outletId !== staff.outletId)) throw new AppError("not_found", "Campaign not found.");
    if (campaign.status !== "draft") return;
    if (isBroadcastQuietTime(now, campaign.timezone)) await tx.update(s.broadcastCampaigns).set({ status: "scheduled", scheduledAt: now }).where(and(eq(s.broadcastCampaigns.tenantId, tenantId), eq(s.broadcastCampaigns.id, campaignId)));
    else await activateCampaign(tx, campaign, now);
  });
}
