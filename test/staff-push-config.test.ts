import { createECDH } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { staffPushConfig, validateSubscription } from "@/server/staff/web-push";

afterEach(() => vi.unstubAllEnvs());
it("accepts a matching push key pair and rejects a rotated public key", () => {
  const pair = createECDH("prime256v1"); pair.generateKeys();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", pair.getPublicKey().toString("base64url"));
  vi.stubEnv("VAPID_PRIVATE_KEY", pair.getPrivateKey().toString("base64url"));
  vi.stubEnv("VAPID_SUBJECT", "mailto:notifications@example.com");
  expect(staffPushConfig().enabled).toBe(true);
  const other = createECDH("prime256v1"); other.generateKeys();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", other.getPublicKey().toString("base64url"));
  expect(staffPushConfig()).toMatchObject({ enabled: false, error: expect.stringContaining("do not match") });
});
it("rejects push subscriptions outside supported push providers", () => {
  expect(() => validateSubscription({ endpoint: "https://example.com/push", keys: { p256dh: "key", auth: "auth" } })).toThrow();
});
