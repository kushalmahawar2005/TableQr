// GST invoice numbering (PS 6.2): gapless per outlet per financial year, e.g. SRJ01/26/000123 for
// FY 2026-27. GST rule 46 allows at most 16 characters, unique within the financial year.

/** Indian financial year (April to March) for a moment, in the outlet's timezone */
export function financialYear(at: Date, timeZone = "Asia/Kolkata"): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "numeric" }).formatToParts(at);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  const start = month >= 4 ? year : year - 1;
  const yy = (n: number) => String(n % 100).padStart(2, "0");
  return `${yy(start)}-${yy(start + 1)}`;
}

export const INVOICE_NUMBER_MAX = 16;

/**
 * Outlet code, the financial year's start ("26" for 2026-27) and the six-digit serial. A long
 * outlet code first loses the separators, then is shortened, so the number never passes 16.
 */
export function formatInvoiceNumber(outletCode: string, fy: string, seq: number): string {
  const yy = fy.slice(0, 2);
  const serial = String(seq).padStart(6, "0");
  const spaced = `${outletCode}/${yy}/${serial}`;
  if (spaced.length <= INVOICE_NUMBER_MAX) return spaced;
  const room = Math.max(1, INVOICE_NUMBER_MAX - yy.length - serial.length);
  return `${outletCode.slice(0, room)}${yy}${serial}`;
}
