// Stock quantities are kept as whole thousandths of the unit. These turn what a person types
// ("1.5", "250") into that and back, and say it in plain words ("1.5 kg", "12 pcs").

export const UNIT_LABEL = { kg: "kg", g: "g", l: "litre", ml: "ml", pcs: "pcs" } as const;
export type StockUnit = keyof typeof UNIT_LABEL;

/** "1.5" -> 1500; null for anything that is not a number of at most three decimals */
export function toMilli(text: string | number): number | null {
  const t = String(text).trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d{1,3})?$/.test(t)) return null;
  const v = Math.round(Number(t) * 1000);
  return Number.isSafeInteger(v) && Math.abs(v) <= 2_000_000_000 ? v : null;
}

/** 1500 -> "1.5"; drops trailing zeros */
export const fromMilli = (milli: number) => String(Math.round(milli) / 1000);

export const showQty = (milli: number, unit: StockUnit) => `${(Math.round(milli) / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${UNIT_LABEL[unit]}`;

/** How much of each stock item a set of sold dishes uses, from their recipes */
export function usage(sold: { itemId: string; qty: number }[], recipes: { itemId: string; stockItemId: string; qtyMilli: number }[]) {
  const per = new Map<string, number>();
  const plates = new Map<string, number>();
  for (const s of sold) plates.set(s.itemId, (plates.get(s.itemId) ?? 0) + s.qty);
  for (const r of recipes) {
    const n = plates.get(r.itemId);
    if (n) per.set(r.stockItemId, (per.get(r.stockItemId) ?? 0) + r.qtyMilli * n);
  }
  return per;
}

export const isLow = (item: { qtyMilli: number; lowMilli: number | null }) => item.lowMilli !== null && item.qtyMilli <= item.lowMilli;
