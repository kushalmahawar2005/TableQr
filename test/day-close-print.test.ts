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
    expect(html).toContain("@page{size:80mm auto");
    expect(html).toContain("DAY CLOSE");
    expect(html).toContain("UPI (1)");
    expect(html).toContain("₹315.00");
    expect(html).toContain("Tomato &lt;Soup&gt; x4");
    expect(html).toContain("Still open: T1");
    expect(html).not.toMatch(/sidebar|<nav|Dashboard/);
  });
});
