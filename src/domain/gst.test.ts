import { describe, expect, it } from "vitest";
import { gstRow, gstSummary, invoicesCsv, monthDays, ratesCsv, shiftMonth, splitTax, type GstInvoice } from "./gst";

const inv = (over: Partial<GstInvoice>): GstInvoice => ({
  number: "SRJ01/26-27/000001",
  issuedAt: Date.UTC(2026, 9, 5),
  customerGstin: null,
  customerName: null,
  subtotalPaise: 100000,
  discountPaise: 0,
  serviceChargePaise: 0,
  taxPaise: 5000,
  roundOffPaise: 0,
  totalPaise: 105000,
  taxBreakup: { "500": 5000 },
  paymentModes: { cash: 105000 },
  ...over,
});

describe("GST report", () => {
  it("splits tax into CGST and SGST that add up", () => {
    expect(splitTax(5001)).toEqual({ cgst: 2500, sgst: 2501 });
  });

  it("works out taxable value per rate, with discount and service charge", () => {
    const r = gstRow(inv({ subtotalPaise: 100000, discountPaise: 10000, serviceChargePaise: 10000, taxPaise: 5000 }));
    expect(r.taxablePaise).toBe(100000);
    expect(r.rates).toEqual([{ rateBp: 500, taxablePaise: 100000, cgstPaise: 2500, sgstPaise: 2500, taxPaise: 5000, invoices: 1 }]);
    // Part of the bill had no tax
    const mixed = gstRow(inv({ subtotalPaise: 150000, taxPaise: 5000 }));
    expect(mixed.rates.map((x) => [x.rateBp, x.taxablePaise])).toEqual([[500, 100000], [0, 50000]]);
  });

  it("totals the month, keeps B2B invoices apart and lists first and last numbers", () => {
    const rows = [
      gstRow(inv({ number: "SRJ01/26-27/000010" })),
      gstRow(inv({ number: "SRJ01/26-27/000002", customerGstin: "08ABCDE1234F1Z5", customerName: "Acme" })),
      gstRow(inv({ number: "SRJ01/26-27/000003", taxBreakup: { "1800": 18000 }, taxPaise: 18000, totalPaise: 118000 })),
    ];
    const s = gstSummary(rows, [{ amountPaise: 2000 }]);
    expect(s.invoices).toBe(3);
    expect([s.firstNumber, s.lastNumber]).toEqual(["SRJ01/26-27/000002", "SRJ01/26-27/000010"]);
    expect(s.taxPaise).toBe(28000);
    expect(s.cgstPaise + s.sgstPaise).toBe(28000);
    expect(s.byRate.map((r) => [r.rateBp, r.invoices])).toEqual([[1800, 1], [500, 2]]);
    expect(s.b2b.map((r) => r.customerName)).toEqual(["Acme"]);
    expect(s.b2cByRate.map((r) => [r.rateBp, r.invoices])).toEqual([[1800, 1], [500, 1]]);
    expect(s.creditNotePaise).toBe(2000);
    expect(s.paymentModes.cash).toBe(315000);
  });

  it("writes sheets a CA or Tally can open", () => {
    const rows = [gstRow(inv({ customerName: 'Sharma, "Hotels"' }))];
    const csv = invoicesCsv(rows, () => "05-10-2026").split("\n");
    expect(csv[0]).toBe("Invoice No,Date,Customer GSTIN,Customer Name,GST Rate %,Taxable Value,CGST,SGST,Invoice Total,Payment Mode");
    expect(csv[1]).toBe('SRJ01/26-27/000001,05-10-2026,,"Sharma, ""Hotels""",5,1000.00,25.00,25.00,1050.00,cash');
    expect(ratesCsv(gstSummary(rows, []).byRate).split("\n")[1]).toBe("5,1,1000.00,25.00,25.00,50.00");
  });

  it("knows the days of a month and moves between months", () => {
    expect(monthDays("2026-02")).toEqual(["2026-02-01", "2026-02-28"]);
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});
