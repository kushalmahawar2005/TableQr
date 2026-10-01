import { MAX_QTY, type PricingGroup } from "./pricing";

// Rules behind the G4 item sheet: option-group wording, what is still missing, live price,
// quick-note chips and which cart lines count as the same.

export type GroupRule = { required: boolean; kind: "one" | "exact" | "upTo" | "range"; min: number; max: number };

/** min/max as words: "Choose 1", "Choose 2", "Choose up to 3", "Choose 1 to 3" */
export function groupRule(g: Pick<PricingGroup, "minSelect" | "maxSelect">): GroupRule {
  const min = Math.max(0, g.minSelect);
  const max = Math.max(1, g.maxSelect);
  const required = min > 0;
  if (max === 1) return { required, kind: "one", min, max };
  if (min === max) return { required, kind: "exact", min, max };
  if (min === 0) return { required, kind: "upTo", min, max };
  return { required, kind: "range", min, max };
}

/** A group whose required minimum can still be met with what is available */
export const canSatisfy = (g: PricingGroup) => g.modifiers.filter((m) => m.isAvailable).length >= g.minSelect;

/** The first required group without enough choices, or null when the line is complete */
export function firstIncomplete<G extends PricingGroup>(groups: G[], selected: Set<string>): G | null {
  for (const g of groups) {
    const count = g.modifiers.filter((m) => selected.has(m.id) && m.isAvailable).length;
    if (count < g.minSelect) return g;
  }
  return null;
}

/** (base + chosen option prices) × quantity, the same sum the server makes */
export function linePrice(basePaise: number, groups: PricingGroup[], selected: Set<string>, qty: number): number {
  let unit = basePaise;
  for (const g of groups) for (const m of g.modifiers) if (selected.has(m.id)) unit += m.priceDeltaPaise;
  return unit * Math.min(Math.max(qty, 1), MAX_QTY);
}

// Quick notes save their English text for the kitchen, whatever language the guest uses
export const QUICK_NOTES = ["Less spicy", "No onion", "Jain"] as const;
export type QuickNote = (typeof QUICK_NOTES)[number];
export const NOTE_MAX = 140;

const parts = (note: string) =>
  note
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

export const hasQuickNote = (note: string, chip: QuickNote) => parts(note).some((p) => p.toLowerCase() === chip.toLowerCase());

/**
 * Adds the chip's phrase, or removes it when it is already there. Free text is kept as typed.
 * Returns null when adding would pass the 140-character limit.
 */
export function toggleQuickNote(note: string, chip: QuickNote): string | null {
  const list = parts(note);
  const next = hasQuickNote(note, chip) ? list.filter((p) => p.toLowerCase() !== chip.toLowerCase()) : [...list, chip];
  const text = next.join(", ");
  return Array.from(text).length > NOTE_MAX ? null : text;
}

/** Note as stored: trimmed, spaces collapsed, at most 140 characters */
export function cleanNote(note: string | null | undefined): string {
  return Array.from((note ?? "").replace(/\s+/g, " ").trim()).slice(0, NOTE_MAX).join("");
}

/** Two cart lines are the same order only with the same dish, option set and note */
export function lineKey(itemId: string, modifierIds: string[], note: string | null | undefined): string {
  return `${itemId}|${[...new Set(modifierIds)].sort().join(",")}|${cleanNote(note)}`;
}
