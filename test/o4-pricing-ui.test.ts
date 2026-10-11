import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PricingScreen } from "@/app/(console)/console/(app)/pricing/_components/pricing-screen";
import { pricingCases } from "@/app/dev/o4/_fixtures";
import { adjustPrice, isValidNewPrice, validAdjustment } from "@/domain/price-adjust";
import { priceLine, quoteKey, resolveItemPrice } from "@/domain/pricing";
import { canPrice } from "@/lib/staff-permissions";

// O4 Pricing: pure price rules and the screen rendered to HTML from the dev board's fixtures.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {} }) }));
vi.mock("@/app/(console)/console/(app)/pricing/actions", () => ({}));
// The drawers are portals in the browser; render them inline so their content is in the HTML
vi.mock("@/components/ui/sheet", () => {
  const Pass = ({ children }: { children?: ReactNode }) => children;
  return { Sheet: ({ open, children }: { open: boolean; children?: ReactNode }) => (open ? children : null), SheetContent: Pass, SheetHeader: Pass, SheetTitle: Pass, SheetDescription: Pass };
});

const render = (id: string) => {
  const c = pricingCases().find((x) => x.id === id)!;
  if (c.kind !== "pricing") throw new Error("not a pricing case");
  return renderToStaticMarkup(createElement(PricingScreen, { initial: c.data, preview: c.preview }));
};

describe("price rules", () => {
  it("F/G: override wins over brand; brand when there is none", () => {
    expect(resolveItemPrice({ brandPricePaise: 30000, outletOverridePricePaise: 35000 })).toEqual({ pricePaise: 35000, source: "outlet_override" });
    expect(resolveItemPrice({ brandPricePaise: 30000, outletOverridePricePaise: null })).toEqual({ pricePaise: 30000, source: "brand_base" });
    expect(resolveItemPrice({ brandPricePaise: 30000, outletOverridePricePaise: 0 })).toEqual({ pricePaise: 0, source: "outlet_override" });
  });

  it("bulk results are whole rupees rounded half up, never negative", () => {
    expect(adjustPrice(27500, "percent", 10)).toBe(30300); // 302.50 -> 303
    expect(adjustPrice(27400, "percent", 10)).toBe(30100); // 301.40 -> 301
    expect(adjustPrice(30000, "percent", -5)).toBe(28500);
    expect(adjustPrice(7950, "fixed", 2000)).toBe(10000); // 99.50 -> 100
    expect(adjustPrice(3000, "fixed", -5000)).toBe(0);
    expect(adjustPrice(30000, "percent", -100)).toBe(0);
  });

  it("M: validation of new prices and amounts", () => {
    expect(isValidNewPrice(34900)).toBe(true);
    expect(isValidNewPrice(34950)).toBe(false);
    expect(isValidNewPrice(-100)).toBe(false);
    expect(validAdjustment("percent", 12.5)).toBe(true);
    expect(validAdjustment("percent", -101)).toBe(false);
    expect(validAdjustment("fixed", 1050)).toBe(false);
    expect(validAdjustment("fixed", -2000)).toBe(true);
  });

  it("AB: a line below zero is refused", () => {
    const item = { id: "x", pricePaise: 1000, isAvailable: true, groups: [{ id: "g", nameEn: "G", minSelect: 0, maxSelect: 1, modifiers: [{ id: "m", nameEn: "M", nameHi: null, priceDeltaPaise: -2000, isAvailable: true }] }] };
    expect(priceLine(item, 1, ["m"])).toEqual({ ok: false, error: { code: "negative_price" } });
    expect(quoteKey("x", ["b", "a", "a"])).toBe("x|a,b");
  });

  it("pricing.view is owner and manager; pricing.edit is owner only", () => {
    expect(canPrice(["owner"], "pricing.edit")).toBe(true);
    expect(canPrice(["manager"], "pricing.edit")).toBe(false);
    expect(canPrice(["manager"], "pricing.view")).toBe(true);
    for (const r of ["host", "waiter", "cashier", "kitchen", "accountant"] as const) expect(canPrice([r], "pricing.view")).toBe(false);
  });
});

describe("pricing screen", () => {
  it("shows brand, outlet and effective prices with the source", () => {
    const html = render("mixed");
    for (const text of ["Pricing", "Set a different price for", "Other outlets are not affected.", "Changed here", "Menu ₹380 · +₹40", "₹420", "₹59.50", "Edit", "Select all 5"]) expect(html).toContain(text);
  });

  it("manager sees prices but no edit actions", () => {
    const html = render("manager");
    expect(html).toContain("View only. Only the owner can change prices.");
    expect(html).not.toMatch(/>Edit</);
    expect(html).not.toContain("Select all");
  });

  it("edit drawer, validation error and bulk previews", () => {
    expect(render("edit")).toContain("Back to ₹380");
    expect(render("edit")).toContain("Save price");
    expect(render("invalid")).toContain("Enter a whole-rupee price");
    const up = render("bulk-increase");
    expect(up).toContain("₹330"); // 300 + 10%
    expect(up).toContain("₹264"); // 240 + 10%
    expect(render("bulk-decrease")).toContain("₹240"); // 260 - 20
    expect(render("reset")).toContain("Reset prices");
    expect(render("reset")).toContain("Menu price");
  });

  it("empty states", () => {
    expect(render("empty")).toContain("No dishes yet.");
    expect(render("overrides-only-empty")).toContain("No price changes yet.");
    expect(render("no-results")).toContain("No dishes match.");
  });
});
