import type { PricingGroup } from "./pricing";

// What a menu row shows for price and actions (G3 decisions 2, 9, 22).

export type OptionsKind = "none" | "optional" | "required";

export function optionsKind(groups: Pick<PricingGroup, "minSelect">[]): OptionsKind {
  if (groups.length === 0) return "none";
  return groups.some((g) => g.minSelect > 0) ? "required" : "optional";
}

/**
 * Lowest price the guest can actually order the dish for. "From" only when a required choice
 * can raise the price above that, e.g. a bread costing ₹0, ₹40 or ₹60.
 */
export function rowPrice(basePaise: number, groups: PricingGroup[]): { paise: number; from: boolean } {
  let min = basePaise;
  let varies = false;
  for (const g of groups) {
    if (g.minSelect <= 0) continue;
    const deltas = g.modifiers
      .filter((m) => m.isAvailable)
      .map((m) => m.priceDeltaPaise)
      .sort((a, b) => a - b);
    if (deltas.length === 0) continue;
    min += deltas.slice(0, g.minSelect).reduce((sum, d) => sum + d, 0);
    if (deltas[deltas.length - 1] > deltas[0] || g.maxSelect > g.minSelect) varies = true;
  }
  return { paise: min, from: varies };
}

export type MenuTag = "bestseller" | "chefs_pick" | "new";

/** At most one tag per row: Bestseller, then Chef's pick, then New */
export function primaryTag(tags: readonly string[] | null | undefined): MenuTag | null {
  for (const t of ["bestseller", "chefs_pick", "new"] as const) if (tags?.includes(t)) return t;
  return null;
}

/** "₹1,84,200": Indian grouping, no paise, for guest screens */
export function formatRupees(paise: number): string {
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(paise / 100))}`;
}
