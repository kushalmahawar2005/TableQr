import { describe, expect, it } from "vitest";
import { kotHtml } from "@/app/(staff)/kds/_components/kot-print";
import type { KdsCard } from "@/app/(staff)/kds/_components/kds-logic";

// The kitchen slip: table, round and dishes, with options and notes; parcels say so on top.

const card = (codes: string[]): KdsCard => ({
  ticketId: "t1", orderId: "o1", station: "Tandoor", stage: "placed", isNew: true, tableCodes: codes, roundNo: 2, placedAt: Date.UTC(2026, 9, 12, 8, 30), elapsedMs: 0, targetMinutes: 15, urgency: "ok", guests: 2, source: "qr", placedBy: { kind: "staff", name: "Ravi" }, orderNote: "Less oil",
  lines: [{ id: "l1", qty: 2, nameEn: "Butter Naan <hot>", nameHi: null, modifiers: [{ en: "Extra butter", hi: null }], note: "PARCEL", allergens: null, jain: null, spice: null }],
} as unknown as KdsCard);

describe("KOT slip", () => {
  it("prints the table, round, dishes, options and notes", () => {
    const html = kotHtml([card(["T4"])]);
    expect(html).toContain("<h1>T4</h1>");
    expect(html).toContain("Round 2");
    expect(html).toContain("2 ×</b> Butter Naan &lt;hot&gt;");
    expect(html).toContain("Extra butter, PARCEL");
    expect(html).toContain("Note: Less oil");
    expect(html).toContain("size:80mm");
  });

  it("marks a takeaway as PARCEL", () => {
    expect(kotHtml([card(["TA-3"])])).toContain("<h1>PARCEL TA-3</h1>");
  });

  it("extends the thermal page for long dish and packing notes", () => {
    const base = card(["T1"]);
    const long: KdsCard = {
      ...base,
      lines: [{
        ...base.lines[0],
        nameEn: "A very long dish name that needs multiple lines on a narrow kitchen printer slip",
        note: "Please pack every part separately and add extra napkins for this table",
        modifiers: [{ en: "Extra butter and a separate side of sauce", hi: null }],
      }],
    };
    const html = kotHtml([long]);
    expect(Number(html.match(/@page\{size:80mm (\d+)mm;margin:0\}/)?.[1])).toBeGreaterThan(64);
  });
});
