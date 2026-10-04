"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { adjustPrice, isValidNewPrice, validAdjustment, type AdjustMode } from "@/domain/price-adjust";
import type { PricingData, PricingRow } from "@/server/staff/pricing";
import { bulkOutletPriceAction, clearOutletPriceAction, pricingDataAction, setOutletPriceAction } from "../actions";

// O4 Pricing: outlet price overrides on top of the brand menu. Owners edit; managers view.
// Every number shown here is re-checked by the server, which also refuses stale edits.

const field = "min-h-11 rounded-input border border-line bg-surface px-3 text-body text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand";
const plainButton = "min-h-11 rounded-input border border-line bg-surface px-3 text-button font-semibold text-ink hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50";
const primaryButton = "min-h-11 rounded-input bg-brand px-4 text-button font-semibold text-brand-on hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50";

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
  reset: "Reset to brand price",
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

  return (
    <main className="min-h-[calc(100dvh-5rem)] bg-paper p-4 text-ink sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-title font-bold">Pricing</h1>
          <p className="mt-1 text-body text-muted">Manage outlet-specific menu prices.</p>
        </div>
        <p className="max-w-md rounded-card border border-line bg-surface px-3 py-2 text-caption text-muted">
          Brand prices are managed in Menu Manager. Outlet overrides apply only to this outlet ({data.outlet}).
        </p>
      </header>

      {!data.canEdit && (
        <p role="status" className="mt-4 rounded-card border border-line bg-surface px-3 py-2 text-body text-info">
          View only. Only an owner can change outlet prices.
        </p>
      )}
      {notice && (
        <p role={notice.kind === "error" ? "alert" : "status"} className={`mt-4 rounded-card border px-3 py-2 text-body ${notice.kind === "error" ? "border-danger/30 bg-surface text-danger" : notice.kind === "success" ? "border-success/30 bg-surface text-success" : "border-line bg-surface text-info"}`}>
          {notice.text}
        </p>
      )}

      <section aria-label="Filters" className="mt-5 flex flex-wrap items-center gap-2">
        <input aria-label="Search items" className={`${field} min-w-0 flex-1 sm:min-w-[220px] sm:flex-none`} placeholder="Search items" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label="Category" className={field} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="all">All categories</option>
          {data.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nameEn}
            </option>
          ))}
        </select>
        <label className="flex min-h-11 items-center gap-2 rounded-input border border-line bg-surface px-3 text-body">
          <input type="checkbox" className="size-4 accent-[var(--brand-main)]" checked={overridesOnly} onChange={(e) => setOverridesOnly(e.target.checked)} />
          Overrides only ({overrideCount})
        </label>
        {data.canEdit && (
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <span className="text-caption text-muted" aria-live="polite">
              {selected.size} selected
            </span>
            {selected.size > 0 && (
              <button type="button" className={plainButton} onClick={() => setSelected(new Set())}>
                Clear
              </button>
            )}
            <button type="button" className={primaryButton} disabled={selected.size === 0} onClick={() => { setDrawer(null); setBulk({ kind: "increase_percent", value: "", preview: false }); }}>
              Bulk adjust
            </button>
          </div>
        )}
      </section>

      <div className={`mt-4 grid gap-5 ${(drawerRow && data.canEdit) || (bulk && data.canEdit) ? "lg:grid-cols-[minmax(0,1fr)_380px]" : ""}`}>
        <section aria-label="Item prices" className="min-w-0">
          {data.rows.length === 0 ? (
            <Empty title="No menu items yet." body="Add dishes in Menu Manager first; their brand prices will show here." />
          ) : visible.length === 0 ? (
            overridesOnly && overrideCount === 0 ? (
              <Empty title="No outlet overrides." body="Every item uses its brand price at this outlet." />
            ) : (
              <Empty title="No items match these filters." body="Try another search or category." action={<button type="button" className={plainButton} onClick={() => { setQuery(""); setCategoryId("all"); setOverridesOnly(false); }}>Clear filters</button>} />
            )
          ) : (
            <>
              {/* Desktop and tablet: a table */}
              <div className="hidden overflow-hidden rounded-card border border-line bg-surface md:block">
                <table className="w-full text-left text-body">
                  <thead className="border-b border-line text-label font-bold uppercase tracking-wider text-muted">
                    <tr>
                      {data.canEdit && (
                        <th scope="col" className="w-11 px-3 py-2">
                          <input type="checkbox" aria-label="Select all shown items" className="size-4 accent-[var(--brand-main)]" checked={allShownSelected} onChange={toggleAllShown} />
                        </th>
                      )}
                      <th scope="col" className="px-3 py-2">Item</th>
                      <th scope="col" className="hidden px-3 py-2 lg:table-cell">Category</th>
                      <th scope="col" className="px-3 py-2 text-right">Brand price</th>
                      <th scope="col" className="px-3 py-2 text-right">Outlet price</th>
                      <th scope="col" className="px-3 py-2 text-right">Effective price</th>
                      <th scope="col" className="px-3 py-2">Source</th>
                      {data.canEdit && <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => (
                      <tr key={r.id} className={`border-b border-line last:border-0 ${drawer === r.id ? "bg-brand-soft" : ""}`}>
                        {data.canEdit && (
                          <td className="px-3 py-2">
                            <input type="checkbox" aria-label={`Select ${r.nameEn}`} className="size-4 accent-[var(--brand-main)]" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                          </td>
                        )}
                        <td className="px-3 py-2">
                          <span className="font-semibold">{r.nameEn}</span>
                          <span className="block text-caption text-muted lg:hidden">{r.categoryName}</span>
                        </td>
                        <td className="hidden px-3 py-2 text-muted lg:table-cell">{r.categoryName}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatPrice(r.brandPricePaise)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.outletPricePaise === null ? <span className="text-muted">—</span> : formatPrice(r.outletPricePaise)}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatPrice(r.pricePaise)}</td>
                        <td className="px-3 py-2"><SourceBadge source={r.source} /></td>
                        {data.canEdit && (
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-1">
                              <button type="button" className={plainButton} onClick={() => { setBulk(null); setDrawer(r.id); }}>Edit price</button>
                              {r.source === "outlet_override" && <button type="button" className={plainButton} onClick={() => { setBulk(null); setDrawer(r.id); }}>Reset</button>}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Phone: cards */}
              <ul className="space-y-2 md:hidden">
                {data.canEdit && (
                  <li>
                    <label className="flex min-h-11 items-center gap-2 text-body">
                      <input type="checkbox" className="size-4 accent-[var(--brand-main)]" checked={allShownSelected} onChange={toggleAllShown} />
                      Select all shown
                    </label>
                  </li>
                )}
                {visible.map((r) => (
                  <li key={r.id} className="rounded-card border border-line bg-surface p-3">
                    <div className="flex items-start gap-3">
                      {data.canEdit && <input type="checkbox" aria-label={`Select ${r.nameEn}`} className="mt-1 size-5 accent-[var(--brand-main)]" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold">{r.nameEn}</p>
                          <p className="font-semibold tabular-nums">{formatPrice(r.pricePaise)}</p>
                        </div>
                        <p className="text-caption text-muted">{r.categoryName}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted">
                          <SourceBadge source={r.source} />
                          <span>Brand {formatPrice(r.brandPricePaise)}</span>
                          {r.outletPricePaise !== null && <span>Outlet {formatPrice(r.outletPricePaise)}</span>}
                        </div>
                        {data.canEdit && (
                          <div className="mt-2 flex gap-2">
                            <button type="button" className={plainButton} onClick={() => { setBulk(null); setDrawer(r.id); }}>Edit price</button>
                            {r.source === "outlet_override" && <button type="button" className={plainButton} onClick={() => { setBulk(null); setDrawer(r.id); }}>Reset</button>}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {drawerRow && data.canEdit && (
          <PriceDrawer
            key={drawerRow.id}
            row={drawerRow}
            preview={preview}
            busy={busy}
            onClose={() => setDrawer(null)}
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
              setNotice({ kind: "success", text: `${drawerRow.nameEn} is back to its brand price, ${formatPrice(drawerRow.brandPricePaise)}.` });
              setDrawer(null);
              await reload();
              return null;
            }}
          />
        )}

        {bulk && data.canEdit && (
          <BulkPanel
            rows={selectedRows}
            plan={bulk}
            busy={busy}
            onChange={setBulk}
            onClose={() => setBulk(null)}
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
              setNotice({ kind: "success", text: bulk.kind === "reset" ? `${itemIds.length} item${itemIds.length === 1 ? "" : "s"} back to brand price.` : `Updated ${itemIds.length} outlet price${itemIds.length === 1 ? "" : "s"}.` });
              setBulk(null);
              setSelected(new Set());
              await reload();
              return null;
            }}
          />
        )}
      </div>
    </main>
  );
}

function SourceBadge({ source }: { source: PricingRow["source"] }) {
  return source === "outlet_override" ? (
    <span className="inline-flex items-center rounded-full border border-brand-border bg-brand-soft px-2 py-0.5 text-caption font-semibold text-brand-strong">Outlet override</span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-line bg-paper px-2 py-0.5 text-caption font-semibold text-muted">Brand</span>
  );
}

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line bg-surface p-6 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-body text-muted">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Side panel on wide screens, bottom sheet on phones. Escape closes it. */
function Panel({ title, labelId, onClose, children }: { title: string; labelId: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  // Focus moves into the panel once, when it opens
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input, select")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <aside
      ref={ref}
      role="dialog"
      aria-labelledby={labelId}
      className="fixed inset-x-0 bottom-0 z-30 max-h-[85dvh] overflow-y-auto rounded-t-sheet border border-line bg-surface p-5 shadow-lg lg:static lg:z-auto lg:max-h-none lg:self-start lg:rounded-card lg:shadow-none"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id={labelId} className="font-display text-section font-bold">
          {title}
        </h2>
        <button type="button" className={plainButton} onClick={onClose}>
          Close
        </button>
      </div>
      {children}
    </aside>
  );
}

function PriceDrawer({ row, preview, busy, onClose, onSave, onReset }: { row: PricingRow; preview?: PricingPreview; busy: boolean; onClose: () => void; onSave: (paise: number) => Promise<string | null>; onReset: () => Promise<string | null> }) {
  const [value, setValue] = useState(preview?.drawerValue ?? (row.outletPricePaise !== null && row.outletPricePaise % 100 === 0 ? String(row.outletPricePaise / 100) : ""));
  const [error, setError] = useState<string | null>(preview?.drawerError ?? null);
  const parsed = parseRupees(value);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (preview) return;
    if (parsed === null) {
      setError("Enter a whole-rupee price of ₹0 or more, for example 349.");
      return;
    }
    setError(await onSave(parsed));
  }

  return (
    <Panel title={`Edit price · ${row.nameEn}`} labelId="price-drawer-title" onClose={onClose}>
      <p className="mt-1 text-caption text-muted">{row.categoryName}</p>
      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-body">
        <dt className="text-muted">Brand base price</dt>
        <dd className="text-right tabular-nums">{formatPrice(row.brandPricePaise)}</dd>
        <dt className="text-muted">Current outlet override</dt>
        <dd className="text-right tabular-nums">{row.outletPricePaise === null ? "None" : formatPrice(row.outletPricePaise)}</dd>
        <dt className="text-muted">Effective price</dt>
        <dd className="text-right font-semibold tabular-nums">{formatPrice(row.pricePaise)}</dd>
        <dt className="text-muted">Price source</dt>
        <dd className="text-right"><SourceBadge source={row.source} /></dd>
      </dl>
      <form className="mt-5 space-y-3 border-t border-line pt-4" onSubmit={save} noValidate>
        <label className="block text-body font-semibold" htmlFor="outlet-price">
          Outlet price (₹)
        </label>
        <input
          id="outlet-price"
          className={`${field} w-full`}
          inputMode="numeric"
          placeholder={String(Math.round(row.brandPricePaise / 100))}
          value={value}
          aria-invalid={!!error}
          aria-describedby="outlet-price-help"
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
        />
        <p id="outlet-price-help" className={`text-caption ${error ? "text-danger" : "text-muted"}`} role={error ? "alert" : undefined}>
          {error ?? "Whole rupees only. Applies to guests at this outlet; orders already placed keep their price."}
        </p>
        <button type="submit" className={`${primaryButton} w-full`} disabled={busy}>
          {busy ? "Saving…" : "Save outlet price"}
        </button>
      </form>
      {row.outletPricePaise !== null && (
        <div className="mt-4 space-y-2 border-t border-line pt-4">
          <p className="text-body">
            Reset to brand price: guests here will pay <strong>{formatPrice(row.brandPricePaise)}</strong> instead of {formatPrice(row.pricePaise)}.
          </p>
          <button
            type="button"
            className={`${plainButton} w-full`}
            disabled={busy}
            onClick={async () => {
              if (preview) return;
              setError(await onReset());
            }}
          >
            Reset to brand price
          </button>
        </div>
      )}
    </Panel>
  );
}

function BulkPanel({ rows, plan, busy, onChange, onClose, onApply }: { rows: PricingRow[]; plan: BulkPlan & { preview: boolean }; busy: boolean; onChange: (p: BulkPlan & { preview: boolean }) => void; onClose: () => void; onApply: (planned: NonNullable<ReturnType<typeof planBulk>>) => Promise<string | null> }) {
  const [error, setError] = useState<string | null>(null);
  const planned = planBulk(rows, plan);
  const isReset = plan.kind === "reset";

  return (
    <Panel title="Bulk adjust" labelId="bulk-title" onClose={onClose}>
      <p className="mt-1 text-body text-muted">{rows.length} selected · results are whole rupees, rounded half up from each item&apos;s current effective price.</p>
      {!plan.preview ? (
        <form
          className="mt-4 space-y-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!planned) {
              setError(plan.kind.endsWith("percent") ? "Enter a percentage above 0 (up to 100 for a decrease)." : "Enter a whole-rupee amount above 0.");
              return;
            }
            setError(null);
            onChange({ ...plan, preview: true });
          }}
        >
          <label className="block text-body font-semibold" htmlFor="bulk-kind">
            Adjustment
          </label>
          <select id="bulk-kind" className={`${field} w-full`} value={plan.kind} onChange={(e) => onChange({ ...plan, kind: e.target.value as BulkKind })}>
            {(Object.keys(bulkLabels) as BulkKind[]).map((k) => (
              <option key={k} value={k}>
                {bulkLabels[k]}
              </option>
            ))}
          </select>
          {!isReset && (
            <>
              <label className="block text-body font-semibold" htmlFor="bulk-value">
                {plan.kind.endsWith("percent") ? "Percent" : "Amount (₹)"}
              </label>
              <input id="bulk-value" className={`${field} w-full`} inputMode="decimal" value={plan.value} aria-invalid={!!error} onChange={(e) => onChange({ ...plan, value: e.target.value })} />
            </>
          )}
          {error && (
            <p role="alert" className="text-caption text-danger">
              {error}
            </p>
          )}
          <button type="submit" className={`${primaryButton} w-full`} disabled={rows.length === 0}>
            Preview
          </button>
        </form>
      ) : planned ? (
        <div className="mt-4 space-y-3">
          <div className="max-h-[50dvh] overflow-auto rounded-card border border-line lg:max-h-[60vh]">
            <table className="w-full text-left text-caption">
              <thead className="sticky top-0 bg-surface text-label font-bold uppercase tracking-wider text-muted">
                <tr>
                  <th scope="col" className="px-2 py-2">Item</th>
                  <th scope="col" className="px-2 py-2 text-right">Brand</th>
                  <th scope="col" className="px-2 py-2 text-right">Now</th>
                  <th scope="col" className="px-2 py-2">Change</th>
                  <th scope="col" className="px-2 py-2 text-right">New</th>
                </tr>
              </thead>
              <tbody>
                {planned.map((p) => (
                  <tr key={p.row.id} className="border-t border-line">
                    <td className="px-2 py-2 font-semibold">{p.row.nameEn}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatPrice(p.row.brandPricePaise)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatPrice(p.row.pricePaise)}</td>
                    <td className="px-2 py-2">{p.label}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{p.nextOutlet === null ? `${formatPrice(p.nextPrice)} (brand)` : formatPrice(p.nextPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && (
            <p role="alert" className="text-caption text-danger">
              {error}
            </p>
          )}
          <p className="text-caption text-muted">Nothing changes until you apply. All {planned.length} prices change together, or none do.</p>
          <div className="flex gap-2">
            <button type="button" className={`${plainButton} flex-1`} onClick={() => onChange({ ...plan, preview: false })}>
              Back
            </button>
            <button
              type="button"
              className={`${primaryButton} flex-1`}
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
    </Panel>
  );
}
