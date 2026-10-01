import { describe, expect, it } from "vitest";
import { parseAllergens, parseSpice } from "./allergens";
import { applyFilters, filterVerdict, hasActiveFilters, NO_FILTERS, type Filterable } from "./menu-filter";
import { formatRupees, optionsKind, primaryTag, rowPrice } from "./menu-price";
import { normaliseSearch, searchItems } from "./menu-search";

describe("menu search (G3)", () => {
  const items = [
    { nameEn: "Paneer Tikka", nameHi: "पनीर टिक्का", searchTerms: "panir tikka, paner" },
    { nameEn: "Kadai Paneer", nameHi: "कड़ाही पनीर", searchTerms: "karahi" },
    { nameEn: "Butter Chicken", nameHi: "बटर चिकन", searchTerms: null },
    { nameEn: "Veg Biryani", nameHi: "वेज बिरयानी", searchTerms: null },
  ];
  const names = (q: string) => searchItems(items, q).map((i) => i.nameEn);

  it("matches English names, prefix first", () => {
    expect(names("paneer")).toEqual(["Paneer Tikka", "Kadai Paneer"]);
    expect(names("BUTTER chick")).toEqual(["Butter Chicken"]);
    expect(names("tikka paneer")).toEqual(["Paneer Tikka"]);
  });

  it("matches Hindi names whatever the interface language", () => {
    expect(names("पनीर")).toEqual(["Paneer Tikka", "Kadai Paneer"]);
    // Nukta written or not
    expect(names("कडाही")).toEqual(["Kadai Paneer"]);
  });

  it("uses the restaurant's aliases for other spellings", () => {
    expect(names("panir")).toEqual(["Paneer Tikka"]);
    expect(names("karahi")).toEqual(["Kadai Paneer"]);
  });

  it("does not guess phonetic swaps", () => {
    expect(names("weg biryani")).toEqual([]);
    expect(names("biriyani")).toEqual([]);
  });

  it("normalises case, accents and punctuation only", () => {
    expect(normaliseSearch("  Crème-Brûlée!! ")).toBe("creme brulee");
    expect(names("")).toEqual([]);
  });
});

describe("menu filters (G3)", () => {
  const dish = (over: Partial<Filterable>): Filterable => ({ isVeg: true, isJain: false, spice: 1, allergens: [], ...over });

  it("diet is a single choice and Jain is Jain-only", () => {
    expect(filterVerdict(dish({ isVeg: false }), { ...NO_FILTERS, diet: "veg" })).toBe("hidden");
    expect(filterVerdict(dish({ isVeg: true }), { ...NO_FILTERS, diet: "non_veg" })).toBe("hidden");
    expect(filterVerdict(dish({ isJain: false }), { ...NO_FILTERS, jainOnly: true })).toBe("hidden");
    expect(filterVerdict(dish({ isJain: true }), { ...NO_FILTERS, jainOnly: true })).toBe("shown");
  });

  it("spice is a maximum, and a dish without a stated spice level never matches", () => {
    const mild = { ...NO_FILTERS, maxSpice: 1 as const };
    expect(filterVerdict(dish({ spice: 0 }), mild)).toBe("shown");
    expect(filterVerdict(dish({ spice: 1 }), mild)).toBe("shown");
    expect(filterVerdict(dish({ spice: 2 }), mild)).toBe("hidden");
    expect(filterVerdict(dish({ spice: null }), mild)).toBe("hidden");
    expect(filterVerdict(dish({ spice: null }), NO_FILTERS)).toBe("shown");
  });

  it("avoid allergens hides matches and never treats missing data as safe", () => {
    const noDairy = { ...NO_FILTERS, avoid: ["dairy" as const] };
    expect(filterVerdict(dish({ allergens: ["dairy", "gluten"] }), noDairy)).toBe("hidden");
    expect(filterVerdict(dish({ allergens: ["gluten"] }), noDairy)).toBe("shown");
    expect(filterVerdict(dish({ allergens: [] }), noDairy)).toBe("shown");
    expect(filterVerdict(dish({ allergens: null }), noDairy)).toBe("hidden_allergen_unknown");
    expect(filterVerdict(dish({ allergens: ["other"] }), noDairy)).toBe("hidden_allergen_unknown");
    // Without an allergen filter, unknown data hides nothing
    expect(filterVerdict(dish({ allergens: null }), NO_FILTERS)).toBe("shown");
  });

  it("counts what is hidden", () => {
    const res = applyFilters(
      [dish({}), dish({ isVeg: false }), dish({ allergens: null }), dish({ allergens: ["dairy"] })],
      { ...NO_FILTERS, diet: "veg", avoid: ["dairy"] },
    );
    expect(res).toMatchObject({ hidden: 3, unknownAllergens: 1 });
    expect(res.shown).toHaveLength(1);
    expect(hasActiveFilters(NO_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...NO_FILTERS, jainOnly: true })).toBe(true);
  });
});

describe("menu rows (G3)", () => {
  const mod = (priceDeltaPaise: number, isAvailable = true) => ({ id: "m", nameEn: "", nameHi: null, priceDeltaPaise, isAvailable });
  const group = (minSelect: number, maxSelect: number, deltas: number[]) => ({
    id: "g",
    nameEn: "",
    minSelect,
    maxSelect,
    modifiers: deltas.map((d) => mod(d)),
  });

  it("knows which dishes need a choice", () => {
    expect(optionsKind([])).toBe("none");
    expect(optionsKind([{ minSelect: 0 }])).toBe("optional");
    expect(optionsKind([{ minSelect: 0 }, { minSelect: 1 }])).toBe("required");
  });

  it("shows From only when a required choice can raise the price", () => {
    expect(rowPrice(38000, [])).toEqual({ paise: 38000, from: false });
    expect(rowPrice(38000, [group(0, 3, [3000])])).toEqual({ paise: 38000, from: false });
    expect(rowPrice(38000, [group(1, 1, [6000, 4000, 0])])).toEqual({ paise: 38000, from: true });
    expect(rowPrice(30000, [group(1, 1, [5000, 7000])])).toEqual({ paise: 35000, from: true });
    expect(rowPrice(30000, [group(1, 1, [0, 0])])).toEqual({ paise: 30000, from: false });
  });

  it("shows one tag, by priority", () => {
    expect(primaryTag(["new", "chefs_pick", "bestseller"])).toBe("bestseller");
    expect(primaryTag(["new", "chefs_pick"])).toBe("chefs_pick");
    expect(primaryTag(null)).toBeNull();
  });

  it("formats rupees the Indian way", () => {
    expect(formatRupees(28000)).toBe("₹280");
    expect(formatRupees(18420000)).toBe("₹1,84,200");
  });

  it("reads stored allergens and spice safely", () => {
    expect(parseAllergens(null)).toBeNull();
    expect(parseAllergens([])).toEqual([]);
    expect(parseAllergens(["dairy", "nuts", "dairy"])).toEqual(["dairy", "other"]);
    expect(parseSpice(2)).toBe(2);
    expect(parseSpice(null)).toBeNull();
    expect(parseSpice(7)).toBeNull();
  });
});
