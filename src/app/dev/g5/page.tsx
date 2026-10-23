import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CartScreen, type CartPreview } from "@/app/(guest)/r/[outlet]/t/[table]/cart/_components/cart-screen";
import { db } from "@/db";
import * as s from "@/db/schema";
import { parseLang } from "@/lib/i18n";
import type { CartLineView, CartScreenData } from "@/server/guest/cart-screen";

export const metadata: Metadata = { title: "G5 states (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Development-only review board: every G5 "Your order" state with seeded dishes. Never in production.

export default async function G5Preview(props: PageProps<"/dev/g5">) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await props.searchParams;
  const lang = parseLang(query.lang as string | undefined);
  const [outlet] = await db.select().from(s.outlets).where(eq(s.outlets.code, "SRJ01"));
  if (!outlet) return <p className="p-8">Seed the dev database first: npm run db:seed</p>;
  const items = await db.select().from(s.menuItems).where(eq(s.menuItems.tenantId, outlet.tenantId));
  const it = (name: string) => items.find((i) => i.nameEn === name)!;

  let n = 0;
  const line = (name: string, qty: number, over: Partial<CartLineView> = {}): CartLineView => {
    const i = it(name);
    const unit = over.unitPricePaise ?? i.pricePaise;
    return {
      id: `l${++n}`,
      itemId: i.id,
      nameEn: i.nameEn,
      nameHi: i.nameHi,
      isVeg: i.isVeg,
      qty,
      options: [],
      note: null,
      shared: false,
      personalForPickup: false,
      unitPricePaise: unit,
      linePaise: unit * qty,
      reason: null,
      kind: "plain",
      ...over,
    };
  };
  const paneer = line("Paneer Tikka", 2);
  const dal = line("Dal Makhani", 1);
  const bc = line("Butter Chicken", 2, {
    kind: "configured",
    options: [
      { nameEn: "Butter naan", nameHi: "बटर नान" },
      { nameEn: "Extra gravy", nameHi: "एक्स्ट्रा ग्रेवी" },
    ],
    note: "Less spicy",
    unitPricePaise: 47000,
  });
  const lassi = line("Masala Lassi", 1);

  const base = (mine: CartLineView[], over: Partial<CartScreenData["session"]> = {}, others: CartScreenData["others"] = []): CartScreenData => ({
    renderedAt: 0,
    outlet: { code: outlet.code, name: outlet.name, logoUrl: null, accentColor: outlet.accentColor },
    table: { code: "T12" },
    session: { key: "dev", people: 3, status: "open", orderingLocked: false, hostName: "Aarav", verified: true, needsName: false, ...over },
    mine,
    myCount: mine.reduce((a, l) => a + l.qty, 0),
    subtotalPaise: mine.reduce((a, l) => a + (l.reason ? 0 : (l.linePaise ?? 0)), 0),
    quote: {},
    others,
  });
  const others: CartScreenData["others"] = [
    {
      id: "p-aarav",
      name: "Aarav",
      count: 3,
      lines: [
        { id: "o1", nameEn: "Butter Chicken", nameHi: "बटर चिकन", isVeg: false, qty: 1, options: [{ nameEn: "Tandoori roti", nameHi: "तंदूरी रोटी" }], note: null, shared: false, personalForPickup: false, reason: null },
        { id: "o2", nameEn: "Garlic Naan", nameHi: "गार्लिक नान", isVeg: true, qty: 2, options: [], note: null, shared: false, personalForPickup: false, reason: null },
      ],
    },
    { id: "p-x", name: null, count: 1, lines: [{ id: "o3", nameEn: "Masala Fries", nameHi: "मसाला फ्राइज़", isVeg: true, qty: 1, options: [], note: "No onion", shared: false, personalForPickup: false, reason: null }] },
  ];
  const normal = [paneer, bc, dal];

  const states: { id: string; label: string; data: CartScreenData; preview: CartPreview }[] = [
    { id: "mine", label: "1 · Mine (named guest)", data: base([paneer, dal]), preview: {} },
    { id: "configured", label: "2–4 · Configured line with note, several lines", data: base(normal), preview: {} },
    { id: "table", label: "6 · Whole table (read-only)", data: base(normal, {}, others), preview: { tab: "table" } },
    { id: "alone", label: "7 · One person: no tabs", data: base([paneer], { people: 1 }), preview: {} },
    { id: "empty", label: "8 · Empty cart", data: base([]), preview: {} },
    {
      id: "unavailable",
      label: "9–11 · Sold out / option / outside hours",
      data: base([
        line("Mutton Curry", 1, { reason: "sold_out" }),
        line("Butter Chicken", 1, { kind: "configured", options: [{ nameEn: "Butter naan", nameHi: "बटर नान" }], unitPricePaise: 44000, reason: "option_unavailable" }),
        line("Aloo Paratha", 1, { reason: "outside_hours" }),
        paneer,
      ]),
      preview: {},
    },
    { id: "name", label: "14 · Open mode: name required", data: base([paneer, dal], { needsName: true }), preview: {} },
    { id: "name-invalid", label: "15 · Invalid name", data: base([paneer, dal], { needsName: true }), preview: { name: "Aarav123" } },
    { id: "name-ok", label: "14b · Name entered", data: base([paneer, dal], { needsName: true }), preview: { name: "Aarav" } },
    { id: "cap", label: "16 · Open-mode cap reached", data: base([line("Mutton Curry", 4), line("Chicken Chettinad", 3)], { needsName: true }), preview: { name: "Aarav", notice: "cap" } },
    { id: "paused", label: "12 · Ordering paused", data: base(normal, { orderingLocked: true }), preview: {} },
    { id: "bill", label: "13 · Bill requested", data: base(normal, { status: "bill_requested" }), preview: {} },
    { id: "offline", label: "17 · Offline", data: base(normal), preview: { offline: true } },
    { id: "placing", label: "18 · Placing order…", data: base([paneer, dal]), preview: { placing: true } },
    { id: "failed", label: "20 · Place order failed", data: base([paneer, dal]), preview: { notice: "failed" } },
    { id: "undo", label: "21 · Removed + Undo", data: base([paneer, dal, lassi]), preview: { undoLine: lassi.id } },
  ];

  const solo = states.find((st) => st.id === query.solo);
  if (solo) {
    const big = query.text === "2";
    return (
      <div data-big={big || undefined} className="relative mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 min-[360px]:px-5">
        {big && <style>{BIG_TEXT}</style>}
        <CartScreen data={solo.data} lang={lang} shortCode="k7Qm" fromMenu realtimeUrl={null} preview={solo.preview} />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#ECE7DF] px-6 py-8">
      <header className="mb-6 flex flex-wrap items-center gap-4">
        <h1 className="font-display text-title font-bold">G5 Your order: all states</h1>
        <a className="text-body font-semibold text-accent underline" href="?lang=en">English</a>
        <a className="text-body font-semibold text-accent underline" href="?lang=hi">Hindi</a>
        <p className="text-caption text-muted">Development only. Buttons do nothing here.</p>
      </header>
      <div className="flex flex-wrap items-start gap-6">
        {states.map((st) => (
          <figure key={st.id} className="w-[360px]">
            <figcaption className="mb-2 text-caption font-semibold text-muted">
              <a href={`?solo=${st.id}&lang=${lang}`} className="hover:underline">
                {st.label}
              </a>
            </figcaption>
            <div className="relative h-[760px] overflow-auto rounded-[28px] border border-line bg-paper px-5 shadow-[var(--shadow-float)] [transform:translateZ(0)] [&>div]:min-h-full">
              <CartScreen data={st.data} lang={lang} shortCode="k7Qm" fromMenu realtimeUrl={null} preview={st.preview} />
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
  .concat("[data-big] input{font-size:32px}")
  .join("\n");
