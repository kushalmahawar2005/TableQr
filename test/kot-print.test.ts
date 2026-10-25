import { describe, expect, it } from "vitest";
import { kotHtml } from "@/app/(staff)/kds/_components/kot-print";
import { kotCard as card, kotLine } from "./fixtures/print-fixtures";

// The kitchen slip: order type and table in big type, round and time, dishes with options and notes.

describe("KOT slip", () => {
  it("prints the order type, table, round, time, dishes, options and notes", () => {
    const html = kotHtml([card({
      orderNote: "Less oil",
      lines: [kotLine({ qty: 2, nameEn: "Butter Naan <hot>", modifiers: [{ en: "Extra butter", hi: null }], note: "Well done" })],
    })], 80);
    expect(html).toContain('<div class="ty">DINE-IN</div>');
    expect(html).toContain("<h1>T4</h1>");
    expect(html).toContain("<b>Round 2</b>");
    expect(html).toMatch(/· \d{1,2}:\d{2} (am|pm) · Tandoor/);
    expect(html).toContain('<span class="q">2×</span>');
    expect(html).toContain("Butter Naan &lt;hot&gt;");
    expect(html).toContain("+ Extra butter");
    expect(html).toContain("NOTE: Well done");
    expect(html).toContain("ORDER NOTE:</b> Less oil");
    expect(html).toContain("@page{size:80mm");
  });

  it("marks a takeaway as PARCEL and says what to pack", () => {
    const html = kotHtml([card({ tableCodes: ["TA-3"], lines: [kotLine({ personalForPickup: true })] })], 80);
    expect(html).toContain('<div class="ty">PARCEL</div>');
    expect(html).toContain("<h1>TA-3</h1>");
    expect(html).toContain("PACK FOR TAKEAWAY");
  });

  it("carries no prices: a kitchen slip is not a bill", () => {
    expect(kotHtml([card()], 80)).not.toContain("₹");
  });

  it("extends the page for long dish names, options and notes", () => {
    const base = card();
    const long = card({
      lines: [kotLine({
        nameEn: "A very long dish name that needs multiple lines on a narrow kitchen printer slip",
        note: "Please pack every part separately and add extra napkins for this table",
        modifiers: [{ en: "Extra butter and a separate side of sauce", hi: null }],
      })],
    });
    const height = (html: string) => Number(html.match(/@page\{size:80mm (\d+)mm;margin:0\}/)?.[1]);
    expect(height(kotHtml([long], 80))).toBeGreaterThan(height(kotHtml([base], 80)));
  });
});
