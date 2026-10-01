import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ItemSheet, type SheetPreview } from "@/app/(guest)/r/[outlet]/t/[table]/menu/_g4/item-sheet";
import { db } from "@/db";
import * as s from "@/db/schema";
import { parseAllergens, parseSpice } from "@/domain/allergens";
import { primaryTag } from "@/domain/menu-price";
import { parseLang } from "@/lib/i18n";
import type { ItemSheetData } from "@/server/guest/item-sheet";
import { loadItems } from "@/server/guest/menu";

export const metadata: Metadata = { title: "G4 states (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Development-only review board: every G4 item-sheet state with seeded dishes. Never in production.
// Photos are labelled sample blocks; real sheets use only restaurant photos.

const sample = (hue: number) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" fill="hsl(${hue} 45% 82%)"/><text x="80" y="49" font-family="sans-serif" font-size="9" text-anchor="middle" fill="hsl(${hue} 40% 30%)">Sample photo</text></svg>`,
  )}`;

async function loadDishes() {
  const [outlet] = await db.select().from(s.outlets).where(eq(s.outlets.code, "SRJ01"));
  if (!outlet) return null;
  const ctx = { tenantId: outlet.tenantId, brandId: outlet.brandId, outletId: outlet.id };
  const items = await loadItems(db, ctx, new Date("2026-10-01T14:30:00Z"));
  const sheet = (name: string, over: Partial<ItemSheetData> = {}): ItemSheetData => {
    const x = items.find((i) => i.item.nameEn === name)!;
    return {
      outlet: { code: outlet.code, accentColor: outlet.accentColor },
      session: { key: "dev", status: "open", orderingLocked: false, hostName: "Aarav" },
      item: {
        id: x.item.id,
        nameEn: x.item.nameEn,
        nameHi: x.item.nameHi,
        descriptionEn: x.item.descriptionEn,
        descriptionHi: x.item.descriptionHi,
        pricePaise: x.pricing.pricePaise,
        isVeg: x.item.isVeg,
        isJain: x.item.isJain,
        spice: parseSpice(x.item.spiceLevel),
        allergens: parseAllergens(x.item.allergens),
        tag: primaryTag(x.item.tags),
        imageUrl: null,
        available: x.pricing.isAvailable,
        outsideHours: false,
      },
      groups: x.pricing.groups.map((g) => ({ ...g, nameHi: g.nameHi ?? null })),
      plainQty: 0,
      ...over,
    };
  };
  return { sheet };
}

type State = { id: string; label: string; data: ItemSheetData; preview: SheetPreview };

export default async function G4Preview(props: PageProps<"/dev/g4">) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await props.searchParams;
  const lang = parseLang(query.lang as string | undefined);
  const dishes = await loadDishes();
  if (!dishes) return <p className="p-8">Seed the dev database first: npm run db:seed</p>;
  const { sheet } = dishes;

  const photo = (d: ItemSheetData, hue: number): ItemSheetData => ({ ...d, item: { ...d.item, imageUrl: sample(hue) } });
  const bc = photo(sheet("Butter Chicken"), 20);
  const naan = bc.groups[0].modifiers[0].id;
  const gravy = bc.groups[1].modifiers[0].id;
  const opt = (id: string, nameEn: string, nameHi: string, paise: number, isAvailable = true) => ({ id, nameEn, nameHi, priceDeltaPaise: paise, isAvailable });
  const biryani = photo(sheet("Veg Biryani"), 40);
  const withAddOns: ItemSheetData = {
    ...biryani,
    groups: [
      {
        id: "addons",
        nameEn: "Add-ons",
        nameHi: "ऐड-ऑन",
        minSelect: 0,
        maxSelect: 3,
        modifiers: [opt("raita", "Raita", "रायता", 5000), opt("egg", "Boiled egg", "उबला अंडा", 4000), opt("rice", "Extra rice", "एक्स्ट्रा चावल", 6000)],
      },
    ],
  };
  const multi: ItemSheetData = {
    ...bc,
    groups: [
      ...bc.groups,
      { id: "gravy", nameEn: "Gravy level", nameHi: "ग्रेवी", minSelect: 0, maxSelect: 1, modifiers: [opt("g1", "Regular", "सामान्य", 0), opt("g2", "Extra gravy", "ज़्यादा ग्रेवी", 3000)] },
    ],
  };
  const naanGone: ItemSheetData = {
    ...bc,
    groups: bc.groups.map((g, i) => (i === 0 ? { ...g, modifiers: g.modifiers.map((m, j) => (j === 0 ? { ...m, isAvailable: false } : m)) } : g)),
  };
  const dal = photo(sheet("Dal Makhani"), 30);
  const paneer = photo(sheet("Paneer Tikka"), 15);
  const c65 = sheet("Chicken 65");

  const states: State[] = [
    { id: "simple", label: "1 · Simple dish (compact)", data: dal, preview: {} },
    { id: "simple-text", label: "1b · Simple dish, no photo", data: sheet("Masala Lassi"), preview: {} },
    { id: "required-missing", label: "2 · Required choice incomplete (after a tap)", data: bc, preview: { attempted: true } },
    { id: "required-done", label: "3 · Required choice complete + add-on", data: bc, preview: { selected: [naan, gravy] } },
    { id: "optional", label: "4 · Optional add-ons only", data: withAddOns, preview: { selected: ["raita"] } },
    { id: "multi", label: "5 · Several groups", data: multi, preview: { selected: [naan] } },
    { id: "qty", label: "6 · Quantity 3, 2 already in cart", data: { ...dal, plainQty: 2 }, preview: { qty: 3 } },
    { id: "note", label: "7 · Note + quick notes", data: dal, preview: { note: "Less spicy, extra lemon please" } },
    { id: "clash", label: "8 · Allergen clash (avoid dairy)", data: paneer, preview: { avoid: ["dairy"] } },
    { id: "clash-ack", label: "8b · Clash acknowledged", data: paneer, preview: { avoid: ["dairy"], ack: true } },
    { id: "unknown-filter", label: "9 · Allergens unknown + avoid filter on", data: c65, preview: { avoid: ["dairy"] } },
    { id: "unknown-nofilter", label: "9b · Allergens unknown, no filter (no tick needed)", data: c65, preview: {} },
    { id: "sold-out", label: "10 · Sold out (read-only)", data: photo(sheet("Mutton Curry"), 10), preview: {} },
    { id: "option-gone", label: "11 · Option unavailable", data: naanGone, preview: { selected: [], attempted: true } },
    { id: "paused", label: "12 · Ordering paused", data: { ...dal, session: { ...dal.session, orderingLocked: true } }, preview: {} },
    { id: "bill", label: "13 · Bill requested", data: { ...bc, session: { ...bc.session, status: "bill_requested" } }, preview: { selected: [naan] } },
    { id: "adding", label: "14 · Adding…", data: dal, preview: { busy: true } },
    { id: "failed", label: "15 · Add failed (choices kept)", data: bc, preview: { selected: [naan, gravy], qty: 2, note: "Less spicy", error: "failed" } },
    { id: "sold-later", label: "16 · Sold out while open", data: { ...bc, item: { ...bc.item, available: false } }, preview: { selected: [naan], soldOutLater: true } },
    { id: "outside-hours", label: "Breakfast after hours", data: { ...sheet("Aloo Paratha"), item: { ...sheet("Aloo Paratha").item, outsideHours: true } }, preview: {} },
  ];

  const solo = states.find((st) => st.id === query.solo);
  if (solo) {
    const big = query.text === "2";
    return (
      <div data-big={big || undefined} className="relative min-h-dvh bg-paper">
        {big && <style>{BIG_TEXT}</style>}
        <ItemSheet data={solo.data} lang={lang} shortCode="k7Qm" mode="sheet" preview={solo.preview} />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#ECE7DF] px-6 py-8">
      <header className="mb-6 flex flex-wrap items-center gap-4">
        <h1 className="font-display text-title font-bold">G4 Item sheet: all states</h1>
        <a className="text-body font-semibold text-accent underline" href="?lang=en">English</a>
        <a className="text-body font-semibold text-accent underline" href="?lang=hi">Hindi</a>
        <p className="text-caption text-muted">Development only. Buttons do nothing. Sample photos are labelled blocks.</p>
      </header>
      <div className="flex flex-wrap items-start gap-6">
        {states.map((st) => (
          <figure key={st.id} className="w-[360px]">
            <figcaption className="mb-2 text-caption font-semibold text-muted">
              <a href={`?solo=${st.id}&lang=${lang}`} className="hover:underline">
                {st.label}
              </a>
            </figcaption>
            <div className="relative h-[760px] overflow-hidden rounded-[28px] border border-line bg-paper shadow-[var(--shadow-float)] [transform:translateZ(0)]">
              <ItemSheet data={st.data} lang={lang} shortCode="k7Qm" mode="sheet" preview={st.preview} />
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}

const TYPE = { title: [22, 28], section: [16, 22], body: [14, 20], caption: [12, 16], label: [11, 14], button: [14, 20] };
const BIG_TEXT = Object.entries(TYPE)
  .map(([k, [size, lh]]) => `[data-big] .text-${k}{font-size:${size * 2}px;line-height:calc(${lh * 2}px * var(--lh))}`)
  .concat("[data-big] textarea{font-size:32px}")
  .join("\n");
