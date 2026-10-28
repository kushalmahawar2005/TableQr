import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metaRequest, openWhatsAppToken, publicMetaConfig, sealWhatsAppToken } from "@/server/whatsapp/meta";

beforeEach(() => {
  vi.stubEnv("WHATSAPP_APP_ID", "123"); vi.stubEnv("WHATSAPP_APP_SECRET", "app-secret");
  vi.stubEnv("WHATSAPP_SIGNUP_CONFIG_ID", "456"); vi.stubEnv("WHATSAPP_GRAPH_VERSION", "v26.0");
  vi.stubEnv("WHATSAPP_TOKEN_KEY", "ab".repeat(32));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("tenant WhatsApp credentials", () => {
  it("encrypts with tenant binding and rejects tampering or key rotation", () => {
    const sealed = sealWhatsAppToken("tenant-a", "private-meta-token");
    expect(sealed).not.toContain("private-meta-token");
    expect(openWhatsAppToken("tenant-a", sealed)).toBe("private-meta-token");
    expect(sealWhatsAppToken("tenant-a", "private-meta-token")).not.toBe(sealed);
    expect(() => openWhatsAppToken("tenant-b", sealed)).toThrow();
    expect(() => openWhatsAppToken("tenant-a", sealed.slice(0, -1) + (sealed.endsWith("0") ? "1" : "0"))).toThrow();
    vi.stubEnv("WHATSAPP_TOKEN_KEY", "cd".repeat(32));
    expect(() => openWhatsAppToken("tenant-a", sealed)).toThrow();
  });
  it("exposes only public signup config and stays disabled without encryption setup", () => {
    expect(publicMetaConfig()).toEqual({ appId: "123", configId: "456", version: "v26.0" });
    vi.stubEnv("WHATSAPP_TOKEN_KEY", ""); expect(publicMetaConfig()).toBeNull();
  });
  it("rejects arbitrary URLs and uses bearer auth rather than token query parameters", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: [] })); vi.stubGlobal("fetch", fetch);
    await expect(metaRequest("https://attacker.example", "private-meta-token")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await metaRequest("123/message_templates", "private-meta-token");
    expect(fetch.mock.calls[0][0].origin).toBe("https://graph.facebook.com");
    expect(fetch.mock.calls[0][0].search).not.toContain("private-meta-token");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer private-meta-token");
  });
  it("never exposes provider payloads or secrets in errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: 190, message: "private-meta-token app-secret" } }, { status: 401 })));
    await expect(metaRequest("123/message_templates", "private-meta-token")).rejects.toThrow("authorization expired");
  });
});
