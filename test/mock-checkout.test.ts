import { afterEach, describe, expect, it, vi } from "vitest";
import MockCheckout from "@/app/pay/mock/page";
import { mockGateway } from "@/server/payments/gateway";

afterEach(() => vi.unstubAllEnvs());

describe("development mock checkout", () => {
  it("accepts the delivery payment return route", async () => {
    vi.stubEnv("PUBLIC_APP_URL", "https://tableeqr.example");
    const { gatewayRef } = await mockGateway.createOrder({ paymentId: "delivery-checkout", amountPaise: 12500 });
    const page = await MockCheckout({ searchParams: Promise.resolve({
      ref: gatewayRef,
      amount: "12500",
      method: "upi",
      callback: "https://tableeqr.example/api/delivery/payments/return?c=019a0000-0000-7000-8000-000000000001",
    }) });
    expect(page).toBeTruthy();
  });
});
