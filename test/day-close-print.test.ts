import { describe, expect, it } from "vitest";
import { dayCloseHtml } from "@/app/(console)/console/(app)/reports/day-close/_components/day-close-print";
import type { DayClose } from "@/server/staff/day-close";

describe("day close print", () => {
  it("is a plain receipt-sized document with the money lines and no console around it", () => {
    const r = {
      date: "2026-10-12", isToday: true,
      bills: { count: 2, subtotalPaise: 30000, discountPaise: 0, serviceChargePaise: 0, taxPaise: 1500, tipsPaise: 0, roundOffPaise: 0, totalPaise: 31500 },
      methods: [{ method: "upi", paise: 21000, count: 1 }, { method: "cash", paise: 10500, count: 1 }],
      collectedPaise: 31500, refunds: { count: 0, paise: 0 }, netPaise: 31500, orders: 7, itemsSold: 5,
      removed: { qty: 2, paise: 10000 }, visits: { count: 4, covers: 4 }, averageBillPaise: 15750,
      topItems: [{ name: "Tomato <Soup>", qty: 4, paise: 40000 }], openTables: [{ table: "T1", totalPaise: 0 }],
    } as DayClose;
    const html = dayCloseHtml(r, "BMW");
    expect(Number(html.match(/@page\{size:80mm (\d+)mm;margin:0\}/)?.[1])).toBeGreaterThanOrEqual(130);
    expect(html).toContain("DAY CLOSE");
    expect(html).toContain("UPI (1)");
    expect(html).toContain("₹315.00");
    expect(html).toContain("Tomato &lt;Soup&gt; x4");
    expect(html).toContain("Still open: T1");
    expect(html).not.toMatch(/Cash counted|Signature/);
    expect(html).not.toMatch(/sidebar|<nav|Dashboard/);
  });

  it("adds roll length when long outlet names, dishes or open-table lists wrap", () => {
    const r = {
      date: "2026-10-12", isToday: false,
      bills: { count: 0, subtotalPaise: 0, discountPaise: 0, serviceChargePaise: 0, taxPaise: 0, tipsPaise: 0, roundOffPaise: 0, totalPaise: 0 },
      methods: [], collectedPaise: 0, refunds: { count: 0, paise: 0 }, netPaise: 0, orders: 0, itemsSold: 0,
      removed: { qty: 0, paise: 0 }, visits: { count: 0, covers: 0 }, averageBillPaise: 0,
      topItems: [{ name: "A very long restaurant special dish name that wraps over several lines", qty: 1, paise: 10000 }],
      openTables: [{ table: "TABLE-123456789", totalPaise: 0 }, { table: "TABLE-987654321", totalPaise: 0 }],
    } as DayClose;
    const html = dayCloseHtml(r, "A restaurant name long enough to wrap across a narrow receipt roll");
    expect(Number(html.match(/@page\{size:80mm (\d+)mm;margin:0\}/)?.[1])).toBeGreaterThan(130);
  });
});
