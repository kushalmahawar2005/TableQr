import { describe, expect, it } from "vitest";
import { canSatisfy, cleanNote, firstIncomplete, groupRule, lineKey, linePrice, toggleQuickNote } from "./item-sheet";

const mod = (id: string, priceDeltaPaise = 0, isAvailable = true) => ({ id, nameEn: id, nameHi: null, priceDeltaPaise, isAvailable });
const group = (id: string, minSelect: number, maxSelect: number, mods: ReturnType<typeof mod>[]) => ({ id, nameEn: id, minSelect, maxSelect, modifiers: mods });

describe("option groups (G4)", () => {
  it("words every min/max the way guests read it", () => {
    expect(groupRule({ minSelect: 1, maxSelect: 1 })).toMatchObject({ required: true, kind: "one" });
    expect(groupRule({ minSelect: 0, maxSelect: 1 })).toMatchObject({ required: false, kind: "one" });
    expect(groupRule({ minSelect: 0, maxSelect: 3 })).toMatchObject({ required: false, kind: "upTo", max: 3 });
    expect(groupRule({ minSelect: 2, maxSelect: 2 })).toMatchObject({ required: true, kind: "exact", min: 2 });
    expect(groupRule({ minSelect: 1, maxSelect: 3 })).toMatchObject({ required: true, kind: "range", min: 1, max: 3 });
  });

  it("names the first required group still missing a choice", () => {
    const bread = group("bread", 1, 1, [mod("naan", 6000), mod("roti", 4000)]);
    const addOns = group("addons", 0, 3, [mod("gravy", 3000)]);
    const spice = group("spice", 1, 1, [mod("mild"), mod("hot")]);
    expect(firstIncomplete([bread, addOns, spice], new Set())?.id).toBe("bread");
    expect(firstIncomplete([bread, addOns, spice], new Set(["naan"]))?.id).toBe("spice");
    expect(firstIncomplete([bread, addOns, spice], new Set(["naan", "mild"]))).toBeNull();
  });

  it("does not count a chosen option that has become unavailable", () => {
    const bread = group("bread", 1, 1, [mod("naan", 6000, false), mod("roti", 4000)]);
    expect(firstIncomplete([bread], new Set(["naan"]))?.id).toBe("bread");
  });

  it("knows when a required group can no longer be met", () => {
    expect(canSatisfy(group("bread", 1, 1, [mod("naan", 0, false)]))).toBe(false);
    expect(canSatisfy(group("two", 2, 2, [mod("a"), mod("b", 0, false)]))).toBe(false);
    expect(canSatisfy(group("addons", 0, 3, []))).toBe(true);
  });

  it("prices the line as the server does", () => {
    const bread = group("bread", 1, 1, [mod("naan", 6000), mod("roti", 4000)]);
    const addOns = group("addons", 0, 3, [mod("gravy", 3000)]);
    expect(linePrice(38000, [bread, addOns], new Set(["naan"]), 1)).toBe(44000);
    expect(linePrice(38000, [bread, addOns], new Set(["naan", "gravy"]), 3)).toBe(3 * 47000);
  });
});

describe("notes (G4)", () => {
  it("toggles quick notes without duplicates and keeps free text", () => {
    expect(toggleQuickNote("", "Less spicy")).toBe("Less spicy");
    expect(toggleQuickNote("less spicy", "Less spicy")).toBe("");
    expect(toggleQuickNote("extra lemon", "No onion")).toBe("extra lemon, No onion");
    expect(toggleQuickNote("extra lemon, No onion", "No onion")).toBe("extra lemon");
    expect(toggleQuickNote("प्याज़ कम, Jain", "Jain")).toBe("प्याज़ कम");
  });

  it("refuses a chip that would pass 140 characters", () => {
    expect(toggleQuickNote("a".repeat(135), "No onion")).toBeNull();
  });

  it("stores notes trimmed and capped by characters", () => {
    expect(cleanNote("  less   spicy  ")).toBe("less spicy");
    expect(Array.from(cleanNote("क".repeat(200)))).toHaveLength(140);
    expect(cleanNote(null)).toBe("");
  });

  it("treats lines as the same only with the same options and note", () => {
    expect(lineKey("bc", ["naan", "gravy"], "Less spicy")).toBe(lineKey("bc", ["gravy", "naan"], " Less  spicy "));
    expect(lineKey("bc", ["naan"], "Less spicy")).not.toBe(lineKey("bc", ["naan"], "No onion"));
    expect(lineKey("bc", ["naan"], "")).not.toBe(lineKey("bc", ["roti"], ""));
  });
});
