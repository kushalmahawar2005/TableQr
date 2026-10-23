import type { CartPreview } from "@/app/(guest)/r/[outlet]/t/[table]/cart/_components/cart-screen";
import type { PricingPreview } from "@/app/(console)/console/(app)/pricing/_components/pricing-screen";
import type { CartLineView, CartScreenData } from "@/server/guest/cart-screen";
import type { PricingData, PricingRow } from "@/server/staff/pricing";

// Sample data for the O4 review board. Not used by the product.

const row = (id: string, nameEn: string, categoryId: string, categoryName: string, brand: number, outlet: number | null = null): PricingRow => ({
  id,
  nameEn,
  nameHi: null,
  categoryId,
  categoryName,
  brandPricePaise: brand * 100,
  outletPricePaise: outlet === null ? null : outlet * 100,
  pricePaise: (outlet ?? brand) * 100,
  source: outlet === null ? "brand_base" : "outlet_override",
});

const categories = [
  { id: "starters", nameEn: "Starters" },
  { id: "mains", nameEn: "Main course" },
  { id: "breads", nameEn: "Breads" },
];

const brandOnly: PricingRow[] = [
  row("pt", "Paneer Tikka", "starters", "Starters", 280),
  row("hk", "Hara Bhara Kebab", "starters", "Starters", 240),
  row("bc", "Butter Chicken", "mains", "Main course", 380),
  row("dm", "Dal Makhani", "mains", "Main course", 260),
  row("bn", "Butter Naan", "breads", "Breads", 60),
];

const mixed: PricingRow[] = [
  row("pt", "Paneer Tikka", "starters", "Starters", 280, 300),
  row("hk", "Hara Bhara Kebab", "starters", "Starters", 240),
  row("bc", "Butter Chicken", "mains", "Main course", 380, 420),
  row("dm", "Dal Makhani", "mains", "Main course", 260),
  // An older brand price with paise stays readable
  { ...row("bn", "Butter Naan", "breads", "Breads", 60), brandPricePaise: 5950, pricePaise: 5950 },
];

const data = (rows: PricingRow[], canEdit = true): PricingData => ({ outlet: "Saffron Room, Jaipur", categories, rows, canEdit });

export type PricingCase = { id: string; label: string; kind: "pricing"; data: PricingData; preview: PricingPreview } | { id: string; label: string; kind: "cart"; data: CartScreenData; preview: CartPreview };

const cartLine = (id: string, nameEn: string, unit: number, qty: number, options: CartLineView["options"] = []): CartLineView => ({
  id,
  itemId: id,
  nameEn,
  nameHi: null,
  isVeg: true,
  qty,
  options,
  note: null,
  shared: false,
  personalForPickup: false,
  unitPricePaise: unit,
  linePaise: unit * qty,
  reason: null,
  kind: options.length ? "configured" : "plain",
});

function cart(): CartScreenData {
  const mine = [cartLine("l1", "Paneer Tikka", 35000, 1), cartLine("l2", "Butter Chicken", 44000, 1, [{ nameEn: "Cheese naan", nameHi: null }])];
  return {
    renderedAt: 0,
    outlet: { code: "SRJ01", name: "Saffron Room", logoUrl: null, accentColor: "#C9482B" },
    table: { code: "T12" },
    session: { key: "dev", people: 2, status: "open", orderingLocked: false, hostName: "Aarav", verified: true, needsName: false },
    mine,
    myCount: 2,
    subtotalPaise: mine.reduce((n, l) => n + (l.linePaise ?? 0), 0),
    quote: {},
    others: [],
  };
}

export function pricingCases(): PricingCase[] {
  return [
    { id: "no-overrides", label: "No overrides: every item at brand price", kind: "pricing", data: data(brandOnly), preview: {} },
    { id: "mixed", label: "Mixed brand and outlet prices", kind: "pricing", data: data(mixed), preview: {} },
    { id: "edit", label: "Edit drawer: one item", kind: "pricing", data: data(mixed), preview: { drawer: "bc", drawerValue: "420" } },
    { id: "bulk-increase", label: "Bulk +10% preview", kind: "pricing", data: data(mixed), preview: { selected: ["pt", "hk", "bc"], bulk: { kind: "increase_percent", value: "10", preview: true } } },
    { id: "bulk-decrease", label: "Bulk −₹20 preview", kind: "pricing", data: data(mixed), preview: { selected: ["pt", "dm", "bn"], bulk: { kind: "decrease_fixed", value: "20", preview: true } } },
    { id: "reset", label: "Reset to brand price preview", kind: "pricing", data: data(mixed), preview: { selected: ["pt", "bc"], bulk: { kind: "reset", value: "", preview: true } } },
    { id: "manager", label: "Manager: view only", kind: "pricing", data: data(mixed, false), preview: {} },
    { id: "invalid", label: "Validation error: not whole rupees", kind: "pricing", data: data(mixed), preview: { drawer: "dm", drawerValue: "249.50", drawerError: "Enter a whole-rupee price of ₹0 or more, for example 349." } },
    { id: "overrides-only-empty", label: "Overrides filter with none set", kind: "pricing", data: data(brandOnly), preview: { overridesOnly: true } },
    { id: "no-results", label: "No search results", kind: "pricing", data: data(mixed), preview: { query: "biryani" } },
    { id: "empty", label: "No menu items", kind: "pricing", data: data([]), preview: {} },
    { id: "price-changed", label: "Guest cart: prices changed (Place order stopped)", kind: "cart", data: cart(), preview: { notice: "prices" } },
  ];
}
