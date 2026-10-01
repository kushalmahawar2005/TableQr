// Server-side price of one cart or order line (PS 3.3: the phone only sends ids and quantities).

export type PricingModifier = {
  id: string;
  nameEn: string;
  nameHi: string | null;
  priceDeltaPaise: number;
  isAvailable: boolean;
};

export type PricingGroup = {
  id: string;
  nameEn: string;
  nameHi?: string | null;
  minSelect: number;
  maxSelect: number;
  modifiers: PricingModifier[];
};

export type PricingItem = {
  id: string;
  /** Outlet override price if set, else the central menu price */
  pricePaise: number;
  isAvailable: boolean;
  groups: PricingGroup[];
};

export type LinePriceError =
  | { code: "item_unavailable" }
  | { code: "bad_quantity" }
  | { code: "unknown_modifier"; modifierId: string }
  | { code: "modifier_unavailable"; modifierId: string }
  | { code: "duplicate_modifier"; modifierId: string }
  | { code: "too_few"; groupId: string; groupName: string; min: number }
  | { code: "too_many"; groupId: string; groupName: string; max: number };

export type PricedLine = {
  unitPricePaise: number;
  linePaise: number;
  modifiers: { groupId: string; modifierId: string; nameEn: string; nameHi: string | null; priceDeltaPaise: number }[];
};

export const MAX_QTY = 50;

export function priceLine(
  item: PricingItem,
  qty: number,
  modifierIds: string[],
): { ok: true; line: PricedLine } | { ok: false; error: LinePriceError } {
  if (!item.isAvailable) return { ok: false, error: { code: "item_unavailable" } };
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
    return { ok: false, error: { code: "bad_quantity" } };
  }

  const byId = new Map<string, { group: PricingGroup; mod: PricingModifier }>();
  for (const group of item.groups) for (const mod of group.modifiers) byId.set(mod.id, { group, mod });

  const seen = new Set<string>();
  const chosen: PricedLine["modifiers"] = [];
  for (const modifierId of modifierIds) {
    if (seen.has(modifierId)) return { ok: false, error: { code: "duplicate_modifier", modifierId } };
    seen.add(modifierId);
    const hit = byId.get(modifierId);
    if (!hit) return { ok: false, error: { code: "unknown_modifier", modifierId } };
    if (!hit.mod.isAvailable) return { ok: false, error: { code: "modifier_unavailable", modifierId } };
    chosen.push({
      groupId: hit.group.id,
      modifierId,
      nameEn: hit.mod.nameEn,
      nameHi: hit.mod.nameHi,
      priceDeltaPaise: hit.mod.priceDeltaPaise,
    });
  }

  for (const group of item.groups) {
    const count = chosen.filter((c) => c.groupId === group.id).length;
    if (count < group.minSelect) {
      return { ok: false, error: { code: "too_few", groupId: group.id, groupName: group.nameEn, min: group.minSelect } };
    }
    if (count > group.maxSelect) {
      return { ok: false, error: { code: "too_many", groupId: group.id, groupName: group.nameEn, max: group.maxSelect } };
    }
  }

  const unitPricePaise = item.pricePaise + chosen.reduce((sum, c) => sum + c.priceDeltaPaise, 0);
  return { ok: true, line: { unitPricePaise, linePaise: unitPricePaise * qty, modifiers: chosen } };
}
