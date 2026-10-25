import { describe, expect, it } from "vitest";
import { billHtml } from "@/app/pos/_components/bill-print";
import type { PosBillDetail } from "@/server/staff/pos-read";

// The counter bill and receipt: a GST-registered restaurant's paid receipt is a tax invoice.

const detail = (over: Partial<PosBillDetail> = {}) => ({
  tableCode: "T4",
  takeaway: false,
  seller: { name: "Spice Route", address: "MI Road", city: "Jaipur", gstin: "08AABCS1234F1Z5", fssai: "12345678901234" },
  invoice: { number: "SRJ01/26-27/000007", issuedAt: Date.UTC(2026, 9, 25, 9, 0) },
  lines: [{ name: "Paneer Tikka", qty: 2, unitPricePaise: 32000, note: null, status: "served" }],
  payments: [{ method: "upi", status: "success", amountPaise: 67200, tipPaise: 0 }],
  bill: { subtotalPaise: 64000, discountPaise: 0, serviceChargePaise: 0, deliveryFeePaise: 0, taxPaise: 3201, taxBreakup: { "500": 3201 }, roundOffPaise: -1, totalPaise: 67200 },
  ...over,
}) as unknown as PosBillDetail;

describe("counter bill print", () => {
  it("prints a paid GST bill as a tax invoice with GSTIN, FSSAI, number and CGST/SGST halves", () => {
    const html = billHtml(detail(), "Spice Route", "receipt");
    expect(html).toContain("<b>TAX INVOICE</b>");
    expect(html).toContain("GSTIN: 08AABCS1234F1Z5");
    expect(html).toContain("FSSAI: 12345678901234");
    expect(html).toContain("No. SRJ01/26-27/000007");
    expect(html).toContain("MI Road, Jaipur");
    expect(html).toContain("<span>CGST 2.5%</span><span>₹16.00</span>");
    expect(html).toContain("<span>SGST 2.5%</span><span>₹16.01</span>");
    expect(html).toContain("<span>Round off</span><span>− ₹0.01</span>");
  });

  it("keeps a plain tax line and no GSTIN for an unregistered restaurant", () => {
    const html = billHtml(detail({ seller: { name: "Cafe", address: "", city: "", gstin: null, fssai: null } as PosBillDetail["seller"] }), "Cafe", "receipt");
    expect(html).toContain("<b>RECEIPT</b>");
    expect(html).not.toContain("GSTIN");
    expect(html).not.toContain("CGST");
    expect(html).toContain("<span>Tax</span>");
  });

  it("calls an unpaid bill a bill, without an invoice number", () => {
    const html = billHtml(detail({ invoice: null }), "Spice Route", "bill");
    expect(html).toContain("<b>BILL</b>");
    expect(html).not.toContain("No. ");
  });
});
