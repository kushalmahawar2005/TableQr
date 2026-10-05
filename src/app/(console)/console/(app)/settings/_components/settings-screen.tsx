"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, Circle, Copy, Plus, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OutletSettings } from "@/server/staff/settings-read";
import { saveSettingsAction } from "../actions";

const DAYS = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]] as const;
const MODE: Record<string, string> = { open: "Open: anyone who scans can order", verified: "Verified: guests confirm their phone number first", host_confirmed: "Host confirms: staff approve each table" };
const TIP_OPTIONS = [5, 10, 15, 20];
type Hours = Record<string, [string, string][]>;

const emptyHours = (): Hours => Object.fromEntries(DAYS.map(([k]) => [k, []]));
const fieldCls = "h-11 rounded-xl";

function Static({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-x-4 py-2.5 text-sm"><dt className="text-muted">{label}</dt><dd className="min-w-0 break-words text-right font-semibold">{children}</dd></div>;
}

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${on ? "border-brand bg-brand" : "border-line bg-ink/10"}`}>
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? "left-[1.375rem]" : "left-0.5"}`} />
    </button>
  );
}

export function SettingsScreen({ o, canEdit }: { o: OutletSettings; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [city, setCity] = useState(o.city);
  const [address, setAddress] = useState(o.address);
  const [gstin, setGstin] = useState(o.gstin ?? "");
  const [fssai, setFssai] = useState(o.fssai ?? "");
  const [sc, setSc] = useState(o.serviceChargeBp ? String(o.serviceChargeBp / 100) : "");
  const [tips, setTips] = useState<number[]>(o.tipPresetsBp?.length ? o.tipPresetsBp.map((b) => b / 100) : [5, 10]);
  const [auto, setAuto] = useState(o.autoAcceptOrders);
  const [review, setReview] = useState(o.reviewUrl ?? "");
  const [hours, setHours] = useState<Hours>({ ...emptyHours(), ...(o.openingHours ?? {}) });
  const [hoursOn, setHoursOn] = useState(!!o.openingHours);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const setDay = (d: string, ranges: [string, string][]) => setHours((h) => ({ ...h, [d]: ranges }));
  const scNum = sc.trim() === "" ? 0 : Number(sc);

  const checklist = [
    ["GST number", !!o.gstin], ["FSSAI licence", !!o.fssai], ["Opening hours", !!o.openingHours], ["Review link", !!o.reviewUrl],
  ] as const;
  const done = checklist.filter(([, v]) => v).length;

  function save() {
    setMsg(null);
    if (!Number.isFinite(scNum) || scNum < 0 || scNum > 20) return setMsg({ ok: false, text: "Service charge must be between 0 and 20." });
    start(async () => {
      const res = await saveSettingsAction({
        city, address, gstin, fssai,
        serviceChargeBp: Math.round(scNum * 100),
        tipPresetsBp: tips.map((t) => Math.round(t * 100)),
        autoAcceptOrders: auto, reviewUrl: review,
        openingHours: hoursOn ? hours : null,
      });
      setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.message });
      if (res.ok) router.refresh();
    });
  }

  return (
    <main className="mx-auto w-full max-w-[1000px] px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pt-7">
      <header>
        <p className="text-caption font-semibold text-muted">{o.name}</p>
        <h1 className="mt-1 font-display text-title font-bold text-ink">Settings</h1>
        <p className="mt-1 text-body text-muted">{canEdit ? "Change your restaurant details here. Name, code and plan are managed by TableQR." : "View only. Only the owner can change settings."}</p>
      </header>

      {done < checklist.length && (
        <Card className="mt-5 border border-brand-border bg-brand-soft/40">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="min-w-0">
              <p className="font-display text-section font-bold">Finish your setup <span className="text-muted">· {done}/{checklist.length}</span></p>
              <div className="mt-2 h-1.5 w-48 max-w-full rounded-full bg-ink/10"><div className="h-full rounded-full bg-brand" style={{ width: `${(done / checklist.length) * 100}%` }} /></div>
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
              {checklist.map(([k, v]) => <li key={k} className={`flex items-center gap-1.5 ${v ? "text-muted" : "font-semibold"}`}>{v ? <CheckCircle2 className="size-4 text-[#16a34a]" /> : <Circle className="size-4 text-muted" />}{k}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="font-display text-section font-bold">Restaurant</CardTitle><CardDescription>Shown on bills and the guest page.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <dl className="divide-y divide-line rounded-xl border border-line px-3"><Static label="Name">{o.name}</Static><Static label="Outlet code"><span className="font-mono">{o.code}</span></Static><Static label="Time zone">{o.timezone}</Static></dl>
            <div className="space-y-1.5"><Label htmlFor="city">City</Label><Input id="city" className={fieldCls} value={city} onChange={(e) => setCity(e.target.value)} disabled={!canEdit} /></div>
            <div className="space-y-1.5"><Label htmlFor="address">Address</Label><Input id="address" className={fieldCls} value={address} onChange={(e) => setAddress(e.target.value)} disabled={!canEdit} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="font-display text-section font-bold">Tax and licences</CardTitle><CardDescription>Printed on every bill.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="gstin">GST number (GSTIN)</Label><Input id="gstin" className={`${fieldCls} font-mono uppercase`} maxLength={15} placeholder="08ABCDE1234F1Z5" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} disabled={!canEdit} /></div>
            <div className="space-y-1.5"><Label htmlFor="fssai">FSSAI licence number</Label><Input id="fssai" className={`${fieldCls} font-mono`} inputMode="numeric" maxLength={14} placeholder="14 digits" value={fssai} onChange={(e) => setFssai(e.target.value.replace(/\D/g, ""))} disabled={!canEdit} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="font-display text-section font-bold">Bill and tips</CardTitle><CardDescription>What guests see when they pay.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sc">Service charge (%)</Label>
              <Input id="sc" className={fieldCls} inputMode="decimal" placeholder="0 = off" value={sc} onChange={(e) => setSc(e.target.value)} disabled={!canEdit} />
              <p className="text-xs text-muted">{scNum > 0 ? `${scNum}% is added to every bill. Guests can ask staff to remove it.` : "Off. Nothing extra is added."}</p>
            </div>
            <div className="space-y-1.5">
              <Label>Tip choices</Label>
              <div className="flex flex-wrap gap-2">
                {TIP_OPTIONS.map((t) => {
                  const on = tips.includes(t);
                  return <button key={t} type="button" disabled={!canEdit} aria-pressed={on} onClick={() => setTips((x) => (on ? x.filter((v) => v !== t) : [...x, t].sort((a, b) => a - b)))} className={`min-h-10 rounded-full border px-4 text-sm font-semibold disabled:opacity-60 ${on ? "border-ink bg-ink text-paper" : "border-line hover:border-ink/40"}`}>{t}%</button>;
                })}
              </div>
              <p className="text-xs text-muted">{tips.length ? `Guests will see ${tips.map((t) => `${t}%`).join(", ")}.` : "No tip choices. Guests can still type their own."}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="font-display text-section font-bold">Orders</CardTitle><CardDescription>How new orders reach the kitchen.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-xl border border-line p-3">
              <div className="min-w-0"><p className="text-sm font-semibold">Accept orders automatically</p><p className="text-xs text-muted">{auto ? "Orders go straight to the kitchen." : "Staff accept each order first."}</p></div>
              <Toggle on={auto} onChange={setAuto} label="Accept orders automatically" disabled={!canEdit} />
            </div>
            <dl className="divide-y divide-line rounded-xl border border-line px-3"><Static label="Table mode">{MODE[o.sessionMode] ?? o.sessionMode}</Static></dl>
            <div className="space-y-1.5"><Label htmlFor="review">Google review link</Label><Input id="review" className={fieldCls} type="url" placeholder="https://g.page/r/…" value={review} onChange={(e) => setReview(e.target.value)} disabled={!canEdit} /><p className="text-xs text-muted">Guests see this after paying.</p></div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div><CardTitle className="font-display text-section font-bold">Opening hours</CardTitle><CardDescription>{hoursOn ? "Set when you are open each day." : "Not set. Turn on to add your timings."}</CardDescription></div>
            <Toggle on={hoursOn} onChange={setHoursOn} label="Set opening hours" disabled={!canEdit} />
          </div>
        </CardHeader>
        {hoursOn && (
          <CardContent>
            <ul className="divide-y divide-line">
              {DAYS.map(([k, label], i) => {
                const ranges = hours[k] ?? [];
                const open = ranges.length > 0;
                return (
                  <li key={k} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                    <div className="flex w-36 items-center gap-3"><Toggle on={open} onChange={(v) => setDay(k, v ? [["12:00", "23:00"]] : [])} label={`${label} open`} disabled={!canEdit} /><span className="text-sm font-semibold">{label}</span></div>
                    {open ? (
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        {ranges.map(([a, b], n) => (
                          <span key={n} className="inline-flex items-center gap-1.5 rounded-xl border border-line px-2 py-1">
                            <input type="time" aria-label={`${label} opens`} value={a} disabled={!canEdit} onChange={(e) => setDay(k, ranges.map((r, j) => (j === n ? [e.target.value, r[1]] : r)))} className="h-8 bg-transparent text-sm" />
                            <span className="text-muted">to</span>
                            <input type="time" aria-label={`${label} closes`} value={b} disabled={!canEdit} onChange={(e) => setDay(k, ranges.map((r, j) => (j === n ? [r[0], e.target.value] : r)))} className="h-8 bg-transparent text-sm" />
                            {canEdit && ranges.length > 1 && <button type="button" aria-label="Remove time slot" onClick={() => setDay(k, ranges.filter((_, j) => j !== n))} className="text-muted hover:text-danger"><X className="size-4" /></button>}
                          </span>
                        ))}
                        {canEdit && ranges.length < 3 && <button type="button" onClick={() => setDay(k, [...ranges, ["18:00", "23:00"]])} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-dashed border-line px-2.5 text-xs font-semibold text-muted hover:text-ink"><Plus className="size-3.5" />Add break slot</button>}
                        {canEdit && i === 0 && <button type="button" onClick={() => setHours(Object.fromEntries(DAYS.map(([d]) => [d, ranges.map((r) => [...r] as [string, string])])))} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-line px-2.5 text-xs font-semibold hover:border-ink/40"><Copy className="size-3.5" />Copy to all days</button>}
                      </div>
                    ) : <span className="text-sm text-muted">Closed</span>}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader><CardTitle className="font-display text-section font-bold">Plan and setup</CardTitle></CardHeader>
        <CardContent><dl className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[["Plan", o.plan || "—"], ["Tables", String(o.tables)], ["Team members", String(o.staff)]].map(([k, v]) => <div key={k} className="px-0 py-2 sm:px-4 sm:first:pl-0"><dt className="text-xs text-muted">{k}</dt><dd className="font-display text-section font-bold">{v}</dd></div>)}
        </dl></CardContent>
      </Card>

      {canEdit && (
        <div className="fixed inset-x-3 bottom-3 z-20 mx-auto flex max-w-[1000px] items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3 shadow-lg lg:left-[calc(var(--sidebar-width,16rem)+0.75rem)] lg:right-3 lg:mx-0 lg:max-w-none">
          <p role={msg?.ok === false ? "alert" : "status"} className={`min-w-0 text-sm font-semibold ${msg?.ok ? "text-[#16a34a]" : "text-danger"}`}>{msg?.text}</p>
          <button type="button" disabled={pending} onClick={save} className="inline-flex h-11 shrink-0 items-center rounded-xl border border-brand bg-brand px-6 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50">{pending ? "Saving…" : "Save changes"}</button>
        </div>
      )}
    </main>
  );
}
