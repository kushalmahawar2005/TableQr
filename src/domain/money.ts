// All money is integer paise. Rates are basis points (500 = 5%).

/** Rounds half up to the nearest integer; used for paise and rupee rounding */
export function roundHalfUp(n: number): number {
  return Math.sign(n) * Math.floor(Math.abs(n) + 0.5);
}

/** Rounds paise to the nearest whole rupee, still expressed in paise */
export function roundToRupee(paise: number): number {
  return roundHalfUp(paise / 100) * 100;
}

const grouping = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const groupingWithPaise = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Indian grouping with the INR prefix used across the spec:
 * formatINR(18420000) -> "INR 1,84,200"; with paise -> "INR 1,990.00".
 */
export function formatINR(paise: number, opts: { paise?: boolean; prefix?: boolean } = {}): string {
  const { paise: showPaise = false, prefix = true } = opts;
  const value = showPaise ? groupingWithPaise.format(paise / 100) : grouping.format(paise / 100);
  return prefix ? `INR ${value}` : value;
}
