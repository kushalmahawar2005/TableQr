import { describe, expect, it } from "vitest";
import { isPincode, parsePincodeResponse } from "@/server/delivery/pincode";

describe("pincode lookup", () => {
  it("accepts six-digit Indian pincodes only", () => {
    expect(isPincode("302017")).toBe(true);
    expect(isPincode("012345")).toBe(false);
    expect(isPincode("30201")).toBe(false);
    expect(isPincode("30201a")).toBe(false);
  });

  it("puts delivering offices first and drops the city in brackets", () => {
    const info = parsePincodeResponse([{ Status: "Success", PostOffice: [
      { Name: "Jagatpura", District: "Jaipur", State: "Rajasthan", DeliveryStatus: "Non-Delivery" },
      { Name: "Malviya Nagar (Jaipur)", District: "Jaipur", State: "Rajasthan", DeliveryStatus: "Delivery" },
      { Name: "Malviya Nagar (Jaipur)", District: "Jaipur", State: "Rajasthan", DeliveryStatus: "Delivery" },
    ] }]);
    expect(info).toEqual({ city: "Jaipur", state: "Rajasthan", areas: ["Malviya Nagar", "Jagatpura"] });
  });

  it("returns null for an unknown pincode or an odd answer", () => {
    expect(parsePincodeResponse([{ Status: "Error", PostOffice: null }])).toBeNull();
    expect(parsePincodeResponse({})).toBeNull();
    expect(parsePincodeResponse(null)).toBeNull();
  });
});
