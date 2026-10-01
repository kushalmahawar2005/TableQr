// Controlled allergen list (G3 decision 12). A dish stores codes from this list:
// null means the restaurant has not stated its allergens (never treated as safe),
// [] means it declared none of the listed allergens.

export const ALLERGENS = [
  "dairy",
  "gluten",
  "peanut",
  "tree_nuts",
  "soy",
  "egg",
  "sesame",
  "mustard",
  "fish",
  "shellfish",
  "sulphites",
  "other",
] as const;

export type Allergen = (typeof ALLERGENS)[number];

export const ALLERGEN_LABELS: Record<Allergen, { en: string; hi: string }> = {
  dairy: { en: "Dairy", hi: "डेयरी" },
  gluten: { en: "Gluten / wheat", hi: "ग्लूटेन / गेहूं" },
  peanut: { en: "Peanut", hi: "मूंगफली" },
  tree_nuts: { en: "Tree nuts", hi: "मेवे" },
  soy: { en: "Soy", hi: "सोया" },
  egg: { en: "Egg", hi: "अंडा" },
  sesame: { en: "Sesame", hi: "तिल" },
  mustard: { en: "Mustard", hi: "सरसों" },
  fish: { en: "Fish", hi: "मछली" },
  shellfish: { en: "Shellfish", hi: "शेलफ़िश" },
  sulphites: { en: "Sulphites", hi: "सल्फ़ाइट" },
  other: { en: "Other / unknown", hi: "अन्य / पता नहीं" },
};

export const isAllergen = (v: unknown): v is Allergen => typeof v === "string" && (ALLERGENS as readonly string[]).includes(v);

/**
 * Stored allergen data as codes. Anything not on the list becomes "other", so an unexpected
 * value can only make a dish look less safe, never more.
 */
export function parseAllergens(raw: unknown): Allergen[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return ["other"];
  return [...new Set(raw.map((v) => (isAllergen(v) ? v : "other")))];
}

export const SPICE_LEVELS = [0, 1, 2, 3] as const;
export type SpiceLevel = (typeof SPICE_LEVELS)[number];

/** Stored spice as 0–3, or null when the restaurant has not stated it */
export function parseSpice(raw: unknown): SpiceLevel | null {
  return typeof raw === "number" && (SPICE_LEVELS as readonly number[]).includes(raw) ? (raw as SpiceLevel) : null;
}
