import { describe, expect, it } from "vitest";
import { offlinePosKotHtml } from "@/lib/pos-offline-kot";
import type { OfflinePosOrder } from "@/lib/pos-offline-queue";

describe("offline local kitchen copy", () => {
  it("prints the saved table, quantities, options, notes and a clear not-sent warning without prices", () => {
    const order: OfflinePosOrder = {
      id: "offline-order-0001", createdAt: Date.UTC(2026, 9, 28, 8), staffUserId: "cashier-1",
      current: { sessionId: null, tableId: "table-1", code: "T8", takeaway: false, seats: 4 },
      guestName: "Meena", partySize: 2,
      lines: [{ itemId: "dish-1", qty: 2, modifierIds: ["mod-1"], note: "less spicy" }],
      quote: { "dish-1|mod-1": 18000 },
    };
    const menu = [{ id: "dish-1", name: "Paneer Tikka", pricing: { groups: [{ modifiers: [{ id: "mod-1", nameEn: "Extra cheese" }] }] } }] as never;
    const html = offlinePosKotHtml(order, menu, 80);
    expect(html).toContain("OFFLINE COPY · NOT SENT TO KITCHEN");
    expect(html).toContain("T8");
    expect(html).toContain("2×");
    expect(html).toContain("Paneer Tikka");
    expect(html).toContain("Extra cheese");
    expect(html).toContain("less spicy");
    expect(html).not.toContain("₹180");
  });

  it("escapes untrusted item and note text before placing it in the print document", () => {
    const order: OfflinePosOrder = {
      id: "offline-order-0002", createdAt: Date.now(), staffUserId: "cashier-1",
      current: { sessionId: null, tableId: null, code: "TA-1", takeaway: true, seats: 1 },
      guestName: "", partySize: 1,
      lines: [{ open: { name: "<script>alert(1)</script>", pricePaise: 100, station: "kitchen", taxRateBp: 0 }, qty: 1, note: "<b>test</b>" }],
    };
    const html = offlinePosKotHtml(order, [], 58);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;test&lt;/b&gt;");
  });
});
