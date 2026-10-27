"use client";

import { useEffect, useMemo, useState } from "react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { fromMilli, showQty, UNIT_LABEL, type StockUnit } from "@/domain/inventory";
import type { Inventory } from "@/server/staff/inventory";
import type { StockReport } from "@/server/staff/inventory-pro";
import { countAction, makePrepAction, prepRecipeAction, reportAction } from "../actions";
import { card, day, downloadCsv, field, focus, label, primary, quiet, rs, Sheet, th, todayIst } from "./ui";

// The day-end count (with the variance it finds), prep items cooked from other stock, and the
// stock report with food cost.

type Item = Inventory["items"][number];
type Done = (message: string) => Promise<void>;
type Variance = { stockItemId: string; name: string; unit: string; expectedMilli: number; countedMilli: number; diffMilli: number; valuePaise: number };

export function CountTab({ items, done }: { items: Item[]; done: Done }) {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [group, setGroup] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Variance[] | null>(null);
  const groups = useMemo(() => [...new Set(items.map((i) => i.category ?? "Other"))].sort(), [items]);
  const shown = items.filter((i) => group === "all" || (i.category ?? "Other") === group);
  const entered = Object.values(counts).filter((v) => v.trim() !== "").length;

  const save = async () => {
    setBusy(true); setError(null);
    const r = await countAction({ counts: Object.entries(counts).map(([stockItemId, qty]) => ({ stockItemId, qty })), note: "Day-end count" });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setResult(r.data.variance);
    setCounts({});
    await done(`Count saved for ${r.data.variance.length} ${r.data.variance.length === 1 ? "item" : "items"}.`);
  };

  if (result) {
    const off = result.filter((v) => v.diffMilli !== 0);
    const value = off.reduce((n, v) => n + v.valuePaise, 0);
    return (
      <section className={`${card} mt-4 overflow-hidden`} aria-label="Count result">
        <div className="px-5 pt-4">
          <h2 className="font-display text-section font-bold text-ink">Variance</h2>
          <p className="text-body text-muted">{off.length === 0 ? "Everything matched what the system expected." : <>{off.length} {off.length === 1 ? "item was" : "items were"} off, worth <span className={`font-semibold ${value < 0 ? "text-danger" : "text-ink"}`}>{rs(value)}</span>. A shortfall means stock used without a bill, wastage nobody wrote down, or a recipe that needs fixing.</>}</p>
        </div>
        <VarianceTable rows={result} />
        <div className="border-t border-line px-5 py-3"><button type="button" className={quiet} onClick={() => setResult(null)}>Count again</button></div>
      </section>
    );
  }

  return (
    <section className={`${card} mt-4 overflow-hidden`} aria-label="Day-end count">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <p className="max-w-xl text-caption text-muted">Count what is on the shelf at closing and type it in. Leave an item empty to skip it. The difference from what the system expected is the variance.</p>
        {groups.length > 1 && (
          <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Shelf group" className={`${field} h-9 w-auto text-caption`}>
            <option value="all">All groups</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        )}
      </div>
      {items.length === 0 ? <p className="px-5 py-10 text-center text-body text-muted">Add stock items first.</p> : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-body">
            <thead><tr className="text-caption text-muted"><th className="px-5 py-3 font-medium">Item</th><th className={`${th} text-right`}>System says</th><th className={th}>On the shelf</th><th className={`${th} pr-5 text-right`}>Difference</th></tr></thead>
            <tbody>
              {shown.map((i) => {
                const v = counts[i.id] ?? "";
                const n = v.trim() === "" ? null : Number(v);
                const diff = n === null || Number.isNaN(n) ? null : Math.round(n * 1000) - i.qtyMilli;
                return (
                  <tr key={i.id} className="border-t border-line">
                    <td className="px-5 py-2.5 font-semibold text-ink">{i.name}<span className="block text-caption font-normal text-muted">{i.category ?? "Other"}</span></td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">{showQty(i.qtyMilli, i.unit)}</td>
                    <td className="w-44 px-3 py-2.5">
                      <label className="relative block">
                        <input value={v} inputMode="decimal" aria-label={`Count of ${i.name}`} placeholder="—" onChange={(e) => setCounts({ ...counts, [i.id]: e.target.value })} className={`${field} h-10 pr-12`} />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-caption text-muted">{UNIT_LABEL[i.unit]}</span>
                      </label>
                    </td>
                    <td className={`px-3 py-2.5 pr-5 text-right font-semibold tabular-nums ${diff === null ? "text-muted" : diff < 0 ? "text-danger" : diff > 0 ? "text-[var(--state-available-text)]" : "text-ink"}`}>{diff === null ? "—" : `${diff > 0 ? "+" : ""}${showQty(diff, i.unit)}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
        <p className="text-caption text-muted">{entered} counted</p>
        {error && <p role="alert" className="text-caption text-danger">{error}</p>}
        <button type="button" disabled={busy || entered === 0} onClick={() => void save()} className={primary}>{busy ? "Saving…" : "Save count"}</button>
      </div>
    </section>
  );
}

function VarianceTable({ rows }: { rows: Variance[] }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-body">
        <thead><tr className="text-caption text-muted"><th className="px-5 py-3 font-medium">Item</th><th className={`${th} text-right`}>Expected</th><th className={`${th} text-right`}>Counted</th><th className={`${th} text-right`}>Difference</th><th className={`${th} pr-5 text-right`}>Value</th></tr></thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.stockItemId} className="border-t border-line">
              <td className="px-5 py-2.5 font-semibold text-ink">{v.name}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted">{showQty(v.expectedMilli, v.unit as StockUnit)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-ink">{showQty(v.countedMilli, v.unit as StockUnit)}</td>
              <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${v.diffMilli < 0 ? "text-danger" : v.diffMilli > 0 ? "text-[var(--state-available-text)]" : "text-muted"}`}>{v.diffMilli > 0 ? "+" : ""}{showQty(v.diffMilli, v.unit as StockUnit)}</td>
              <td className={`px-3 py-2.5 pr-5 text-right tabular-nums ${v.valuePaise < 0 ? "text-danger" : "text-muted"}`}>{v.valuePaise ? rs(v.valuePaise) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- prep

export function PrepTab({ items, onAdd, onRecipe, onMake }: { items: Item[]; onAdd: () => void; onRecipe: (i: Item) => void; onMake: (i: Item) => void }) {
  const preps = items.filter((i) => i.isPrep);
  const byId = new Map(items.map((i) => [i.id, i]));
  return (
    <section className={`${card} mt-4 overflow-hidden`} aria-label="Prep items">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <p className="max-w-xl text-caption text-muted">Things the kitchen makes ahead from raw stock, like makhani gravy or dough. When you make a batch, its ingredients come off stock and the batch goes in. Dishes can then use the prep item in their recipe.</p>
        <button type="button" className={quiet} onClick={onAdd}>Add prep item</button>
      </div>
      {preps.length === 0 ? <p className="px-5 py-10 text-center text-body text-muted">No prep items yet. Add one and tick “Made in the kitchen”.</p> : (
        <ul className="mt-2">
          {preps.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
              <div className="min-w-0">
                <p className="font-semibold text-ink">{p.name} <span className="text-caption font-normal text-muted">· {showQty(p.qtyMilli, p.unit)} ready</span></p>
                <p className="text-caption text-muted">{p.prep.length ? `1 ${UNIT_LABEL[p.unit]} takes ` + p.prep.map((r) => { const it = byId.get(r.stockItemId); return it ? `${it.name} ${showQty(r.qtyMilli, it.unit)}` : null; }).filter(Boolean).join(", ") : "No recipe yet"}</p>
              </div>
              <div className="flex gap-1.5">
                <button type="button" className={quiet} onClick={() => onRecipe(p)}>{p.prep.length ? "Edit recipe" : "Set recipe"}</button>
                <button type="button" className={quiet} disabled={!p.prep.length} onClick={() => onMake(p)}>Make batch</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PrepRecipeSheet({ prep, items, onClose, done }: { prep: Item; items: Item[]; onClose: () => void; done: Done }) {
  const raw = items.filter((i) => !i.isPrep);
  const [rows, setRows] = useState(() => (prep.prep.length ? prep.prep.map((r) => ({ stockItemId: r.stockItemId, qty: fromMilli(r.qtyMilli) })) : [{ stockItemId: raw[0]?.id ?? "", qty: "" }]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unitOf = (id: string) => items.find((i) => i.id === id)?.unit;
  return (
    <Sheet title={`Recipe: ${prep.name}`} onClose={onClose}>
      <p className="text-body text-muted">What 1 {UNIT_LABEL[prep.unit]} of {prep.name} takes.</p>
      <ul className="mt-3 grid gap-2">
        {rows.map((r, idx) => (
          <li key={idx} className="grid grid-cols-[minmax(0,1fr)_96px_auto] items-center gap-2">
            <select value={r.stockItemId} aria-label="Ingredient" onChange={(e) => setRows(rows.map((x, i) => (i === idx ? { ...x, stockItemId: e.target.value } : x)))} className={field}>
              {raw.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            <label className="relative">
              <input value={r.qty} inputMode="decimal" aria-label="Amount" placeholder="0.2" onChange={(e) => setRows(rows.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))} className={`${field} pr-10`} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-caption text-muted">{unitOf(r.stockItemId) ? UNIT_LABEL[unitOf(r.stockItemId)!] : ""}</span>
            </label>
            <button type="button" aria-label="Remove ingredient" onClick={() => setRows(rows.filter((_, i) => i !== idx))} className={`grid size-11 place-items-center rounded-xl text-muted hover:bg-ink/5 ${focus}`}><HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden /></button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => setRows([...rows, { stockItemId: raw.find((i) => !rows.some((r) => r.stockItemId === i.id))?.id ?? raw[0]?.id ?? "", qty: "" }])} className={`mt-2 ${quiet}`}>Add ingredient</button>
      {error && <p role="alert" className="mt-2 text-caption text-danger">{error}</p>}
      <button type="button" disabled={busy} onClick={async () => { setBusy(true); setError(null); const r = await prepRecipeAction(prep.id, rows); setBusy(false); if (!r.ok) return setError(r.error); await done(`Recipe saved for ${prep.name}.`); }} className={`mt-4 w-full ${primary}`}>{busy ? "Saving…" : "Save recipe"}</button>
    </Sheet>
  );
}

export function MakePrepSheet({ prep, items, onClose, done }: { prep: Item; items: Item[]; onClose: () => void; done: Done }) {
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(qty) || 0;
  return (
    <Sheet title={`Make ${prep.name}`} onClose={onClose}>
      <label className={label}>How much was made ({UNIT_LABEL[prep.unit]})<input autoFocus value={qty} inputMode="decimal" onChange={(e) => setQty(e.target.value)} placeholder="e.g. 5" className={field} /></label>
      {n > 0 && (
        <ul className="mt-3 grid gap-1 rounded-xl border border-line p-3 text-caption">
          <li className="font-semibold text-muted">Comes off stock</li>
          {prep.prep.map((r) => {
            const it = items.find((i) => i.id === r.stockItemId);
            if (!it) return null;
            const use = Math.round(r.qtyMilli * n);
            return <li key={r.stockItemId} className={`flex justify-between ${use > it.qtyMilli ? "text-danger" : "text-ink"}`}><span>{it.name}</span><span className="tabular-nums">{showQty(use, it.unit)} of {showQty(it.qtyMilli, it.unit)}</span></li>;
          })}
        </ul>
      )}
      {error && <p role="alert" className="mt-2 text-caption text-danger">{error}</p>}
      <button type="button" disabled={busy || n <= 0} onClick={async () => { setBusy(true); setError(null); const r = await makePrepAction({ prepItemId: prep.id, qty }); setBusy(false); if (!r.ok) return setError(r.error); await done(`${qty} ${UNIT_LABEL[prep.unit]} of ${prep.name} added to stock.`); }} className={`mt-4 w-full ${primary}`}>{busy ? "Saving…" : "Save batch"}</button>
    </Sheet>
  );
}

// ---- report

export function ReportTab() {
  const [from, setFrom] = useState(todayIst());
  const [to, setTo] = useState(todayIst());
  const [data, setData] = useState<StockReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async (f: string, t: string) => {
    setBusy(true); setError(null);
    const r = await reportAction({ from: f, to: t });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setData(r.data);
  };
  // Today's report on opening the tab
  useEffect(() => {
    let off = false;
    void reportAction({ from: todayIst(), to: todayIst() }).then((r) => { if (off) return; if (r.ok) setData(r.data); else setError(r.error); });
    return () => { off = true; };
  }, []);
  const preset = (days: number) => {
    const t = todayIst();
    const f = new Date(Date.parse(`${t}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    setFrom(f); setTo(t); void load(f, t);
  };
  const q = (m: number, u: string) => (m ? showQty(m, u as StockUnit) : "—");
  const exportCsv = () => {
    if (!data) return;
    downloadCsv(`stock-report-${data.from}-to-${data.to}.csv`, [
      ["Item", "Group", "Unit", "Opening", "Purchased", "Purchase amount (Rs)", "Returned", "Made (prep)", "Used in prep", "Sold (by recipe)", "Wastage", "Count variance", "Closing", "Cost of sold (Rs)", "Wastage cost (Rs)", "Variance value (Rs)", "Closing value (Rs)"],
      ...data.rows.map((r) => [r.name, r.category ?? "", r.unit, r.openingMilli / 1000, r.purchasedMilli / 1000, r.purchasedPaise / 100, r.returnedMilli / 1000, r.madeMilli / 1000, r.prepUsedMilli / 1000, r.usedMilli / 1000, r.wastedMilli / 1000, r.varianceMilli / 1000, r.closingMilli / 1000, r.usedPaise / 100, r.wastedPaise / 100, r.variancePaise / 100, r.closingPaise / 100]),
    ]);
  };
  return (
    <section className="mt-4 grid gap-4" aria-label="Stock report">
      <div className={`${card} flex flex-wrap items-end gap-3 p-4`}>
        <label className={label}>From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={`${field} w-40`} /></label>
        <label className={label}>To<input type="date" value={to} min={from} max={todayIst()} onChange={(e) => setTo(e.target.value)} className={`${field} w-40`} /></label>
        <button type="button" className={primary} disabled={busy} onClick={() => void load(from, to)}>{busy ? "Loading…" : "Show"}</button>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={quiet} onClick={() => preset(1)}>Today</button>
          <button type="button" className={quiet} onClick={() => preset(7)}>7 days</button>
          <button type="button" className={quiet} onClick={() => preset(30)}>30 days</button>
        </div>
        <button type="button" className={`${quiet} ml-auto`} disabled={!data?.rows.length} onClick={exportCsv}>Download Excel (CSV)</button>
      </div>
      {error && <p role="alert" className="text-caption text-danger">{error}</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat title="Food cost" value={data.totals.foodCostPct === null ? "—" : `${data.totals.foodCostPct}%`} hint={`${rs(data.totals.usedPaise)} of ${rs(data.totals.salesPaise)} sales`} />
            <Stat title="Purchased" value={rs(data.totals.purchasedPaise)} />
            <Stat title="Wastage" value={rs(data.totals.wastedPaise)} bad={data.totals.wastedPaise > 0} />
            <Stat title="Count variance" value={rs(data.totals.variancePaise)} bad={data.totals.variancePaise < 0} />
            <Stat title="Stock value now" value={rs(data.totals.closingPaise)} hint={data.to === data.today ? undefined : `on ${day(data.to)}`} />
          </div>
          <div className={`${card} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-body">
                <thead><tr className="text-caption text-muted"><th className="px-5 py-3 font-medium">Item</th><th className={`${th} text-right`}>Opening</th><th className={`${th} text-right`}>Purchased</th><th className={`${th} text-right`}>Prep</th><th className={`${th} text-right`}>Sold</th><th className={`${th} text-right`}>Wastage</th><th className={`${th} text-right`}>Returned</th><th className={`${th} text-right`}>Variance</th><th className={`${th} text-right`}>Closing</th><th className={`${th} pr-5 text-right`}>Cost of sold</th></tr></thead>
                <tbody>
                  {data.rows.length === 0 && <tr><td colSpan={10} className="px-5 py-10 text-center text-muted">No stock items yet.</td></tr>}
                  {data.rows.map((r) => (
                    <tr key={r.id} className="border-t border-line">
                      <td className="px-5 py-2.5 font-semibold text-ink">{r.name}{r.isPrep && <span className="ml-1.5 text-caption font-normal text-muted">prep</span>}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted">{q(r.openingMilli, r.unit)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink">{q(r.purchasedMilli, r.unit)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted">{r.madeMilli || r.prepUsedMilli ? `${r.madeMilli ? "+" + showQty(r.madeMilli, r.unit as StockUnit) : ""}${r.madeMilli && r.prepUsedMilli ? " / " : ""}${r.prepUsedMilli ? "−" + showQty(r.prepUsedMilli, r.unit as StockUnit) : ""}` : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink">{q(r.usedMilli, r.unit)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${r.wastedMilli ? "text-danger" : "text-muted"}`}>{q(r.wastedMilli, r.unit)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted">{q(r.returnedMilli, r.unit)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${r.varianceMilli < 0 ? "text-danger" : r.varianceMilli > 0 ? "text-[var(--state-available-text)]" : "text-muted"}`}>{r.varianceMilli ? `${r.varianceMilli > 0 ? "+" : ""}${showQty(r.varianceMilli, r.unit as StockUnit)}` : "—"}</td>
                      <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${r.closingMilli < 0 ? "text-danger" : "text-ink"}`}>{showQty(r.closingMilli, r.unit as StockUnit)}</td>
                      <td className="px-3 py-2.5 pr-5 text-right tabular-nums text-muted">{r.usedPaise ? rs(r.usedPaise) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-caption text-muted">Sold is what paid bills used by their recipes. Food cost is that, at each item&apos;s latest price, as a share of food sales after discounts. Dishes without a recipe are not counted.</p>
        </>
      )}
    </section>
  );
}

function Stat({ title, value, hint, bad = false }: { title: string; value: string; hint?: string; bad?: boolean }) {
  return (
    <div className={`${card} p-4`}>
      <p className="text-caption font-semibold text-muted">{title}</p>
      <p className={`mt-1 font-display text-title font-bold tabular-nums ${bad ? "text-danger" : "text-ink"}`}>{value}</p>
      {hint && <p className="text-caption text-muted">{hint}</p>}
    </div>
  );
}
