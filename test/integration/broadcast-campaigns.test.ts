import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { uuidv7 } from "@/db/id";
import { adjustMessageCredits, previewBroadcastAudience } from "@/server/broadcast";
import { cancelBroadcastCampaign, createBroadcastCampaign, type CampaignInput } from "@/server/whatsapp/campaigns";
import { processBroadcastCampaign } from "@/server/whatsapp/worker";
import { saveMessageCreditPrice, settleMessageCreditPurchaseByGatewayRef, startMessageCreditPurchase } from "@/server/whatsapp/credits";
import { sealWhatsAppToken } from "@/server/whatsapp/meta";
import type { StaffSession } from "@/server/staff/auth";
import { resetTestDb } from "./setup-db";

let env: Awaited<ReturnType<typeof resetTestDb>>;
let staff: StaffSession;
let templateId: string;
let guestIds: string[];
const noon = new Date("2026-10-28T06:30:00Z");
beforeEach(async () => {
  env = await resetTestDb();
  vi.stubEnv("WHATSAPP_APP_ID", "123"); vi.stubEnv("WHATSAPP_APP_SECRET", "secret"); vi.stubEnv("WHATSAPP_SIGNUP_CONFIG_ID", "456"); vi.stubEnv("WHATSAPP_GRAPH_VERSION", "v26.0"); vi.stubEnv("WHATSAPP_TOKEN_KEY", "ab".repeat(32));
  staff = { tenantId: env.demo.tenantId, outletId: env.demo.outletId, userId: env.demo.staffIds.owner, roles: ["owner"], name: "Owner", sessionId: uuidv7(), expiresAt: Date.now() + 60_000, outlet: { code: "SRJ01", name: "Restaurant", timezone: "Asia/Kolkata" } };
  await env.db.update(s.tenants).set({ status: "active", customFeatures: { broadcast: true } }).where(eq(s.tenants.id, staff.tenantId));
  const accountId = uuidv7(); templateId = uuidv7();
  await env.db.insert(s.whatsappAccounts).values({ id: accountId, tenantId: staff.tenantId, wabaId: "900", phoneNumberId: "901", accessToken: sealWhatsAppToken(staff.tenantId, "test-token"), status: "connected" });
  await env.db.insert(s.whatsappTemplates).values({ id: templateId, tenantId: staff.tenantId, accountId, name: "offer", language: "en", body: "Hi {{1}}", status: "approved", category: "MARKETING" });
  guestIds = [uuidv7(), uuidv7()];
  await env.db.insert(s.guests).values(guestIds.map((id, i) => ({ id, tenantId: staff.tenantId, phone: `+91987654321${i}`, name: `Guest${i}`, consentMarketing: true })));
  await adjustMessageCredits({ tenantId: staff.tenantId, delta: 10, reason: "grant", actorLabel: "test", note: "Test credit grant" });
});
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); if (env) await env.conn.end(); });
afterAll(async () => { await db.$client.end(); });
const input = (patch: Partial<CampaignInput> = {}): CampaignInput => ({ requestId: uuidv7(), name: "Offer campaign", templateId, outletId: null, variables: ["{name}"], headerMediaUrl: null, offerCode: null, linkUrl: null, segment: {}, audienceLimit: 2, intent: "send", scheduledLocal: null, ...patch });
const balance = async () => (await env.db.select({ n: s.tenants.messageCredits }).from(s.tenants).where(eq(s.tenants.id, staff.tenantId)))[0].n;
const recipients = async (campaignId: string) => env.db.select().from(s.broadcastRecipients).where(and(eq(s.broadcastRecipients.tenantId, staff.tenantId), eq(s.broadcastRecipients.campaignId, campaignId)));
describe("broadcast reservation and sending", () => {
  it("freezes/debits once, replays a lost create reply, and refunds cancellation once", async () => {
    const request = input();
    const [a, b] = await Promise.all([createBroadcastCampaign(staff, request, noon), createBroadcastCampaign(staff, request, noon)]);
    expect(a).toBe(b); expect(await balance()).toBe(8); expect(await recipients(a)).toHaveLength(2);
    await cancelBroadcastCampaign(staff, a, noon); await cancelBroadcastCampaign(staff, a, noon);
    expect(await balance()).toBe(10); expect((await recipients(a)).every((r) => r.refunded)).toBe(true);
    const [sum] = await env.db.select({ n: sql<string>`sum(${s.messageCreditLedger.delta})` }).from(s.messageCreditLedger).where(eq(s.messageCreditLedger.tenantId, staff.tenantId));
    expect(Number(sum.n)).toBe(await balance());
  });
  it("rolls back when balance is short and keeps another tenant out", async () => {
    await adjustMessageCredits({ tenantId: staff.tenantId, delta: -9, reason: "adjust", actorLabel: "test" });
    await expect(createBroadcastCampaign(staff, input(), noon)).rejects.toThrow("needs 2");
    expect(await balance()).toBe(1);
    expect(await env.db.select().from(s.broadcastCampaigns).where(eq(s.broadcastCampaigns.tenantId, staff.tenantId))).toHaveLength(0);
    const campaign = await createBroadcastCampaign(staff, input({ intent: "draft" }), noon);
    await expect(cancelBroadcastCampaign({ ...staff, tenantId: env.other.tenantId }, campaign, noon)).rejects.toThrow("not found");
  });
  it("waits through quiet hours and freezes the audience only when the schedule starts", async () => {
    const night = new Date("2026-10-28T16:00:00Z");
    const campaign = await createBroadcastCampaign(staff, input(), night);
    expect(await balance()).toBe(10); expect(await recipients(campaign)).toHaveLength(0);
    const fetch = vi.fn().mockResolvedValue(Response.json({ messages: [{ id: "wamid.one" }] })); vi.stubGlobal("fetch", fetch);
    expect(await processBroadcastCampaign(staff.tenantId, campaign, night)).toBe("waiting"); expect(fetch).not.toHaveBeenCalled();
    await env.db.update(s.guests).set({ marketingOptOutAt: night }).where(and(eq(s.guests.tenantId, staff.tenantId), eq(s.guests.id, guestIds[1])));
    expect(await processBroadcastCampaign(staff.tenantId, campaign, new Date("2026-10-29T03:30:00Z"))).toBe("accepted");
    expect(await recipients(campaign)).toHaveLength(1); expect(await balance()).toBe(9);
  });
  it("claims a recipient once under competing workers and preserves accepted credits on cancel", async () => {
    const campaign = await createBroadcastCampaign(staff, input(), noon);
    const fetch = vi.fn().mockResolvedValue(Response.json({ messages: [{ id: "wamid.one" }] })); vi.stubGlobal("fetch", fetch);
    await Promise.all([processBroadcastCampaign(staff.tenantId, campaign, noon), processBroadcastCampaign(staff.tenantId, campaign, noon)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await cancelBroadcastCampaign(staff, campaign, noon);
    expect(await balance()).toBe(9); expect((await recipients(campaign)).filter((r) => r.waMessageId)).toHaveLength(1);
    const campaignRows = await env.db.select().from(s.broadcastCampaigns).where(and(eq(s.broadcastCampaigns.tenantId, staff.tenantId), eq(s.broadcastCampaigns.id, campaign)));
    expect(campaignRows[0].creditsUsed).toBe(1);
  });
  it("holds uncertain credits without retrying and refunds only the unsent queue", async () => {
    const campaign = await createBroadcastCampaign(staff, input(), noon);
    const fetch = vi.fn().mockRejectedValue(new Error("response lost")); vi.stubGlobal("fetch", fetch);
    expect(await processBroadcastCampaign(staff.tenantId, campaign, noon)).toBe("unknown");
    await cancelBroadcastCampaign(staff, campaign, noon);
    expect(await processBroadcastCampaign(staff.tenantId, campaign, new Date(noon.getTime() + 5000))).toBe("waiting");
    expect(fetch).toHaveBeenCalledTimes(1); expect(await balance()).toBe(9);
    expect((await recipients(campaign)).filter((r) => r.status === "unknown")).toHaveLength(1);
  });
  it("rechecks opt-outs before sending and refunds explicit Graph rejection", async () => {
    const campaign = await createBroadcastCampaign(staff, input(), noon);
    await env.db.update(s.guests).set({ marketingOptOutAt: noon }).where(and(eq(s.guests.tenantId, staff.tenantId), eq(s.guests.id, guestIds[0])));
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: { code: 131026 } }, { status: 400 })); vi.stubGlobal("fetch", fetch);
    const outcomes = [await processBroadcastCampaign(staff.tenantId, campaign, noon), await processBroadcastCampaign(staff.tenantId, campaign, new Date(noon.getTime() + 2000))];
    expect(outcomes.sort()).toEqual(["rejected", "skipped"]); expect(fetch).toHaveBeenCalledTimes(1); expect(await balance()).toBe(10);
  });
  it("deduplicates phone aliases and honors any alias's opt-out", async () => {
    await env.db.insert(s.guests).values({ tenantId: staff.tenantId, phone: "9876543210", consentMarketing: true });
    expect((await previewBroadcastAudience(staff.tenantId, { now: noon })).count).toBe(2);
    await env.db.update(s.guests).set({ marketingOptOutAt: noon }).where(and(eq(s.guests.tenantId, staff.tenantId), eq(s.guests.phone, "9876543210")));
    expect((await previewBroadcastAudience(staff.tenantId, { now: noon })).count).toBe(1);
  });
  it("does not refund an in-flight message when cancellation races with its acceptance", async () => {
    const campaign = await createBroadcastCampaign(staff, input(), noon);
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    let reply!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => { signalStarted(); return new Promise<Response>((resolve) => { reply = resolve; }); }));
    const sending = processBroadcastCampaign(staff.tenantId, campaign, noon);
    await started;
    await cancelBroadcastCampaign(staff, campaign, noon);
    expect(await balance()).toBe(9);
    reply(Response.json({ messages: [{ id: "wamid.after-cancel" }] }));
    expect(await sending).toBe("accepted");
    expect(await balance()).toBe(9);
    expect((await recipients(campaign)).filter((r) => r.status === "sent" && !r.refunded)).toHaveLength(1);
  });
  it("waits for a scheduled time and refuses audience growth beyond the approved budget", async () => {
    const campaign = await createBroadcastCampaign(staff, input({ intent: "schedule", scheduledLocal: "2026-10-28T13:00" }), noon);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(await processBroadcastCampaign(staff.tenantId, campaign, noon)).toBe("waiting");
    await env.db.insert(s.guests).values({ tenantId: staff.tenantId, phone: "+919876543219", consentMarketing: true });
    expect(await processBroadcastCampaign(staff.tenantId, campaign, new Date("2026-10-28T07:30:00Z"))).toBe("waiting");
    expect(fetch).not.toHaveBeenCalled(); expect(await balance()).toBe(10);
    const [saved] = await env.db.select().from(s.broadcastCampaigns).where(and(eq(s.broadcastCampaigns.tenantId, staff.tenantId), eq(s.broadcastCampaigns.id, campaign)));
    expect(saved).toMatchObject({ status: "failed", creditsReserved: 0 }); expect(saved.failureReason).toContain("grew");
  });
  it("moves an abandoned claim to review and never resends that recipient", async () => {
    const campaign = await createBroadcastCampaign(staff, input(), noon);
    const [recipient] = await recipients(campaign);
    await env.db.update(s.broadcastRecipients).set({ status: "sending", attemptedAt: new Date(noon.getTime() - 180_000) }).where(and(eq(s.broadcastRecipients.tenantId, staff.tenantId), eq(s.broadcastRecipients.id, recipient.id)));
    const fetch = vi.fn().mockResolvedValue(Response.json({ messages: [{ id: "wamid.remaining" }] })); vi.stubGlobal("fetch", fetch);
    expect(await processBroadcastCampaign(staff.tenantId, campaign, noon)).toBe("accepted");
    await processBroadcastCampaign(staff.tenantId, campaign, new Date(noon.getTime() + 2000));
    expect(fetch).toHaveBeenCalledTimes(1); expect(await balance()).toBe(8);
    const [abandoned] = (await recipients(campaign)).filter((r) => r.id === recipient.id);
    expect(abandoned).toMatchObject({ status: "unknown", refunded: false });
  });
  it("starts an idempotent platform Cashfree credit checkout and applies confirmed credits once", async () => {
    await saveMessageCreditPrice({ pricePerCreditPaise: 250, packSizes: [100, 500], lowBalanceThreshold: 20 });
    vi.stubEnv("CASHFREE_CLIENT_ID", "tableeqr_client_123"); vi.stubEnv("CASHFREE_CLIENT_SECRET", "tableeqr_secret_123"); vi.stubEnv("CASHFREE_MODE", "sandbox");
    const fetch = vi.fn(async (url: URL, init?: RequestInit) => init?.method === "POST" ? Response.json({ order_id: JSON.parse(String(init.body)).order_id }) : Response.json({ payment_session_id: "cashfree-session" }));
    vi.stubGlobal("fetch", fetch);
    const purchase = await startMessageCreditPurchase(staff, { credits: 100, requestId: "credits-request-1", callbackUrl: "https://tableeqr.example/api/fees/return?p=PLACEHOLDER" });
    expect(purchase).toMatchObject({ credits: 100, amountPaise: 25_000, checkout: { kind: "cashfree", paymentSessionId: "cashfree-session" } });
    const replay = await startMessageCreditPurchase(staff, { credits: 100, requestId: "credits-request-1", callbackUrl: "https://tableeqr.example/api/fees/return?p=PLACEHOLDER" });
    expect(replay.id).toBe(purchase.id);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(await balance()).toBe(10);
    expect(await settleMessageCreditPurchaseByGatewayRef(purchase.id, { status: "success", amountPaise: 25_000, currency: "INR", gatewayPaymentId: "cf-credit-1" })).toMatchObject({ status: "confirmed", alreadyFinal: false });
    expect(await settleMessageCreditPurchaseByGatewayRef(purchase.id, { status: "success", amountPaise: 25_000, currency: "INR", gatewayPaymentId: "cf-credit-1" })).toMatchObject({ status: "confirmed", alreadyFinal: true });
    expect(await balance()).toBe(110);
    const [sum] = await env.db.select({ n: sql<string>`sum(${s.messageCreditLedger.delta})` }).from(s.messageCreditLedger).where(eq(s.messageCreditLedger.tenantId, staff.tenantId));
    expect(Number(sum.n)).toBe(await balance());
  });
  it("rejects amount/currency mismatches without granting credits", async () => {
    await saveMessageCreditPrice({ pricePerCreditPaise: 100, packSizes: [10], lowBalanceThreshold: 5 });
    vi.stubEnv("CASHFREE_CLIENT_ID", "tableeqr_client_123"); vi.stubEnv("CASHFREE_CLIENT_SECRET", "tableeqr_secret_123"); vi.stubEnv("CASHFREE_MODE", "sandbox");
    const fetch = vi.fn(async (url: URL, init?: RequestInit) => init?.method === "POST" ? Response.json({ order_id: JSON.parse(String(init.body)).order_id }) : Response.json({ payment_session_id: "cashfree-session" })); vi.stubGlobal("fetch", fetch);
    const purchase = await startMessageCreditPurchase(staff, { credits: 10, requestId: "credits-request-2", callbackUrl: "https://tableeqr.example/api/fees/return?p=PLACEHOLDER" });
    expect(await settleMessageCreditPurchaseByGatewayRef(purchase.id, { status: "success", amountPaise: 1000, currency: "USD", gatewayPaymentId: "cf-credit-wrong" })).toMatchObject({ status: "rejected" });
    expect(await balance()).toBe(10);
  });
});
