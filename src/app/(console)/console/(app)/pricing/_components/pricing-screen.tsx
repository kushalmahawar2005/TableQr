"use client";
import { useMemo, useState } from "react";
import { Search, Tag, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { adjustPrice, isValidNewPrice, validAdjustment, type AdjustMode } from "@/domain/price-adjust";
import type { PricingData, PricingRow } from "@/server/staff/pricing";
import { bulkOutletPriceAction, clearOutletPriceAction, pricingDataAction, setOutletPriceAction } from "../actions";

// O4 Pricing: outlet price overrides on top of the brand menu. Owners edit; managers view.
// Every number shown here is re-checked by the server, which also refuses stale edits.

const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
/** ₹349, or ₹349.50 for an older price that still has paise */
export const formatPrice = (paise: number) => `₹${paise % 100 === 0 ? rupees.format(paise / 100) : (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "349" -> 34900; anything that is not a whole rupee amount of ₹0 or more is null */
function parseRupees(value: string): number | null {
  const v = value.trim();
  if (!/^\d+$/.test(v)) return null;
  const paise = Number(v) * 100;
  return isValidNewPrice(paise) ? paise : null;
}

export type BulkKind = "increase_percent" | "decrease_percent" | "increase_fixed" | "decrease_fixed" | "reset";
const bulkLabels: Record<BulkKind, string> = {
  increase_percent: "Increase by %",
  decrease_percent: "Decrease by %",
  increase_fixed: "Increase by ₹",
  decrease_fixed: "Decrease by ₹",
  reset: "Back to menu price",
};

type BulkPlan = { kind: BulkKind; value: string };

/** What a bulk change would do to each row; null when the value is not usable */
function planBulk(rows: PricingRow[], plan: BulkPlan) {
  if (plan.kind === "reset") {
    return rows.map((r) => ({ row: r, label: "Brand price", nextOutlet: null as number | null, nextPrice: r.brandPricePaise }));
  }
  const percent = plan.kind.endsWith("percent");
  const sign = plan.kind.startsWith("increase") ? 1 : -1;
  const raw = Number(plan.value);
  if (!plan.value.trim() || !Number.isFinite(raw) || raw <= 0) return null;
  const mode: AdjustMode = percent ? "percent" : "fixed";
  const amount = percent ? sign * raw : sign * Math.round(raw * 100);
  if (!validAdjustment(mode, amount)) return null;
  return rows.map((r) => {
    const next = adjustPrice(r.pricePaise, mode, amount);
    return { row: r, label: percent ? `${sign > 0 ? "+" : "−"}${raw}%` : `${sign > 0 ? "+" : "−"}₹${raw}`, nextOutlet: next as number | null, nextPrice: next };
  });
}

export type PricingPreview = {
  drawer?: string;
  drawerValue?: string;
  drawerError?: string;
  bulk?: BulkPlan & { preview: boolean };
  selected?: string[];
  query?: string;
  overridesOnly?: boolean;
};

type Notice = { kind: "success" | "error" | "info"; text: string };

export function PricingScreen({ initial, preview }: { initial: PricingData; preview?: PricingPreview }) {
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState(preview?.query ?? "");
  const [categoryId, setCategoryId] = useState("all");
  const [overridesOnly, setOverridesOnly] = useState(!!preview?.overridesOnly);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preview?.selected ?? []));
  const [drawer, setDrawer] = useState<string | null>(preview?.drawer ?? null);
  const [bulk, setBulk] = useState<(BulkPlan & { preview: boolean }) | null>(preview?.bulk ?? null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.rows.filter(
      (r) => (categoryId === "all" || r.categoryId === categoryId) && (!overridesOnly || r.source === "outlet_override") && (!q || `${r.nameEn} ${r.nameHi ?? ""} ${r.categoryName}`.toLowerCase().includes(q)),
    );
  }, [data.rows, query, categoryId, overridesOnly]);
  const selectedRows = data.rows.filter((r) => selected.has(r.id));
  const allShownSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));
  const overrideCount = data.rows.filter((r) => r.source === "outlet_override").length;

  async function reload() {
    if (preview) return;
    const res = await pricingDataAction();
    if (res.ok) {
      setData(res.data);
      // Selections of items no longer on the menu are dropped
      setSelected((prev) => new Set([...prev].filter((id) => res.data.rows.some((r) => r.id === id))));
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllShown() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of visible) {
        if (allShownSelected) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });
  }

  const drawerRow = drawer ? (data.rows.find((r) => r.id === drawer) ?? null) : null;
  const chip = (on: boolean) => `min-h-9 shrink-0 rounded-full border px-3.5 text-sm font-semibold transition-colors ${on ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink hover:border-ink/40"}`;

  return (
    <main className="min-h-[calc(100dvh-5rem)] bg-paper p-4 pb-28 text-ink sm:p-6 sm:pb-28">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-title font-bold">Pricing</h1>
          <p className="mt-1 text-body text-muted">Set a different price for {data.outlet}. Other outlets are not affected.</p>
        </div>
      </header>

      <div className="mt-4 grid grid-cols-3 gap-2 sm:max-w-xl sm:gap-3">
        {[
          ["Dishes", data.rows.length],
          ["Changed here", overrideCount],
          ["Menu price", data.rows.length - overrideCount],
        ].map(([label, n]) => (
          <div key={label as string} className="rounded-2xl border border-line bg-surface p-3">
            <p className="font-display text-title font-bold tabular-nums">{n}</p>
            <p className="text-caption text-muted">{label}</p>
          </div>
        ))}
      </div>

      {!data.canEdit && (
        <p role="status" className="mt-4 rounded-xl border border-line bg-surface px-3 py-2 text-body text-info">
          View only. Only the owner can change prices.
        </p>
      )}
      {notice && (
        <p role={notice.kind === "error" ? "alert" : "status"} className={`mt-4 flex items-start justify-between gap-3 rounded-xl border px-3 py-2 text-body ${notice.kind === "error" ? "border-danger/30 bg-surface text-danger" : notice.kind === "success" ? "border-success/30 bg-surface text-success" : "border-line bg-surface text-info"}`}>
          <span>{notice.text}</span>
          <button type="button" aria-label="Dismiss" className="shrink-0 opacity-60 hover:opacity-100" onClick={() => setNotice(null)}><X className="size-4" /></button>
        </p>
      )}

      <section aria-label="Filters" className="mt-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input aria-label="Search dishes" className="h-11 rounded-xl pl-9" placeholder="Search dish or category" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="flex gap-1.5">
            <button type="button" className={chip(!overridesOnly)} onClick={() => setOverridesOnly(false)}>All</button>
            <button type="button" className={chip(overridesOnly)} onClick={() => setOverridesOnly(true)}>Changed here ({overrideCount})</button>
          </div>
          {data.canEdit && visible.length > 0 && (
            <button type="button" className="ml-auto min-h-9 rounded-full border border-line bg-surface px-3.5 text-sm font-semibold hover:border-ink/40" onClick={toggleAllShown}>
              {allShownSelected ? "Unselect all" : `Select all ${visible.length}`}
            </button>
          )}
        </div>
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <button type="button" className={chip(categoryId === "all")} onClick={() => setCategoryId("all")}>All categories</button>
          {data.categories.map((c) => (
            <button key={c.id} type="button" className={chip(categoryId === c.id)} onClick={() => setCategoryId(c.id)}>{c.nameEn}</button>
          ))}
        </div>
      </section>

      <section aria-label="Dish prices" className="mt-4 min-w-0">
        {data.rows.length === 0 ? (
          <Empty title="No dishes yet." body="Add dishes in Menu first. Their prices will show here." />
        ) : visible.length === 0 ? (
          overridesOnly && overrideCount === 0 ? (
            <Empty title="No price changes yet." body="Every dish uses its menu price at this outlet." />
          ) : (
            <Empty title="No dishes match." body="Try another search or category." action={<button type="button" className="min-h-10 rounded-xl border border-line px-4 text-sm font-semibold hover:border-ink/40" onClick={() => { setQuery(""); setCategoryId("all"); setOverridesOnly(false); }}>Clear filters</button>} />
          )
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((r) => {
              const changed = r.source === "outlet_override";
              const diff = r.pricePaise - r.brandPricePaise;
              const on = selected.has(r.id);
              return (
                <li key={r.id} className={`flex items-center gap-3 rounded-2xl border bg-surface p-3.5 transition-colors ${on ? "border-brand ring-1 ring-brand" : "border-line"}`}>
                  {data.canEdit && (
                    <input type="checkbox" aria-label={`Select ${r.nameEn}`} className="size-5 shrink-0 accent-[var(--brand-main)]" checked={on} onChange={() => toggle(r.id)} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{r.nameEn}</p>
                    <p className="truncate text-caption text-muted">{r.categoryName}</p>
                    {changed && (
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-caption">
                        <span className="rounded-full border border-brand-border bg-brand-soft px-2 py-0.5 font-semibold text-brand-strong">Changed here</span>
                        <span className="text-muted">Menu {formatPrice(r.brandPricePaise)} · {diff > 0 ? "+" : "−"}{formatPrice(Math.abs(diff))}</span>
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-display text-section font-bold tabular-nums">{formatPrice(r.pricePaise)}</p>
                    {data.canEdit && (
                      <button type="button" className="mt-1 min-h-9 rounded-lg border border-line px-3 text-sm font-semibold hover:border-ink/40" onClick={() => { setBulk(null); setDrawer(r.id); }}>
                        Edit
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {data.canEdit && selected.size > 0 && !bulk && (
        <div className="fixed inset-x-3 bottom-3 z-20 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3 shadow-lg lg:left-[calc(var(--sidebar-width,16rem)+0.75rem)]">
          <span className="text-sm font-semibold" aria-live="polite">{selected.size} selected</span>
          <div className="flex gap-2">
            <button type="button" className="min-h-11 rounded-xl border border-line px-3 text-sm font-semibold hover:border-ink/40" onClick={() => setSelected(new Set())}>Clear</button>
            <button type="button" className="min-h-11 rounded-xl border border-brand bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong" onClick={() => { setDrawer(null); setBulk({ kind: "increase_percent", value: "", preview: false }); }}>
              Change prices
            </button>
          </div>
        </div>
      )}

      <Sheet open={!!drawerRow && data.canEdit} onOpenChange={(o) => !o && setDrawer(null)}>
        <SheetContent className="w-full overflow-y-auto bg-background data-[side=right]:sm:max-w-md">
          {drawerRow && (
            <PriceDrawer
              key={drawerRow.id}
              row={drawerRow}
              preview={preview}
              busy={busy}
              onSave={async (pricePaise) => {
                setBusy(true);
                const res = await setOutletPriceAction(drawerRow.id, pricePaise, drawerRow.outletPricePaise);
                setBusy(false);
                if (!res.ok) {
                  if (res.code === "conflict") await reload();
                  return res.message;
                }
                setNotice({ kind: "success", text: `${drawerRow.nameEn} now costs ${formatPrice(pricePaise)} at this outlet.` });
                setDrawer(null);
                await reload();
                return null;
              }}
              onReset={async () => {
                setBusy(true);
                const res = await clearOutletPriceAction(drawerRow.id, drawerRow.outletPricePaise);
                setBusy(false);
                if (!res.ok) {
                  if (res.code === "conflict") await reload();
                  return res.message;
                }
                setNotice({ kind: "success", text: `${drawerRow.nameEn} is back to its menu price, ${formatPrice(drawerRow.brandPricePaise)}.` });
                setDrawer(null);
                await reload();
                return null;
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!bulk && data.canEdit} onOpenChange={(o) => !o && setBulk(null)}>
        <SheetContent className="w-full overflow-y-auto bg-background data-[side=right]:sm:max-w-lg">
          {bulk && (
            <BulkPanel
              rows={selectedRows}
              plan={bulk}
              busy={busy}
              onChange={setBulk}
              onApply={async (planned) => {
                if (preview) return null;
                setBusy(true);
                const itemIds = planned.map((p) => p.row.id);
                const expected = Object.fromEntries(planned.map((p) => [p.row.id, p.row.pricePaise]));
                const res =
                  bulk.kind === "reset"
                    ? await bulkOutletPriceAction({ action: "reset", itemIds, expected })
                    : await bulkOutletPriceAction({
                        action: "adjust",
                        itemIds,
                        expected,
                        mode: bulk.kind.endsWith("percent") ? "percent" : "fixed",
                        amount: (bulk.kind.startsWith("increase") ? 1 : -1) * (bulk.kind.endsWith("percent") ? Number(bulk.value) : Math.round(Number(bulk.value) * 100)),
                      });
                setBusy(false);
                if (!res.ok) {
                  await reload();
                  return res.code === "conflict" ? "Some prices changed since this preview. Nothing was changed. Check the new preview and apply again." : `Nothing was changed. ${res.message}`;
                }
                setNotice({ kind: "success", text: bulk.kind === "reset" ? `${itemIds.length} dish${itemIds.length === 1 ? "" : "es"} back to menu price.` : `Updated ${itemIds.length} price${itemIds.length === 1 ? "" : "s"}.` });
                setBulk(null);
                setSelected(new Set());
                await reload();
                return null;
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </main>
  );
}

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface p-8 text-center">
      <Tag aria-hidden="true" className="mx-auto size-6 text-muted" />
      <p className="mt-2 font-semibold">{title}</p>
      <p className="mt-1 text-body text-muted">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

const sheetBtnPrimary = "inline-flex h-12 flex-1 items-center justify-center rounded-xl border border-brand bg-brand text-base font-semibold text-white hover:bg-brand-strong disabled:opacity-50";
const sheetBtnPlain = "inline-flex h-12 items-center justify-center rounded-xl border border-line px-4 text-base font-semibold hover:border-ink/40 disabled:opacity-50";

function PriceDrawer({ row, preview, busy, onSave, onReset }: { row: PricingRow; preview?: PricingPreview; busy: boolean; onSave: (paise: number) => Promise<string | null>; onReset: () => Promise<string | null> }) {
  const [value, setValue] = useState(preview?.drawerValue ?? String(Math.round(row.pricePaise / 100)));
  const [error, setError] = useState<string | null>(preview?.drawerError ?? null);
  const parsed = parseRupees(value);
  const diff = parsed === null ? null : parsed - row.brandPricePaise;
  const nudge = (rupees: number) => {
    const base = parsed ?? row.pricePaise;
    setValue(String(Math.max(0, Math.round((base + rupees * 100) / 100))));
    setError(null);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (preview) return;
    if (parsed === null) {
      setError("Enter a whole-rupee price, for example 349.");
      return;
    }
    setError(await onSave(parsed));
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="font-display text-title font-bold">{row.nameEn}</SheetTitle>
        <SheetDescription>{row.categoryName} · Menu price {formatPrice(row.brandPricePaise)}</SheetDescription>
      </SheetHeader>
      <form className="space-y-5 px-4 pb-8" onSubmit={save} noValidate>
        <div>
          <label htmlFor="outlet-price" className="text-sm font-semibold">Price at this outlet</label>
          <div className="relative mt-2">
            <span aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-xl font-semibold text-muted">₹</span>
            <Input id="outlet-price" inputMode="numeric" className="h-16 rounded-2xl pl-10 font-display text-3xl font-bold tabular-nums md:text-3xl" value={value} aria-invalid={!!error} onChange={(e) => { setValue(e.target.value); setError(null); }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[-10, -5, 5, 10, 20].map((n) => (
              <button key={n} type="button" onClick={() => nudge(n)} className="min-h-9 rounded-full border border-line px-3 text-sm font-semibold hover:border-ink/40">{n > 0 ? "+" : "−"}₹{Math.abs(n)}</button>
            ))}
          </div>
          <p className={`mt-2 text-sm ${error ? "font-semibold text-danger" : "text-muted"}`} role={error ? "alert" : undefined}>
            {error ?? (diff === null ? "Whole rupees only." : diff === 0 ? "Same as the menu price." : `${diff > 0 ? "+" : "−"}${formatPrice(Math.abs(diff))} from the menu price.`)}
          </p>
        </div>
        <p className="rounded-xl bg-ink/5 p-3 text-sm text-muted">New price is for guests at this outlet. Orders already placed keep their old price.</p>
        <div className="flex gap-2">
          {row.outletPricePaise !== null && (
            <button type="button" className={sheetBtnPlain} disabled={busy} onClick={async () => { if (preview) return; setError(await onReset()); }}>
              Back to {formatPrice(row.brandPricePaise)}
            </button>
          )}
          <button type="submit" className={sheetBtnPrimary} disabled={busy}>{busy ? "Saving…" : "Save price"}</button>
        </div>
      </form>
    </>
  );
}

function BulkPanel({ rows, plan, busy, onChange, onApply }: { rows: PricingRow[]; plan: BulkPlan & { preview: boolean }; busy: boolean; onChange: (p: BulkPlan & { preview: boolean }) => void; onApply: (planned: NonNullable<ReturnType<typeof planBulk>>) => Promise<string | null> }) {
  const [error, setError] = useState<string | null>(null);
  const planned = planBulk(rows, plan);
  const isReset = plan.kind === "reset";
  const isPercent = plan.kind.endsWith("percent");
  const quick = isPercent ? ["5", "10", "15", "20"] : ["5", "10", "20", "50"];

  return (
    <>
      <SheetHeader>
        <SheetTitle className="font-display text-title font-bold">Change {rows.length} price{rows.length === 1 ? "" : "s"}</SheetTitle>
        <SheetDescription>{plan.preview ? "Check the new prices. Nothing changes until you apply." : "Pick what to do. You will see the result before it is saved."}</SheetDescription>
      </SheetHeader>
      {!plan.preview ? (
        <form
          className="space-y-5 px-4 pb-8"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!planned) {
              setError(isPercent ? "Enter a percentage above 0 (up to 100 for a decrease)." : "Enter a whole-rupee amount above 0.");
              return;
            }
            setError(null);
            onChange({ ...plan, preview: true });
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(bulkLabels) as BulkKind[]).map((k) => (
              <button key={k} type="button" onClick={() => { onChange({ ...plan, kind: k }); setError(null); }} className={`min-h-12 rounded-xl border px-3 text-sm font-semibold ${plan.kind === k ? "border-ink bg-ink text-paper" : "border-line bg-surface hover:border-ink/40"} ${k === "reset" ? "col-span-2" : ""}`}>
                {bulkLabels[k]}
              </button>
            ))}
          </div>
          {!isReset && (
            <div>
              <label htmlFor="bulk-value" className="text-sm font-semibold">{isPercent ? "How many percent?" : "How many rupees?"}</label>
              <div className="relative mt-2">
                <span aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xl font-semibold text-muted">{isPercent ? "%" : "₹"}</span>
                <Input id="bulk-value" inputMode="decimal" className="h-16 rounded-2xl pl-4 pr-10 font-display text-3xl font-bold tabular-nums md:text-3xl" value={plan.value} aria-invalid={!!error} onChange={(e) => onChange({ ...plan, value: e.target.value })} />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {quick.map((q) => (
                  <button key={q} type="button" onClick={() => onChange({ ...plan, value: q })} className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${plan.value === q ? "border-ink bg-ink text-paper" : "border-line hover:border-ink/40"}`}>{q}{isPercent ? "%" : ""}</button>
                ))}
              </div>
            </div>
          )}
          {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
          <button type="submit" className={`${sheetBtnPrimary} w-full`} disabled={rows.length === 0}>See new prices</button>
        </form>
      ) : planned ? (
        <div className="space-y-4 px-4 pb-8">
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {planned.map((p) => (
              <li key={p.row.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{p.row.nameEn}</p>
                  <p className="text-caption text-muted">{p.label}</p>
                </div>
                <p className="shrink-0 text-right tabular-nums">
                  <span className="text-sm text-muted line-through">{formatPrice(p.row.pricePaise)}</span>{" "}
                  <b>{formatPrice(p.nextPrice)}</b>
                </p>
              </li>
            ))}
          </ul>
          {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
          <p className="text-caption text-muted">All {planned.length} prices change together, or none do. Results are whole rupees.</p>
          <div className="flex gap-2">
            <button type="button" className={sheetBtnPlain} onClick={() => onChange({ ...plan, preview: false })}>Back</button>
            <button
              type="button"
              className={sheetBtnPrimary}
              disabled={busy}
              onClick={async () => {
                const message = await onApply(planned);
                setError(message);
                if (message) onChange({ ...plan, preview: true });
              }}
            >
              {busy ? "Applying…" : isReset ? "Reset prices" : "Apply"}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
