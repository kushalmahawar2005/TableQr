"use client";

import { useMemo, useState } from "react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { showQty, UNIT_LABEL, type StockUnit } from "@/domain/inventory";
import type { Inventory } from "@/server/staff/inventory";
import type { Purchasing } from "@/server/staff/inventory-pro";
import { payAction, purchaseAction, removeSupplierAction, returnAction, saveSupplierAction } from "../actions";
import { card, day, field, focus, label, primary, quiet, rs, Sheet, th, todayIst } from "./ui";

// Buying stock: suppliers with what each is owed, supplier bills (many items on one bill, by the
// unit or by the pack), stock sent back, and payments.

type Item = Inventory["items"][number];
type Supplier = Purchasing["suppliers"][number];
type Done = (message: string) => Promise<void>;
const METHODS = [["cash", "Cash"], ["upi", "UPI"], ["bank", "Bank transfer"], ["card", "Card"], ["cheque", "Cheque"]] as const;

export type BillPanel = { kind: "bill"; mode: "purchase" | "return"; supplierId?: string; itemId?: string } | { kind: "pay"; supplier: Supplier; purchaseId?: string; due?: number } | { kind: "supplier"; supplier: Supplier | null };

export function PurchasesTab({ data, onOpen }: { data: Purchasing; onOpen: (p: BillPanel) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [who, setWho] = useState("");
  const bills = data.bills.filter((b) => !who || b.supplierId === who);
  return (
    <section className={`${card} mt-4 overflow-hidden`} aria-label="Purchases">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <p className="text-caption text-muted">Every supplier bill and return. Stock goes in (or out) the moment it is saved.</p>
        <div className="flex flex-wrap gap-2">
          {data.suppliers.length > 0 && (
            <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Supplier" className={`${field} h-9 w-auto text-caption`}>
              <option value="">All suppliers</option>
              {data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <button type="button" className={quiet} onClick={() => onOpen({ kind: "bill", mode: "return" })} disabled={!data.suppliers.length}>Return to supplier</button>
        </div>
      </div>
      {bills.length === 0 ? (
        <p className="px-5 py-10 text-center text-body text-muted">No purchase bills yet. Use New purchase bill when stock arrives.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-body">
            <thead><tr className="text-caption text-muted"><th className="px-5 py-3 font-medium">Date</th><th className={th}>Supplier</th><th className={th}>Bill no.</th><th className={`${th} text-right`}>Items</th><th className={`${th} text-right`}>Amount</th><th className={`${th} text-right`}>Paid</th><th className="px-5 py-3 font-medium" /></tr></thead>
            <tbody>
              {bills.map((b) => {
                const due = b.kind === "purchase" ? b.totalPaise - b.paidPaise : 0;
                const supplier = data.suppliers.find((s) => s.id === b.supplierId);
                return (
                  <FragmentRow key={b.id} open={open === b.id} lines={b.lines} note={b.note} by={b.by}>
                    <td className="whitespace-nowrap px-5 py-3 text-muted">{day(b.billDate)}</td>
                    <td className="px-3 py-3">
                      <button type="button" onClick={() => setOpen(open === b.id ? null : b.id)} className={`text-left font-semibold text-ink hover:underline ${focus}`}>{b.supplier ?? "Cash purchase"}</button>
                      {b.kind === "return" && <span className="ml-2 rounded-full bg-danger/10 px-2 py-0.5 text-caption font-semibold text-danger">Return</span>}
                    </td>
                    <td className="px-3 py-3 text-muted">{b.billNo ?? "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted">{b.lines.length}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink">{b.kind === "return" ? `−${rs(b.totalPaise)}` : rs(b.totalPaise)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{b.kind === "return" ? <span className="text-muted">—</span> : due > 0 ? <span className="font-semibold text-danger">{rs(due)} due</span> : <span className="text-[var(--state-available-text)]">Paid</span>}</td>
                    <td className="px-5 py-3 text-right">{due > 0 && supplier && <button type="button" className={quiet} onClick={() => onOpen({ kind: "pay", supplier, purchaseId: b.id, due })}>Pay</button>}</td>
                  </FragmentRow>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FragmentRow({ open, lines, note, by, children }: { open: boolean; lines: Purchasing["bills"][number]["lines"]; note: string | null; by: string | null; children: React.ReactNode }) {
  return (
    <>
      <tr className="border-t border-line">{children}</tr>
      {open && (
        <tr className="bg-ink/[0.02]">
          <td colSpan={7} className="px-5 pb-4 pt-1">
            <ul className="grid gap-1 text-caption text-ink sm:grid-cols-2">
              {lines.map((l) => <li key={l.stockItemId} className="flex justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2"><span>{l.name} · {showQty(l.qtyMilli, l.unit as StockUnit)}</span><span className="tabular-nums text-muted">{rs(l.amountPaise)}</span></li>)}
            </ul>
            {(note || by) && <p className="mt-2 text-caption text-muted">{[note, by ? `Entered by ${by}` : null].filter(Boolean).join(" · ")}</p>}
          </td>
        </tr>
      )}
    </>
  );
}

export function SuppliersTab({ data, onOpen }: { data: Purchasing; onOpen: (p: BillPanel) => void }) {
  const owed = data.suppliers.reduce((n, s) => n + Math.max(0, s.duePaise), 0);
  return (
    <section className={`${card} mt-4 overflow-hidden`} aria-label="Suppliers">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <p className="text-body text-muted">You owe <span className="font-semibold text-ink">{rs(owed)}</span> across {data.suppliers.length} {data.suppliers.length === 1 ? "supplier" : "suppliers"}.</p>
        <button type="button" className={quiet} onClick={() => onOpen({ kind: "supplier", supplier: null })}>Add supplier</button>
      </div>
      {data.suppliers.length === 0 ? (
        <p className="px-5 py-10 text-center text-body text-muted">Add the dairy, vegetable vendor and wholesaler you buy from, to track bills and what you owe.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-body">
            <thead><tr className="text-caption text-muted"><th className="px-5 py-3 font-medium">Supplier</th><th className={`${th} text-right`}>Bought</th><th className={`${th} text-right`}>Returned</th><th className={`${th} text-right`}>Paid</th><th className={`${th} text-right`}>Due</th><th className="px-5 py-3" /></tr></thead>
            <tbody>
              {data.suppliers.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="px-5 py-3">
                    <button type="button" onClick={() => onOpen({ kind: "supplier", supplier: s })} className={`text-left font-semibold text-ink hover:underline ${focus}`}>{s.name}</button>
                    <span className="block text-caption text-muted">{[s.phone, s.gstin ? `GSTIN ${s.gstin}` : null].filter(Boolean).join(" · ") || "No phone"}</span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-muted">{rs(s.billedPaise)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-muted">{s.returnedPaise ? rs(s.returnedPaise) : "—"}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-muted">{rs(s.paidPaise)}</td>
                  <td className={`px-3 py-3 text-right font-semibold tabular-nums ${s.duePaise > 0 ? "text-danger" : "text-ink"}`}>{s.duePaise < 0 ? `${rs(-s.duePaise)} advance` : rs(s.duePaise)}</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button type="button" className={quiet} onClick={() => onOpen({ kind: "bill", mode: "purchase", supplierId: s.id })}>New bill</button>
                      <button type="button" className={quiet} onClick={() => onOpen({ kind: "pay", supplier: s, due: Math.max(0, s.duePaise) })}>Pay</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.payments.length > 0 && (
        <div className="border-t border-line px-5 py-4">
          <p className="text-caption font-semibold uppercase tracking-wide text-muted">Recent payments</p>
          <ul className="mt-2 grid gap-1 text-caption">
            {data.payments.slice(0, 10).map((p) => <li key={p.id} className="flex justify-between gap-3"><span className="text-ink">{day(p.paidOn)} · {p.supplier} · {METHODS.find((m) => m[0] === p.method)?.[1]}{p.note ? ` · ${p.note}` : ""}</span><span className="tabular-nums font-semibold text-ink">{rs(p.amountPaise)}</span></li>)}
          </ul>
        </div>
      )}
    </section>
  );
}

// ---- sheets

export function BillSheet({ mode, items, suppliers, supplierId, itemId = "", onClose, done }: { mode: "purchase" | "return"; items: Item[]; suppliers: Supplier[]; supplierId?: string; /** Starts the bill on this item, when it was opened from one */ itemId?: string; onClose: () => void; done: Done }) {
  const [supplier, setSupplier] = useState(supplierId ?? (mode === "return" ? suppliers[0]?.id ?? "" : ""));
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState(todayIst());
  const [rows, setRows] = useState<{ stockItemId: string; qty: string; byPack: boolean; amount: string }[]>([{ stockItemId: itemId, qty: "", byPack: false, amount: "" }]);
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const total = rows.reduce((n, r) => n + (Number(r.amount) || 0), 0);
  const set = (idx: number, patch: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const save = async () => {
    setBusy(true); setError(null);
    const lines = rows.filter((r) => r.stockItemId);
    const input = { supplierId: supplier || null, billNo, billDate, note, lines, paid: mode === "purchase" ? paid : "", method };
    const r = mode === "purchase" ? await purchaseAction(input) : await returnAction(input);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    await done(mode === "purchase" ? `Bill saved: ${lines.length} ${lines.length === 1 ? "item" : "items"} added to stock.` : "Return saved: stock taken out.");
  };

  return (
    <Sheet title={mode === "purchase" ? "New purchase bill" : "Return to supplier"} onClose={onClose} wide>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={label}>Supplier
          <select value={supplier} onChange={(e) => setSupplier(e.target.value)} className={field}>
            {mode === "purchase" && <option value="">Cash purchase (no supplier)</option>}
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className={label}>{mode === "purchase" ? "Bill no." : "Reference"}<input value={billNo} onChange={(e) => setBillNo(e.target.value.slice(0, 40))} placeholder="Optional" className={field} /></label>
        <label className={label}>Date<input type="date" value={billDate} max={todayIst()} onChange={(e) => setBillDate(e.target.value)} className={field} /></label>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-body">
          <thead><tr className="text-caption text-muted"><th className="py-2 pr-2 font-medium">Item</th><th className="px-2 py-2 font-medium">Quantity</th><th className="px-2 py-2 font-medium">Amount (₹)</th><th /></tr></thead>
          <tbody>
            {rows.map((r, idx) => {
              const it = byId.get(r.stockItemId);
              const base = it && r.qty && r.byPack && it.packMilli ? (Number(r.qty) * it.packMilli) / 1000 : null;
              const perUnit = it && Number(r.amount) > 0 && Number(r.qty) > 0 ? Number(r.amount) / (r.byPack && it.packMilli ? (Number(r.qty) * it.packMilli) / 1000 : Number(r.qty)) : null;
              return (
                <tr key={idx} className="align-top">
                  <td className="py-1.5 pr-2">
                    <select value={r.stockItemId} aria-label="Item" onChange={(e) => set(idx, { stockItemId: e.target.value, byPack: false })} className={field}>
                      <option value="">Choose item…</option>
                      {items.filter((i) => !i.isPrep && (i.id === r.stockItemId || !rows.some((x) => x.stockItemId === i.id))).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                    {it && mode === "return" && <span className="mt-1 block text-caption text-muted">In stock: {showQty(it.qtyMilli, it.unit)}</span>}
                  </td>
                  <td className="w-44 px-2 py-1.5">
                    <div className="flex gap-1">
                      <input value={r.qty} inputMode="decimal" aria-label="Quantity" placeholder="0" onChange={(e) => set(idx, { qty: e.target.value })} className={`${field} min-w-0`} />
                      {it?.packName && it.packMilli ? (
                        <select value={r.byPack ? "pack" : "unit"} aria-label="Unit" onChange={(e) => set(idx, { byPack: e.target.value === "pack" })} className={`${field} w-24 px-2`}>
                          <option value="unit">{UNIT_LABEL[it.unit]}</option>
                          <option value="pack">{it.packName}</option>
                        </select>
                      ) : <span className="grid w-14 place-items-center text-caption text-muted">{it ? UNIT_LABEL[it.unit] : ""}</span>}
                    </div>
                    {base !== null && it && <span className="mt-1 block text-caption text-muted">= {base.toLocaleString("en-IN")} {UNIT_LABEL[it.unit]}</span>}
                  </td>
                  <td className="w-36 px-2 py-1.5">
                    <input value={r.amount} inputMode="decimal" aria-label="Amount" placeholder="0" onChange={(e) => set(idx, { amount: e.target.value })} className={field} />
                    {perUnit !== null && it && <span className="mt-1 block text-caption text-muted">₹{perUnit.toLocaleString("en-IN", { maximumFractionDigits: 2 })}/{UNIT_LABEL[it.unit]}</span>}
                  </td>
                  <td className="py-1.5 pl-1">
                    <button type="button" aria-label="Remove line" onClick={() => setRows(rows.length > 1 ? rows.filter((_, i) => i !== idx) : [{ stockItemId: "", qty: "", byPack: false, amount: "" }])} className={`grid size-11 place-items-center rounded-xl text-muted hover:bg-ink/5 ${focus}`}><HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className={`mt-1 ${quiet}`} onClick={() => setRows([...rows, { stockItemId: "", qty: "", byPack: false, amount: "" }])} disabled={rows.length >= 100}>Add line</button>
      {!items.length && <p className="mt-2 text-caption text-danger">Add stock items first.</p>}

      <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-3">
        <p className="text-body text-muted sm:col-span-3">Total <span className="font-display text-section font-bold text-ink">₹{total.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span></p>
        {mode === "purchase" && supplier && (
          <>
            <label className={label}>Paid now (₹)<input value={paid} inputMode="decimal" placeholder="0 = all on credit" onChange={(e) => setPaid(e.target.value)} className={field} /></label>
            <label className={label}>Paid by<select value={method} onChange={(e) => setMethod(e.target.value)} className={field}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <div className="flex items-end"><button type="button" className={`${quiet} min-h-11 w-full`} onClick={() => setPaid(String(total))}>Paid in full</button></div>
          </>
        )}
        <label className={`${label} sm:col-span-3`}>Note<input value={note} onChange={(e) => setNote(e.target.value.slice(0, 140))} placeholder={mode === "return" ? "e.g. Paneer was sour" : "Optional"} className={field} /></label>
      </div>
      {error && <p role="alert" className="mt-3 text-caption text-danger">{error}</p>}
      <button type="button" disabled={busy || !rows.some((r) => r.stockItemId && r.qty)} onClick={() => void save()} className={`mt-4 w-full ${primary}`}>{busy ? "Saving…" : mode === "purchase" ? "Save bill and add to stock" : "Save return"}</button>
    </Sheet>
  );
}

export function PaySheet({ supplier, purchaseId, due, onClose, done }: { supplier: Supplier; purchaseId?: string; due?: number; onClose: () => void; done: Done }) {
  const [amount, setAmount] = useState(due ? String(due / 100) : "");
  const [method, setMethod] = useState("cash");
  const [paidOn, setPaidOn] = useState(todayIst());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    const r = await payAction({ supplierId: supplier.id, purchaseId: purchaseId ?? null, amount, method, paidOn, note });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    await done(`Payment to ${supplier.name} saved.`);
  };
  return (
    <Sheet title={`Pay ${supplier.name}`} onClose={onClose}>
      <p className="text-body text-muted">{supplier.duePaise > 0 ? <>Owed in all: <span className="font-semibold text-danger">{rs(supplier.duePaise)}</span></> : "Nothing is owed right now."}</p>
      <div className="mt-3 grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>Amount (₹)<input autoFocus value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} className={field} /></label>
          <label className={label}>Date<input type="date" value={paidOn} max={todayIst()} onChange={(e) => setPaidOn(e.target.value)} className={field} /></label>
        </div>
        <label className={label}>Paid by<select value={method} onChange={(e) => setMethod(e.target.value)} className={field}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className={label}>Note<input value={note} onChange={(e) => setNote(e.target.value.slice(0, 140))} placeholder="e.g. UPI ref 4821" className={field} /></label>
        {error && <p role="alert" className="text-caption text-danger">{error}</p>}
        <button type="button" disabled={busy} onClick={() => void save()} className={primary}>{busy ? "Saving…" : "Save payment"}</button>
      </div>
    </Sheet>
  );
}

export function SupplierSheet({ supplier, onClose, done }: { supplier: Supplier | null; onClose: () => void; done: Done }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title={supplier ? `Edit ${supplier.name}` : "Add supplier"} onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true); setError(null);
          const r = await saveSupplierAction({ id: supplier?.id ?? null, name: String(f.get("name")), phone: String(f.get("phone")), gstin: String(f.get("gstin")), note: String(f.get("note")) });
          setBusy(false);
          if (!r.ok) return setError(r.error);
          await done(supplier ? "Supplier saved." : "Supplier added.");
        }}
      >
        <label className={label}>Name<input name="name" required maxLength={80} defaultValue={supplier?.name} placeholder="e.g. Sharma Dairy" className={field} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>Phone<input name="phone" inputMode="tel" maxLength={16} defaultValue={supplier?.phone ?? ""} placeholder="Optional" className={field} /></label>
          <label className={label}>GSTIN<input name="gstin" maxLength={15} defaultValue={supplier?.gstin ?? ""} placeholder="Optional" className={field} /></label>
        </div>
        <label className={label}>Note<input name="note" maxLength={140} defaultValue={supplier?.note ?? ""} placeholder="e.g. Delivers before 9 am" className={field} /></label>
        {error && <p role="alert" className="text-caption text-danger">{error}</p>}
        <button type="submit" disabled={busy} className={primary}>{busy ? "Saving…" : supplier ? "Save" : "Add supplier"}</button>
        {supplier && <button type="button" disabled={busy} onClick={async () => { setBusy(true); const r = await removeSupplierAction(supplier.id); setBusy(false); if (!r.ok) return setError(r.error); await done(`${supplier.name} removed.`); }} className={`min-h-10 text-caption font-semibold text-danger ${focus}`}>Remove supplier</button>}
      </form>
    </Sheet>
  );
}

