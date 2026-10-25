import { describe, expect, it } from "vitest";
import { orderSlipHtml } from "@/app/(console)/console/(app)/orders/_components/order-slip-print";
import { dayCloseHtml } from "@/app/(console)/console/(app)/reports/day-close/_components/day-close-print";
import { billHtml } from "@/app/pos/_components/bill-print";
import { kotHtml } from "@/app/(staff)/kds/_components/kot-print";
import { fitThermalPage } from "@/lib/print/runtime";
import { PORTRAIT_GUARD_MM, PRINT_PROFILES, rs, type PaperMm } from "@/lib/print/thermal";
import type { PosBillDetail } from "@/server/staff/pos-read";
import { ADDRESS_LONG, billDetail, busyDayClose, dayClose, kotCard, kotLine, manyLines, orderSlip } from "./fixtures/print-fixtures";

// Layout rules every thermal slip must keep, on both roll widths and for small and large slips:
// portrait page of the roll's width, text laid out inside the printable strip, amounts that
// never wrap, no scaling tricks, nothing but the slip itself. The page height is measured in the
// browser just before printing; these tests check what the generated document asks for.

const PAPERS: PaperMm[] = [80, 58];
const page = (html: string) => {
  const m = html.match(/@page\{size:(\d+)mm (\d+)mm;margin:0\}/);
  return { w: Number(m?.[1]), h: Number(m?.[2]) };
};
const sidePadding = (html: string) => Number(html.match(/body\{width:\d+mm;padding:0 ([\d.]+)mm/)?.[1]);

function laidOutRight(html: string, paper: PaperMm) {
  const { w, h } = page(html);
  expect(w).toBe(paper);
  // Taller than wide, or the printer turns the slip sideways
  expect(h).toBeGreaterThanOrEqual(paper + PORTRAIT_GUARD_MM);
  expect(html).toContain(`body{width:${paper}mm;`);
  // Text sits in the printable strip, centred, never out to the paper's edge
  const content = paper - 2 * sidePadding(html);
  expect(content).toBe(PRINT_PROFILES[paper].contentMm);
  expect(sidePadding(html)).toBeGreaterThanOrEqual(4);
  // Amounts never wrap and labels may
  expect(html).toContain(".r>span:last-child{flex:none;margin-left:auto;white-space:nowrap;text-align:right}");
  expect(html).toContain(".r{display:flex;flex-wrap:wrap;")
  expect(html).toContain("overflow-wrap:anywhere");
  // No scaling, rotation, fixed pixel layout, scripts or console chrome
  expect(html).not.toMatch(/zoom|landscape|(?<!text-)transform|<script|<nav|sidebar/i);
  expect(html).not.toMatch(/(?<!max-)(?<!min-)width:\d+px/);
  expect(html).not.toMatch(/[^-]vw\b/);
  expect(html).toMatch(/<title>[^<]+<\/title>/);
}

describe.each(PAPERS)("%i mm roll", (paper) => {
  const cases: Record<string, string> = {
    "receipt, one item": billHtml(billDetail(), "Spice Route", "receipt", paper),
    "receipt, 20 items": billHtml(billDetail({ ...manyLines(20) }), "Spice Route", "receipt", paper),
    "receipt, long address and dish names": billHtml(billDetail({
      seller: { name: "The Grand Royal Rajasthani Thali and Kebab House", address: ADDRESS_LONG, city: "Jaipur", gstin: "08AABCS1234F1Z5", fssai: "12345678901234" } as PosBillDetail["seller"],
      lines: [{ name: "Hyderabadi Dum Biryani with Extra Raita, Salan and Mirchi Ka Salan Combo Family Pack", qty: 3, unitPricePaise: 45000, note: "parcel", status: "served" }, { name: "Supercalifragilisticexpialidocious_Unbroken_Name", qty: 1, unitPricePaise: 100, note: null, status: "served" }],
    } as never), "Spice Route", "receipt", paper),
    "bill with discount, service charge and two taxes, cash and online": billHtml(billDetail({
      bill: { subtotalPaise: 100000, discountPaise: 10000, serviceChargePaise: 5000, deliveryFeePaise: 3000, taxPaise: 5000, taxBreakup: { "500": 4000, "1800": 1000 }, roundOffPaise: 12, totalPaise: 103012 } as never,
      payments: [{ method: "cash", status: "success", amountPaise: 50000, tipPaise: 0 }, { method: "upi", status: "success", amountPaise: 53012, tipPaise: 500 }] as never,
    }), "Spice Route", "receipt", paper),
    "bill, takeaway": billHtml(billDetail({ takeaway: true, tableCode: "TA-12", invoice: null }), "Spice Route", "bill", paper),
    "kot, one item": kotHtml([kotCard()], paper),
    "kot, 20 items with options and notes": kotHtml([kotCard({
      orderNote: "Guest has a nut allergy, please use separate utensils for everything on this table",
      lines: Array.from({ length: 20 }, (_, i) => kotLine({ qty: (i % 4) + 1, nameEn: `Item ${i + 1} with a long descriptive dish name that wraps`, modifiers: [{ en: "Extra spicy", hi: null }, { en: "No onion, no garlic, sauce on the side", hi: null }, { en: "Less oil", hi: null }], note: i % 5 === 0 ? "Cook well done and pack hot" : null, personalForPickup: i % 7 === 0 })),
    })], paper),
    "kot, three tickets": kotHtml([kotCard(), kotCard({ tableCodes: ["T5", "T6"] }), kotCard({ tableCodes: ["TA-9"] })], paper),
    "order slip": orderSlipHtml(orderSlip(), "Spice Route", paper),
    "order slip, long names and note": orderSlipHtml(orderSlip({ items: Array.from({ length: 12 }, (_, i) => ({ name: `Long dish name number ${i + 1} for the order slip`, qty: i + 1 })), note: "Please serve all dishes together, not one by one", totalPaise: 9_999_900 }), "Spice Route", paper),
    "day summary, small": dayCloseHtml(dayClose(), "BMW", paper),
    "day close report, busy day": dayCloseHtml(busyDayClose(), "A Restaurant With A Very Long Name Across Many Words", paper),
  };

  it.each(Object.keys(cases))("%s is portrait, inside the printable strip and free of tricks", (name) => {
    laidOutRight(cases[name], paper);
  });

  it("makes a long slip taller than a short one, so nothing is cut at the foot", () => {
    expect(page(cases["receipt, 20 items"]).h).toBeGreaterThan(page(cases["receipt, one item"]).h);
    expect(page(cases["kot, 20 items with options and notes"]).h).toBeGreaterThan(page(cases["kot, one item"]).h);
    expect(page(cases["day close report, busy day"]).h).toBeGreaterThan(page(cases["day summary, small"]).h);
  });

  it("cuts each kitchen ticket onto its own page", () => {
    expect(cases["kot, three tickets"].match(/<section data-slip>/g)).toHaveLength(3);
    expect(cases["kot, three tickets"]).toContain("break-after:page");
  });

  it("prints the same amounts the bill holds", () => {
    const m = manyLines(20);
    const html = cases["receipt, 20 items"];
    expect(html).toContain(`<span>Subtotal</span><span>${rs(m.bill!.subtotalPaise)}</span>`);
    expect(html).toContain(`<span>TOTAL</span><span>${rs(m.bill!.totalPaise)}</span>`);
    for (const l of m.lines) expect(html).toContain(`<span>${l.qty} × ${rs(l.unitPricePaise)}</span><span>${rs(l.qty * l.unitPricePaise)}</span>`);
    const mixed = cases["bill with discount, service charge and two taxes, cash and online"];
    for (const row of ["Subtotal|₹1,000.00", "Discount|− ₹100.00", "Service charge|₹50.00", "Delivery charge|₹30.00", "Round off|₹0.12", "TOTAL|₹1,030.12", "Paid by Cash|₹500.00", "Paid by UPI|₹535.12", "Amount paid|₹1,035.12"]) {
      const [label, amount] = row.split("|");
      expect(mixed).toContain(`<span>${label}</span><span>${amount}</span>`);
    }
    expect(mixed).toContain("<span>CGST 2.5%</span>");
  });

  it("keeps the ₹ sign and escapes anything typed by a guest", () => {
    const html = billHtml(billDetail({ lines: [{ name: '<img src=x onerror=1> "Spicy" & Sweet', qty: 1, unitPricePaise: 100, note: null, status: "served" }] as never }), "Spice Route", "receipt", paper);
    expect(html).toContain("₹");
    expect(html).toContain("&lt;img src=x onerror=1&gt; &quot;Spicy&quot; &amp; Sweet");
    expect(html).not.toContain("<img");
    expect(kotHtml([kotCard({ orderNote: "<b>x</b>" })], paper)).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("builds the same slip every time it is printed", () => {
    expect(billHtml(billDetail(), "Spice Route", "receipt", paper)).toBe(billHtml(billDetail(), "Spice Route", "receipt", paper));
    expect(kotHtml([kotCard()], paper)).toBe(kotHtml([kotCard()], paper));
  });
});

describe("the 58 mm layout is narrower than the 80 mm one, not a shrunken copy", () => {
  it("uses a narrower strip and smaller type, on a page of its own width", () => {
    expect(PRINT_PROFILES[58].contentMm).toBeLessThan(PRINT_PROFILES[80].contentMm);
    expect(PRINT_PROFILES[58].contentMm).toBeLessThanOrEqual(48);
    expect(PRINT_PROFILES[80].contentMm).toBeLessThanOrEqual(72);
    expect(PRINT_PROFILES[58].fs).toBeLessThan(PRINT_PROFILES[80].fs);
    expect(PRINT_PROFILES[58].fs).toBeGreaterThanOrEqual(10);
  });
});

describe("fitting the page to the slip just before printing", () => {
  function fakeDoc(paper: PaperMm, slipPx: number[], css = `@page{size:${paper}mm 100mm;margin:0}`) {
    const added: string[] = [];
    const bodyPx = (paper * 96) / 25.4;
    return {
      added,
      doc: {
        head: { innerHTML: `<style>${css}</style>`, appendChild: (el: { textContent: string }) => added.push(el.textContent) },
        body: { getBoundingClientRect: () => ({ height: slipPx.reduce((a, b) => a + b, 0), width: bodyPx }) },
        querySelectorAll: () => slipPx.map((h) => ({ getBoundingClientRect: () => ({ height: h }) })),
        createElement: () => ({ textContent: "" }),
      } as unknown as Document,
    };
  }
  const mm = (px: number) => Math.ceil((px * 25.4) / 96) + 1;

  it("never makes a short slip landscape: the page stays taller than the roll is wide", () => {
    for (const paper of PAPERS) {
      const { doc, added } = fakeDoc(paper, [120]);
      fitThermalPage(doc);
      expect(added[0]).toBe(`@page{size:${paper}mm ${paper + PORTRAIT_GUARD_MM}mm;margin:0}`);
    }
  });

  it("sizes a long slip to its content", () => {
    const { doc, added } = fakeDoc(80, [1000]);
    fitThermalPage(doc);
    expect(added[0]).toBe(`@page{size:80mm ${mm(1000)}mm;margin:0}`);
  });

  it("sizes every ticket's page to the tallest ticket, not to all of them added together", () => {
    const { doc, added } = fakeDoc(80, [400, 900, 500]);
    fitThermalPage(doc);
    expect(added[0]).toBe(`@page{size:80mm ${mm(900)}mm;margin:0}`);
  });

  it("leaves a page that is not a thermal slip alone", () => {
    const { doc, added } = fakeDoc(80, [500], "@page{size:A4}");
    fitThermalPage(doc);
    expect(added).toHaveLength(0);
  });
});
