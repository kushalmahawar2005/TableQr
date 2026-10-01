// GST invoice numbering (PS 6.2): gapless per outlet per financial year, e.g. SRJ01/26-27/000123.

/** Indian financial year (April to March) for a moment, in the outlet's timezone */
export function financialYear(at: Date, timeZone = "Asia/Kolkata"): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "numeric" }).formatToParts(at);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  const start = month >= 4 ? year : year - 1;
  const yy = (n: number) => String(n % 100).padStart(2, "0");
  return `${yy(start)}-${yy(start + 1)}`;
}

export function formatInvoiceNumber(outletCode: string, fy: string, seq: number): string {
  return `${outletCode}/${fy}/${String(seq).padStart(6, "0")}`;
}
