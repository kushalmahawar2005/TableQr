import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyWhatsAppSignature } from "@/server/whatsapp/webhook";

afterEach(() => { vi.unstubAllEnvs(); });

describe("WhatsApp webhook signature", () => {
  it("accepts the exact raw-body SHA-256 signature", () => {
    const raw = '{"entry":[{"id":"1"}]}';
    const signature = `sha256=${createHmac("sha256", "secret").update(raw).digest("hex")}`;
    expect(verifyWhatsAppSignature(raw, signature, "secret")).toBe(true);
    expect(verifyWhatsAppSignature(`${raw} `, signature, "secret")).toBe(false);
  });

  it("rejects missing, malformed, mismatched signatures and missing secrets", () => {
    expect(verifyWhatsAppSignature("{}", null, "secret")).toBe(false);
    expect(verifyWhatsAppSignature("{}", "sha256=bad", "secret")).toBe(false);
    expect(verifyWhatsAppSignature("{}", `sha256=${"00".repeat(32)}`, "secret")).toBe(false);
    expect(verifyWhatsAppSignature("{}", `sha256=${"00".repeat(32)}`, "")).toBe(false);
  });
});
