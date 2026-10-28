"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { staffFor } from "@/server/staff/request";
import { requireFeature } from "@/server/plan";
import { AppError } from "@/server/errors";
import { connectWhatsApp, disconnectWhatsApp, submitWhatsAppTemplate, syncWhatsAppTemplates } from "@/server/whatsapp/accounts";
import { cancelBroadcastCampaign, createBroadcastCampaign, startDraftCampaign, type CampaignInput } from "@/server/whatsapp/campaigns";
import { previewBroadcastAudience } from "@/server/broadcast";
import { storeBroadcastPhoto } from "@/server/whatsapp/media";
import { reconcileMessageCreditPurchase, startMessageCreditPurchase } from "@/server/whatsapp/credits";
import { publicOrigin } from "@/server/guest/invite";
import type { BroadcastSegment } from "@/db/schema/broadcast";
import type { StaffSession } from "@/server/staff/auth";

async function run<T>(work: (tenantId: string, staff: StaffSession) => Promise<T>, refresh = true) {
  try {
    const staff = await staffFor(["owner", "manager"], "broadcasts");
    await requireFeature(staff.tenantId, "broadcast");
    const data = await work(staff.tenantId, staff);
    if (refresh) revalidatePath("/console/broadcasts");
    return { error: null, data };
  } catch (error) {
    return { error: error instanceof AppError ? error.message : "WhatsApp could not complete this. Please refresh and try again.", data: null };
  }
}
export async function connectWhatsAppAction(input: { code: string; wabaId: string; phoneNumberId: string; pin: string }) { return run((tenantId) => connectWhatsApp(tenantId, input)); }
export async function disconnectWhatsAppAction() { return run(disconnectWhatsApp); }
export async function syncWhatsAppTemplatesAction() { return run(syncWhatsAppTemplates); }
export async function submitWhatsAppTemplateAction(input: { name: string; language: string; body: string; examples: string[]; header: "none" | "image" | "video"; headerExample?: string }) { return run((tenantId) => submitWhatsAppTemplate(tenantId, input)); }
export async function previewCampaignAudienceAction(segment: BroadcastSegment) {
  return run(async (tenantId, staff) => {
    if (!staff.roles.includes("owner") && segment.outletId !== staff.outletId) throw new AppError("forbidden", "Choose your current outlet.");
    const result = await previewBroadcastAudience(tenantId, { segment, timezone: staff.outlet.timezone });
    return { count: result.count, credits: result.credits };
  }, false);
}
export async function createCampaignAction(input: CampaignInput) { return run((_, staff) => createBroadcastCampaign(staff, input)); }
export async function cancelCampaignAction(campaignId: string) { return run((_, staff) => cancelBroadcastCampaign(staff, campaignId)); }
export async function startDraftAction(campaignId: string) { return run((_, staff) => startDraftCampaign(staff, campaignId)); }
export async function uploadBroadcastPhotoAction(form: FormData) {
  return run(async (tenantId) => {
    const file = form.get("photo");
    if (!(file instanceof File)) throw new AppError("invalid_state", "Choose a photo first.");
    return storeBroadcastPhoto(tenantId, file);
  });
}
export async function buyMessageCreditsAction(input: { credits: number; requestId: string }) {
  return run(async (_tenantId, staff) => startMessageCreditPurchase(staff, { ...input, callbackUrl: `${publicOrigin(await headers())}/api/fees/return?p=PLACEHOLDER` }));
}
export async function refreshMessageCreditPurchaseAction(id: string) {
  return run((tenantId) => reconcileMessageCreditPurchase(id, new Date(), tenantId));
}
