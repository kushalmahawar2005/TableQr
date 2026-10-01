import type { Allergen, SpiceLevel } from "./allergens";

// Dietary filters on the guest menu (G3 decisions 12–16). Filters only hide dishes; they never
// reorder anything. A dish whose data is not stated never passes a filter that depends on it.

export type DietChoice = "all" | "veg" | "non_veg";

export type MenuFilters = {
  diet: DietChoice;
  jainOnly: boolean;
  /** Highest spice the guest wants; null = no spice filter */
  maxSpice: SpiceLevel | null;
  avoid: Allergen[];
};

export const NO_FILTERS: MenuFilters = { diet: "all", jainOnly: false, maxSpice: null, avoid: [] };

export type Filterable = { isVeg: boolean; isJain: boolean; spice: SpiceLevel | null; allergens: Allergen[] | null };

export const hasActiveFilters = (f: MenuFilters) => f.diet !== "all" || f.jainOnly || f.maxSpice !== null || f.avoid.length > 0;

export type FilterVerdict = "shown" | "hidden" | "hidden_allergen_unknown";

export function filterVerdict(item: Filterable, f: MenuFilters): FilterVerdict {
  if (f.diet === "veg" && !item.isVeg) return "hidden";
  if (f.diet === "non_veg" && item.isVeg) return "hidden";
  if (f.jainOnly && !item.isJain) return "hidden";
  // Not stated never matches a tolerance
  if (f.maxSpice !== null && (item.spice === null || item.spice > f.maxSpice)) return "hidden";
  if (f.avoid.length) {
    if (item.allergens === null || item.allergens.includes("other")) return "hidden_allergen_unknown";
    if (item.allergens.some((a) => f.avoid.includes(a))) return "hidden";
  }
  return "shown";
}

/** Shown items plus how many were hidden, and how many of those only for missing allergen data */
export function applyFilters<T extends Filterable>(items: T[], f: MenuFilters) {
  const shown: T[] = [];
  let hidden = 0;
  let unknownAllergens = 0;
  for (const item of items) {
    const v = filterVerdict(item, f);
    if (v === "shown") shown.push(item);
    else {
      hidden++;
      if (v === "hidden_allergen_unknown") unknownAllergens++;
    }
  }
  return { shown, hidden, unknownAllergens };
}
