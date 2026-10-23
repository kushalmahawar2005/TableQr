import { describe, expect, it } from "vitest";
import { DEFAULT_DELIVERY_POLICY, deliveryQuote, readDeliveryPolicy, validateDeliveryPolicy } from "@/domain/delivery";
import { readFeatures } from "@/lib/plan-features";

const policy = { ...DEFAULT_DELIVERY_POLICY, acceptingOrders: true, pincodes: ["302001"], minimumOrderPaise: 10000, deliveryFeePaise: 3000, freeDeliveryAbovePaise: 50000 };

describe("delivery pricing policy", () => {
  it("keeps delivery off for old packages and missing or corrupt configuration", () => {
    expect(readFeatures({}).delivery).toBe(false);
    expect(readFeatures({ delivery: true }).delivery).toBe(true);
    for (const raw of [null, {}, { acceptingOrders: true }, { ...policy, deliveryFeePaise: -1 }]) expect(readDeliveryPolicy(raw).acceptingOrders).toBe(false);
  });
  it("rejects invalid areas, amounts and payment methods instead of coercing them", () => {
    for (const patch of [{ pincodes: [] }, { pincodes: ["000000"] }, { pincodes: ["30200"] }, { minimumOrderPaise: "100" }, { deliveryFeePaise: 0.1 }, { deliveryFeePaise: Infinity }, { estimatedMinutes: 0 }, { paymentMode: "anything" }, { paymentMode: ["cod"] }, { acceptingOrders: "true" }]) expect(() => validateDeliveryPolicy({ ...policy, ...patch })).toThrow();
    expect(validateDeliveryPolicy({ ...policy, pincodes: ["302002", "302001", "302001"] }).pincodes).toEqual(["302001", "302002"]);
  });
  it("enforces the area, order minimum and pause before calculating charges", () => {
    expect(() => deliveryQuote(policy, "302002", 50000)).toThrow("pincode");
    expect(() => deliveryQuote(policy, "302001", 9999)).toThrow("Minimum");
    expect(() => deliveryQuote({ ...policy, acceptingOrders: false }, "302001", 50000)).toThrow("paused");
    expect(() => deliveryQuote(policy, "302001", NaN)).toThrow("subtotal");
    expect(deliveryQuote(policy, "302001", 49999).feePaise).toBe(3000);
    expect(deliveryQuote(policy, "302001", 50000).feePaise).toBe(0);
    expect(deliveryQuote({ ...policy, freeDeliveryAbovePaise: null }, "302001", 50000).feePaise).toBe(3000);
  });
});
