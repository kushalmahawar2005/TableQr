// GST summary for a month of invoices (GSTR-1 style, restaurant sales within one state).
// Tax is split equally into CGST and SGST. The taxable value per rate is worked back from the tax
// at that rate, which is how the bill computed it; whatever is left of the invoice's taxable value
// is shown as untaxed (0%).

export type GstInvoice = {
  number: string;
  issuedAt: number;
  customerGstin: string | null;
  customerName: string | null;
  subtotalPaise: number;
  discountPaise: number;
  serviceChargePaise: number;
  taxPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  /** Tax by rate in basis points, e.g. { "500": 9950 } for 5% */
  taxBreakup: Record<string, number> | null;
  paymentModes: Record<string, number> | null;
};

export type GstRateRow = { rateBp: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; taxPaise: number; invoices: number };
export type GstRow = GstInvoice & { taxablePaise: number; cgstPaise: number; sgstPaise: number; rates: GstRateRow[] };

/** Half to CGST (rounded down), the rest to SGST, so the two always add up to the tax */
export const splitTax = (tax: number) => {
  const cgst = Math.floor(tax / 2);
  return { cgst, sgst: tax - cgst };
};

/** One invoice, with its taxable value and tax per rate */
export function gstRow(inv: GstInvoice): GstRow {
  const taxable = Math.max(0, inv.subtotalPaise - inv.discountPaise + inv.serviceChargePaise);
  const rates: GstRateRow[] = [];
  let used = 0;
  for (const [key, tax] of Object.entries(inv.taxBreakup ?? {})) {
    const rateBp = Number(key);
    if (!rateBp || !tax) continue;
    const part = Math.min(taxable - used, Math.round((tax * 10000) / rateBp));
    used += part;
    const { cgst, sgst } = splitTax(tax);
    rates.push({ rateBp, taxablePaise: part, cgstPaise: cgst, sgstPaise: sgst, taxPaise: tax, invoices: 1 });
  }
  if (taxable - used > 0) rates.push({ rateBp: 0, taxablePaise: taxable - used, cgstPaise: 0, sgstPaise: 0, taxPaise: 0, invoices: 1 });
  const { cgst, sgst } = splitTax(inv.taxPaise);
  return { ...inv, taxablePaise: taxable, cgstPaise: cgst, sgstPaise: sgst, rates };
}

export type GstSummary = {
  invoices: number;
  firstNumber: string | null;
  lastNumber: string | null;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  taxPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  creditNotes: number;
  creditNotePaise: number;
  byRate: GstRateRow[];
  /** Invoices with the customer's GSTIN: reported one by one (B2B) */
  b2b: GstRow[];
  /** Everyone else: reported as a total per rate (B2C small) */
  b2cByRate: GstRateRow[];
  paymentModes: Record<string, number>;
};

const addRate = (into: Map<number, GstRateRow>, r: GstRateRow) => {
  const row = into.get(r.rateBp) ?? { rateBp: r.rateBp, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, taxPaise: 0, invoices: 0 };
  row.taxablePaise += r.taxablePaise;
  row.cgstPaise += r.cgstPaise;
  row.sgstPaise += r.sgstPaise;
  row.taxPaise += r.taxPaise;
  row.invoices += r.invoices;
  into.set(r.rateBp, row);
};
const sorted = (m: Map<number, GstRateRow>) => [...m.values()].sort((a, b) => b.rateBp - a.rateBp);

export function gstSummary(rows: GstRow[], creditNotes: { amountPaise: number }[]): GstSummary {
  const all = new Map<number, GstRateRow>();
  const b2c = new Map<number, GstRateRow>();
  const modes: Record<string, number> = {};
  for (const r of rows) {
    for (const rate of r.rates) {
      addRate(all, rate);
      if (!r.customerGstin) addRate(b2c, rate);
    }
    for (const [m, p] of Object.entries(r.paymentModes ?? {})) modes[m] = (modes[m] ?? 0) + p;
  }
  const byNumber = [...rows].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  const sum = (f: (r: GstRow) => number) => rows.reduce((n, r) => n + f(r), 0);
  return {
    invoices: rows.length,
    firstNumber: byNumber[0]?.number ?? null,
    lastNumber: byNumber.at(-1)?.number ?? null,
    taxablePaise: sum((r) => r.taxablePaise),
    cgstPaise: sum((r) => r.cgstPaise),
    sgstPaise: sum((r) => r.sgstPaise),
    taxPaise: sum((r) => r.taxPaise),
    roundOffPaise: sum((r) => r.roundOffPaise),
    totalPaise: sum((r) => r.totalPaise),
    creditNotes: creditNotes.length,
    creditNotePaise: creditNotes.reduce((n, c) => n + c.amountPaise, 0),
    byRate: sorted(all),
    b2b: rows.filter((r) => r.customerGstin),
    b2cByRate: sorted(b2c),
    paymentModes: modes,
  };
}

/** "2026-10" for the month a local date is in */
export const monthOf = (date: string) => date.slice(0, 7);

/** The first and last day of a month, e.g. ["2026-10-01", "2026-10-31"] */
export function monthDays(month: string): [string, string] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, "0")}`];
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const rupees = (paise: number) => (paise / 100).toFixed(2);
const csvCell = (v: string | number) => {
  const t = String(v);
  return /[",\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
};

/** Invoice-wise sheet for the CA or Tally (one row per invoice and rate) */
export function invoicesCsv(rows: GstRow[], dateOf: (at: number) => string): string {
  const head = ["Invoice No", "Date", "Customer GSTIN", "Customer Name", "GST Rate %", "Taxable Value", "CGST", "SGST", "Invoice Total", "Payment Mode"];
  const lines = rows.flatMap((r) =>
    r.rates.map((rate, i) => [
      r.number,
      dateOf(r.issuedAt),
      r.customerGstin ?? "",
      r.customerName ?? "",
      (rate.rateBp / 100).toString(),
      rupees(rate.taxablePaise),
      rupees(rate.cgstPaise),
      rupees(rate.sgstPaise),
      i === 0 ? rupees(r.totalPaise) : "",
      i === 0 ? Object.keys(r.paymentModes ?? {}).join(" + ") : "",
    ]),
  );
  return [head, ...lines].map((l) => l.map(csvCell).join(",")).join("\n");
}

/** Rate-wise summary sheet (the B2C table of GSTR-1) */
export function ratesCsv(rows: GstRateRow[]): string {
  const head = ["GST Rate %", "Invoices", "Taxable Value", "CGST", "SGST", "Total Tax"];
  const lines = rows.map((r) => [(r.rateBp / 100).toString(), r.invoices, rupees(r.taxablePaise), rupees(r.cgstPaise), rupees(r.sgstPaise), rupees(r.taxPaise)]);
  return [head, ...lines].map((l) => l.map(csvCell).join(",")).join("\n");
}
