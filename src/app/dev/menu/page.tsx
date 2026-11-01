import type { ComponentProps } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StaffShell } from "@/app/(console)/console/(app)/_components/staff-shell";
import { MenuManager } from "@/app/(console)/console/(app)/menu/_components/menu-manager";
import { consoleSections } from "@/lib/console-nav";

export const metadata: Metadata = { title: "Menu (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const dish = (id: string, nameEn: string, pricePaise: number, over: Record<string, unknown> = {}) => ({ id, nameEn, nameHi: null, pricePaise, categoryId: "c1", isActive: true, isVeg: true, imageUrl: null, station: "Kitchen", prepMinutes: 10, searchTerms: null, tags: [], ...over });

const data = {
  currentOutlet: "Spice Route", outlets: [{ id: "o1" }], canEditPrice: true, pairings: [],
  categories: [{ id: "c1", nameEn: "Bowls", isActive: true }, { id: "c2", nameEn: "Soups", isActive: true }, { id: "c3", nameEn: "Sandwiches", isActive: true }],
  items: [
    dish("a", "Fruit Bowl", 7_000, { nameHi: "फ्रूट बाउल" }),
    dish("b", "Muscle Bowl", 16_000),
    dish("c", "Protein Bowl with a very long dish name for wrapping", 11_000, { categoryId: "c3" }),
    dish("d", "Tomato Soup", 12_000, { categoryId: "c2" }),
    dish("e", "Chicken Sandwich", 13_000, { categoryId: "c3", isVeg: false }),
    dish("f", "Old Dish", 9_000, { isActive: false }),
  ],
  overrides: [{ itemId: "b", isAvailable: true, portionsLeft: 4, pricePaise: null }, { itemId: "e", isAvailable: true, portionsLeft: 0, pricePaise: null }],
  groups: [{ id: "g1", itemId: "a", isActive: true, nameEn: "Size" }],
  modifiers: [{ id: "m1", groupId: "g1", nameEn: "Small", priceDeltaPaise: 0 }, { id: "m2", groupId: "g1", nameEn: "Large", priceDeltaPaise: 3_000 }],
} as unknown as ComponentProps<typeof MenuManager>["initial"];

// Development-only review board for the Menu screen, with sample data
export default function MenuBoard() {
  if (process.env.NODE_ENV === "production") notFound();
  const sections = consoleSections.map((s) => ({ slug: s.slug, label: s.label }));
  return (
    <StaffShell lang="en" sections={sections} staff={{ name: "Owner", roles: ["owner"], outlet: "Spice Route", shiftEnds: null }} activeSlug="menu" preview>
      <MenuManager initial={data} canEditPrice />
    </StaffShell>
  );
}
