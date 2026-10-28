import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { connectWhatsApp, disconnectWhatsApp, submitWhatsAppTemplate, syncWhatsAppTemplates, whatsappOverview } from "@/server/whatsapp/accounts";
import { processWhatsAppWebhook } from "@/server/whatsapp/webhook";
import { broadcastWorkspace } from "@/server/whatsapp/campaigns";
import { resetTestDb } from "./setup-db";

let env: Awaited<ReturnType<typeof resetTestDb>>;
beforeAll(async () => {
  env = await resetTestDb();
  vi.stubEnv("WHATSAPP_APP_ID", "123"); vi.stubEnv("WHATSAPP_APP_SECRET", "app-secret");
  vi.stubEnv("WHATSAPP_SIGNUP_CONFIG_ID", "456"); vi.stubEnv("WHATSAPP_GRAPH_VERSION", "v26.0"); vi.stubEnv("WHATSAPP_TOKEN_KEY", "ab".repeat(32));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { vi.unstubAllEnvs(); await env.conn.end(); await db.$client.end(); });
const input = { code: "signup-code", wabaId: "900", phoneNumberId: "901", pin: "123456" };
function provider(templates: unknown[] = []) {
  return vi.fn(async (url: URL) => {
    const path = url.pathname;
    if (path.endsWith("oauth/access_token")) return Response.json({ access_token: "business-secret-token" });
    if (path.endsWith("phone_numbers")) return Response.json({ data: [{ id: "901", verified_name: "Test restaurant", display_phone_number: "+91 9876543210", quality_rating: "GREEN" }] });
    if (path.endsWith("message_templates")) return Response.json({ data: templates });
    return Response.json({ success: true });
  });
}
describe("tenant-owned WhatsApp connection", () => {
  it("rejects a spoofed signup phone before storing or registering it", async () => {
    const fetch = provider(); vi.stubGlobal("fetch", fetch);
    await expect(connectWhatsApp(env.demo.tenantId, { ...input, phoneNumberId: "999" })).rejects.toThrow("not granted");
    expect((await whatsappOverview(env.demo.tenantId)).account).toBeNull();
    expect(fetch.mock.calls.some(([url]) => url.pathname.endsWith("register"))).toBe(false);
  });
  it("registers and subscribes before connecting, stores ciphertext and isolates tenants", async () => {
    vi.stubGlobal("fetch", provider());
    await connectWhatsApp(env.demo.tenantId, input);
    expect((await whatsappOverview(env.demo.tenantId)).account).toMatchObject({ status: "connected", verifiedName: "Test restaurant", qualityRating: "GREEN" });
    const [saved] = await env.db.select().from(s.whatsappAccounts).where(eq(s.whatsappAccounts.tenantId, env.demo.tenantId));
    expect(saved.accessToken).not.toContain("business-secret-token");
    expect((await whatsappOverview(env.other.tenantId)).account).toBeNull();
  });
  it("syncs approvals/rejections/media and disables templates missing from Meta", async () => {
    vi.stubGlobal("fetch", provider([{ id: "700", name: "weekend_offer", language: "en", category: "MARKETING", status: "APPROVED", components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Weekend offer" }] }]));
    await syncWhatsAppTemplates(env.demo.tenantId);
    expect((await whatsappOverview(env.demo.tenantId)).templates[0]).toMatchObject({ status: "approved", header: "image" });
    vi.stubGlobal("fetch", provider([{ id: "700", name: "weekend_offer", language: "en", category: "MARKETING", status: "REJECTED", rejected_reason: "Policy issue", components: [{ type: "BODY", text: "Weekend offer" }] }]));
    await syncWhatsAppTemplates(env.demo.tenantId);
    expect((await whatsappOverview(env.demo.tenantId)).templates[0]).toMatchObject({ status: "rejected", rejectionReason: "Policy issue" });
    vi.stubGlobal("fetch", provider([])); await syncWhatsAppTemplates(env.demo.tenantId);
    expect((await whatsappOverview(env.demo.tenantId)).templates[0].status).toBe("disabled");
  });
  it("reconciles an uncertain accepted message monotonically and handles STOP exactly once", async () => {
    const [template] = await env.db.select().from(s.whatsappTemplates).where(eq(s.whatsappTemplates.tenantId, env.demo.tenantId));
    await env.db.update(s.whatsappTemplates).set({ status: "approved" }).where(eq(s.whatsappTemplates.id, template.id));
    const campaignId = uuidv7(), recipientId = uuidv7(), inFlightId = uuidv7(), guestId = uuidv7(), guest2Id = uuidv7(), now = new Date();
    await env.db.insert(s.broadcastCampaigns).values({ id: campaignId, tenantId: env.demo.tenantId, name: "Webhook test", templateId: template.id, variables: [], segment: {}, status: "failed", startedAt: now, finishedAt: now, failureReason: "Some message results need review", audienceCount: 2, creditsReserved: 2, creditsUsed: 0 });
    await env.db.insert(s.guests).values([{ id: guestId, tenantId: env.demo.tenantId, phone: "+919123456789", name: "Test guest", consentMarketing: true }, { id: guest2Id, tenantId: env.demo.tenantId, phone: "+919123456788", name: "In-flight guest", consentMarketing: true }]);
    await env.db.insert(s.broadcastRecipients).values([{ id: recipientId, tenantId: env.demo.tenantId, campaignId, guestId, phone: "9123456789", status: "unknown" }, { id: inFlightId, tenantId: env.demo.tenantId, campaignId, guestId: guest2Id, phone: "9123456788", status: "sending", attemptedAt: now }]);
    const payload = (status: string) => ({ entry: [{ id: "900", changes: [{ field: "messages", value: { metadata: { phone_number_id: "901" }, statuses: [{ id: "wamid.test-1", status, timestamp: String(Math.floor(now.getTime() / 1000)), biz_opaque_callback_data: recipientId }] } }] }] });
    await processWhatsAppWebhook(payload("delivered"), now);
    await processWhatsAppWebhook(payload("read"), now);
    await processWhatsAppWebhook(payload("delivered"), now);
    await processWhatsAppWebhook({ entry: [{ id: "900", changes: [{ field: "messages", value: { metadata: { phone_number_id: "901" }, statuses: [{ id: "wamid.test-2", status: "read", timestamp: String(Math.floor(now.getTime() / 1000)), biz_opaque_callback_data: inFlightId }] } }] }] }, now);
    const [recipient] = await env.db.select().from(s.broadcastRecipients).where(eq(s.broadcastRecipients.id, recipientId));
    const [campaign] = await env.db.select().from(s.broadcastCampaigns).where(eq(s.broadcastCampaigns.id, campaignId));
    expect(recipient).toMatchObject({ status: "read", waMessageId: "wamid.test-1" });
    expect(campaign).toMatchObject({ status: "sent", creditsUsed: 2, failureReason: null });
    const report = await broadcastWorkspace({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, userId: env.demo.staffIds.owner, sessionId: uuidv7(), name: "Owner", roles: ["owner"], outlet: { code: env.demo.outletCode, name: "Test", timezone: "Asia/Kolkata" }, expiresAt: Date.now() + 60_000 });
    expect(report.campaigns.find((entry) => entry.id === campaignId)?.report).toEqual({ optedOut: 0, returningGuests: 0, offerRedemptions: 0 });

    const fetch = vi.fn().mockResolvedValue(Response.json({ messages: [{ id: "wamid.reply" }] })); vi.stubGlobal("fetch", fetch);
    const stopPayload = { entry: [{ id: "900", changes: [{ field: "messages", value: { metadata: { phone_number_id: "901" }, messages: [{ id: "incoming-1", from: "919123456789", type: "text", text: { body: "STOP" } }] } }] }] };
    await processWhatsAppWebhook(stopPayload, now);
    await processWhatsAppWebhook({ ...stopPayload, entry: [{ ...stopPayload.entry[0], changes: [{ ...stopPayload.entry[0].changes[0], value: { ...stopPayload.entry[0].changes[0].value, messages: [{ ...stopPayload.entry[0].changes[0].value.messages[0], id: "incoming-2" }] } }] }] }, now);
    const [guest] = await env.db.select().from(s.guests).where(eq(s.guests.id, guestId));
    expect(guest.marketingOptOutAt).toBeTruthy();
    expect(guest.marketingOptOutReplyAt).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("validates variables before calling Meta and removes token access on disconnect", async () => {
    const fetch = provider(); vi.stubGlobal("fetch", fetch);
    await expect(submitWhatsAppTemplate(env.demo.tenantId, { name: "offer", language: "en", body: "Hi {{2}}", examples: ["Sam"], header: "none" })).rejects.toThrow("sequential variables");
    expect(fetch).not.toHaveBeenCalled();
    await disconnectWhatsApp(env.demo.tenantId);
    const [saved] = await env.db.select().from(s.whatsappAccounts).where(eq(s.whatsappAccounts.tenantId, env.demo.tenantId));
    expect(saved).toMatchObject({ accessToken: "", status: "disconnected" });
    await expect(syncWhatsAppTemplates(env.demo.tenantId)).rejects.toThrow("Connect your WhatsApp");
  });
});
