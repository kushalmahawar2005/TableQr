import { describe, expect, it } from "vitest";
import { billTotals, customRemaining, splitByItems, splitEqually, type SplitLine } from "./split";

const r = (rupees: number) => Math.round(rupees * 100);
const line = (id: string, ownerId: string, rupees: number, sharedWith?: string[]): SplitLine => ({
  id,
  ownerId,
  amountPaise: r(rupees),
  taxRateBp: 500,
  sharedWith,
});

// The worked example in PS 3.6: four friends, GST 5%, no service charge
const example = {
  participantIds: ["A", "B", "C", "D"],
  hostId: "A",
  lines: [
    line("biryani", "A", 280),
    line("lassi", "A", 110),
    line("dal", "B", 260),
    line("naan-b", "B", 60),
    line("chicken", "C", 380),
    line("naan-c", "C", 60),
    line("cola", "C", 70),
    line("pbm", "D", 300),
    line("naan-d", "D", 60),
    line("tikka", "A", 320, ["A", "B", "C", "D"]),
    line("papad", "A", 90, ["A", "B"]),
  ],
};

describe("splitByItems: spec worked example", () => {
  const { totals, shares } = splitByItems(example);
  const byId = Object.fromEntries(shares.map((s) => [s.participantId, s]));

  it("matches the table totals", () => {
    expect(totals.subtotalPaise).toBe(r(1990));
    expect(totals.taxPaise).toBe(r(99.5));
    expect(totals.exactPaise).toBe(r(2089.5));
    expect(totals.totalPaise).toBe(r(2090));
    expect(totals.taxBreakup).toEqual({ "500": r(99.5) });
  });

  it("matches every person's row", () => {
    expect([byId.A.subtotalPaise, byId.A.taxPaise, byId.A.exactPaise, byId.A.amountPaise]).toEqual([r(515), r(25.75), r(540.75), r(541)]);
    expect([byId.B.subtotalPaise, byId.B.taxPaise, byId.B.exactPaise, byId.B.amountPaise]).toEqual([r(445), r(22.25), r(467.25), r(467)]);
    expect([byId.C.subtotalPaise, byId.C.taxPaise, byId.C.exactPaise, byId.C.amountPaise]).toEqual([r(590), r(29.5), r(619.5), r(620)]);
    expect([byId.D.subtotalPaise, byId.D.taxPaise, byId.D.exactPaise, byId.D.amountPaise]).toEqual([r(440), r(22), r(462), r(462)]);
  });

  it("shows Aarav's breakdown as on the G8 bill screen", () => {
    expect(byId.A.ownItemsPaise).toBe(r(390));
    expect(byId.A.sharedItemsPaise).toBe(r(125));
    expect(byId.A.roundOffPaise).toBe(r(0.25));
  });

  it("rounded shares add up to the rounded bill with no host adjustment", () => {
    expect(shares.reduce((s, x) => s + x.amountPaise, 0)).toBe(totals.totalPaise);
  });

  it("equal split gives 523, 523, 522, 522", () => {
    expect(splitEqually(totals.totalPaise, example.participantIds).map((s) => s.amountPaise / 100)).toEqual([523, 523, 522, 522]);
  });
});

describe("splitByItems: calculation rules", () => {
  it("gives leftover paise of a shared item to the first person in the list", () => {
    const { shares } = splitByItems({
      participantIds: ["A", "B", "C"],
      hostId: "A",
      lines: [{ id: "x", ownerId: "B", amountPaise: 10001, taxRateBp: 0, sharedWith: ["B", "A", "C"] }],
    });
    expect(shares.map((s) => s.subtotalPaise)).toEqual([3333, 3335, 3333]);
  });

  it("puts the difference between rounded shares and the rounded bill on the host", () => {
    // Each person owes 100.50; each rounds up to 101 but the bill of 301.50 rounds to 302
    const { totals, shares } = splitByItems({
      participantIds: ["A", "B", "C"],
      hostId: "B",
      lines: ["A", "B", "C"].map((p) => ({ id: p, ownerId: p, amountPaise: 10050, taxRateBp: 0 })),
    });
    expect(totals.totalPaise).toBe(30200);
    expect(shares.map((s) => s.amountPaise)).toEqual([10100, 10000, 10100]);
    expect(shares[1].roundOffPaise).toBe(-50);
  });

  it("divides a bill-level discount in proportion to subtotals, before tax", () => {
    const { totals, shares } = splitByItems({
      participantIds: ["A", "B"],
      hostId: "A",
      lines: [line("a", "A", 300), line("b", "B", 100)],
      billDiscountPaise: r(40),
    });
    expect(shares.map((s) => s.discountPaise)).toEqual([r(30), r(10)]);
    expect(shares.map((s) => s.taxPaise)).toEqual([r(13.5), r(4.5)]);
    expect(totals.taxPaise).toBe(r(18));
    expect(totals.totalPaise).toBe(r(378));
  });

  it("keeps tax per rate when lines carry different GST rates", () => {
    const totals = billTotals({
      lines: [
        { id: "food", ownerId: "A", amountPaise: r(1000), taxRateBp: 500 },
        { id: "drink", ownerId: "A", amountPaise: r(100), taxRateBp: 1800 },
      ],
    });
    expect(totals.taxBreakup).toEqual({ "500": r(50), "1800": r(18) });
  });

  it("rejects lines assigned to someone who is not at the table", () => {
    expect(() =>
      splitByItems({ participantIds: ["A"], hostId: "A", lines: [line("x", "A", 100, ["A", "Z"])] }),
    ).toThrow(/unknown participant/);
  });
});

describe("custom amounts", () => {
  it("reports what is left to assign", () => {
    expect(customRemaining(r(2090), [{ participantId: "A", amountPaise: r(1000) }])).toBe(r(1090));
  });
});
