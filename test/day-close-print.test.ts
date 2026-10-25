import { describe, expect, it } from "vitest";
import { dayCloseHtml } from "@/app/(console)/console/(app)/reports/day-close/_components/day-close-print";
import { busyDayClose, dayClose } from "./fixtures/print-fixtures";

describe("day close print", () => {
  it("is a plain receipt-sized document with the money lines and no console around it", () => {
    const html = dayCloseHtml(dayClose(), "BMW", 80);
    expect(Number(html.match(/@page\{size:80mm (\d+)mm;margin:0\}/)?.[1])).toBeGreaterThanOrEqual(92);
    expect(html).toContain("UPI (1)");
    expect(html).toContain("<span>COLLECTED</span><span>₹315.00</span>");
    expect(html).toContain("<span>SALES</span><span>₹315.00</span>");
    expect(html).toContain("Tomato &lt;Soup&gt;");
    expect(html).toContain("<span>Table T1</span>");
    expect(html).not.toMatch(/Cash counted|Signature/);
    expect(html).not.toMatch(/sidebar|<nav|Dashboard/);
  });

  it("tells a day still going from a final report", () => {
    const today = dayCloseHtml(dayClose({ isToday: true }), "BMW", 80);
    expect(today).toContain("<b>DAY SUMMARY</b>");
    expect(today).toContain("So far today · not final");
    expect(today).toContain("Still open (1)");
    const past = dayCloseHtml(dayClose({ isToday: false }), "BMW", 80);
    expect(past).toContain("<b>DAY CLOSE REPORT</b>");
    expect(past).toContain("Final for this business day");
    expect(past).toContain("Unsettled from this day (1)");
    expect(past).not.toContain("So far today");
  });

  it("names a takeaway as one, and lists nothing when nothing is open", () => {
    const html = dayCloseHtml(dayClose({ openTables: [{ table: "TA-2", totalPaise: 10000, takeaway: true }] }), "BMW", 80);
    expect(html).toContain("<span>Takeaway TA-2</span><span>₹100.00</span>");
    expect(dayCloseHtml(dayClose({ openTables: [] }), "BMW", 80)).not.toMatch(/Still open|Unsettled/);
  });

  it("adds roll length when long outlet names, dishes or open-table lists wrap", () => {
    const height = (html: string) => Number(html.match(/@page\{size:80mm (\d+)mm;margin:0\}/)?.[1]);
    const plain = dayCloseHtml(dayClose({ openTables: [], topItems: [] }), "BMW", 80);
    const wide = dayCloseHtml(busyDayClose(), "A restaurant name long enough to wrap across a narrow receipt roll", 80);
    expect(height(wide)).toBeGreaterThan(height(plain));
  });
});
