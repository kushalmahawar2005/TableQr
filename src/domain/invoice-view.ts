// How a bill or invoice is shown to a guest, on screen, as a PDF and on the receipt printer. Every
// renderer uses these so the documents agree.

import { splitTax } from "./gst";

/** The outlet's address line; the city is added only when the address does not already name it */
export function addressLine(address: string | null | undefined, city: string | null | undefined): string {
  const a = address?.trim() ?? "";
  const c = city?.trim() ?? "";
  if (!a) return c;
  return !c || a.toLowerCase().includes(c.toLowerCase()) ? a : `${a}, ${c}`;
}

/** The same dish at the same price ordered in several rounds is one line, with the quantities added */
export function mergeLines<T extends { qty: number; amountPaise: number }>(lines: readonly T[], key: (line: T) => string): T[] {
  const merged = new Map<string, T>();
  for (const line of lines) {
    const k = key(line);
    const seen = merged.get(k);
    merged.set(k, seen ? { ...seen, qty: seen.qty + line.qty, amountPaise: seen.amountPaise + line.amountPaise } : { ...line });
  }
  return [...merged.values()];
}

/** An invoice snapshot line's dish identity: its name and unit price */
export const dishKey = (line: { nameEn: string; qty: number; amountPaise: number }) => `${line.nameEn}|${Math.round(line.amountPaise / Math.max(1, line.qty))}`;

const pct = (bp: number) => `${(bp / 100).toFixed(2).replace(/\.?0+$/, "")}%`;

/**
 * Tax lines. A GST-registered seller shows CGST and SGST halves per rate (intra-state sale); the
 * halves always add up to the tax. Without a GSTIN it is one line per rate.
 */
export function taxRows(breakup: Record<string, number> | null | undefined, gstin: string | null | undefined, taxPaise = 0): { label: string; paise: number }[] {
  const rates = Object.entries(breakup ?? {}).map(([bp, tax]) => [Number(bp), tax] as const).filter(([, tax]) => tax > 0).sort((x, y) => x[0] - y[0]);
  if (!rates.length) {
    if (!taxPaise) return [];
    if (!gstin?.trim()) return [{ label: "GST", paise: taxPaise }];
    const { cgst, sgst } = splitTax(taxPaise);
    return [{ label: "CGST", paise: cgst }, { label: "SGST", paise: sgst }];
  }
  if (!gstin?.trim()) return rates.map(([bp, tax]) => ({ label: bp ? `GST ${pct(bp)}` : "GST", paise: tax }));
  return rates.flatMap(([bp, tax]) => {
    const { cgst, sgst } = splitTax(tax);
    return [{ label: bp ? `CGST ${pct(bp / 2)}` : "CGST", paise: cgst }, { label: bp ? `SGST ${pct(bp / 2)}` : "SGST", paise: sgst }];
  });
}
