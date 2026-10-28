"use client";

import { LoaderCircle, Printer as PrinterIcon } from "lucide-react";
import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePrint } from "@/components/print/print-provider";
import { loadDevicePrefs, saveDevicePrefs, subscribeDevicePrefs } from "@/lib/print/device-prefs";
import type { DevicePrefs } from "@/lib/print/manager";
import { describeJob, MAX_PRINTERS_PER_OUTLET, PRINTER_NAME_MAX, type JobStatus } from "@/lib/print/jobs";
import { testSlipHtml } from "@/lib/print/test-slip";
import { allTransports, confirmable } from "@/lib/print/transports";
import type { JobRow } from "@/server/print/jobs";
import type { PrinterInfo, PrintSetup } from "@/server/print/printers";
import { PRINT_TIPS } from "@/app/pos/_components/paper-toggle";
import { assignPrintersAction, recentPrintsAction, removePrinterAction, savePrinterAction } from "../actions";

const KIND: Record<string, string> = { receipt: "Receipt", bill: "Bill", kot: "Kitchen ticket", order_slip: "Order slip", day_close: "Day close", test: "Test print" };
const STATUS: Record<JobStatus, { label: string; tone: string }> = {
  queued: { label: "Waiting", tone: "bg-neutral-100 text-muted" },
  sent: { label: "Sent", tone: "bg-amber-50 text-amber-800" },
  confirmed: { label: "Printed", tone: "bg-emerald-50 text-emerald-700" },
  failed: { label: "Failed", tone: "bg-rose-50 text-rose-700" },
  cancelled: { label: "Cancelled", tone: "bg-neutral-100 text-muted" },
};
const when = (ms: number) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(ms);

const field = "h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink";
const primary = "h-11 rounded-xl bg-brand px-5 text-sm font-semibold text-white disabled:opacity-50";
const quiet = "h-9 rounded-lg border border-line px-3 text-xs font-semibold text-ink hover:bg-ink/5 disabled:opacity-50";

type Draft = { id?: string; name: string; paperMm: 58 | 80; transport: string };
const BLANK: Draft = { name: "", paperMm: 80, transport: "browser" };

export function PrinterSettings({ initial, outletId, outletName, recent: initialRecent }: { initial: PrintSetup; outletId: string; outletName: string; recent: JobRow[] }) {
  const { manager, reload } = usePrint();
  const [setup, setSetup] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [recent, setRecent] = useState(initialRecent);
  const [busy, start] = useTransition();

  const prefsRaw = useSyncExternalStore(subscribeDevicePrefs, () => JSON.stringify(loadDevicePrefs(outletId)), () => "{}");
  const prefs = useMemo<DevicePrefs>(() => ({ receiptPrinterId: null, kitchenPrinterId: null, ...(JSON.parse(prefsRaw) as Partial<DevicePrefs>) }), [prefsRaw]);
  const [outletReceipt, setOutletReceipt] = useState(initial.receiptPrinterId ?? "");
  const [outletKitchen, setOutletKitchen] = useState(initial.kitchenPrinterId ?? "");

  const apply = (r: { ok: true; setup: PrintSetup } | { ok: false; message: string }, done: string) => {
    if (!r.ok) { setMessage({ text: r.message, error: true }); return false; }
    setSetup(r.setup);
    setOutletReceipt(r.setup.receiptPrinterId ?? "");
    setOutletKitchen(r.setup.kitchenPrinterId ?? "");
    setMessage({ text: done });
    reload();
    return true;
  };

  const save = () => draft && start(async () => {
    if (apply(await savePrinterAction({ id: draft.id, name: draft.name, paperMm: draft.paperMm, transport: draft.transport }), draft.id ? "Printer updated." : "Printer added.")) setDraft(null);
  });
  const remove = (p: PrinterInfo) => start(async () => { apply(await removePrinterAction(p.id), `${p.name} removed.`); });
  const saveDefaults = () => start(async () => { apply(await assignPrintersAction({ receiptPrinterId: outletReceipt || null, kitchenPrinterId: outletKitchen || null }), "Outlet printers saved."); });
  const testPrint = (p: PrinterInfo) => void manager.print({ kind: "test", printerId: p.id, subject: { type: "printer", id: p.id }, build: (paper) => testSlipHtml(paper, { printerName: p.name, outletName }) });
  const refresh = () => start(async () => { const r = await recentPrintsAction(); if (r.ok) setRecent(r.jobs); else setMessage({ text: r.message, error: true }); });
  const nameOf = (id: string | null) => setup.printers.find((p) => p.id === id)?.name ?? null;

  const choose = (current: string, set: (v: string) => void, label: string, blank: string) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <select value={current} onChange={(e) => set(e.target.value)} className={field}>
        <option value="">{blank}</option>
        {setup.printers.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.paperMm} mm</option>)}
      </select>
    </div>
  );

  return <section className="mt-5 overflow-hidden rounded-2xl border border-line bg-surface" aria-labelledby="printers-heading">
    <header className="flex items-start gap-3 border-b border-line px-5 py-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ink/5 text-ink"><PrinterIcon className="size-4" aria-hidden="true" /></span>
      <div><h2 id="printers-heading" className="font-display text-section font-bold text-ink">Printers</h2>
        <p className="text-sm text-muted">The printers this outlet uses. Bills and receipts go to the receipt printer, kitchen tickets to the kitchen printer.</p></div>
    </header>
    <div className="space-y-6 p-5">
      {message && <p role={message.error ? "alert" : "status"} className={`rounded-xl px-3.5 py-2.5 text-sm ${message.error ? "bg-rose-50 text-rose-700" : "bg-sage text-forest"}`}>{message.text}</p>}

      <div>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink">Printers at {outletName}</h3>
          {!draft && setup.printers.length < MAX_PRINTERS_PER_OUTLET && <button type="button" className={quiet} onClick={() => { setDraft(BLANK); setMessage(null); }}>Add a printer</button>}
        </div>
        {setup.printers.length === 0 && !draft && <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-5 text-sm text-muted">No printer added yet. Slips still print through this device&apos;s print window. Add a printer to name it, set its roll size and run a test print.</p>}
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
          {setup.printers.map((p) => <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
              <p className="text-xs text-muted">{p.paperMm} mm roll · {allTransports().find((t) => t.id === p.transport)?.label ?? p.transport}</p>
              <p className="mt-1 flex flex-wrap gap-1.5">
                {setup.receiptPrinterId === p.id && <span className="rounded-full bg-sage px-2 py-0.5 text-[11px] font-semibold text-forest">Receipt printer</span>}
                {setup.kitchenPrinterId === p.id && <span className="rounded-full bg-sage px-2 py-0.5 text-[11px] font-semibold text-forest">Kitchen printer</span>}
                {prefs.receiptPrinterId === p.id && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Receipts from this device</span>}
                {prefs.kitchenPrinterId === p.id && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Kitchen from this device</span>}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={quiet} onClick={() => testPrint(p)}>Test print</button>
              <button type="button" className={quiet} onClick={() => { setDraft({ id: p.id, name: p.name, paperMm: p.paperMm, transport: p.transport }); setMessage(null); }}>Edit</button>
              <button type="button" className={quiet} disabled={busy} onClick={() => remove(p)}>Remove</button>
            </div>
          </li>)}
        </ul>
      </div>

      {draft && <div className="rounded-xl border border-line bg-canvas p-4">
        <h3 className="text-sm font-semibold text-ink">{draft.id ? "Edit printer" : "Add a printer"}</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="printer-name">Name</Label>
            <Input id="printer-name" value={draft.name} maxLength={PRINTER_NAME_MAX} placeholder="Counter printer" onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
          <fieldset className="space-y-2"><legend className="text-sm font-medium text-ink">Roll width</legend>
            <div className="flex gap-2">{([80, 58] as const).map((mm) => <label key={mm} className={`flex h-11 flex-1 cursor-pointer items-center justify-center rounded-xl border text-sm font-semibold ${draft.paperMm === mm ? "border-forest bg-sage text-forest" : "border-line bg-surface text-ink"}`}>
              <input type="radio" name="paper" className="sr-only" checked={draft.paperMm === mm} onChange={() => setDraft({ ...draft, paperMm: mm })} />{mm} mm</label>)}</div></fieldset>
        </div>
        <fieldset className="mt-4 space-y-2"><legend className="text-sm font-medium text-ink">How it is connected</legend>
          <div className="grid gap-2">{allTransports().map((t) => <label key={t.id} className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${t.implemented ? "cursor-pointer" : "cursor-not-allowed opacity-60"} ${draft.transport === t.id ? "border-forest bg-sage/60" : "border-line bg-surface"}`}>
            <input type="radio" name="transport" className="mt-1" disabled={!t.implemented} checked={draft.transport === t.id} onChange={() => setDraft({ ...draft, transport: t.id })} />
            <span><span className="font-semibold text-ink">{t.label}{!t.implemented && <span className="ml-2 text-xs font-medium text-muted">Not available yet</span>}</span>
              <span className="mt-0.5 block text-xs text-muted">{t.description}</span>
              {t.implemented && <span className="mt-0.5 block text-xs text-muted">{confirmable(t.id) ? "The printer can confirm that it printed." : "Tableeqr can show that a slip was sent, not that paper came out."}</span>}</span>
          </label>)}</div></fieldset>
        <div className="mt-4 flex gap-2"><button type="button" className={primary} disabled={busy || !draft.name.trim()} onClick={save}>{busy ? <LoaderCircle className="mx-auto size-4 animate-spin" aria-label="Saving" /> : draft.id ? "Save changes" : "Add printer"}</button>
          <button type="button" className="h-11 rounded-xl border border-line px-5 text-sm font-semibold text-ink" onClick={() => setDraft(null)}>Cancel</button></div>
      </div>}

      {setup.printers.length > 0 && <>
        <div className="rounded-xl border border-line p-4">
          <h3 className="text-sm font-semibold text-ink">This outlet uses</h3>
          <p className="mt-0.5 text-xs text-muted">Every staff device here prints to these, unless the device has its own choice below.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {choose(outletReceipt, setOutletReceipt, "Receipt printer", "None: use the print window")}
            {choose(outletKitchen, setOutletKitchen, "Kitchen printer", "None: use the print window")}
          </div>
          <button type="button" className={`${primary} mt-4`} disabled={busy} onClick={saveDefaults}>Save outlet printers</button>
        </div>

        <div className="rounded-xl border border-line p-4">
          <h3 className="text-sm font-semibold text-ink">This device only</h3>
          <p className="mt-0.5 text-xs text-muted">Saved on this phone, tablet or computer, not for the whole outlet. For example a kitchen tablet that always prints to the kitchen printer.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {choose(prefs.receiptPrinterId ?? "", (v) => saveDevicePrefs(outletId, { ...prefs, receiptPrinterId: v || null }), "Receipt printer", `Same as outlet${nameOf(setup.receiptPrinterId) ? `: ${nameOf(setup.receiptPrinterId)}` : ""}`)}
            {choose(prefs.kitchenPrinterId ?? "", (v) => saveDevicePrefs(outletId, { ...prefs, kitchenPrinterId: v || null }), "Kitchen printer", `Same as outlet${nameOf(setup.kitchenPrinterId) ? `: ${nameOf(setup.kitchenPrinterId)}` : ""}`)}
          </div>
        </div>
      </>}

      <div>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink">Recent prints</h3>
          <button type="button" className={quiet} disabled={busy} onClick={refresh}>Refresh</button>
        </div>
        {recent.length === 0 ? <p className="mt-3 text-sm text-muted">Nothing printed yet.</p> : <div className="mt-3 overflow-x-auto rounded-xl border border-line"><table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="bg-canvas text-xs text-muted"><tr><th className="px-3 py-2 font-semibold">When</th><th className="px-3 py-2 font-semibold">Slip</th><th className="px-3 py-2 font-semibold">Printer</th><th className="px-3 py-2 font-semibold">Result</th></tr></thead>
          <tbody className="divide-y divide-line">{recent.map((j) => <tr key={j.id}>
            <td className="whitespace-nowrap px-3 py-2 text-muted">{when(j.at)}</td>
            <td className="px-3 py-2 text-ink">{KIND[j.kind] ?? j.kind}{j.reprint && <span className="ml-1.5 text-xs text-muted">again</span>}</td>
            <td className="px-3 py-2 text-muted">{j.printerName ?? "Print window"} · {j.paperMm} mm</td>
            <td className="px-3 py-2"><span title={describeJob(j.status, { confirmable: confirmable(j.transport), detail: j.failure })} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[j.status].tone}`}>{STATUS[j.status].label}</span>{j.attempts > 1 && <span className="ml-1.5 text-xs text-muted">{j.attempts} tries</span>}</td>
          </tr>)}</tbody></table></div>}
        <p className="mt-3 text-xs leading-relaxed text-muted">“Sent” means the slip was handed to the print window or printer. A browser cannot tell whether paper came out, so check the printer. {PRINT_TIPS}</p>
      </div>
    </div>
  </section>;
}

/** Shown in place of the card when the printer tables cannot be read; printing itself is not affected */
export function PrinterSettingsUnavailable() {
  return <section className="mt-5 overflow-hidden rounded-2xl border border-line bg-surface" aria-labelledby="printers-heading">
    <header className="flex items-start gap-3 border-b border-line px-5 py-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ink/5 text-ink"><PrinterIcon className="size-4" aria-hidden="true" /></span>
      <div><h2 id="printers-heading" className="font-display text-section font-bold text-ink">Printers</h2>
        <p className="text-sm text-muted">Printer settings could not be loaded just now. Bills, receipts and kitchen tickets still print through this device&apos;s print window. Reload the page to try again.</p></div>
    </header>
  </section>;
}
