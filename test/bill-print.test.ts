import { describe, expect, it } from "vitest";
import { billHtml, forPaper } from "@/app/pos/_components/bill-print";
import type { PosBillDetail } from "@/server/staff/pos-read";
import { billDetail as detail } from "./fixtures/print-fixtures";

// The counter bill and receipt: a GST-registered restaurant's paid receipt is a tax invoice.

describe("counter bill print", () => {
  it("prints a paid GST bill as a tax invoice with GSTIN, FSSAI, number and CGST/SGST halves", () => {
    const html = billHtml(detail(), "Spice Route", "receipt", 80);
    expect(html).toContain("<b>TAX INVOICE</b>");
    expect(html).toContain("GSTIN: 08AABCS1234F1Z5");
    expect(html).toContain("FSSAI: 12345678901234");
    expect(html).toContain("<span>Invoice No.</span><span>SRJ01/26-27/000007</span>");
    expect(html).toContain("MI Road, Jaipur");
    expect(html).toContain("<span>CGST 2.5%</span><span>₹16.00</span>");
    expect(html).toContain("<span>SGST 2.5%</span><span>₹16.01</span>");
    expect(html).toContain("<span>Round off</span><span>− ₹0.01</span>");
  });

  it("keeps a plain tax line and no GSTIN for an unregistered restaurant", () => {
    const html = billHtml(detail({ seller: { name: "Cafe", address: "", city: "", gstin: null, fssai: null } as PosBillDetail["seller"] }), "Cafe", "receipt", 80);
    expect(html).toContain("<b>RECEIPT</b>");
    expect(html).not.toContain("GSTIN");
    expect(html).not.toContain("CGST");
    expect(html).toContain("<span>GST 5%</span>");
  });

  it("calls an unpaid bill a bill, without an invoice number", () => {
    const html = billHtml(detail({ invoice: null }), "Spice Route", "bill", 80);
    expect(html).toContain("<b>BILL</b>");
    expect(html).not.toContain("Invoice No.");
  });

  it("labels the food total Subtotal, and shows the payment method and the amount paid on a receipt", () => {
    const html = billHtml(detail(), "Spice Route", "receipt", 80);
    expect(html).toContain("<span>Subtotal</span><span>₹640.00</span>");
    expect(html).not.toContain("<span>Items</span>");
    expect(html).toContain("<span>Paid by UPI</span><span>₹672.00</span>");
    expect(html).toContain("<span>Amount paid</span><span>₹672.00</span>");
    expect(html).toContain("<span>TOTAL</span><span>₹672.00</span>");
    // The bill before payment has no payment rows
    expect(billHtml(detail({ invoice: null }), "Spice Route", "bill", 80)).not.toContain("Amount paid");
  });

  it("shows order type, table and date, a compact footer, and no browser-looking extras", () => {
    const html = billHtml(detail(), "Spice Route", "receipt", 80);
    expect(html).toContain("<span>Order</span><span>Dine-in</span>");
    expect(html).toContain("<span>Table</span><span>T4</span>");
    expect(html).toContain("<span>Date</span><span>25 Oct 2026");
    expect(html).toContain("Thank you for dining with us!");
    expect(html).toContain("Powered by TableQR");
    const take = billHtml(detail({ takeaway: true, tableCode: "TA-3" }), "Spice Route", "receipt", 80);
    expect(take).toContain("<span>Order</span><span>Takeaway</span>");
    expect(take).toContain("<span>Token</span><span>TA-3</span>");
  });
});

describe("58 mm receipt paper", () => {
  it("is laid out for the narrow roll itself, not scaled down from an 80 mm slip", () => {
    const html = billHtml(detail(), "Spice Route", "receipt", 58);
    expect(html).toMatch(/@page\{size:58mm [\d.]+mm;margin:0\}/);
    expect(html).not.toContain("@page{size:80mm");
    expect(html).not.toContain("zoom");
    expect(forPaper(html, 58)).toBe(html);
  });

  it("still scales an older 80 mm slip down for a 58 mm roll, and leaves 80 mm slips and other pages alone", () => {
    const old = "<style>@page{size:80mm 120mm;margin:0}</style>";
    expect(forPaper(old, 58)).toContain("@page{size:58mm 120mm;margin:0}");
    expect(forPaper(old, 58)).toContain("body{zoom:0.725}");
    expect(forPaper(old, 80)).toBe(old);
    expect(forPaper("<style>@page{size:A4}</style>", 58)).toBe("<style>@page{size:A4}</style>");
  });
});
