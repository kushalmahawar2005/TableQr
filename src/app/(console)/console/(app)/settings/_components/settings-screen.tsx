"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Check, CheckCircle2, Circle, ClipboardList, Clock, Copy, CreditCard, Lock, Plus, Receipt, Store, Wallet, X, type LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OutletSettings } from "@/server/staff/settings-read";
import { saveSettingsAction } from "../actions";

const DAYS = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]] as const;
const MODE: Record<string, string> = { open: "Open: anyone who scans can order", verified: "Verified: guests confirm their phone number first", host_confirmed: "Host confirms: staff approve each table" };
const TIP_OPTIONS = [5, 10, 15, 20];
// Left-hand list of sections; "hours" is also the target of the setup guide's link
const NAV = [
  ["restaurant", "Restaurant", Store], ["tax", "Tax and licences", Receipt], ["bill", "Bill and tips", Wallet],
  ["orders", "Orders", ClipboardList], ["hours", "Opening hours", Clock], ["plan", "Plan", CreditCard],
] as const;
type Hours = Record<string, [string, string][]>;

const emptyHours = (): Hours => Object.fromEntries(DAYS.map(([k]) => [k, []]));
const fieldCls = "h-11 rounded-xl";

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${on ? "border-brand bg-brand" : "border-line bg-ink/10"}`}>
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? "left-[1.375rem]" : "left-0.5"}`} />
    </button>
  );
}

function Section({ id, icon: Icon, title, desc, action, children }: { id: string; icon: LucideIcon; title: string; desc: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 overflow-hidden rounded-2xl border border-line bg-surface">
      <header className={`flex items-start justify-between gap-3 px-5 py-4 ${children ? "border-b border-line" : ""}`}>
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ink/5 text-ink"><Icon className="size-4" aria-hidden="true" /></span>
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="font-display text-section font-bold text-ink">{title}</h2>
            <p className="text-sm text-muted">{desc}</p>
          </div>
        </div>
        {action}
      </header>
      {children && <div className="divide-y divide-line px-5">{children}</div>}
    </section>
  );
}

// One setting: what it is on the left, the control on the right (stacked on phones)
function Row({ label, hint, htmlFor, children }: { label: string; hint?: React.ReactNode; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] sm:items-center sm:gap-6">
      <div className="min-w-0">
        {htmlFor ? <Label htmlFor={htmlFor} className="text-sm font-semibold text-ink">{label}</Label> : <p className="text-sm font-semibold text-ink">{label}</p>}
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Fixed({ children }: { children: React.ReactNode }) {
  return <p className="flex items-center gap-1.5 text-sm font-semibold text-ink sm:justify-end"><Lock className="size-3.5 text-muted" aria-hidden="true" />{children}</p>;
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
  const [copied, setCopied] = useState(false);
  const [activeId, setActiveId] = useState<string>(NAV[0][0]);

  // What is on screen against what was last saved, so the save bar can say if anything changed
  const snapshot = JSON.stringify({ city, address, gstin, fssai, sc, tips, auto, review, hours: hoursOn ? hours : null });
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
  const dirty = snapshot !== savedSnapshot;

  const setDay = (d: string, ranges: [string, string][]) => setHours((h) => ({ ...h, [d]: ranges }));
  const scNum = sc.trim() === "" ? 0 : Number(sc);

  const checklist = [
    ["GST number", !!o.gstin, "tax"], ["FSSAI licence", !!o.fssai, "tax"], ["Opening hours", !!o.openingHours, "hours"], ["Review link", !!o.reviewUrl, "orders"],
  ] as const;
  const done = checklist.filter(([, v]) => v).length;

  // Light up the section in the left list that is at the top of the screen
  useEffect(() => {
    const seen = new IntersectionObserver((entries) => {
      const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setActiveId(top.target.id);
    }, { rootMargin: "-80px 0px -60% 0px" });
    NAV.forEach(([id]) => { const el = document.getElementById(id); if (el) seen.observe(el); });
    return () => seen.disconnect();
  }, []);

  function copyCode() {
    try { void navigator.clipboard.writeText(o.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard may be blocked; the code stays on screen */ }
  }

  function save() {
    setMsg(null);
    if (!Number.isFinite(scNum) || scNum < 0 || scNum > 20) return setMsg({ ok: false, text: "Service charge must be between 0 and 20." });
    const sent = snapshot;
    start(async () => {
      const res = await saveSettingsAction({
        city, address, gstin, fssai,
        serviceChargeBp: Math.round(scNum * 100),
        tipPresetsBp: tips.map((t) => Math.round(t * 100)),
        autoAcceptOrders: auto, reviewUrl: review,
        openingHours: hoursOn ? hours : null,
      });
      setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.message });
      if (res.ok) { setSavedSnapshot(sent); router.refresh(); }
    });
  }

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pt-7">
      <header>
        <p className="text-caption font-semibold text-muted">{o.name}</p>
        <h1 className="mt-1 font-display text-title font-bold text-ink">Settings</h1>
        <p className="mt-1 text-body text-muted">{canEdit ? "Change your restaurant details here. Name, code and plan are managed by TableQR." : "View only. Only the owner can change settings."}</p>
      </header>

      {done < checklist.length && (
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-brand-border bg-brand-soft/40 px-5 py-4">
          <div className="min-w-0">
            <p className="font-display text-section font-bold">Finish your setup <span className="text-muted">· {done}/{checklist.length}</span></p>
            <div className="mt-2 h-1.5 w-48 max-w-full rounded-full bg-ink/10"><div className="h-full rounded-full bg-brand" style={{ width: `${(done / checklist.length) * 100}%` }} /></div>
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
            {checklist.map(([k, v, to]) => <li key={k}><a href={`#${to}`} className={`flex items-center gap-1.5 ${v ? "text-muted" : "font-semibold hover:underline"}`}>{v ? <CheckCircle2 className="size-4 text-[#16a34a]" aria-hidden="true" /> : <Circle className="size-4 text-muted" aria-hidden="true" />}{k}</a></li>)}
          </ul>
        </div>
      )}

      <nav aria-label="Settings sections" className="-mx-4 mt-5 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:hidden">
        {NAV.map(([id, label]) => <a key={id} href={`#${id}`} className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold ${activeId === id ? "border-ink bg-ink text-paper" : "border-line text-muted hover:text-ink"}`}>{label}</a>)}
      </nav>

      <div className="mt-4 grid gap-6 lg:mt-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="hidden lg:block">
          <ul className="sticky top-20 space-y-0.5">
            {NAV.map(([id, label, Icon]) => (
              <li key={id}>
                <a href={`#${id}`} aria-current={activeId === id ? "true" : undefined} className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${activeId === id ? "bg-ink/[0.06] text-ink" : "text-muted hover:bg-ink/[0.03] hover:text-ink"}`}>
                  <Icon className="size-4" aria-hidden="true" />{label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-4">
          <Section id="restaurant" icon={Store} title="Restaurant" desc="Shown on bills and the guest page.">
            <Row label="Name" hint="Changed by TableQR."><Fixed>{o.name}</Fixed></Row>
            <Row label="Outlet code" hint="Your team types this to sign in.">
              <div className="flex items-center gap-2 sm:justify-end">
                <span className="font-mono text-sm font-semibold text-ink">{o.code}</span>
                <button type="button" onClick={copyCode} aria-label="Copy outlet code" className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-line px-2 text-xs font-semibold hover:border-ink/40">{copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}{copied ? "Copied" : "Copy"}</button>
              </div>
            </Row>
            <Row label="Time zone"><Fixed>{o.timezone}</Fixed></Row>
            <Row label="City" htmlFor="city"><Input id="city" className={fieldCls} value={city} onChange={(e) => setCity(e.target.value)} disabled={!canEdit} /></Row>
            <Row label="Address" htmlFor="address" hint="Printed at the top of the bill."><Input id="address" className={fieldCls} value={address} onChange={(e) => setAddress(e.target.value)} disabled={!canEdit} /></Row>
          </Section>

          <Section id="tax" icon={Receipt} title="Tax and licences" desc="Printed on every bill.">
            <Row label="GST number (GSTIN)" htmlFor="gstin" hint="15 characters. Leave empty if you don't have GST."><Input id="gstin" className={`${fieldCls} font-mono uppercase`} maxLength={15} placeholder="08ABCDE1234F1Z5" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} disabled={!canEdit} /></Row>
            <Row label="FSSAI licence number" htmlFor="fssai" hint="14 digits from your food licence."><Input id="fssai" className={`${fieldCls} font-mono`} inputMode="numeric" maxLength={14} placeholder="14 digits" value={fssai} onChange={(e) => setFssai(e.target.value.replace(/\D/g, ""))} disabled={!canEdit} /></Row>
          </Section>

          <Section id="bill" icon={Wallet} title="Bill and tips" desc="What guests see when they pay.">
            <Row label="Service charge" htmlFor="sc" hint={scNum > 0 ? `${scNum}% is added to every bill. Guests can ask staff to remove it.` : "Off. Nothing extra is added."}>
              <div className="relative">
                <Input id="sc" className={`${fieldCls} pr-9`} inputMode="decimal" placeholder="0 = off" value={sc} onChange={(e) => setSc(e.target.value)} disabled={!canEdit} />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm font-semibold text-muted">%</span>
              </div>
            </Row>
            <Row label="Tip choices" hint={tips.length ? `Guests will see ${tips.map((t) => `${t}%`).join(", ")}.` : "No tip choices. Guests can still type their own."}>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                {TIP_OPTIONS.map((t) => {
                  const on = tips.includes(t);
                  return <button key={t} type="button" disabled={!canEdit} aria-pressed={on} onClick={() => setTips((x) => (on ? x.filter((v) => v !== t) : [...x, t].sort((a, b) => a - b)))} className={`min-h-10 min-w-14 rounded-full border px-4 text-sm font-semibold disabled:opacity-60 ${on ? "border-ink bg-ink text-paper" : "border-line hover:border-ink/40"}`}>{t}%</button>;
                })}
              </div>
            </Row>
          </Section>

          <Section id="orders" icon={ClipboardList} title="Orders" desc="How new orders reach the kitchen.">
            <Row label="Accept orders automatically" hint={auto ? "Orders go straight to the kitchen." : "Staff accept each order first."}>
              <div className="flex sm:justify-end"><Toggle on={auto} onChange={setAuto} label="Accept orders automatically" disabled={!canEdit} /></div>
            </Row>
            <Row label="Table mode" hint="Changed by TableQR."><Fixed>{MODE[o.sessionMode] ?? o.sessionMode}</Fixed></Row>
            <Row label="Google review link" htmlFor="review" hint="Guests see this after paying."><Input id="review" className={fieldCls} type="url" placeholder="https://g.page/r/…" value={review} onChange={(e) => setReview(e.target.value)} disabled={!canEdit} /></Row>
          </Section>

          <Section id="hours" icon={Clock} title="Opening hours" desc={hoursOn ? "Set when you are open each day." : "Not set. Turn on to add your timings."} action={<Toggle on={hoursOn} onChange={setHoursOn} label="Set opening hours" disabled={!canEdit} />}>
            {hoursOn && DAYS.map(([k, label], i) => {
              const ranges = hours[k] ?? [];
              const open = ranges.length > 0;
              return (
                <div key={k} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                  <div className="flex w-36 items-center gap-3"><Toggle on={open} onChange={(v) => setDay(k, v ? [["12:00", "23:00"]] : [])} label={`${label} open`} disabled={!canEdit} /><span className="text-sm font-semibold">{label}</span></div>
                  {open ? (
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      {ranges.map(([a, b], n) => (
                        <span key={n} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-background px-2 py-1">
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
                </div>
              );
            })}
          </Section>

          <Section id="plan" icon={CreditCard} title="Plan and setup" desc="Managed by TableQR.">
            <dl className="grid grid-cols-3 divide-x divide-line py-4">
              {[["Plan", o.plan || "—"], ["Tables", String(o.tables)], ["Team members", String(o.staff)]].map(([k, v]) => <div key={k} className="min-w-0 px-4 first:pl-0"><dt className="text-xs text-muted">{k}</dt><dd className="truncate font-display text-section font-bold">{v}</dd></div>)}
            </dl>
          </Section>
        </div>
      </div>

      {canEdit && (
        <div className="fixed inset-x-3 bottom-3 z-20 mx-auto flex max-w-[1100px] items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3 shadow-lg lg:left-[calc(var(--sidebar-width,16rem)+0.75rem)] lg:right-3 lg:mx-0 lg:max-w-none">
          <p role={msg?.ok === false ? "alert" : "status"} className={`flex min-w-0 items-center gap-2 text-sm font-semibold ${msg ? (msg.ok ? "text-[#16a34a]" : "text-danger") : "text-muted"}`}>
            {!msg && <span className={`size-2 shrink-0 rounded-full ${dirty ? "bg-brand" : "bg-[var(--state-available)]"}`} aria-hidden="true" />}
            {msg && !(msg.ok && dirty) ? msg.text : dirty ? "You have changes that are not saved" : "Everything is saved"}
          </p>
          <button type="button" disabled={pending || !dirty} onClick={save} className="inline-flex h-11 shrink-0 items-center rounded-xl border border-brand bg-brand px-6 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50">{pending ? "Saving…" : "Save changes"}</button>
        </div>
      )}
    </main>
  );
}
