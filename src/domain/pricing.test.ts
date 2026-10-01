import { describe, expect, it } from "vitest";
import { priceLine, type PricingItem } from "./pricing";

// Butter Chicken as drawn on the G4 item sheet
const butterChicken: PricingItem = {
  id: "bc",
  pricePaise: 38000,
  isAvailable: true,
  groups: [
    {
      id: "bread",
      nameEn: "Choose bread",
      minSelect: 1,
      maxSelect: 1,
      modifiers: [
        { id: "naan", nameEn: "Butter naan", nameHi: null, priceDeltaPaise: 6000, isAvailable: true },
        { id: "roti", nameEn: "Tandoori roti", nameHi: null, priceDeltaPaise: 4000, isAvailable: true },
        { id: "none", nameEn: "No bread", nameHi: null, priceDeltaPaise: 0, isAvailable: true },
      ],
    },
    {
      id: "addons",
      nameEn: "Add-ons",
      minSelect: 0,
      maxSelect: 3,
      modifiers: [{ id: "gravy", nameEn: "Extra gravy", nameHi: null, priceDeltaPaise: 3000, isAvailable: false }],
    },
  ],
};

describe("priceLine", () => {
  it("prices Butter Chicken with butter naan at INR 440, as on the Add button", () => {
    const res = priceLine(butterChicken, 1, ["naan"]);
    expect(res.ok && res.line.unitPricePaise).toBe(44000);
  });

  it("multiplies by quantity", () => {
    const res = priceLine(butterChicken, 2, ["roti"]);
    expect(res.ok && res.line.linePaise).toBe(84000);
  });

  it("blocks a missing required choice and names the group", () => {
    expect(priceLine(butterChicken, 1, [])).toEqual({
      ok: false,
      error: { code: "too_few", groupId: "bread", groupName: "Choose bread", min: 1 },
    });
  });

  it("blocks two picks from a pick-one group", () => {
    const res = priceLine(butterChicken, 1, ["naan", "roti"]);
    expect(!res.ok && res.error.code).toBe("too_many");
  });

  it("rejects a modifier from another item, a sold-out option, and repeats", () => {
    expect(!priceLine(butterChicken, 1, ["naan", "cheese"]).ok).toBe(true);
    const soldOut = priceLine(butterChicken, 1, ["naan", "gravy"]);
    expect(!soldOut.ok && soldOut.error.code).toBe("modifier_unavailable");
    const dup = priceLine(butterChicken, 1, ["naan", "naan"]);
    expect(!dup.ok && dup.error.code).toBe("duplicate_modifier");
  });

  it("rejects unavailable items and silly quantities", () => {
    expect(priceLine({ ...butterChicken, isAvailable: false }, 1, ["naan"])).toEqual({ ok: false, error: { code: "item_unavailable" } });
    for (const qty of [0, -1, 1.5, 51]) {
      expect(priceLine(butterChicken, qty, ["naan"])).toEqual({ ok: false, error: { code: "bad_quantity" } });
    }
  });
});
