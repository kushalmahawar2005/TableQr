"use client";

import type { Features } from "@/lib/plan-features";
import { useMemo, useState } from "react";
import { Cancel01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { fromMilli, showQty, UNIT_LABEL, type StockUnit } from "@/domain/inventory";
import type { Inventory } from "@/server/staff/inventory";
import type { Purchasing } from "@/server/staff/inventory-pro";
import { inventoryAction, moveAction, purchasingAction, recipeAction, removeItemAction, saveItemAction, stockSoldOutAction } from "../actions";
import { CountTab, MakePrepSheet, PrepRecipeSheet, PrepTab, ReportTab } from "./count-prep-report";
import { LibrarySheet } from "./library-sheet";
import { BillSheet, PaySheet, PurchasesTab, SupplierSheet, SuppliersTab, type BillPanel } from "./purchasing";
import { card, field, focus, label, primary, quiet, rs, Sheet, when } from "./ui";

// Inventory: what is on the shelf, what each dish uses, and every change. Paid bills take stock
// off by the recipes; supplier bills put it in; the day-end count finds what went missing; the
// report shows food cost. Organised like a counter POS: Stock, Purchases, Suppliers, Count,
// Recipes, Prep, Report, History.

type Item = Inventory["items"][number];
type Dish = Inventory["dishes"][number];
type Tab = "stock" | "purchases" | "suppliers" | "count" | "recipes" | "prep" | "report" | "history";
type Panel =
  | { kind: "item"; item: Item | null; prep?: boolean }
  | { kind: "move"; item: Item; move: "wastage" | "count" }
  | { kind: "recipe"; dish: Dish }
  | { kind: "prepRecipe"; item: Item }
  | { kind: "make"; item: Item }
  | { kind: "library" }
  | BillPanel
  | null;

const TABS: [Tab, string][] = [["stock", "Stock"], ["purchases", "Purchases"], ["suppliers", "Suppliers"], ["count", "Day-end count"], ["recipes", "Recipes"], ["prep", "Prep items"], ["report", "Report"], ["history", "History"]];
const KIND = {
  purchase: { label: "Purchase", tone: "bg-[var(--state-available-soft)] text-[var(--state-available-text)]" },
  sale: { label: "Sold", tone: "bg-ink/[0.06] text-muted" },
  wastage: { label: "Wastage", tone: "bg-danger/10 text-danger" },
  count: { label: "Count", tone: "bg-[var(--state-cleaning-soft)] text-[var(--state-cleaning-text)]" },
  return: { label: "Returned", tone: "bg-[var(--state-bill-soft)] text-[var(--state-bill-text)]" },
  prep: { label: "Prep", tone: "bg-[var(--state-reserved-soft)] text-[var(--state-reserved-text)]" },
} as const;
const MOVE_TITLE = { wastage: "Wastage", count: "Count on the shelf" } as const;

export function InventoryScreen({ initial, purchasing, features }: { initial: Inventory; purchasing: Purchasing; features?: Features }) {
  const [data, setData] = useState(initial);
  const [buying, setBuying] = useState(purchasing);
  const [tab, setTab] = useState<Tab>("stock");
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");

  const reload = async () => {
    const [a, b] = await Promise.all([inventoryAction(), purchasingAction()]);
    if (a.ok) setData(a.data);
    if (b.ok) setBuying(b.data);
  };
  // A sheet saved: close it, say so, and read everything again
  const done = async (message: string) => {
    setPanel(null);
    setError(null);
    setNotice(message);
    await reload();
  };
  const run = async (task: () => Promise<{ ok: true } | { ok: false; error: string }>, message: string) => {
    setBusy(true);
    setError(null);
    const r = await task();
    setBusy(false);
    if (!r.ok) return setError(r.error);
    await done(message);
  };
  const close = () => {
    setPanel(null);
    setError(null);
  };

  const low = data.items.filter((i) => i.low);
  const groups = useMemo(() => [...new Set(data.items.map((i) => i.category ?? "Other"))].sort(), [data.items]);
  const shown = data.items.filter((i) => (!query.trim() || i.name.toLowerCase().includes(query.trim().toLowerCase())) && (group === "all" || (i.category ?? "Other") === group));
  const itemName = useMemo(() => new Map(data.items.map((i) => [i.id, i])), [data.items]);
  const withRecipe = data.dishes.filter((d) => d.recipe.length).length;
  const held = data.dishes.filter((d) => d.heldByStock);
  const owed = buying.suppliers.reduce((n, s) => n + Math.max(0, s.duePaise), 0);

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-title font-bold text-ink">Inventory</h1>
          <p className="mt-1 text-body text-muted">
            {data.items.length} {data.items.length === 1 ? "item" : "items"} worth about {rs(data.stockValuePaise)}. {withRecipe} of {data.dishes.length} dishes have a recipe.{owed > 0 ? ` You owe suppliers ${rs(owed)}.` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${quiet} min-h-11 px-4`} onClick={() => setPanel({ kind: "library" })}>From library</button>
          <button type="button" className={`${quiet} min-h-11 px-4`} onClick={() => setPanel({ kind: "item", item: null })}>
            <HugeiconsIcon icon={PlusSignIcon} size={16} aria-hidden />
            <span className="ml-1.5">Stock item</span>
          </button>
          {(!features || features.purchasing) && <button type="button" className={primary} disabled={!data.items.length} onClick={() => setPanel({ kind: "bill", mode: "purchase" })}>
            <HugeiconsIcon icon={PlusSignIcon} size={18} aria-hidden />
            New purchase bill
          </button>}
        </div>
      </header>

      {notice && <p role="status" className="mt-4 rounded-xl bg-[var(--state-available-soft)] px-4 py-2.5 text-body text-[var(--state-available-text)]">{notice}</p>}
      {low.length > 0 && (
        <p role="alert" className="mt-4 rounded-xl border border-danger/30 bg-danger/[0.06] px-4 py-3 text-body text-ink">
          <span className="font-semibold text-danger">Running low: </span>
          {low.map((i) => `${i.name} (${showQty(i.qtyMilli, i.unit)})`).join(", ")}
        </p>
      )}
      {held.length > 0 && (
        <p className="mt-3 rounded-xl border border-line bg-surface px-4 py-3 text-body text-ink">
          <span className="font-semibold">Sold out because stock ran out: </span>
          {held.map((d) => d.name).join(", ")}. They come back on by themselves when you add the stock.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Inventory" className="no-scrollbar flex max-w-full overflow-x-auto rounded-xl border border-line bg-surface p-1">
          {TABS.filter(([k])=> !features || (["stock","history"].includes(k) || (["purchases","suppliers","count"].includes(k) ? features.purchasing : features.recipeCosting))).map(([k, name]) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => { setTab(k); setNotice(null); }} className={`min-h-9 shrink-0 whitespace-nowrap rounded-lg px-3.5 text-body font-semibold ${focus} ${tab === k ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}>
              {name}
            </button>
          ))}
        </div>
        {tab === "stock" && (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {groups.length > 1 && (
              <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Shelf group" className={`${field} w-full sm:w-auto`}>
                <option value="all">All groups</option>
                {groups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search stock" aria-label="Search stock" className={`${field} w-full sm:w-56`} />
          </div>
        )}
      </div>

      {tab === "stock" && (
        <section className={`${card} mt-4 overflow-hidden`} aria-label="Stock">
          {data.items.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="font-display text-section font-bold text-ink">Start with what you buy most</p>
              <p className="mx-auto mt-1 max-w-md text-body text-muted">Pick from a ready list of 100+ common items (paneer, atta, onion, oil, Coke…), or add your own. Save a purchase bill to put stock in; count the shelf at closing to see what was used.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button type="button" className={primary} onClick={() => setPanel({ kind: "library" })}>Choose from library</button>
                <button type="button" className={`${quiet} min-h-11 px-4`} onClick={() => setPanel({ kind: "item", item: null })}>Add my own item</button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-body">
                <thead>
                  <tr className="text-caption text-muted">
                    <th className="px-5 py-3 font-medium">Item</th>
                    <th className="px-3 py-3 text-right font-medium">On hand</th>
                    <th className="px-3 py-3 text-right font-medium">Alert at</th>
                    <th className="px-3 py-3 text-right font-medium">Price</th>
                    <th className="px-3 py-3 text-right font-medium">Value</th>
                    <th className="px-5 py-3 text-right font-medium">Update</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((i) => (
                    <tr key={i.id} className="border-t border-line">
                      <td className="px-5 py-3">
                        <button type="button" onClick={() => setPanel({ kind: "item", item: i })} className={`text-left font-semibold text-ink hover:underline ${focus}`}>{i.name}</button>
                        {i.isPrep && <span className="ml-1.5 rounded-full bg-[var(--state-reserved-soft)] px-2 py-0.5 text-caption font-semibold text-[var(--state-reserved-text)]">Prep</span>}
                        <span className="block text-caption text-muted">
                          {[i.category, i.packName && i.packMilli ? `1 ${i.packName} = ${showQty(i.packMilli, i.unit)}` : null, i.usedIn ? `in ${i.usedIn} ${i.usedIn === 1 ? "dish" : "dishes"}` : "not in a recipe"].filter(Boolean).join(" · ")}
                        </span>
                      </td>
                      <td className={`px-3 py-3 text-right font-semibold tabular-nums ${i.qtyMilli < 0 || i.low ? "text-danger" : "text-ink"}`}>{showQty(i.qtyMilli, i.unit)}</td>
                      <td className="px-3 py-3 text-right text-muted tabular-nums">{i.lowMilli === null ? "—" : showQty(i.lowMilli, i.unit)}</td>
                      <td className="px-3 py-3 text-right text-muted tabular-nums">{i.costPaise === null ? "—" : `₹${(i.costPaise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}/${UNIT_LABEL[i.unit]}`}</td>
                      <td className="px-3 py-3 text-right text-muted tabular-nums">{i.costPaise && i.qtyMilli > 0 ? rs(Math.round((i.costPaise * i.qtyMilli) / 1000)) : "—"}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1.5">
                          {i.isPrep
                            ? <button type="button" className={quiet} disabled={!i.prep.length} onClick={() => setPanel({ kind: "make", item: i })}>Make batch</button>
                            : <button type="button" className={quiet} onClick={() => setPanel({ kind: "bill", mode: "purchase" })}>Purchase</button>}
                          {(!features || features.purchasing) && <button type="button" className={quiet} onClick={() => setPanel({ kind: "move", item: i, move: "wastage" })}>Wastage</button>}
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

      {tab === "purchases" && <PurchasesTab data={buying} onOpen={setPanel} />}
      {tab === "suppliers" && <SuppliersTab data={buying} onOpen={setPanel} />}
      {tab === "count" && <CountTab items={data.items} done={async (m) => { setNotice(m); await reload(); }} />}

      {tab === "recipes" && (
        <section className={`${card} mt-4 overflow-hidden`} aria-label="Recipes">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
            <p className="text-caption text-muted">What one plate uses. When a bill is paid, these come off your stock.</p>
            <label className="inline-flex cursor-pointer items-center gap-2 text-caption font-semibold text-ink">
              <input type="checkbox" className="size-4 accent-[var(--ink)]" checked={data.stockSoldOut} disabled={busy} onChange={(e) => void run(() => stockSoldOutAction(e.target.checked), e.target.checked ? "Dishes now go sold out when an ingredient runs out." : "Dishes no longer go sold out by stock.")} />
              Sold out by itself when an ingredient runs out
            </label>
          </div>
          {data.dishes.length === 0 ? <p className="px-5 py-10 text-center text-body text-muted">Add dishes to your menu first.</p> : (
            <ul className="mt-2">
              {data.dishes.map((d) => {
                const cost = d.recipe.reduce((n, r) => { const it = itemName.get(r.stockItemId); return n + (it?.costPaise ? Math.round((it.costPaise * r.qtyMilli) / 1000) : 0); }, 0);
                return (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{d.name} <span className="text-caption font-normal text-muted">· {d.category}</span>{d.heldByStock && <span className="ml-2 rounded-full bg-danger/10 px-2 py-0.5 text-caption font-semibold text-danger">Sold out: no stock</span>}</p>
                      <p className="text-caption text-muted">
                        {d.recipe.length ? d.recipe.map((r) => { const it = itemName.get(r.stockItemId); return it ? `${it.name} ${showQty(r.qtyMilli, it.unit)}` : null; }).filter(Boolean).join(", ") : "No recipe: selling it uses no stock"}
                        {cost > 0 && <span className="text-ink"> · costs about {rs(cost)} a plate</span>}
                      </p>
                    </div>
                    <button type="button" className={quiet} disabled={!data.items.length} onClick={() => setPanel({ kind: "recipe", dish: d })}>{d.recipe.length ? "Edit recipe" : "Add recipe"}</button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {tab === "prep" && <PrepTab items={data.items} onAdd={() => setPanel({ kind: "item", item: null, prep: true })} onRecipe={(i) => setPanel({ kind: "prepRecipe", item: i })} onMake={(i) => setPanel({ kind: "make", item: i })} />}
      {tab === "report" && <ReportTab />}

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
        <Sheet title={panel.item ? `Edit ${panel.item.name}` : panel.prep ? "Add prep item" : "Add stock item"} onClose={close}>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(
                () => saveItemAction({ id: panel.item?.id ?? null, name: String(f.get("name")), unit: String(f.get("unit")), low: String(f.get("low")), cost: String(f.get("cost")), category: String(f.get("category")), packName: String(f.get("packName")), packSize: String(f.get("packSize")), isPrep: f.get("isPrep") === "on" }),
                panel.item ? "Saved." : "Added. Save a purchase bill to put stock in.",
              );
            }}
          >
            <label className={label}>Name<input name="name" required maxLength={80} defaultValue={panel.item?.name} placeholder={panel.prep ? "e.g. Makhani gravy" : "e.g. Paneer"} className={field} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>Unit
                <select name="unit" defaultValue={panel.item?.unit ?? "kg"} className={field}>
                  {(Object.keys(UNIT_LABEL) as StockUnit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
                </select>
              </label>
              <label className={label}>Group<input name="category" maxLength={40} list="stock-groups" defaultValue={panel.item?.category ?? (panel.prep ? "Prep" : "")} placeholder="e.g. Dairy" className={field} /></label>
              <datalist id="stock-groups">{groups.filter((g) => g !== "Other").map((g) => <option key={g} value={g} />)}</datalist>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>Alert when below<input name="low" inputMode="decimal" defaultValue={panel.item?.lowMilli == null ? "" : fromMilli(panel.item.lowMilli)} placeholder="e.g. 2" className={field} /></label>
              <label className={label}>Price per unit (₹)<input name="cost" inputMode="decimal" defaultValue={panel.item?.costPaise == null ? "" : String(panel.item.costPaise / 100)} placeholder="Set by bills" className={field} /></label>
            </div>
            <fieldset className="grid grid-cols-2 gap-3">
              <legend className="mb-1 text-caption font-semibold text-muted">Bought by the pack? (optional)</legend>
              <label className={label}>Pack name<input name="packName" maxLength={20} defaultValue={panel.item?.packName ?? ""} placeholder="e.g. crate, box" className={field} /></label>
              <label className={label}>Units in one pack<input name="packSize" inputMode="decimal" defaultValue={panel.item?.packMilli ? fromMilli(panel.item.packMilli) : ""} placeholder="e.g. 30" className={field} /></label>
            </fieldset>
            <label className="inline-flex items-center gap-2 text-body text-ink">
              <input name="isPrep" type="checkbox" className="size-4 accent-[var(--ink)]" defaultChecked={panel.item?.isPrep ?? !!panel.prep} />
              Made in the kitchen from other stock (prep item)
            </label>
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
              void run(() => moveAction({ stockItemId: panel.item.id, kind: panel.move, qty: String(f.get("qty")), note: String(f.get("note") ?? "") }), "Stock updated.");
            }}
          >
            <label className={label}>
              {panel.move === "count" ? `How much is on the shelf (${UNIT_LABEL[panel.item.unit]})` : `How much (${UNIT_LABEL[panel.item.unit]})`}
              <input name="qty" required inputMode="decimal" autoFocus placeholder="e.g. 5" className={field} />
            </label>
            <label className={label}>Note<input name="note" maxLength={140} placeholder={panel.move === "wastage" ? "e.g. Spoiled, burnt, spilled" : "Optional"} className={field} /></label>
            {error && <p role="alert" className="text-caption text-danger">{error}</p>}
            <button type="submit" disabled={busy} className={primary}>{busy ? "Saving…" : "Save"}</button>
          </form>
        </Sheet>
      )}

      {panel?.kind === "recipe" && <RecipeSheet dish={panel.dish} items={data.items} busy={busy} error={error} onClose={close} onSave={(lines) => void run(() => recipeAction(panel.dish.id, lines), `Recipe saved for ${panel.dish.name}.`)} />}
      {panel?.kind === "prepRecipe" && <PrepRecipeSheet prep={panel.item} items={data.items} onClose={close} done={done} />}
      {panel?.kind === "make" && <MakePrepSheet prep={panel.item} items={data.items} onClose={close} done={done} />}
      {panel?.kind === "library" && <LibrarySheet have={data.items.map((i) => i.name)} onClose={close} done={done} />}
      {panel?.kind === "bill" && <BillSheet mode={panel.mode} items={data.items} suppliers={buying.suppliers} supplierId={panel.supplierId} onClose={close} done={done} />}
      {panel?.kind === "pay" && <PaySheet supplier={panel.supplier} purchaseId={panel.purchaseId} due={panel.due} onClose={close} done={done} />}
      {panel?.kind === "supplier" && <SupplierSheet supplier={panel.supplier} onClose={close} done={done} />}
    </main>
  );
}

function RecipeSheet({ dish, items, busy, error, onClose, onSave }: { dish: Dish; items: Item[]; busy: boolean; error: string | null; onClose: () => void; onSave: (lines: { stockItemId: string; qty: string }[]) => void }) {
  const [rows, setRows] = useState(() => (dish.recipe.length ? dish.recipe.map((r) => ({ stockItemId: r.stockItemId, qty: fromMilli(r.qtyMilli) })) : [{ stockItemId: items[0]?.id ?? "", qty: "" }]));
  const unitOf = (id: string) => items.find((i) => i.id === id)?.unit;
  return (
    <Sheet title={`Recipe: ${dish.name}`} onClose={onClose}>
      <p className="text-body text-muted">What one plate uses. Prep items (like gravy) can be used too.</p>
      <ul className="mt-3 grid gap-2">
        {rows.map((r, idx) => (
          <li key={idx} className="grid grid-cols-[minmax(0,1fr)_96px_auto] items-center gap-2">
            <select value={r.stockItemId} aria-label="Ingredient" onChange={(e) => setRows(rows.map((x, i) => (i === idx ? { ...x, stockItemId: e.target.value } : x)))} className={field}>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name}{i.isPrep ? " (prep)" : ""}</option>)}
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
