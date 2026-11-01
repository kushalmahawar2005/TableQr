"use client";

import type { Features } from "@/lib/plan-features";
import { useMemo, useState } from "react";
import { AlertTriangle, ChefHat, MoreHorizontal, Package, Plus, Search, Wallet } from "lucide-react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { fromMilli, showQty, UNIT_LABEL, type StockUnit } from "@/domain/inventory";
import type { Inventory } from "@/server/staff/inventory";
import type { Purchasing } from "@/server/staff/inventory-pro";
import { inventoryAction, moveAction, purchasingAction, recipeAction, removeItemAction, saveItemAction, stockSoldOutAction } from "../actions";
import { CountTab, MakePrepSheet, PrepRecipeSheet, PrepTab, ReportTab } from "./count-prep-report";
import { LibrarySheet } from "./library-sheet";
import { BillSheet, PaySheet, PurchasesTab, SupplierSheet, SuppliersTab, type BillPanel } from "./purchasing";
import { columnHead, DetailHead, DetailSection, DetailSheet, Pill, primaryButton, QueuePanel, RowSelect, rowCells, rowTone, secondaryButton, Segmented, StatCards, type Stat } from "../../orders/_components/orders-ui";
import { card, field, focus, label, primary, quiet, rs, Sheet, when } from "./ui";

// Inventory: what is on the shelf, what each dish uses, and every change. Paid bills take stock
// off by the recipes; supplier bills put it in; the day-end count finds what went missing; the
// report shows food cost. Four daily tabs (Stock, Purchases, Day-end count, Reports); recipes and
// prep sit under More because they are set up once, not used every day.

type Item = Inventory["items"][number];
type Dish = Inventory["dishes"][number];
type Tab = "stock" | "purchases" | "count" | "recipes" | "prep" | "reports";
type Panel =
  | { kind: "item"; item: Item | null; prep?: boolean }
  | { kind: "move"; item: Item; move: "wastage" | "count" }
  | { kind: "update"; item: Item }
  | { kind: "recipe"; dish: Dish }
  | { kind: "prepRecipe"; item: Item }
  | { kind: "make"; item: Item }
  | { kind: "library" }
  | BillPanel
  | null;

const COLUMNS = "lg:grid-cols-[minmax(0,1.6fr)_96px_72px_104px_84px]";
const OK_TONE = "bg-[var(--state-available-soft)] text-[var(--state-available-text)]";
const LOW_TONE = "bg-[var(--state-held-soft)] text-[var(--state-held-text)]";
const OUT_TONE = "bg-danger/10 text-danger";
/** One word for the shelf: nothing left, running low, or fine */
const shelf = (i: Item) => (i.qtyMilli <= 0 ? { rank: 0, label: "Out", tone: OUT_TONE } : i.low ? { rank: 1, label: "Low", tone: LOW_TONE } : { rank: 2, label: "OK", tone: OK_TONE });
const LOW_FILTER = "__low";
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
  const [buyView, setBuyView] = useState<"bills" | "suppliers">("bills");
  const [reportView, setReportView] = useState<"summary" | "history">("summary");
  const [more, setMore] = useState(false);
  // Chosen on purpose: opens the item on phones. Wide screens show the first item until then.
  const [picked, setPicked] = useState<string | null>(null);

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

  const groups = useMemo(() => [...new Set(data.items.map((i) => i.category ?? "Other"))].sort(), [data.items]);
  const shown = data.items
    .filter((i) => (!query.trim() || i.name.toLowerCase().includes(query.trim().toLowerCase())) && (group === "all" || (group === LOW_FILTER ? shelf(i).rank < 2 : (i.category ?? "Other") === group)))
    .sort((a, b) => shelf(a).rank - shelf(b).rank || a.name.localeCompare(b.name));
  const focused = shown.find((i) => i.id === picked) ?? shown[0] ?? null;
  const needStock = data.items.filter((i) => shelf(i).rank < 2).length;
  const canBuy = !features || features.purchasing;
  const canCost = !features || features.recipeCosting;
  const tabs: [Tab, string][] = [["stock", "Stock"], ...(canBuy ? [["purchases", "Purchases"], ["count", "Day-end count"]] as [Tab, string][] : []), ["reports", "Reports"]];
  const showTab = (next: Tab) => { setTab(next); setNotice(null); setMore(false); };
  const itemName = useMemo(() => new Map(data.items.map((i) => [i.id, i])), [data.items]);
  const withRecipe = data.dishes.filter((d) => d.recipe.length).length;
  const held = data.dishes.filter((d) => d.heldByStock);
  const owed = buying.suppliers.reduce((n, s) => n + Math.max(0, s.duePaise), 0);
  // The ways stock changes, from the row's Update button and from the item panel alike
  const stockActions = (item: Item) => (
    <div className="grid gap-2">
      {item.isPrep
        ? <button type="button" className={`${primaryButton} w-full`} disabled={!item.prep.length} onClick={() => setPanel({ kind: "make", item })}>Make a batch</button>
        : canBuy && <button type="button" className={`${primaryButton} w-full`} onClick={() => setPanel({ kind: "bill", mode: "purchase", itemId: item.id })}>Stock came in</button>}
      <div className="grid grid-cols-2 gap-2">
        {canBuy && <button type="button" className={secondaryButton} onClick={() => setPanel({ kind: "move", item, move: "wastage" })}>Wastage</button>}
        <button type="button" className={`${secondaryButton} ${canBuy ? "" : "col-span-2"}`} onClick={() => setPanel({ kind: "move", item, move: "count" })}>Count shelf</button>
      </div>
    </div>
  );
  const stats: Stat[] = [
    { icon: AlertTriangle, label: "Need stock", value: String(needStock), note: needStock ? "Low or out right now" : "Nothing running low", tone: needStock ? "warn" : "forest" },
    { icon: Package, label: "Stock value", value: rs(data.stockValuePaise), note: `${data.items.length} ${data.items.length === 1 ? "item" : "items"} on the shelf` },
    ...(canBuy ? [{ icon: Wallet, label: "Suppliers to pay", value: rs(owed), note: owed ? "Unpaid purchase bills" : "Nothing due", tone: "accent" } as Stat] : []),
    { icon: ChefHat, label: "Dishes with a recipe", value: `${withRecipe} / ${data.dishes.length}`, note: "These take stock off when sold" },
  ];

  return (
    <main className="mx-auto w-full max-w-[1440px] px-3 py-3 pb-6 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-lg font-bold leading-6 tracking-tight text-ink sm:text-[28px] sm:leading-8">Inventory</h1>
          <p className="mt-1 text-sm font-medium text-muted">What you have, what came in and what to buy next.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            {more && <button type="button" aria-label="Close menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setMore(false)} />}
            <button type="button" aria-expanded={more} aria-label="More inventory actions" className={`${secondaryButton} relative z-20 !px-3`} onClick={() => setMore(!more)}><MoreHorizontal className="size-4" aria-hidden="true" />More</button>
            {more && <div className="absolute left-0 z-20 mt-1 grid w-48 gap-1 rounded-input border border-line bg-surface p-1.5 shadow-lg sm:left-auto sm:right-0 [&>button]:w-full [&>button]:justify-start [&>button]:border-0">
              <button type="button" className={secondaryButton} onClick={() => { setMore(false); setPanel({ kind: "library" }); }}>Add from library</button>
              {canCost && <button type="button" className={secondaryButton} onClick={() => showTab("recipes")}>Recipes</button>}
              {canCost && <button type="button" className={secondaryButton} onClick={() => showTab("prep")}>Prep items</button>}
            </div>}
          </div>
          <button type="button" className={secondaryButton} onClick={() => setPanel({ kind: "item", item: null })}><Plus className="size-4" aria-hidden="true" />Add item</button>
          {canBuy && <button type="button" className={primaryButton} disabled={!data.items.length} onClick={() => setPanel({ kind: "bill", mode: "purchase" })}><Plus className="size-4" aria-hidden="true" />New purchase bill</button>}
        </div>
      </header>

      <StatCards stats={stats} />

      {notice && <p role="status" className="mt-4 rounded-input bg-[var(--state-available-soft)] px-4 py-2.5 text-sm font-medium text-[var(--state-available-text)]">{notice}</p>}
      {held.length > 0 && (
        <p className="mt-3 rounded-input border border-line bg-surface px-4 py-3 text-sm text-ink">
          <span className="font-semibold">Sold out because stock ran out: </span>
          {held.map((d) => d.name).join(", ")}. They come back on by themselves when you add the stock.
        </p>
      )}

      <div className="no-scrollbar mt-4 flex items-center gap-x-7 overflow-x-auto border-b border-line" role="tablist" aria-label="Inventory">
        {tabs.map(([k, name]) => <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => showTab(k)} className={`-mb-px min-h-11 shrink-0 cursor-pointer border-b-2 text-sm font-semibold transition-colors ${focus} ${tab === k ? "border-forest text-forest" : "border-transparent text-muted hover:text-ink"}`}>{name}</button>)}
      </div>

      {tab === "stock" && <>
        {data.items.length > 0 && <div className="mt-4 flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Shelf group" className="no-scrollbar flex min-w-0 flex-1 basis-full gap-2 overflow-x-auto lg:basis-0">
            {([["all", "All", data.items.length], ...(needStock ? [[LOW_FILTER, "Low stock", needStock]] : []), ...groups.map((g) => [g, g, data.items.filter((i) => (i.category ?? "Other") === g).length])] as [string, string, number][]).map(([id, name, n]) => <button key={id} type="button" aria-pressed={group === id} onClick={() => setGroup(id)} className={`min-h-10 shrink-0 cursor-pointer rounded-full border px-4 text-sm font-semibold transition-colors ${focus} ${group === id ? "border-forest bg-forest text-white" : "border-line bg-surface text-muted hover:text-ink"}`}>{name} <span className="tabular-nums opacity-70">{n}</span></button>)}
          </div>
          <div className="relative w-full lg:w-64"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search stock" aria-label="Search stock" className="h-10 w-full rounded-input border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none focus:border-[var(--state-available)]" /></div>
        </div>}
        {data.items.length === 0 ? (
          <section className={`${card} mt-4 px-6 py-12 text-center`} aria-label="Stock">
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-sage text-forest"><Package className="size-6" aria-hidden="true" /></span>
            <p className="mt-3 font-display text-[15px] font-bold text-ink">Start with what you buy most</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">Pick from a ready list of 100+ common items (paneer, atta, onion, oil, Coke…), or add your own. Save a purchase bill to put stock in; count the shelf at closing to see what was used.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button type="button" className={primaryButton} onClick={() => setPanel({ kind: "library" })}>Choose from library</button>
              <button type="button" className={secondaryButton} onClick={() => setPanel({ kind: "item", item: null })}>Add my own item</button>
            </div>
          </section>
        ) : (
          <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <QueuePanel title="Stock" meta={`${shown.length} of ${data.items.length} · Low stock first`} columns={shown.length > 0 && <div className={`${columnHead} ${COLUMNS}`}><span>Item</span><span>Left</span><span>Status</span><span>Price</span><span className="text-right">Action</span></div>}>
              {shown.length === 0 ? <p className="px-5 py-10 text-center text-sm text-muted">Nothing matches.</p> : <ul>
                {shown.map((i) => {
                  const s = shelf(i), sel = focused?.id === i.id;
                  return <li key={i.id} className={`${rowCells} ${COLUMNS} ${rowTone(sel, false)}`}>
                    <span className="col-start-1 row-start-1 min-w-0 lg:col-auto lg:row-auto"><RowSelect selected={sel} onSelect={() => setPicked(i.id)}>
                      <span className="flex items-center gap-1.5"><span className="truncate text-sm font-bold text-ink">{i.name}</span>{i.isPrep && <Pill className="bg-[var(--state-reserved-soft)] text-[var(--state-reserved-text)]">Prep</Pill>}</span>
                      <span className="mt-0.5 block truncate text-xs font-medium text-muted">{[i.category, i.usedIn ? `in ${i.usedIn} ${i.usedIn === 1 ? "dish" : "dishes"}` : "not in a recipe"].filter(Boolean).join(" · ")}</span>
                    </RowSelect></span>
                    <span className={`col-start-2 row-start-1 justify-self-end text-sm font-bold tabular-nums lg:col-auto lg:row-auto lg:justify-self-start ${s.rank < 2 ? "text-danger" : "text-ink"}`}>{showQty(i.qtyMilli, i.unit)}</span>
                    <span className="col-start-1 row-start-2 mt-1.5 lg:col-auto lg:row-auto lg:mt-0"><Pill className={s.tone}>{s.label}</Pill></span>
                    <span className="hidden text-sm text-muted tabular-nums lg:inline">{i.costPaise === null ? "—" : `₹${(i.costPaise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}/${UNIT_LABEL[i.unit]}`}</span>
                    <span className="relative z-10 col-start-2 row-start-2 mt-1.5 flex justify-end lg:col-auto lg:row-auto lg:mt-0"><button type="button" aria-label={`Update ${i.name}`} className={`${secondaryButton} !min-h-9 !px-3 text-xs`} onClick={() => setPanel({ kind: "update", item: i })}>Update</button></span>
                  </li>;
                })}
              </ul>}
            </QueuePanel>
            {focused && <DetailSheet label="Item details" open={picked === focused.id} sticky>
              <DetailHead title={focused.name} badge={<Pill className={shelf(focused).tone}>{shelf(focused).label}</Pill>} sub={[focused.category, focused.isPrep ? "Prep item" : null].filter(Boolean).join(" · ") || "Stock item"} onClose={() => setPicked(null)} />
              <DetailSection>
                <p className="text-xs font-medium text-muted">Left on the shelf</p>
                <p className={`font-display text-2xl font-bold tabular-nums ${shelf(focused).rank < 2 ? "text-danger" : "text-ink"}`}>{showQty(focused.qtyMilli, focused.unit)}</p>
                <dl className="mt-3 space-y-1.5 text-sm">
                  <div className="flex justify-between gap-3"><dt className="text-muted">Alert at</dt><dd className="font-semibold tabular-nums">{focused.lowMilli === null ? "Not set" : showQty(focused.lowMilli, focused.unit)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted">Price</dt><dd className="font-semibold tabular-nums">{focused.costPaise === null ? "Not set" : `₹${(focused.costPaise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}/${UNIT_LABEL[focused.unit]}`}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted">Value</dt><dd className="font-semibold tabular-nums">{focused.costPaise && focused.qtyMilli > 0 ? rs(Math.round((focused.costPaise * focused.qtyMilli) / 1000)) : "—"}</dd></div>
                  {focused.packName && focused.packMilli ? <div className="flex justify-between gap-3"><dt className="text-muted">Pack</dt><dd className="font-semibold tabular-nums">1 {focused.packName} = {showQty(focused.packMilli, focused.unit)}</dd></div> : null}
                </dl>
              </DetailSection>
              <DetailSection title="Update stock">
                {stockActions(focused)}
              </DetailSection>
              {data.moves.some((m) => m.stockItemId === focused.id) && <DetailSection title="Last changes">
                <ul className="grid gap-2 text-sm">{data.moves.filter((m) => m.stockItemId === focused.id).slice(0, 4).map((m) => <li key={m.id} className="flex items-center justify-between gap-2"><span className="min-w-0"><span className="block font-semibold text-ink">{KIND[m.kind].label}</span><span className="block text-xs text-muted">{when(m.createdAt)}</span></span><span className={`shrink-0 font-semibold tabular-nums ${m.qtyMilli < 0 ? "text-danger" : "text-[var(--state-available-text)]"}`}>{m.qtyMilli > 0 ? "+" : ""}{showQty(m.qtyMilli, focused.unit)}</span></li>)}</ul>
              </DetailSection>}
              <DetailSection><button type="button" className="cursor-pointer text-sm font-semibold text-forest hover:underline" onClick={() => setPanel({ kind: "item", item: focused })}>Edit item details</button></DetailSection>
            </DetailSheet>}
          </div>
        )}
      </>}

      {tab === "purchases" && <div className="mt-4"><Segmented label="Purchases" value={buyView} onChange={setBuyView} options={[{ key: "bills", label: "Bills", count: buying.bills.length }, { key: "suppliers", label: "Suppliers", count: buying.suppliers.length }]} /></div>}
      {tab === "purchases" && buyView === "bills" && <PurchasesTab data={buying} onOpen={setPanel} />}
      {tab === "purchases" && buyView === "suppliers" && <SuppliersTab data={buying} onOpen={setPanel} />}
      {tab === "count" && <CountTab items={data.items} done={async (m) => { setNotice(m); await reload(); }} />}

      {tab === "recipes" && (
        <section className={`${card} mt-4 overflow-hidden`} aria-label="Recipes">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
            <p className="text-caption text-muted">What one plate uses. When a bill is paid, these come off your stock.</p>
            <label className="inline-flex cursor-pointer items-center gap-2 text-caption font-semibold text-ink">
              <input type="checkbox" className="size-4 accent-[var(--state-available)]" checked={data.stockSoldOut} disabled={busy} onChange={(e) => void run(() => stockSoldOutAction(e.target.checked), e.target.checked ? "Dishes now go sold out when an ingredient runs out." : "Dishes no longer go sold out by stock.")} />
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
      {tab === "reports" && canCost && <div className="mt-4 inline-flex gap-1 rounded-input bg-ink/5 p-1" role="group" aria-label="Reports">{([["summary", "Stock report"], ["history", "History"]] as const).map(([key, name]) => <button key={key} type="button" aria-pressed={reportView === key} onClick={() => setReportView(key)} className={`min-h-9 cursor-pointer rounded-lg px-3 text-sm font-semibold ${focus} ${reportView === key ? "bg-surface text-ink shadow-xs" : "text-muted hover:text-ink"}`}>{name}</button>)}</div>}
      {tab === "reports" && canCost && reportView === "summary" && <ReportTab />}

      {tab === "reports" && (!canCost || reportView === "history") && (
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
              <input name="isPrep" type="checkbox" className="size-4 accent-[var(--state-available)]" defaultChecked={panel.item?.isPrep ?? !!panel.prep} />
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
      {panel?.kind === "update" && <Sheet title={`Update ${panel.item.name}`} onClose={close}>
        <p className="text-sm text-muted">Left on the shelf: <b className="text-ink tabular-nums">{showQty(panel.item.qtyMilli, panel.item.unit)}</b></p>
        <div className="mt-4">{stockActions(panel.item)}</div>
      </Sheet>}
      {panel?.kind === "bill" && <BillSheet mode={panel.mode} items={data.items} suppliers={buying.suppliers} supplierId={panel.supplierId} itemId={panel.itemId} onClose={close} done={done} />}
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
