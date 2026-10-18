"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Cancel01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { fromMilli, showQty, UNIT_LABEL, type StockUnit } from "@/domain/inventory";
import type { Inventory } from "@/server/staff/inventory";
import { inventoryAction, moveAction, recipeAction, removeItemAction, saveItemAction } from "../actions";

// Inventory: what is on the shelf, what each dish uses, and every change. Paid bills take stock
// off by the recipes; people add what they bought, what was thrown away, and shelf counts.

type Item = Inventory["items"][number];
type Dish = Inventory["dishes"][number];
type Panel = { kind: "item"; item: Item | null } | { kind: "move"; item: Item; move: "purchase" | "wastage" | "count" } | { kind: "recipe"; dish: Dish } | null;

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const card = "rounded-2xl border border-line bg-surface";
const field = `h-11 w-full rounded-xl border border-line bg-surface px-3 text-body text-ink placeholder:text-muted ${focus}`;
const primary = `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-ink px-4 text-button font-semibold text-paper disabled:opacity-50 ${focus}`;
const quiet = `inline-flex min-h-9 items-center justify-center rounded-lg border border-line px-3 text-caption font-semibold text-ink hover:bg-ink/[0.05] ${focus}`;
const rs = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const when = (at: number) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(at);
const KIND = {
  purchase: { label: "Stock in", tone: "bg-[var(--state-available-soft)] text-[var(--state-available-text)]" },
  sale: { label: "Sold", tone: "bg-ink/[0.06] text-muted" },
  wastage: { label: "Wastage", tone: "bg-danger/10 text-danger" },
  count: { label: "Count", tone: "bg-[var(--state-cleaning-soft)] text-[var(--state-cleaning-text)]" },
} as const;
const MOVE_TITLE = { purchase: "Stock in", wastage: "Wastage", count: "Count on the shelf" } as const;

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 outline-none sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-section font-bold text-ink">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`grid size-9 place-items-center rounded-lg text-muted hover:bg-ink/5 ${focus}`}>
            <HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function InventoryScreen({ initial }: { initial: Inventory }) {
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<"stock" | "recipes" | "history">("stock");
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const reload = async () => {
    const r = await inventoryAction();
    if (r.ok) setData(r.data);
  };
  const run = async (task: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) => {
    setBusy(true);
    setError(null);
    const r = await task();
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setPanel(null);
    setNotice(done);
    await reload();
  };
  const close = () => {
    setPanel(null);
    setError(null);
  };

  const low = data.items.filter((i) => i.low);
  const shown = data.items.filter((i) => !query.trim() || i.name.toLowerCase().includes(query.trim().toLowerCase()));
  const itemName = useMemo(() => new Map(data.items.map((i) => [i.id, i])), [data.items]);
  const withRecipe = data.dishes.filter((d) => d.recipe.length).length;

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-title font-bold text-ink">Inventory</h1>
          <p className="mt-1 text-body text-muted">
            {data.items.length} {data.items.length === 1 ? "item" : "items"} in stock, worth about {rs(data.stockValuePaise)}. {withRecipe} of {data.dishes.length} dishes have a recipe.
          </p>
        </div>
        <button type="button" className={primary} onClick={() => setPanel({ kind: "item", item: null })}>
          <HugeiconsIcon icon={PlusSignIcon} size={18} aria-hidden />
          Add stock item
        </button>
      </header>

      {notice && <p role="status" className="mt-4 rounded-xl bg-[var(--state-available-soft)] px-4 py-2.5 text-body text-[var(--state-available-text)]">{notice}</p>}
      {low.length > 0 && (
        <p role="alert" className="mt-4 rounded-xl border border-danger/30 bg-danger/[0.06] px-4 py-3 text-body text-ink">
          <span className="font-semibold text-danger">Running low: </span>
          {low.map((i) => `${i.name} (${showQty(i.qtyMilli, i.unit)})`).join(", ")}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Inventory" className="inline-flex rounded-xl border border-line bg-surface p-1">
          {([["stock", "Stock"], ["recipes", "Recipes"], ["history", "History"]] as const).map(([k, label]) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-9 rounded-lg px-4 text-body font-semibold ${focus} ${tab === k ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}>
              {label}
            </button>
          ))}
        </div>
        {tab === "stock" && <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search stock" aria-label="Search stock" className={`${field} max-w-64`} />}
      </div>

      {tab === "stock" && (
        <section className={`${card} mt-4 overflow-hidden`} aria-label="Stock">
          {data.items.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="font-display text-section font-bold text-ink">Start with what you buy most</p>
              <p className="mx-auto mt-1 max-w-md text-body text-muted">Add items like Paneer, Milk or Coke, then give each dish a recipe. Stock goes down by itself as bills are paid.</p>
              <button type="button" className={`${primary} mt-4`} onClick={() => setPanel({ kind: "item", item: null })}>Add stock item</button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-body">
                <thead>
                  <tr className="text-caption text-muted">
                    <th className="px-5 py-3 font-medium">Item</th>
                    <th className="px-3 py-3 text-right font-medium">On hand</th>
                    <th className="px-3 py-3 text-right font-medium">Alert at</th>
                    <th className="px-3 py-3 text-right font-medium">Price</th>
                    <th className="px-5 py-3 text-right font-medium">Update</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((i) => (
                    <tr key={i.id} className="border-t border-line">
                      <td className="px-5 py-3">
                        <button type="button" onClick={() => setPanel({ kind: "item", item: i })} className={`text-left font-semibold text-ink hover:underline ${focus}`}>{i.name}</button>
                        <span className="block text-caption text-muted">{i.usedIn ? `Used in ${i.usedIn} ${i.usedIn === 1 ? "dish" : "dishes"}` : "Not in any recipe yet"}</span>
                      </td>
                      <td className={`px-3 py-3 text-right font-semibold tabular-nums ${i.qtyMilli < 0 || i.low ? "text-danger" : "text-ink"}`}>{showQty(i.qtyMilli, i.unit)}</td>
                      <td className="px-3 py-3 text-right text-muted tabular-nums">{i.lowMilli === null ? "—" : showQty(i.lowMilli, i.unit)}</td>
                      <td className="px-3 py-3 text-right text-muted tabular-nums">{i.costPaise === null ? "—" : `${rs(i.costPaise)}/${UNIT_LABEL[i.unit]}`}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1.5">
                          <button type="button" className={quiet} onClick={() => setPanel({ kind: "move", item: i, move: "purchase" })}>Stock in</button>
                          <button type="button" className={quiet} onClick={() => setPanel({ kind: "move", item: i, move: "wastage" })}>Wastage</button>
                          <button type="button" className={quiet} onClick={() => setPanel({ kind: "move", item: i, move: "count" })}>Count</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "recipes" && (
        <section className={`${card} mt-4 overflow-hidden`} aria-label="Recipes">
          <p className="px-5 pt-4 text-caption text-muted">What one plate uses. When a bill is paid, these come off your stock.</p>
          {data.dishes.length === 0 ? <p className="px-5 py-10 text-center text-body text-muted">Add dishes to your menu first.</p> : (
            <ul className="mt-2">
              {data.dishes.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{d.name} <span className="text-caption font-normal text-muted">· {d.category}</span></p>
                    <p className="text-caption text-muted">
                      {d.recipe.length ? d.recipe.map((r) => { const it = itemName.get(r.stockItemId); return it ? `${it.name} ${showQty(r.qtyMilli, it.unit)}` : null; }).filter(Boolean).join(", ") : "No recipe: selling it uses no stock"}
                    </p>
                  </div>
                  <button type="button" className={quiet} disabled={!data.items.length} onClick={() => setPanel({ kind: "recipe", dish: d })}>{d.recipe.length ? "Edit recipe" : "Add recipe"}</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "history" && (
        <section className={`${card} mt-4 overflow-hidden`} aria-label="History">
          {data.moves.length === 0 ? <p className="px-5 py-10 text-center text-body text-muted">No changes yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-body">
                <thead><tr className="text-caption text-muted"><th className="px-5 py-3 font-medium">When</th><th className="px-3 py-3 font-medium">Item</th><th className="px-3 py-3 font-medium">What</th><th className="px-3 py-3 text-right font-medium">Change</th><th className="px-5 py-3 font-medium">By</th></tr></thead>
                <tbody>
                  {data.moves.map((m) => {
                    const it = itemName.get(m.stockItemId);
                    return (
                      <tr key={m.id} className="border-t border-line">
                        <td className="whitespace-nowrap px-5 py-2.5 text-muted">{when(m.createdAt)}</td>
                        <td className="px-3 py-2.5 font-semibold text-ink">{it?.name ?? "Removed item"}</td>
                        <td className="px-3 py-2.5"><span className={`rounded-full px-2.5 py-0.5 text-caption font-semibold ${KIND[m.kind].tone}`}>{KIND[m.kind].label}</span>{m.note && <span className="ml-2 text-caption text-muted">{m.note}</span>}</td>
                        <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${m.qtyMilli < 0 ? "text-danger" : "text-[var(--state-available-text)]"}`}>{m.qtyMilli > 0 ? "+" : ""}{it ? showQty(m.qtyMilli, it.unit) : fromMilli(m.qtyMilli)}</td>
                        <td className="px-5 py-2.5 text-muted">{m.kind === "sale" ? "Paid bill" : (m.by ?? "—")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {panel?.kind === "item" && (
        <Sheet title={panel.item ? `Edit ${panel.item.name}` : "Add stock item"} onClose={close}>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(() => saveItemAction({ id: panel.item?.id ?? null, name: String(f.get("name")), unit: String(f.get("unit")), low: String(f.get("low")), cost: String(f.get("cost")) }), panel.item ? "Saved." : "Added. Use Stock in to add what you have.");
            }}
          >
            <label className="grid gap-1 text-caption font-semibold text-muted">Name<input name="name" required maxLength={80} defaultValue={panel.item?.name} placeholder="e.g. Paneer" className={field} /></label>
            <label className="grid gap-1 text-caption font-semibold text-muted">Unit
              <select name="unit" defaultValue={panel.item?.unit ?? "kg"} className={field}>
                {(Object.keys(UNIT_LABEL) as StockUnit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-caption font-semibold text-muted">Alert when below<input name="low" inputMode="decimal" defaultValue={panel.item?.lowMilli == null ? "" : fromMilli(panel.item.lowMilli)} placeholder="e.g. 2" className={field} /></label>
              <label className="grid gap-1 text-caption font-semibold text-muted">Price per unit (₹)<input name="cost" inputMode="decimal" defaultValue={panel.item?.costPaise == null ? "" : String(panel.item.costPaise / 100)} placeholder="Optional" className={field} /></label>
            </div>
            {error && <p role="alert" className="text-caption text-danger">{error}</p>}
            <button type="submit" disabled={busy} className={primary}>{busy ? "Saving…" : panel.item ? "Save" : "Add item"}</button>
            {panel.item && (
              <button type="button" disabled={busy} onClick={() => void run(() => removeItemAction(panel.item!.id), `${panel.item!.name} removed from stock.`)} className={`min-h-10 text-caption font-semibold text-danger ${focus}`}>Remove from stock list</button>
            )}
          </form>
        </Sheet>
      )}

      {panel?.kind === "move" && (
        <Sheet title={`${MOVE_TITLE[panel.move]}: ${panel.item.name}`} onClose={close}>
          <p className="text-body text-muted">On hand now: <span className="font-semibold text-ink">{showQty(panel.item.qtyMilli, panel.item.unit)}</span></p>
          <form
            className="mt-3 grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(() => moveAction({ stockItemId: panel.item.id, kind: panel.move, qty: String(f.get("qty")), cost: String(f.get("cost") ?? ""), note: String(f.get("note") ?? "") }), "Stock updated.");
            }}
          >
            <label className="grid gap-1 text-caption font-semibold text-muted">
              {panel.move === "count" ? `How much is on the shelf (${UNIT_LABEL[panel.item.unit]})` : `How much (${UNIT_LABEL[panel.item.unit]})`}
              <input name="qty" required inputMode="decimal" autoFocus placeholder="e.g. 5" className={field} />
            </label>
            {panel.move === "purchase" && <label className="grid gap-1 text-caption font-semibold text-muted">Total cost (₹)<input name="cost" inputMode="decimal" placeholder="Optional" className={field} /></label>}
            <label className="grid gap-1 text-caption font-semibold text-muted">Note<input name="note" maxLength={140} placeholder={panel.move === "wastage" ? "e.g. Spoiled" : panel.move === "purchase" ? "e.g. From Sharma Dairy" : "Optional"} className={field} /></label>
            {error && <p role="alert" className="text-caption text-danger">{error}</p>}
            <button type="submit" disabled={busy} className={primary}>{busy ? "Saving…" : "Save"}</button>
          </form>
        </Sheet>
      )}

      {panel?.kind === "recipe" && <RecipeSheet dish={panel.dish} items={data.items} busy={busy} error={error} onClose={close} onSave={(lines) => void run(() => recipeAction(panel.dish.id, lines), `Recipe saved for ${panel.dish.name}.`)} />}
    </main>
  );
}

function RecipeSheet({ dish, items, busy, error, onClose, onSave }: { dish: Dish; items: Item[]; busy: boolean; error: string | null; onClose: () => void; onSave: (lines: { stockItemId: string; qty: string }[]) => void }) {
  const [rows, setRows] = useState(() => (dish.recipe.length ? dish.recipe.map((r) => ({ stockItemId: r.stockItemId, qty: fromMilli(r.qtyMilli) })) : [{ stockItemId: items[0]?.id ?? "", qty: "" }]));
  const unitOf = (id: string) => items.find((i) => i.id === id)?.unit;
  return (
    <Sheet title={`Recipe: ${dish.name}`} onClose={onClose}>
      <p className="text-body text-muted">What one plate uses.</p>
      <ul className="mt-3 grid gap-2">
        {rows.map((r, idx) => (
          <li key={idx} className="grid grid-cols-[minmax(0,1fr)_96px_auto] items-center gap-2">
            <select value={r.stockItemId} aria-label="Ingredient" onChange={(e) => setRows(rows.map((x, i) => (i === idx ? { ...x, stockItemId: e.target.value } : x)))} className={field}>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            <label className="relative">
              <input value={r.qty} inputMode="decimal" aria-label="Amount per plate" placeholder="0.2" onChange={(e) => setRows(rows.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))} className={`${field} pr-10`} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-caption text-muted">{unitOf(r.stockItemId) ? UNIT_LABEL[unitOf(r.stockItemId)!] : ""}</span>
            </label>
            <button type="button" aria-label="Remove ingredient" onClick={() => setRows(rows.filter((_, i) => i !== idx))} className={`grid size-11 place-items-center rounded-xl text-muted hover:bg-ink/5 ${focus}`}>
              <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => setRows([...rows, { stockItemId: items.find((i) => !rows.some((r) => r.stockItemId === i.id))?.id ?? items[0]?.id ?? "", qty: "" }])} className={`mt-2 ${quiet}`}>Add ingredient</button>
      <p className="mt-3 text-caption text-muted">For grams of a kg item, write 0.2 for 200 g. Leave the list empty to remove the recipe.</p>
      {error && <p role="alert" className="mt-2 text-caption text-danger">{error}</p>}
      <button type="button" disabled={busy} onClick={() => onSave(rows)} className={`mt-4 w-full ${primary}`}>{busy ? "Saving…" : "Save recipe"}</button>
    </Sheet>
  );
}
