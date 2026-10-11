import { describe, expect, it } from "vitest";
import { LIBRARY } from "./data";
import { LIBRARY_SIZE, libraryItem, libraryItemsIn, searchLibraryCategories, searchLibraryItems } from "./index";

describe("menu library data", () => {
  it("has a sizeable, well-formed list with unique dishes", () => {
    expect(LIBRARY_SIZE.categories).toBeGreaterThanOrEqual(45);
    expect(LIBRARY_SIZE.items).toBeGreaterThanOrEqual(700);
    const keys = new Set<string>();
    for (const c of LIBRARY) {
      expect(keys.has(c.key)).toBe(false);
      keys.add(c.key);
      const ids = new Set<string>();
      for (const line of c.items) {
        const [en, hi, code] = line.split("|");
        expect(en.trim().length, line).toBeGreaterThan(1);
        expect(hi.trim().length, line).toBeGreaterThan(0);
        expect(code, line).toMatch(/^[vn][0-3]$/);
        expect(ids.has(en.toLowerCase()), `duplicate ${en} in ${c.key}`).toBe(false);
        ids.add(en.toLowerCase());
      }
    }
  });

  it("gives every dish its category, station, prep time and usual sizes", () => {
    const pizza = searchLibraryItems("margherita")[0];
    expect(pizza).toMatchObject({ nameEn: "Margherita Pizza", categoryKey: "pizza", isVeg: true, station: "Pizza", sizes: ["Regular", "Medium", "Large"] });
    expect(libraryItem(pizza.id)).toEqual(pizza);
    expect(libraryItemsIn("pizza").every((i) => i.categoryKey === "pizza")).toBe(true);
    expect(searchLibraryItems("butter chicken")[0]).toMatchObject({ isVeg: false, categoryKey: "chicken-main", sizes: ["Half", "Full"] });
  });
});

describe("menu library search", () => {
  it("finds categories from the first letters, a second name or Hindi", () => {
    expect(searchLibraryCategories("fas")[0].nameEn).toBe("Fast Food");
    expect(searchLibraryCategories("chai")[0].nameEn).toBe("Tea & Hot Drinks");
    expect(searchLibraryCategories("biriyani")[0].nameEn).toBe("Biryani");
    expect(searchLibraryCategories("पिज़्ज़ा")[0].nameEn).toBe("Pizza");
  });

  it("finds dishes from partial, misspelt or Hindi words", () => {
    expect(searchLibraryItems("marg")[0].nameEn).toBe("Margherita Pizza");
    expect(searchLibraryItems("panir tikka")[0].nameEn).toBe("Paneer Tikka");
    expect(searchLibraryItems("chowmin").map((i) => i.nameEn)).toContain("Veg Chowmein");
    expect(searchLibraryItems("golgappe")[0].nameEn).toBe("Pani Puri");
    expect(searchLibraryItems("दाल मखनी")[0].nameEn).toBe("Dal Makhani");
    expect(searchLibraryItems("cold cof")[0].nameEn).toBe("Cold Coffee");
  });

  it("can stay inside one category and returns nothing for nonsense", () => {
    expect(searchLibraryItems("paneer", { categoryKey: "pizza" }).every((i) => i.categoryKey === "pizza")).toBe(true);
    expect(searchLibraryItems("zzqx")).toEqual([]);
    expect(searchLibraryItems("")).toEqual([]);
  });
});
