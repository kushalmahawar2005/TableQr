import { afterEach, describe, expect, it, vi } from "vitest";
import { broadcastTemplatePayload, broadcastTemplateSignature, isBroadcastQuietTime } from "@/domain/broadcast";
import { sendWhatsAppTemplate } from "@/server/whatsapp/send";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const template = { name: "offer", language: "en", body: "Hello {{1}}, {{2}}", header: "image" as const, buttons: [{ type: "URL" as const, text: "Visit", url: "https://restaurant.example/offer/{{1}}" }] };
describe("broadcast payload and quiet hours", () => {
  it("enforces both sending-hour boundaries in the outlet time zone", () => {
    expect(isBroadcastQuietTime(new Date("2026-10-28T03:29:59Z"), "Asia/Kolkata")).toBe(true);
    expect(isBroadcastQuietTime(new Date("2026-10-28T03:30:00Z"), "Asia/Kolkata")).toBe(false);
    expect(isBroadcastQuietTime(new Date("2026-10-28T15:29:59Z"), "Asia/Kolkata")).toBe(false);
    expect(isBroadcastQuietTime(new Date("2026-10-28T15:30:00Z"), "Asia/Kolkata")).toBe(true);
  });
  it("renders named personalisation values, media and approved dynamic button suffixes", () => {
    const payload = broadcastTemplatePayload(template, { variables: ["{name}", "Use {offer}"], headerMediaUrl: "https://cdn.example/offer.jpg", offerCode: "OFFER10", linkUrl: "https://restaurant.example/offer/OFFER10" }, { name: "Kushal Mahawar" }, "recipient-id");
    expect(payload).toMatchObject({ biz_opaque_callback_data: "recipient-id", template: { components: [{ type: "header", parameters: [{ image: { link: "https://cdn.example/offer.jpg" } }] }, { type: "body", parameters: [{ text: "Kushal" }, { text: "Use OFFER10" }] }, { sub_type: "url", parameters: [{ text: "OFFER10" }] }] } });
    expect(broadcastTemplateSignature(template)).toBe(broadcastTemplateSignature({ buttons: template.buttons, header: "image", body: template.body, language: "en", name: "offer" }));
    expect(() => broadcastTemplatePayload(template, { variables: ["Hi", "Offer"], headerMediaUrl: "http://127.0.0.1/file", offerCode: null, linkUrl: null }, { name: null }, "id")).toThrow();
  });
});
describe("Meta send outcomes", () => {
  it("distinguishes accepted, explicit rejection and an uncertain response", async () => {
    vi.stubEnv("WHATSAPP_APP_ID", "123"); vi.stubEnv("WHATSAPP_APP_SECRET", "secret"); vi.stubEnv("WHATSAPP_SIGNUP_CONFIG_ID", "456"); vi.stubEnv("WHATSAPP_GRAPH_VERSION", "v26.0");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ messages: [{ id: "wamid.accepted" }] })).mockResolvedValueOnce(Response.json({ error: { code: 190 } }, { status: 401 })).mockResolvedValueOnce(Response.json({ error: { code: 1 } }, { status: 500 })).mockRejectedValueOnce(new Error("lost connection")));
    expect(await sendWhatsAppTemplate("123", "token", {})).toEqual({ kind: "accepted", messageId: "wamid.accepted" });
    expect(await sendWhatsAppTemplate("123", "token", {})).toMatchObject({ kind: "rejected", fatal: true });
    expect(await sendWhatsAppTemplate("123", "token", {})).toEqual({ kind: "unknown" });
    expect(await sendWhatsAppTemplate("123", "token", {})).toEqual({ kind: "unknown" });
  });
});
