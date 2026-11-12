import { afterEach, describe, expect, it, vi } from "vitest";
import { checkMerchantCredentials, encryptMerchantCredentials, outletGatewayFromConfig, outletGatewayReady } from "@/server/payments/outlet-gateway";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("restaurant Cashfree account isolation", () => {
  it("uses encrypted restaurant credentials and never the Tableeqr subscription account", async () => {
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

  it("treats unreadable saved credentials as no online payment instead of failing the page", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PAYMENT_CREDENTIALS_KEY", "a".repeat(64));
    const encrypted = encryptMerchantCredentials({ mode: "sandbox", clientId: "restaurant_client_123", clientSecret: "restaurant_secret_456" });
    expect(outletGatewayReady(encrypted)).toBe(true);

    vi.stubEnv("PAYMENT_CREDENTIALS_KEY", "b".repeat(64));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => outletGatewayFromConfig(encrypted)).toThrow();
    expect(outletGatewayReady(encrypted)).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("refuses test-mode merchant credentials for live checkout", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PAYMENT_CREDENTIALS_KEY", "b".repeat(64));
    const encrypted = encryptMerchantCredentials({ mode: "sandbox", clientId: "restaurant_client_123", clientSecret: "restaurant_secret_456" });
    vi.stubEnv("NODE_ENV", "production");
    expect(outletGatewayFromConfig(encrypted)).toBeNull();
  });

  it("checks new merchant keys with Cashfree before saving them", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const urls: string[] = [];
    const answer = (status: number) => vi.stubGlobal("fetch", async (url: string) => { urls.push(url); return new Response("{}", { status }); });
    const keys = { mode: "sandbox", clientId: "restaurant_client_123", clientSecret: "restaurant_secret_456" };

    answer(404);
    expect(await checkMerchantCredentials(keys)).toBe("ok");
    expect(urls[0]).toMatch(/^https:\/\/sandbox\.cashfree\.com\/pg\/orders\/tq_keycheck_/);
    answer(401);
    expect(await checkMerchantCredentials(keys)).toBe("rejected");
    answer(503);
    expect(await checkMerchantCredentials(keys)).toBe("unknown");
    vi.stubGlobal("fetch", async () => { throw new TypeError("network down"); });
    expect(await checkMerchantCredentials(keys)).toBe("unknown");

    // Input the save rejects anyway is left to its own message, without calling Cashfree
    const before = urls.length;
    expect(await checkMerchantCredentials({ ...keys, clientSecret: "short" })).toBe("skipped");
    expect(await checkMerchantCredentials({ ...keys, mode: "production" })).toBe("skipped");
    expect(urls.length).toBe(before);
  });
});
