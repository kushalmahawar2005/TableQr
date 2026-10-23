import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptMerchantCredentials, outletGatewayFromConfig } from "@/server/payments/outlet-gateway";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("restaurant Cashfree account isolation", () => {
  it("uses encrypted restaurant credentials and never the TableQR subscription account", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PAYMENT_CREDENTIALS_KEY", "a".repeat(64));
    vi.stubEnv("CASHFREE_MODE", "sandbox");
    vi.stubEnv("CASHFREE_CLIENT_ID", "tableqr_platform_client");
    vi.stubEnv("CASHFREE_CLIENT_SECRET", "tableqr_platform_secret");
    const encrypted = encryptMerchantCredentials({ mode: "sandbox", clientId: "restaurant_client_123", clientSecret: "restaurant_secret_456" });
    expect(encrypted).not.toContain("restaurant_client_123");
    expect(encrypted).not.toContain("restaurant_secret_456");

    const calls: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      calls.push(init);
      return new Response(JSON.stringify({ order_id: "tenant_order_1" }), { status: 200 });
    });
    const gateway = outletGatewayFromConfig(encrypted);
    expect(gateway?.name).toBe("cashfree");
    await gateway!.createOrder({ paymentId: "tenant_order_1", amountPaise: 12500, receipt: "tenant_order_1", callbackUrl: "https://restaurant.example/return" });
    expect(calls[0].headers).toMatchObject({ "x-client-id": "restaurant_client_123", "x-client-secret": "restaurant_secret_456" });
    expect(calls[0].headers).not.toMatchObject({ "x-client-id": "tableqr_platform_client", "x-client-secret": "tableqr_platform_secret" });
  });

  it("refuses test-mode merchant credentials for live checkout", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PAYMENT_CREDENTIALS_KEY", "b".repeat(64));
    const encrypted = encryptMerchantCredentials({ mode: "sandbox", clientId: "restaurant_client_123", clientSecret: "restaurant_secret_456" });
    vi.stubEnv("NODE_ENV", "production");
    expect(outletGatewayFromConfig(encrypted)).toBeNull();
  });
});
