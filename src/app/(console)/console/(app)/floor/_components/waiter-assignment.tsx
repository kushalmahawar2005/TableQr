"use client";

import { useState } from "react";
import { Check, Users, WandSparkles } from "lucide-react";
import type { FloorData } from "@/server/floor/read";
import { assignWaiterAction } from "../actions";
import { Dialog, btnPrimary, btnLine } from "./ui";

export function WaiterAssignment({ data, initialIds, hi, onClose, onSaved }: { data: FloorData; initialIds: string[]; hi: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const tables = data.tables.filter(t => !t.visit || t.visit.isPrimary);
  const canonical = (id: string) => data.tables.find(t => t.id === id)?.visit?.tableIds[0] ?? id;
  const [selected, setSelected] = useState(() => new Set(initialIds.map(canonical)));
  const [waiter, setWaiter] = useState<string | null>("__auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const L = (en: string, hindi: string) => hi ? hindi : en;
  const save = async () => {
    if (busy || !selected.size) return;
    setBusy(true); setError("");
    try {
      const result = await assignWaiterAction([...selected], waiter);
      if (!result.ok) { setError(result.message); return; }
      await onSaved(); onClose();
    } catch { setError(L("Connection lost. Please try again.", "कनेक्शन टूट गया। दोबारा कोशिश करें।")); }
    finally { setBusy(false); }
  };
  return <Dialog title={L("Assign tables", "टेबल असाइन करें")} onClose={() => !busy && onClose()} closeLabel={L("Close", "बंद करें")} wide>
    <div className="max-h-[70dvh] space-y-5 overflow-y-auto p-5">
      <p className="text-sm text-muted">{L("Choose tables, then a waiter. Auto-balance gives more work to the least busy staff on duty.", "टेबल और वेटर चुनें। ऑटो बैलेंस कम व्यस्त ऑन-ड्यूटी वेटर को काम देता है।")}</p>
      <fieldset disabled={busy}>
        <div className="flex items-center justify-between gap-3"><legend className="font-semibold">{L("Tables", "टेबल")} · {selected.size}</legend><button type="button" className="min-h-9 text-sm font-semibold text-brand-strong" onClick={() => setSelected(new Set(selected.size === tables.length ? [] : tables.map(t => t.id)))}>{selected.size === tables.length ? L("Clear all", "सब हटाएं") : L("Select all", "सब चुनें")}</button></div>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">{tables.map(t => <label key={t.id} className={`flex min-h-14 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 ${selected.has(t.id) ? "border-brand bg-brand-soft text-brand-strong" : "border-line bg-paper"}`}><input type="checkbox" checked={selected.has(t.id)} onChange={() => setSelected(old => { const next = new Set(old); if (next.has(t.id)) next.delete(t.id); else next.add(t.id); return next; })} className="size-4 accent-[var(--brand-main)]"/><span className="min-w-0"><span className="block font-semibold">{t.code}{t.visit && t.visit.tableIds.length > 1 ? " +" : ""}</span><span className="block truncate text-xs text-muted">{t.assignedWaiter?.name ?? L("Unassigned", "असाइन नहीं")}</span></span></label>)}</div>
      </fieldset>
      <fieldset disabled={busy} className="space-y-2"><legend className="mb-2 font-semibold">{L("Who's responsible?", "ज़िम्मेदारी किसकी?")}</legend>
        <button type="button" aria-pressed={waiter === "__auto"} onClick={() => setWaiter("__auto")} className={`flex min-h-16 w-full items-center gap-3 rounded-xl border p-3 text-left ${waiter === "__auto" ? "border-brand bg-brand-soft" : "border-line"}`}><span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-strong"><WandSparkles className="size-5"/></span><span className="flex-1"><span className="block font-semibold">{L("Auto-balance", "ऑटो बैलेंस")}</span><span className="text-xs text-muted">{L("Balances active tables, requests and ready food", "टेबल, अनुरोध और तैयार खाने के हिसाब से")}</span></span>{waiter === "__auto" && <Check className="size-5 text-brand-strong"/>}</button>
        {data.waiters.map(w => <button key={w.id} type="button" disabled={w.duty !== "on"} aria-pressed={waiter === w.id} onClick={() => setWaiter(w.id)} className={`flex min-h-16 w-full items-center gap-3 rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-45 ${waiter === w.id ? "border-brand bg-brand-soft" : "border-line"}`}><span className="grid size-10 shrink-0 place-items-center rounded-full bg-forest/10 text-lg font-bold text-forest">{w.name.slice(0, 1).toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate font-semibold">{w.name}</span><span className="block text-xs text-muted">{w.duty === "on" ? L("On duty", "ड्यूटी पर") : w.duty === "break" ? L("On break", "ब्रेक पर") : L("Off duty", "ऑफ ड्यूटी")} · {w.activeTables} {L("active tables", "सक्रिय टेबल")} · {w.pendingRequests} {L("requests", "अनुरोध")}</span></span>{waiter === w.id && <Check className="size-5 shrink-0 text-brand-strong"/>}</button>)}
        {!data.waiters.some(w => w.duty === "on") && <p className="rounded-xl bg-paper p-3 text-sm text-muted">{L("No waiter is on duty. Set their shift from Team before assigning tables.", "कोई वेटर ड्यूटी पर नहीं है। पहले टीम से ड्यूटी चालू करें।")}</p>}
        <button type="button" aria-pressed={waiter === null} onClick={() => setWaiter(null)} className={`flex min-h-12 w-full items-center gap-3 rounded-xl border p-3 text-left ${waiter === null ? "border-brand bg-brand-soft" : "border-line"}`}><Users className="size-5 text-muted"/><span className="flex-1 font-semibold">{L("Release to shared queue", "शेयर्ड सूची में छोड़ें")}</span>{waiter === null && <Check className="size-5 text-brand-strong"/>}</button>
      </fieldset>
      <p className="text-xs text-muted">{L("Shift coverage lasts 12 hours. Current guests keep their waiter when moved. Overdue requests can be handed to available staff automatically.", "शिफ़्ट कवरेज 12 घंटे रहती है। टेबल बदलने पर मेहमान का वेटर साथ रहता है। देर वाले अनुरोध उपलब्ध स्टाफ को दिए जा सकते हैं।")}</p>
      {error && <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>}
    </div>
    <div className="flex gap-2 border-t border-line p-4"><button type="button" className={`${btnLine} flex-1`} disabled={busy} onClick={onClose}>{L("Cancel", "रद्द करें")}</button><button type="button" className={`${btnPrimary} flex-1`} disabled={busy || !selected.size || (waiter !== null && !data.waiters.some(w => w.duty === "on"))} onClick={() => void save()}>{busy ? L("Saving…", "सेव हो रहा…") : L("Save assignment", "असाइनमेंट सेव करें")}</button></div>
  </Dialog>;
}
