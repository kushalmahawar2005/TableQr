// Guest menu search (G3 decision 17): English name, Hindi name and the restaurant's own
// aliases. Normalisation is deliberately conservative: case, accents, punctuation and spacing
// only. Spelling variants come from the aliases the restaurant enters, not from guessing.

/** Lowercase, accents stripped, Hindi nukta and ZW joiners dropped, punctuation to spaces */
export function normaliseSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // Latin accents
    .replace(/[़‌‍]/g, "") // Devanagari nukta, zero-width joiners
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

export type Searchable = { nameEn: string; nameHi: string | null; searchTerms: string | null };

/** 3: a name starts with the query, 2: a word starts with every part, 1: contains every part, 0: no match */
export function searchScore(item: Searchable, query: string): number {
  const q = normaliseSearch(query);
  if (!q) return 0;
  const parts = q.split(" ");
  const fields = [item.nameEn, item.nameHi ?? "", ...(item.searchTerms?.split(",") ?? [])].map(normaliseSearch).filter(Boolean);

  let best = 0;
  for (const f of fields) {
    if (f.startsWith(q)) return 3;
    const words = f.split(" ");
    if (parts.every((p) => words.some((w) => w.startsWith(p)))) best = Math.max(best, 2);
    else if (parts.every((p) => f.includes(p))) best = Math.max(best, 1);
  }
  return best;
}

/** Matching items, best first; equal scores keep menu order */
export function searchItems<T extends Searchable>(items: T[], query: string): T[] {
  return items
    .map((item, i) => ({ item, i, score: searchScore(item, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.item);
}
