"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import type { LibraryCategoryView, LibraryItemView } from "@/server/staff/menu-library";
import * as actions from "../actions";

// "Add from library": browse or search the TableQR menu list, tick dishes, type prices (or a price
// per size) and add them. Each dish goes into its own category, made if the menu does not have it.

type Pick = { price: string; sizes: Record<string, string>; useSizes: boolean };
const rupees = (v: string) => Math.round(Number(v) * 100);
const okPrice = (v: string) => v.trim() !== "" && Number.isInteger(Number(v)) && Number(v) > 0;

function VegMark({ veg }: { veg: boolean }) {
  return (
    <span aria-label={veg ? "Veg" : "Non-veg"} className={`grid size-4 shrink-0 place-items-center rounded-[3px] border-2 ${veg ? "border-[#237a68]" : "border-[#b83a3a]"}`}>
      <i className={`size-1.5 rounded-full ${veg ? "bg-[#237a68]" : "bg-[#b83a3a]"}`} />
    </span>
  );
}

/** Live search as the owner types, a little after they stop */
function useLibrarySearch(query: string) {
  const [result, setResult] = useState<{ categories: LibraryCategoryView[]; items: LibraryItemView[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const n = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const r = await actions.librarySearchAction(q);
      if (n !== seq.current) return;
      setLoading(false);
      setResult(r.ok ? r.data : { categories: [], items: [] });
    }, 180);
    return () => clearTimeout(t);
  }, [query]);
  return { result: query.trim() ? result : null, loading: query.trim() ? loading : false };
}

export function LibraryPanel({ canEdit, onDone }: { canEdit: boolean; onDone: (message: string) => void }) {
  const [filling, setFilling] = useState(false);
  const [query, setQuery] = useState("");
  const [all, setAll] = useState<LibraryCategoryView[] | null>(null);
  const [open, setOpen] = useState<{ category: LibraryCategoryView; items: LibraryItemView[] } | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  // Everything ever shown, so the summary and the add can find a picked dish from any view
  const [known, setKnown] = useState<Record<string, LibraryItemView>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { result, loading } = useLibrarySearch(query);

  useEffect(() => {
    void actions.libraryBrowseAction().then((r) => r.ok && setAll(r.data));
  }, []);
  const remember = (items: LibraryItemView[]) => setKnown((k) => ({ ...k, ...Object.fromEntries(items.map((i) => [i.id, i])) }));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep search results for the summary below
    if (result) remember(result.items);
  }, [result]);

  const openCategory = async (key: string) => {
    const r = await actions.libraryCategoryAction(key);
    if (!r.ok) return setError(r.error);
    remember(r.data.items);
    setOpen(r.data);
    setQuery("");
  };
  const toggle = (item: LibraryItemView) =>
    setPicks((p) => {
      if (p[item.id]) {
        const next = { ...p };
        delete next[item.id];
        return next;
      }
      return { ...p, [item.id]: { price: "", sizes: Object.fromEntries(item.sizes.map((s) => [s, ""])), useSizes: false } };
    });
  const setPick = (id: string, patch: Partial<Pick>) => setPicks((p) => ({ ...p, [id]: { ...p[id], ...patch } }));

  const picked = Object.entries(picks);
  const missing = picked.filter(([, p]) => (p.useSizes ? Object.values(p.sizes).filter(okPrice).length < 2 : !okPrice(p.price))).length;
  const add = async () => {
    setBusy(true);
    setError("");
    const r = await actions.libraryAddAction(
      picked.map(([id, p]) =>
        p.useSizes
          ? { id, pricePaise: 0, sizes: Object.entries(p.sizes).filter(([, v]) => okPrice(v)).map(([name, v]) => ({ name, pricePaise: rupees(v) })) }
          : { id, pricePaise: rupees(p.price) },
      ),
    );
    setBusy(false);
    if (!r.ok) return setError(r.error);
    const { added, skipped } = r.data;
    onDone(`Added ${added} ${added === 1 ? "dish" : "dishes"} from the library.${skipped.length ? ` Already on your menu: ${skipped.join(", ")}.` : ""}`);
  };

  const row = (item: LibraryItemView) => {
    const p = picks[item.id];
    return (
      <li key={item.id} className={`rounded-xl border p-3 transition-colors ${p ? "border-brand bg-brand-soft/60" : "border-line bg-surface"} ${item.onMenu ? "opacity-60" : ""}`}>
        <label className={`flex items-center gap-3 ${item.onMenu || !canEdit ? "" : "cursor-pointer"}`}>
          <input type="checkbox" className="size-4 shrink-0 accent-[#c9482b]" checked={!!p} disabled={item.onMenu || !canEdit} onChange={() => toggle(item)} />
          <VegMark veg={item.isVeg} />
          <LibraryThumb src={item.imageUrl} />
          <span className="min-w-0 flex-1">
            <b className="block truncate text-sm">{item.nameEn}</b>
            <span className="block truncate text-xs text-muted">{item.nameHi}{item.categoryName && !open ? ` · ${item.categoryName}` : ""}</span>
          </span>
          {item.onMenu ? <span className="shrink-0 rounded-full bg-ink/5 px-2 py-0.5 text-xs font-semibold text-muted">On your menu</span> : null}
          {p && !p.useSizes && (
            <span className="relative w-24 shrink-0">
              <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted">₹</span>
              <Input aria-label={`Price of ${item.nameEn}`} type="number" min="1" step="1" inputMode="numeric" value={p.price} onChange={(e) => setPick(item.id, { price: e.target.value })} className="h-10 rounded-lg pl-6 font-bold" placeholder="Price" />
            </span>
          )}
        </label>
        {p && item.sizes.length > 0 && (
          <div className="mt-2 pl-7">
            <button type="button" className="text-xs font-semibold text-brand-strong underline underline-offset-4" onClick={() => setPick(item.id, { useSizes: !p.useSizes })}>
              {p.useSizes ? "One price instead" : `Sell in sizes (${item.sizes.join(" / ")})`}
            </button>
            {p.useSizes && (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {item.sizes.map((size) => (
                  <label key={size} className="text-xs font-semibold text-muted">
                    {size}
                    <span className="relative mt-1 block">
                      <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted">₹</span>
                      <Input type="number" min="1" step="1" inputMode="numeric" value={p.sizes[size] ?? ""} onChange={(e) => setPick(item.id, { sizes: { ...p.sizes, [size]: e.target.value } })} className="h-10 rounded-lg pl-6 font-bold" />
                    </span>
                  </label>
                ))}
                <p className="col-span-full text-xs text-muted">Fill at least two sizes. Leave a size empty to skip it.</p>
              </div>
            )}
          </div>
        )}
      </li>
    );
  };

  const categoryGrid = (cats: LibraryCategoryView[]) => (
    <ul className="grid gap-2 sm:grid-cols-2">
      {cats.map((c) => (
        <li key={c.key}>
          <button type="button" onClick={() => void openCategory(c.key)} className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 text-left hover:border-ink/40">
            <span className="min-w-0 flex-1">
              <b className="block truncate text-sm">{c.nameEn}</b>
              <span className="block truncate text-xs text-muted">{c.nameHi} · {c.itemCount} dishes</span>
            </span>
            {c.onMenu && <span className="shrink-0 rounded-full bg-[var(--state-available-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--state-available-text)]">On menu</span>}
            <span aria-hidden className="text-muted">›</span>
          </button>
        </li>
      ))}
    </ul>
  );

  const summary = useMemo(() => picked.map(([id]) => known[id]?.nameEn).filter(Boolean).join(", "), [picked, known]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">Pick dishes from the TableQR list and type your price. Each dish goes into its own category; a category you don&apos;t have yet is made for you.</p>
      {!canEdit && <p className="rounded-xl bg-[var(--state-held-soft)] p-3 text-sm text-[var(--state-held-text)]">Only the owner can add dishes. You can still look through the list.</p>}
      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-paper p-3">
          <p className="text-sm text-ink"><b>Ready-made dish photos.</b> <span className="text-muted">Dishes on your menu without a photo get the library photo of the same name. Your own photos are never replaced.</span></p>
          <button
            type="button"
            disabled={filling}
            onClick={() => {
              setFilling(true);
              void actions.libraryFillPhotosAction().then((r) => {
                setFilling(false);
                onDone(!r.ok ? r.error : r.data.filled ? `Added photos to ${r.data.filled} ${r.data.filled === 1 ? "dish" : "dishes"}.${r.data.withoutPhoto ? ` ${r.data.withoutPhoto} still have no photo in the library yet.` : ""}` : "No matching library photos for your dishes without a photo yet.");
              });
            }}
            className="min-h-10 shrink-0 rounded-lg bg-brand px-3.5 text-sm font-semibold text-brand-on disabled:opacity-60"
          >
            {filling ? "Adding photos…" : "Add photos to my dishes"}
          </button>
        </div>
      )}

      <div className="relative">
        <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">⌕</span>
        <Input autoFocus aria-label="Search the library" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search: pizza, paneer, chai, fast food…" className="h-11 rounded-xl pl-9" />
      </div>

      {result ? (
        <div className="space-y-4">
          {loading && <p className="text-xs text-muted">Searching…</p>}
          {result.categories.length > 0 && (
            <section>
              <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Categories</p>
              {categoryGrid(result.categories)}
            </section>
          )}
          {result.items.length > 0 && (
            <section>
              <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Dishes</p>
              <ul className="space-y-2">{result.items.map(row)}</ul>
            </section>
          )}
          {!loading && result.categories.length === 0 && result.items.length === 0 && (
            <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">Nothing in the library for “{query}”. Add it yourself with New dish.</p>
          )}
        </div>
      ) : open ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <button type="button" className="text-sm font-semibold text-muted hover:text-ink" onClick={() => setOpen(null)}>‹ All categories</button>
            {canEdit && !open.category.onMenu && (
              <button
                type="button"
                className="min-h-9 rounded-lg border border-line px-3 text-xs font-semibold hover:border-ink/40"
                onClick={() => void actions.libraryEnsureCategoryAction(open.category.key).then((r) => onDone(r.ok ? `Category ${open.category.nameEn} added.` : r.error))}
              >
                Add only the category
              </button>
            )}
          </div>
          <div>
            <h3 className="font-display text-section font-bold">{open.category.nameEn} <span className="font-normal text-muted">{open.category.nameHi}</span></h3>
            {canEdit && (
              <button
                type="button"
                className="mt-1 text-xs font-semibold text-brand-strong underline underline-offset-4"
                onClick={() => open.items.filter((i) => !i.onMenu && !picks[i.id]).forEach(toggle)}
              >
                Tick every dish not on my menu
              </button>
            )}
          </div>
          <ul className="space-y-2">{open.items.map(row)}</ul>
        </section>
      ) : all ? (
        categoryGrid(all)
      ) : (
        <p className="text-sm text-muted">Loading the library…</p>
      )}

      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}

      {picked.length > 0 && (
        <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-line bg-background/95 px-4 py-3 backdrop-blur">
          <p className="truncate text-xs text-muted">{picked.length} picked: {summary}</p>
          {missing > 0 && <p className="text-xs font-semibold text-[var(--state-held-text)]">Type a whole-rupee price for {missing} {missing === 1 ? "dish" : "dishes"}.</p>}
          <button
            type="button"
            disabled={busy || missing > 0 || !canEdit}
            onClick={() => void add()}
            className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-brand bg-brand text-base font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
          >
            {busy ? "Adding…" : `Add ${picked.length} ${picked.length === 1 ? "dish" : "dishes"}`}
          </button>
        </div>
      )}
    </div>
  );
}

/** Small search for the New dish form: pick a library dish to fill the form in */
export function LibraryQuickPick({ onPick }: { onPick: (item: LibraryItemView) => void }) {
  const [query, setQuery] = useState("");
  const { result, loading } = useLibrarySearch(query);
  return (
    <section className="rounded-2xl border border-dashed border-brand/50 bg-brand-soft/40 p-4">
      <p className="text-sm font-semibold text-ink">Start from the TableQR list</p>
      <p className="mt-0.5 text-xs text-muted">Type a dish name. We fill in the details and its category; you add the price.</p>
      <Input aria-label="Search the library" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. margherita, paneer tikka, cold coffee" className="mt-2 h-11 rounded-xl" />
      {loading && <p className="mt-2 text-xs text-muted">Searching…</p>}
      {result && result.items.length > 0 && (
        <ul className="mt-2 max-h-64 space-y-1 overflow-auto">
          {result.items.map((i) => (
            <li key={i.id}>
              <button type="button" disabled={i.onMenu} onClick={() => { onPick(i); setQuery(""); }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-surface disabled:opacity-50">
                <VegMark veg={i.isVeg} />
                <span className="min-w-0 flex-1"><b className="block truncate text-sm">{i.nameEn}</b><span className="block truncate text-xs text-muted">{i.categoryName}</span></span>
                {i.onMenu && <span className="text-xs text-muted">On your menu</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The library photo's small copy, or nothing when the dish has no photo yet */
function LibraryThumb({ src }: { src: string | null }) {
  if (!src) return null;
  // Library photos live in the photo bucket, so this stays a plain lazy image
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src.replace(/\.webp$/, "-sm.webp")} alt="" loading="lazy" decoding="async" className="size-11 shrink-0 rounded-lg bg-line/40 object-cover" />;
}
