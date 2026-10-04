// Whole-rupee price writes and bulk adjustments (O3 brand prices, O4 outlet prices). All money is
// integer paise; new prices are whole rupees. Older prices with paise stay readable and billable.

export type AdjustMode = "percent" | "fixed";

export const MAX_PRICE_PAISE = 10_000_000; // ₹1,00,000

export const isWholeRupee = (paise: number) => Number.isInteger(paise) && paise % 100 === 0;

/** A price someone is typing in now: whole rupees, not negative, within reason */
export const isValidNewPrice = (paise: number) => isWholeRupee(paise) && paise >= 0 && paise <= MAX_PRICE_PAISE;

/**
 * Checks a bulk adjustment amount. Percent: -100 to +500 with at most two decimals (12.5 = +12.5%).
 * Fixed: whole rupees in paise, positive or negative.
 */
export function validAdjustment(mode: AdjustMode, amount: number): boolean {
  if (!Number.isFinite(amount) || amount === 0) return false;
  if (mode === "percent") return amount >= -100 && amount <= 500 && Number.isInteger(Math.round(amount * 100)) && Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-9;
  return isWholeRupee(Math.abs(amount)) && Math.abs(amount) <= MAX_PRICE_PAISE;
}

/** Half up to the nearest rupee, in integer arithmetic so the result never depends on float error */
function roundRatioToRupee(numerator: number, denominator: number): number {
  // numerator / denominator is in paise; returns whole rupees in paise, half up
  return Math.floor((2 * numerator + 100 * denominator) / (200 * denominator)) * 100;
}

/**
 * The new price after a bulk adjustment of `basePaise` (the current effective price). Rounded half up
 * to a whole rupee, never below zero.
 */
export function adjustPrice(basePaise: number, mode: AdjustMode, amount: number): number {
  if (mode === "percent") {
    const bp = Math.round(amount * 100); // +10% = 1000 bp
    const next = Math.max(0, basePaise * (10_000 + bp));
    return roundRatioToRupee(next, 10_000);
  }
  return Math.max(0, roundRatioToRupee(Math.max(0, basePaise + Math.round(amount)), 1));
}
