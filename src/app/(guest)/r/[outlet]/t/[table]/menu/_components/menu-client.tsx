"use client";

import { Cancel01Icon, CheckmarkCircle02Icon, InformationCircleIcon, Invoice01Icon, PauseIcon, Search01Icon, WifiOff01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { applyFilters, hasActiveFilters, NO_FILTERS, type MenuFilters } from "@/domain/menu-filter";
import { searchItems } from "@/domain/menu-search";
import type { Lang } from "@/lib/i18n";
import type { MenuRowItem, MenuScreenData } from "@/server/guest/menu-screen";
import { DiningNav } from "../../_components/dining-nav";
import { g3Copy } from "../_copy";
import { useMenuSync, useOnline, type CartError } from "../_hooks/use-menu-sync";
import { BUILT } from "../_screens";
import { CartBar } from "./cart-bar";
import { CategoryBar } from "./category-bar";
import { FilterBar } from "./filter-bar";
import { MenuRow, PopularCard, pick } from "./menu-row";

/** A frozen state for the dev review board */
export type MenuPreview = {
  query?: string;
  filters?: MenuFilters;
  qty?: Record<string, number>;
  offline?: boolean;
  /** Show the cart-update failure toast */
  toast?: "failed";
  sheet?: "spice" | "allergens";
  /** Draw G4 / G5 entry points as they will look once built */
  showFuture?: boolean;
  /** Show "Order sent to the kitchen · Round N" */
  sent?: number;
};

// Filters last for this dining session on this phone (G3 decision 16)
const filterKey = (sessionKey: string) => `tq_menu_filters:${sessionKey}`;
const filterEvent = "tq-menu-filters";
function readFilters(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function subscribeFilters(cb: () => void) {
  window.addEventListener(filterEvent, cb);
  return () => window.removeEventListener(filterEvent, cb);
}

export function MenuClient({
  data,
  lang,
  shortCode,
  renderedAt,
  realtimeUrl,
  sessionKey,
  preview,
}: {
  data: MenuScreenData;
  lang: Lang;
  shortCode: string;
  renderedAt: number;
  realtimeUrl: string | null;
  sessionKey: string;
  preview?: MenuPreview;
}) {
  const c = g3Copy[lang];
  const screens = preview?.showFuture ? { itemSheet: true, cart: true } : BUILT;

  // ---- filters (session storage, no effects) ----
  const key = filterKey(sessionKey);
  const stored = useSyncExternalStore(subscribeFilters, () => readFilters(key), () => null);
  const previewFilters = preview?.filters;
  const filters: MenuFilters = useMemo(() => {
    if (previewFilters) return previewFilters;
    try {
      return stored ? { ...NO_FILTERS, ...(JSON.parse(stored) as MenuFilters) } : NO_FILTERS;
    } catch {
      return NO_FILTERS;
    }
  }, [stored, previewFilters]);
  const setFilters = useCallback(
    (f: MenuFilters) => {
      if (preview) return;
      try {
        sessionStorage.setItem(key, JSON.stringify(f));
      } catch {
        // Private mode: filters still work, they just are not remembered
      }
      window.dispatchEvent(new Event(filterEvent));
    },
    [key, preview],
  );

  // The search text lasts for this table visit too, so coming back from Your order keeps it
  const searchKey = `tq_menu_search:${sessionKey}`;
  const storedQuery = useSyncExternalStore(subscribeFilters, () => readFilters(searchKey), () => null);
  const query = preview?.query ?? storedQuery ?? "";
  const setQuery = (q: string) => {
    if (preview) return;
    try {
      if (q) sessionStorage.setItem(searchKey, q);
      else sessionStorage.removeItem(searchKey);
    } catch {
      // Private mode: search still works for this page, it just is not remembered
    }
    window.dispatchEvent(new Event(filterEvent));
  };
  const [searchFocused, setSearchFocused] = useState(false);
  const [toast, setToast] = useState<string | null>(preview?.toast ? c.failed : null);

  // ---- cart ----
  const allItems = useMemo(() => data.menu.flatMap((cat) => cat.items), [data.menu]);
  const byId = useMemo(() => new Map(allItems.map((i) => [i.id, i])), [allItems]);
  const serverQty = useMemo(
    () => Object.fromEntries(Object.entries(data.cart.byItem).map(([id, q]) => [id, q.plain])),
    [data.cart.byItem],
  );
  const onError = useCallback(
    (error: CartError, itemId: string) => {
      const item = byId.get(itemId);
      const name = item ? pick(lang, item.nameEn, item.nameHi) : "";
      if (error === "sold_out") setToast(c.justSoldOut(name));
      else if (error === "unavailable_now") setToast(c.notAvailableNow(name));
      else if (error === "failed") setToast(c.failed);
      // blocked / gone: the refreshed page shows why
      setTimeout(() => setToast(null), 3000);
    },
    [byId, lang, c],
  );
  const { qtyOf, setQty } = useMenuSync({
    outletCode: data.outlet.code,
    shortCode,
    renderedAt,
    serverQty,
    realtimeUrl,
    onError,
    preview: !!preview,
    initial: preview?.qty,
  });

  const sentRound = preview?.sent ?? null;
  const scrollKey = `tq_menu_scroll:${sessionKey}`;
  // Search and filters hydrate before this frame; then restore the guest's place in the menu
  // when returning from Orders. Back from an item sheet retains the mounted menu naturally.
  useEffect(() => {
    if (preview) return;
    const saved = readFilters(scrollKey);
    if (saved === null) return;
    const top = Number(saved);
    if (!Number.isFinite(top) || top < 0) return;
    const frame = requestAnimationFrame(() => window.scrollTo({ top, behavior: "instant" }));
    return () => cancelAnimationFrame(frame);
  }, [preview, scrollKey]);
  const rememberScroll = () => {
    if (preview) return;
    try {
      sessionStorage.setItem(scrollKey, String(window.scrollY));
    } catch {
      // Browser Back still restores scroll when storage is unavailable.
    }
  };

  const online = useOnline(preview?.offline);
  const paused = data.session.orderingLocked;
  const billRequested = data.session.status === "bill_requested";
  const blocked = paused || billRequested || !online;

  // Count and total include taps still on their way to the server
  let count = data.cart.count;
  let total = data.cart.subtotalPaise;
  for (const item of allItems) {
    const delta = qtyOf(item.id) - (serverQty[item.id] ?? 0);
    if (delta) {
      count += delta;
      total += delta * item.price.paise;
    }
  }

  const rowState = (item: MenuRowItem) => ({
    qty: qtyOf(item.id),
    custom: data.cart.byItem[item.id]?.custom ?? 0,
    blocked,
    canOpenSheet: screens.itemSheet,
  });
  // The item sheet (G4) opens over the menu as its own route, loaded only when opened
  const router = useRouter();
  const outletCode = data.outlet.code;
  const canOpenSheet = !preview && screens.itemSheet;
  const openItem = (itemId: string) => {
    if (!canOpenSheet) return;
    // A fresh "o" per open gives every opening its own sheet instead of reusing a closed one
    router.push(`/r/${encodeURIComponent(outletCode)}/t/${encodeURIComponent(shortCode)}/menu/item/${encodeURIComponent(itemId)}?o=${Date.now().toString(36)}`, {
      scroll: false,
    });
  };

  // ---- what to show ----
  const filtered = applyFilters(allItems, filters);
  const shownIds = new Set(filtered.shown.map((i) => i.id));
  const filtersOn = hasActiveFilters(filters);
  const searching = query.trim().length > 0;
  const results = searching ? searchItems(filtered.shown, query) : [];

  const sections = [
    ...(data.popularIds.length ? [{ id: "popular", label: c.popular, items: data.popularIds.map((id) => byId.get(id)!) }] : []),
    ...data.menu.map((cat) => ({ id: cat.id, label: pick(lang, cat.nameEn, cat.nameHi), items: cat.items })),
  ]
    .map((s) => ({ ...s, items: s.items.filter((i) => shownIds.has(i.id)) }))
    .filter((s) => s.items.length > 0);

  const pausedBy = paused ? c.pausedBy(data.session.hostName) : billRequested ? c.billRequested : null;

  return (
    <>
      {paused ? (
        <Banner icon={PauseIcon} tone="paused" title={c.pausedBy(data.session.hostName)} body={c.pausedBody} />
      ) : billRequested ? (
        <Banner icon={Invoice01Icon} tone="bill" title={c.billRequested} body={c.billRequestedBody} />
      ) : null}
      {!online && <Banner icon={WifiOff01Icon} tone="offline" title={c.offline} body={c.offlineBody} />}
      {sentRound !== null && (
        <p role="status" className="mt-3 flex animate-fade items-center gap-2.5 rounded-cta bg-[var(--state-available-soft)] px-4 py-3 text-body font-semibold text-[var(--state-available-text)]">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={20} className="shrink-0" aria-hidden />
          {c.orderSent(sentRound)}
        </p>
      )}

      {/* Search */}
      <form role="search" onSubmit={(e) => { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur(); }} className="mt-3">
        <label className="relative block">
          <span className="sr-only">{c.searchLabel}</span>
          <HugeiconsIcon icon={Search01Icon} size={20} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-brand" aria-hidden />
          <input
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder={c.searchPlaceholder}
            className="h-12 w-full rounded-full border border-line/80 bg-surface pr-11 pl-12 text-body text-ink shadow-[0_1px_3px_rgb(0_0_0/0.05)] outline-none placeholder:text-muted/80 focus:border-brand focus:shadow-[0_0_0_3px_var(--brand-soft)] [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={c.clearSearch}
              className="absolute top-1/2 right-1 grid size-11 -translate-y-1/2 place-items-center rounded-full text-muted hover:text-ink"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden />
            </button>
          )}
        </label>
      </form>

      <div className="mt-3">
        <FilterBar filters={filters} onChange={setFilters} lang={lang} c={c} openSheet={preview?.sheet} />
      </div>

      {filtersOn && (
        <div className="mt-2 space-y-1">
          <p role="status" className="flex flex-wrap items-center gap-x-2 text-caption text-muted">
            {filtered.hidden > 0 && <span>{c.hidden(filtered.hidden)}</span>}
            {filtered.hidden > 0 && <span aria-hidden>·</span>}
            <button type="button" onClick={() => setFilters(NO_FILTERS)} className="-my-2 py-2 font-semibold text-brand-strong hover:underline">
              {c.clearFilters}
            </button>
          </p>
          {filtered.unknownAllergens > 0 && (
            <p className="flex items-start gap-1.5 text-caption text-muted">
              <HugeiconsIcon icon={InformationCircleIcon} size={14} className="mt-px shrink-0" aria-hidden />
              {c.allergenUnknownNotice}
            </p>
          )}
        </div>
      )}

      {searching ? (
        <section aria-live="polite" className="mt-4">
          {results.length ? (
            <>
              <h2 className="text-caption font-semibold text-muted">{c.results(results.length, query.trim())}</h2>
              <ul className="mt-1">
                {results.map((item) => (
                  <MenuRow key={item.id} item={item} state={rowState(item)} lang={lang} c={c} onQty={setQty} onOpen={openItem} />
                ))}
              </ul>
            </>
          ) : (
            <Empty title={c.noResults.title} body={c.noResults.body} action={c.clearSearch} onAction={() => setQuery("")} />
          )}
        </section>
      ) : data.menu.length === 0 ? (
        <Empty title={c.emptyMenu.title} body={c.emptyMenu.body} />
      ) : sections.length === 0 ? (
        <Empty title={c.filteredEmpty.title} body={c.filteredEmpty.body} action={c.clearFilters} onAction={() => setFilters(NO_FILTERS)} />
      ) : (
        <>
          <div className="mt-3">
            <CategoryBar categories={sections.map((s) => ({ id: s.id, label: s.label }))} label={c.categoriesLabel} />
          </div>
          {sections.map((s) => (
            <section key={s.id} id={`cat-${s.id}`} aria-labelledby={`h-${s.id}`} className="scroll-mt-14 pt-5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id={`h-${s.id}`} className="font-display text-title font-bold text-ink">
                  {s.label}
                </h2>
                <span className="shrink-0 rounded-full border border-line/80 bg-surface px-2.5 py-0.5 text-caption text-muted">{c.itemCount(s.items.length)}</span>
              </div>
              {s.id === "popular" ? (
                <ul className="-mx-4 mt-3 flex gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] min-[360px]:-mx-5 min-[360px]:px-5">
                  {s.items.map((item) => (
                    <PopularCard key={item.id} item={item} state={rowState(item)} lang={lang} c={c} onQty={setQty} onOpen={openItem} />
                  ))}
                </ul>
              ) : (
                <ul className="mt-3">
                  {s.items.map((item) => (
                    <MenuRow key={item.id} item={item} state={rowState(item)} lang={lang} c={c} onQty={setQty} onOpen={openItem} />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </>
      )}

      {toast && (
        <p role="status" className="fixed inset-x-0 top-4 z-40 mx-auto w-fit max-w-[calc(100%-32px)] animate-fade rounded-cta bg-ink px-4 py-2.5 text-center text-caption font-semibold text-white shadow-[var(--shadow-float)]">
          {toast}
        </p>
      )}

      <DiningNav
        tablePath={`/r/${encodeURIComponent(outletCode)}/t/${encodeURIComponent(shortCode)}`}
        active="menu"
        lang={lang}
        inProgress={data.inProgress}
        preview={!!preview}
        onLeave={rememberScroll}
        above={count > 0 && !searchFocused ? (
        <CartBar
          count={count}
          totalPaise={total}
          pausedBy={pausedBy}
          canOpenCart={screens.cart}
          onOpen={() => {
            if (preview) return;
            rememberScroll();
            router.push(`/r/${encodeURIComponent(outletCode)}/t/${encodeURIComponent(shortCode)}/cart?from=menu`, { scroll: false });
          }}
          c={c}
        />
        ) : undefined}
      />
    </>
  );
}

const BANNER_TONE = {
  paused: "bg-[var(--state-held-soft)] text-[var(--state-held-text)]",
  bill: "bg-[var(--state-bill-soft)] text-[var(--state-bill-text)]",
  offline: "bg-surface text-ink ring-1 ring-line ring-inset",
} as const;

function Banner({ icon, tone, title, body }: { icon: IconSvgElement; tone: keyof typeof BANNER_TONE; title: string; body: string }) {
  return (
    <div role="status" className={`mt-3 flex items-start gap-3 rounded-cta px-4 py-3 ${BANNER_TONE[tone]}`}>
      <HugeiconsIcon icon={icon} size={20} className="shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-body font-semibold">{title}</p>
        <p className="mt-0.5 text-caption text-ink/75">{body}</p>
      </div>
    </div>
  );
}

function Empty({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex flex-col items-center px-4 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-surface text-muted ring-1 ring-line">
        <HugeiconsIcon icon={Search01Icon} size={22} aria-hidden />
      </span>
      <p className="mt-4 font-display text-section font-bold text-ink">{title}</p>
      <p className="mt-1 text-body text-muted">{body}</p>
      {action && (
        <button type="button" onClick={onAction} className="mt-5 min-h-11 rounded-cta border border-line bg-surface px-5 text-button font-semibold text-ink hover:bg-paper">
          {action}
        </button>
      )}
    </div>
  );
}
