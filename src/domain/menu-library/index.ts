import { LIBRARY } from "./data";

// Search over the TableQR menu library (see data.ts). Pure functions, so they run on the server
// and in tests; the console asks the server, which keeps the whole list out of the browser.

export type LibraryItem = {
  /** Stable id: category key / dish slug */
  id: string;
  categoryKey: string;
  nameEn: string;
  nameHi: string;
  isVeg: boolean;
  /** 0 not spicy … 3 hot */
  spice: number;
  /** Other names guests type, comma separated, ready for the dish's search field */
  searchTerms: string;
  station: string;
  prepMinutes: number;
  /** Sizes this kind of dish is often sold in (from its category) */
  sizes: string[];
};

export type LibraryCategory = {
  key: string;
  nameEn: string;
  nameHi: string;
  aliases: string;
  station: string;
  sizes: string[];
  itemCount: number;
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const norm = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^a-z0-9ऀ-ॿ]+/g, " ").trim();
/** Consonants only, doubles squeezed: "paneer" and "panir" both become "pnr", "chowmein" and "chowmin" "chwmn" */
const skeleton = (s: string) => norm(s).replace(/[aeiouy\s]/g, "").replace(/(.)\1+/g, "$1");

const CATEGORIES: LibraryCategory[] = LIBRARY.map((c) => ({
  key: c.key,
  nameEn: c.en,
  nameHi: c.hi,
  aliases: c.aliases ?? "",
  station: c.station,
  sizes: c.sizes ?? [],
  itemCount: c.items.length,
}));

const ITEMS: LibraryItem[] = LIBRARY.flatMap((c) =>
  c.items.map((line) => {
    const [nameEn, nameHi, code, aliases] = line.split("|");
    return {
      id: `${c.key}/${slug(nameEn)}`,
      categoryKey: c.key,
      nameEn,
      nameHi,
      isVeg: code.startsWith("v"),
      spice: Math.max(0, Math.min(3, Number(code.slice(1)) || 0)),
      searchTerms: (aliases ?? "").trim(),
      station: c.station,
      prepMinutes: c.prep,
      sizes: c.sizes ?? [],
    };
  }),
);

const byId = new Map(ITEMS.map((i) => [i.id, i]));
const categoryByKey = new Map(CATEGORIES.map((c) => [c.key, c]));

/** How well a query matches some text, 0 when it does not */
function score(query: string, texts: { text: string; weight: number }[]): number {
  const q = norm(query);
  if (!q) return 0;
  const qCompact = q.replace(/\s/g, "");
  const qSkel = skeleton(q);
  let best = 0;
  for (const { text, weight } of texts) {
    const t = norm(text);
    if (!t) continue;
    let s = 0;
    if (t === q) s = 120;
    else if (t.startsWith(q)) s = 100;
    else if (t.split(" ").some((w) => w.startsWith(q))) s = 85;
    else if (t.replace(/\s/g, "").includes(qCompact)) s = 65;
    else if (qSkel.length >= 3 && t.split(" ").some((w) => skeleton(w).startsWith(qSkel))) s = 45;
    else if (qSkel.length >= 4 && skeleton(t).includes(qSkel)) s = 35;
    best = Math.max(best, s * weight);
  }
  return best;
}

export function libraryCategories(): LibraryCategory[] {
  return CATEGORIES;
}

export function libraryCategory(key: string): LibraryCategory | null {
  return categoryByKey.get(key) ?? null;
}

export function libraryItem(id: string): LibraryItem | null {
  return byId.get(id) ?? null;
}

export function libraryItemsIn(categoryKey: string): LibraryItem[] {
  return ITEMS.filter((i) => i.categoryKey === categoryKey);
}

/** Categories for a typed word: "fas" finds Fast Food, "chai" finds Tea & Hot Drinks */
export function searchLibraryCategories(query: string, limit = 8): LibraryCategory[] {
  return CATEGORIES.map((c) => ({
    c,
    s: score(query, [
      { text: c.nameEn, weight: 1 },
      { text: c.nameHi, weight: 0.9 },
      ...c.aliases.split(",").map((a) => ({ text: a, weight: 0.85 })),
    ]),
  }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.c.nameEn.length - b.c.nameEn.length)
    .slice(0, limit)
    .map((x) => x.c);
}

/** Dishes for a typed word, best first; optionally only inside one category */
export function searchLibraryItems(query: string, opts: { categoryKey?: string; limit?: number } = {}): LibraryItem[] {
  const pool = opts.categoryKey ? ITEMS.filter((i) => i.categoryKey === opts.categoryKey) : ITEMS;
  return pool
    .map((i) => ({
      i,
      s: score(query, [
        { text: i.nameEn, weight: 1 },
        { text: i.nameHi, weight: 0.9 },
        ...i.searchTerms.split(",").map((a) => ({ text: a, weight: 0.8 })),
      ]),
    }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i.nameEn.length - b.i.nameEn.length)
    .slice(0, opts.limit ?? 12)
    .map((x) => x.i);
}

export const LIBRARY_SIZE = { categories: CATEGORIES.length, items: ITEMS.length };
