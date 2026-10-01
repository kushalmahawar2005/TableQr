import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MenuSkeleton } from "@/app/(guest)/r/[outlet]/t/[table]/menu/_components/menu-skeleton";
import type { MenuPreview } from "@/app/(guest)/r/[outlet]/t/[table]/menu/_components/menu-client";
import { MenuScreen } from "@/app/(guest)/r/[outlet]/t/[table]/menu/_components/menu-screen";
import { db } from "@/db";
import * as s from "@/db/schema";
import { NO_FILTERS } from "@/domain/menu-filter";
import { parseLang } from "@/lib/i18n";
import { getGuestMenu } from "@/server/guest/menu";
import { toMenuRows, type MenuScreenData } from "@/server/guest/menu-screen";

export const metadata: Metadata = { title: "G3 states (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Development-only review board: every G3 state with the seeded Spice Route menu. Never in production.
// Photos here are labelled sample blocks to check the layout; real menus use only restaurant photos.

const EVENING = new Date("2026-10-01T14:30:00Z"); // 20:00 in Jaipur: no breakfast

const sample = (label: string, hue: number) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="hsl(${hue} 45% 82%)"/><text x="48" y="52" font-family="sans-serif" font-size="10" text-anchor="middle" fill="hsl(${hue} 40% 30%)">${label}</text></svg>`,
  )}`;

async function loadBase(): Promise<MenuScreenData | null> {
  const [outlet] = await db.select().from(s.outlets).where(eq(s.outlets.code, "SRJ01"));
  if (!outlet) return null;
  const categories = await getGuestMenu(
    { tenantId: outlet.tenantId, brandId: outlet.brandId, outletId: outlet.id, timezone: outlet.timezone, soldOutDisplay: "grey" },
    EVENING,
  );
  const { menu, popularIds } = toMenuRows(categories);
  return {
    outlet: { code: outlet.code, name: outlet.name, logoUrl: null, accentColor: outlet.accentColor },
    table: { code: "T12" },
    renderedAt: 0,
    inProgress: 3,
    session: { key: "dev", people: 3, status: "open", orderingLocked: false, hostName: "Aarav" },
    menu,
    popularIds,
    cart: { byItem: {}, count: 0, subtotalPaise: 0 },
  };
}

type State = { id: string; label: string; data?: (b: MenuScreenData) => MenuScreenData; preview: MenuPreview; skeleton?: boolean };

export default async function G3Preview(props: PageProps<"/dev/g3">) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await props.searchParams;
  const lang = parseLang(query.lang as string | undefined);
  const base = await loadBase();
  if (!base) return <p className="p-8">Seed the dev database first: npm run db:seed</p>;

  const id = (name: string) => base.menu.flatMap((c) => c.items).find((i) => i.nameEn === name)!.id;
  const withPhotos = (b: MenuScreenData): MenuScreenData => ({
    ...b,
    menu: b.menu.map((c) => ({
      ...c,
      items: c.items.map((i, n) =>
        ["Paneer Tikka", "Butter Chicken", "Masala Papad", "Chicken Seekh Kebab", "Mutton Curry"].includes(i.nameEn)
          ? { ...i, imageUrl: sample("Sample photo", 20 + n * 40) }
          : i.nameEn === "Chicken 65"
            ? { ...i, imageUrl: "/broken-image-for-dev.jpg" }
            : i,
      ),
    })),
  });
  const withCart = (b: MenuScreenData): MenuScreenData => ({
    ...b,
    cart: {
      byItem: { [id("Paneer Tikka")]: { plain: 2, custom: 0 }, [id("Butter Chicken")]: { plain: 0, custom: 1 } },
      count: 3,
      subtotalPaise: 2 * 32000 + 44000,
    },
  });
  const cartQty = { [id("Paneer Tikka")]: 2 };

  const states: State[] = [
    { id: "loading", label: "1 · Loading", preview: {}, skeleton: true },
    { id: "normal", label: "2 · Menu (text-only rows, as seeded)", preview: {} },
    { id: "photos", label: "2b · With restaurant photos (one broken → text-only)", data: withPhotos, preview: {} },
    { id: "added", label: "3 · Item added: stepper + cart bar", data: (b) => withCart(withPhotos(b)), preview: { qty: cartQty } },
    { id: "future", label: "3b · Final visuals once G4/G5 exist: Choose, N in cart, View cart", data: (b) => withCart(withPhotos(b)), preview: { qty: cartQty, showFuture: true } },
    { id: "filters", label: "4 · Filters: Veg + avoid dairy", preview: { filters: { ...NO_FILTERS, diet: "veg", avoid: ["dairy"] } } },
    { id: "spice-sheet", label: "4b · Spice sheet", preview: { filters: { ...NO_FILTERS, maxSpice: 1 }, sheet: "spice" } },
    { id: "allergen-sheet", label: "4c · Avoid allergens sheet", preview: { filters: { ...NO_FILTERS, avoid: ["dairy", "tree_nuts"] }, sheet: "allergens" } },
    { id: "filters-empty", label: "4d · Filters hide everything", preview: { filters: { ...NO_FILTERS, diet: "non_veg", jainOnly: true } } },
    { id: "search", label: "5 · Search results: “paneer”", preview: { query: "paneer" } },
    { id: "search-alias", label: "5b · Alias search: “panir”", preview: { query: "panir" } },
    { id: "no-results", label: "6 · Search, no results", preview: { query: "pizza" } },
    { id: "sold-out", label: "7 · Sold out: grey + Back soon (search “curry”)", data: withPhotos, preview: { query: "curry" } },
    {
      id: "paused",
      label: "8 · Ordering paused by the host",
      data: (b) => ({ ...withCart(withPhotos(b)), session: { ...b.session, orderingLocked: true } }),
      preview: { qty: cartQty },
    },
    {
      id: "bill",
      label: "9 · Bill requested",
      data: (b) => ({ ...withCart(b), session: { ...b.session, status: "bill_requested" } }),
      preview: { qty: cartQty },
    },
    { id: "empty", label: "10 · Empty menu", data: (b) => ({ ...b, menu: [], popularIds: [] }), preview: {} },
    { id: "offline", label: "11 · Offline", data: withCart, preview: { qty: cartQty, offline: true } },
    { id: "failed", label: "12 · Add/update failed (toast, rolled back)", data: withCart, preview: { qty: cartQty, toast: "failed" } },
    { id: "max", label: "Quantity 50 (+ disabled)", data: withPhotos, preview: { qty: { [id("Paneer Tikka")]: 50 } } },
    { id: "alone", label: "Header: Just you, no Popular", data: (b) => ({ ...b, session: { ...b.session, people: 1 }, popularIds: [] }), preview: {} },
  ];

  const solo = states.find((st) => st.id === query.solo);
  if (solo) {
    const big = query.text === "2";
    return (
      <div data-big={big || undefined} className="relative mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 min-[360px]:px-5">
        {big && <style>{BIG_TEXT}</style>}
        {solo.skeleton ? (
          <MenuSkeleton />
        ) : (
          <MenuScreen data={(solo.data ?? ((b) => b))(base)} lang={lang} shortCode="k7Qm" realtimeUrl={null} preview={solo.preview} />
        )}
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#ECE7DF] px-6 py-8">
      <header className="mb-6 flex flex-wrap items-center gap-4">
        <h1 className="font-display text-title font-bold">G3 Menu: all states</h1>
        <a className="text-body font-semibold text-accent underline" href="?lang=en">English</a>
        <a className="text-body font-semibold text-accent underline" href="?lang=hi">Hindi</a>
        <p className="text-caption text-muted">Development only. Buttons do nothing here. Sample photos are labelled blocks.</p>
      </header>
      <div className="flex flex-wrap items-start gap-6">
        {states.map((st) => (
          <figure key={st.id} className="w-[360px]">
            <figcaption className="mb-2 text-caption font-semibold text-muted">
              <a href={`?solo=${st.id}&lang=${lang}`} className="hover:underline">
                {st.label}
              </a>
            </figcaption>
            {/* transform: the frame becomes the containing block for the fixed cart bar */}
            <div className="relative h-[760px] overflow-auto rounded-[28px] border border-line bg-paper px-5 shadow-[var(--shadow-float)] [transform:translateZ(0)] [&>div]:min-h-full">
              {st.skeleton ? (
                <MenuSkeleton />
              ) : (
                <MenuScreen data={(st.data ?? ((b) => b))(base)} lang={lang} shortCode="k7Qm" realtimeUrl={null} preview={st.preview} />
              )}
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}

// Foundation type sizes (size / line height, px), doubled for the 200% text check
const TYPE = { title: [22, 28], section: [16, 22], body: [14, 20], caption: [12, 16], label: [11, 14], button: [14, 20] };
const BIG_TEXT = Object.entries(TYPE)
  .map(([k, [size, lh]]) => `[data-big] .text-${k}{font-size:${size * 2}px;line-height:calc(${lh * 2}px * var(--lh))}`)
  .concat("[data-big] input{font-size:32px}")
  .join("\n");
