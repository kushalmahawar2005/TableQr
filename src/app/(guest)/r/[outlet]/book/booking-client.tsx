"use client";

import { Alert02Icon, ArrowLeft01Icon, Calendar03Icon, CheckmarkCircle02Icon, Clock01Icon, MinusSignIcon, PartyIcon, PlusSignIcon, Sofa01Icon, Timer02Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { useGuestBase } from "@/lib/guest-base";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { availabilityAction, groupRequestAction, holdAction } from "./actions";

const addDate = (key: string, days: number) => { const date = new Date(`${key}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const money = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;
type Slot = { startAt: number; available: boolean; creditRequiredPaise: number; reason: string; alternatives: number[] };
const PARTS = [["Morning", "सुबह", 0, 12], ["Afternoon", "दोपहर", 12, 17], ["Evening", "शाम", 17, 21], ["Night", "रात", 21, 24]] as const;
const cancellationText = (minutes: number, hindi: boolean) => minutes === 0 ? (hindi ? "रेस्टोरेंट की रद्दीकरण नीति लागू होगी।" : "The restaurant’s cancellation policy applies.") : hindi ? `बुकिंग से ${minutes < 60 ? `${minutes} मिनट` : `${minutes / 60} घंटे`} पहले तक मुफ़्त रद्दीकरण।` : `Free cancellation up to ${minutes < 60 ? `${minutes} minutes` : `${minutes / 60} hours`} before your reservation.`;

/** Times grouped by part of the day; times already gone (too soon or outside the booking window) are left out */
function SlotGroups({ slots, selected, busy, onSelect, hindi, timezone }: { slots: Slot[]; selected: number | null; busy: boolean; onSelect: (at: number) => void; hindi: boolean; timezone: string }) {
  const open = slots.filter(s => s.reason !== "cutoff" && s.reason !== "outside_window");
  if (!open.length) return <p className="mt-3 flex items-start gap-2 rounded-2xl bg-paper p-4 text-caption text-muted"><HugeiconsIcon icon={Calendar03Icon} size={18} className="mt-px shrink-0" aria-hidden />{hindi ? "इस तारीख के लिए समय उपलब्ध नहीं है। कृपया कोई और दिन चुनें।" : "No times are left for this date. Please pick another day."}</p>;
  return <div className="mt-4 grid gap-5">{PARTS.map(([name, hindiName, from, to]) => {
    const part = open.filter(s => { const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(new Date(s.startAt))); return h >= from && h < to; });
    if (!part.length) return null;
    return <div key={name}>
      <p className="text-label font-semibold tracking-[.12em] text-muted uppercase">{hindi ? hindiName : name}</p>
      <div className="mt-2 grid grid-cols-3 gap-2">{part.map(slot => {
        const on = selected === slot.startAt;
        return <button type="button" key={slot.startAt} disabled={!slot.available || busy} onClick={() => onSelect(slot.startAt)} aria-pressed={on}
          className={`min-h-12 rounded-2xl border-2 px-1 py-1.5 text-center transition-[border-color,background-color,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.97] disabled:cursor-not-allowed ${on ? "border-brand bg-brand text-brand-on shadow-[0_6px_16px_-6px_var(--brand-border)]" : slot.available ? "border-line/70 bg-surface text-ink hover:border-ink/30" : "border-transparent bg-paper text-muted line-through decoration-muted/50"}`}>
          <span className="block text-body font-bold tabular">{new Intl.DateTimeFormat(hindi ? "hi-IN-u-nu-latn" : "en-IN", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(slot.startAt))}</span>
          {!slot.available ? <span className="block text-label no-underline">{hindi ? "भर गया" : "Full"}</span> : slot.creditRequiredPaise ? <span className={`block text-label ${on ? "text-brand-on/85" : "text-muted"}`}>{hindi ? "अग्रिम" : "Advance"} {money(slot.creditRequiredPaise)}</span> : null}
        </button>;
      })}</div>
    </div>;
  })}</div>;
}

/** One white card per question, with an icon and a title */
function Card({ icon, title, aside, children }: { icon: IconSvgElement; title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return <section className="mt-4 rounded-[22px] border border-line/60 bg-surface p-4 shadow-[0_2px_12px_rgb(31_41_55/0.05)] min-[380px]:p-5">
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2.5 text-body font-bold"><span aria-hidden className="grid size-8 place-items-center rounded-lg bg-brand-soft text-brand-strong"><HugeiconsIcon icon={icon} size={17} /></span>{title}</h2>
      {aside}
    </div>
    {children}
  </section>;
}

const field = "min-h-12 w-full rounded-2xl border border-line/70 bg-paper px-4 text-body text-ink outline-none placeholder:text-muted/80 focus:border-brand focus:bg-surface focus:shadow-[0_0_0_3px_var(--brand-soft)]";

export function BookingClient({ outletCode, zones, timezone, today, freeCancellationMinutes, hindi: initialHindi = false }: { outletCode: string; zones: { id: string; name: string }[]; timezone: string; today: string; freeCancellationMinutes: number; hindi?: boolean }) {
  const base = useGuestBase(outletCode);
  const router = useRouter();
  const [hindi, setHindi] = useState(initialHindi);
  const t = (en: string, hi: string) => hindi ? hi : en;
  const lang = hindi ? "hi" : "en";
  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDate(today, i)), [today]);
  const [party, setParty] = useState(2);
  const [date, setDate] = useState(dates[0]);
  const [zoneId, setZoneId] = useState("");
  const [data, setData] = useState<{ slots: Slot[] } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const availabilityRequest = useRef(0);
  const [groupName, setGroupName] = useState(""); const [groupPhone, setGroupPhone] = useState(""); const [groupNotes, setGroupNotes] = useState(""); const [groupRef, setGroupRef] = useState(""); const [groupTime, setGroupTime] = useState("19:00");
  const load = async (nextDate = date, nextParty = party, nextZoneId = zoneId) => {
    const request = ++availabilityRequest.current;
    setBusy(true); setError(null); setData(null); setSelected(null);
    try {
      const result = await availabilityAction(outletCode, { date: nextDate, partySize: nextParty, zoneId: nextZoneId || null });
      if (request !== availabilityRequest.current) return;
      if (result.ok) setData(result.data);
      else setError(result.message);
    } catch {
      if (request === availabilityRequest.current) setError(t("Could not load times. Check your connection and try again.", "समय लोड नहीं हुए। कनेक्शन जाँचकर फिर कोशिश करें।"));
    } finally {
      if (request === availabilityRequest.current) setBusy(false);
    }
  };
  const chooseDate = (d: string) => { setDate(d); void load(d, party, zoneId); };
  const chooseParty = (n: number) => { setParty(n); if (n <= 12) void load(date, n, zoneId); else { availabilityRequest.current += 1; setBusy(false); setData(null); setSelected(null); setError(null); } };
  const continueBooking = async () => {
    if (selected == null || !data) return;
    setBusy(true); setError(null);
    try {
      const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      const holdToken = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      const result = await holdAction(outletCode, { date, startAt: selected, partySize: party, requestId, holdToken, zoneId: zoneId || null });
      if (result.ok) router.push(`${base}/book/details?token=${encodeURIComponent(String(result.data.manageToken))}&ref=${encodeURIComponent(String(result.data.publicReference ?? ""))}&lang=${lang}`);
      else setError(result.message);
    } catch {
      setError(t("Could not hold this time. Check your connection and try again.", "यह समय बुक नहीं हो पाया। कनेक्शन जाँचकर फिर कोशिश करें।"));
    } finally { setBusy(false); }
  };
  const submitGroup = async () => {
    setBusy(true); setError(null);
    try {
      const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      const result = await groupRequestAction(outletCode, { requestId, name: groupName, phone: groupPhone, partySize: party, desiredDate: date, desiredLocalDateTime: `${date}T${groupTime}`, notes: groupNotes });
      if (result.ok) setGroupRef(result.data.publicReference);
      else setError(result.message);
    } catch {
      setError(t("Could not send the enquiry. Check your connection and try again.", "पूछताछ नहीं भेजी जा सकी। कनेक्शन जाँचकर फिर कोशिश करें।"));
    } finally { setBusy(false); }
  };
  const dayParts = (d: string) => {
    const at = new Date(`${d}T12:00:00Z`);
    const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(hindi ? "hi-IN-u-nu-latn" : "en-IN", { timeZone: timezone, ...o }).format(at);
    return { week: d === dates[0] ? t("Today", "आज") : d === dates[1] ? t("Tomorrow", "कल") : f({ weekday: "short" }), day: f({ day: "numeric" }), month: f({ month: "short" }) };
  };
  const selectedLabel = selected != null ? new Intl.DateTimeFormat(hindi ? "hi-IN-u-nu-latn" : "en-IN", { timeZone: timezone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(selected)) : null;
  const switchLanguage = (next: boolean) => { if (next === hindi) return; setHindi(next); router.replace(`${base}/book?lang=${next ? "hi" : "en"}`, { scroll: false }); };

  return <main lang={lang} className="flex min-h-dvh w-full min-w-0 flex-col pt-5 pb-32 text-ink">
    <div className="flex items-center justify-between gap-3">
      <Link href={`${base}`} className="relative -ml-1 inline-flex items-center gap-0.5 rounded-full px-1 py-0.5 text-caption font-semibold text-muted before:absolute before:-inset-2.5 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand">
        <HugeiconsIcon icon={ArrowLeft01Icon} size={16} strokeWidth={2} aria-hidden />{t("Back", "वापस")}
      </Link>
      <div role="group" aria-label={t("Language", "भाषा")} className="flex rounded-full border border-line/70 bg-surface p-0.5 text-caption font-semibold shadow-[0_1px_3px_rgb(31_41_55/0.05)]">
        {/* On an English page the "हिं" label uses the phone's own font, so it does not pull the 70 KB Hindi web font before the page can paint */}
        {([[false, "EN"], [true, "हिं"]] as const).map(([hi, label]) => <button key={label} type="button" aria-pressed={hindi === hi} onClick={() => switchLanguage(hi)} className={`min-h-9 min-w-11 rounded-full px-3 transition-colors ${hindi === hi ? "bg-ink text-white" : "text-muted hover:text-ink"}`}><span className={hi && !hindi ? "font-[system-ui]" : undefined}>{label}</span></button>)}
      </div>
    </div>

    <h1 className="mt-6 font-display text-[1.875rem] leading-tight font-bold tracking-tight">{t("Book a table", "टेबल बुक करें")}</h1>
    <p className="mt-1.5 text-body text-muted">{t("Pick your guests, day and time.", "मेहमान, दिन और समय चुनें।")}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-label font-semibold text-ink ring-1 ring-line/70"><HugeiconsIcon icon={Timer02Icon} size={14} className="text-brand" aria-hidden />{t("Table held for 5 minutes", "टेबल 5 मिनट के लिए रुकेगी")}</span>
      {party <= 12 && freeCancellationMinutes > 0 && <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-label font-semibold text-ink ring-1 ring-line/70"><HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} className="text-success" aria-hidden />{t("Free cancellation", "मुफ़्त रद्दीकरण")}</span>}
    </div>

    {error && <p role="alert" className="mt-4 flex items-start gap-2.5 rounded-2xl border border-danger/20 bg-[var(--state-seated-soft)] p-4 text-caption font-semibold text-danger"><HugeiconsIcon icon={Alert02Icon} size={18} className="mt-px shrink-0" aria-hidden />{error}</p>}

    <Card icon={UserGroupIcon} title={t("Guests", "मेहमान")}>
      <div className="mt-4 flex items-center justify-between rounded-2xl bg-paper p-2">
        <button type="button" aria-label={t("Fewer guests", "कम मेहमान")} disabled={party <= 1} onClick={() => chooseParty(Math.max(1, party - 1))} className="grid size-12 place-items-center rounded-xl bg-surface text-ink shadow-[0_1px_3px_rgb(31_41_55/0.08)] transition-transform active:scale-95 disabled:opacity-40"><HugeiconsIcon icon={MinusSignIcon} size={20} strokeWidth={2.2} aria-hidden /></button>
        <span aria-live="polite" className="text-center"><span className="block font-display text-[1.75rem] leading-none font-bold tabular">{party}</span><span className="mt-1 block text-label text-muted">{party > 12 ? t("Event enquiry", "कार्यक्रम की पूछताछ") : party === 1 ? t("guest", "मेहमान") : t("guests", "मेहमान")}</span></span>
        <button type="button" aria-label={t("More guests", "ज़्यादा मेहमान")} onClick={() => chooseParty(party + 1)} className="grid size-12 place-items-center rounded-xl bg-brand text-brand-on shadow-[0_4px_12px_-2px_var(--brand-border)] transition-transform active:scale-95"><HugeiconsIcon icon={PlusSignIcon} size={20} strokeWidth={2.2} aria-hidden /></button>
      </div>
      {party > 12 && <p className="mt-3 rounded-2xl bg-brand-soft/60 p-3 text-caption text-ink">{t("For 13 or more guests, send an enquiry so the restaurant can confirm arrangements with you.", "13 या अधिक मेहमानों के लिए पूछताछ भेजें ताकि रेस्टोरेंट व्यवस्था की पुष्टि कर सके।")}</p>}
    </Card>

    <Card icon={Calendar03Icon} title={t("Date", "तारीख")}>
      <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] min-[380px]:-mx-5 min-[380px]:px-5">{dates.map(d => {
        const on = date === d; const p = dayParts(d);
        return <button type="button" key={d} onClick={() => chooseDate(d)} aria-pressed={on} className={`flex min-w-[68px] shrink-0 flex-col items-center rounded-2xl border-2 px-2 py-2.5 transition-[border-color,background-color,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.97] ${on ? "border-brand bg-brand text-brand-on shadow-[0_6px_16px_-6px_var(--brand-border)]" : "border-line/70 bg-surface text-ink hover:border-ink/30"}`}>
          <span className={`text-label font-semibold ${on ? "text-brand-on/85" : "text-muted"}`}>{p.week}</span>
          <span className="mt-0.5 font-display text-[1.375rem] leading-tight font-bold tabular">{p.day}</span>
          <span className={`text-label ${on ? "text-brand-on/85" : "text-muted"}`}>{p.month}</span>
        </button>;
      })}</div>
    </Card>

    {zones.length > 0 && <Card icon={Sofa01Icon} title={t("Seating preference", "बैठने की पसंद")}>
      <div role="group" aria-label={t("Seating preference", "बैठने की पसंद")} className="mt-4 flex flex-wrap gap-2">{[{ id: "", name: t("No preference", "कोई पसंद नहीं") }, ...zones].map(zone => {
        const on = zoneId === zone.id;
        return <button key={zone.id || "any"} type="button" aria-pressed={on} onClick={() => { setZoneId(zone.id); if (data || busy) void load(date, party, zone.id); }} className={`min-h-10 rounded-full border px-4 text-caption font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${on ? "border-ink bg-ink text-white" : "border-line/70 bg-surface text-ink hover:border-ink/30"}`}>{zone.name}</button>;
      })}</div>
    </Card>}

    {party <= 12 && <Card icon={Clock01Icon} title={t("Time", "समय")} aside={busy ? <span role="status" className="text-caption text-muted">{t("Checking…", "जाँच रहे हैं…")}</span> : undefined}>
      {!data && <button type="button" disabled={busy} onClick={() => void load()} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-border bg-brand-soft/40 px-4 text-body font-bold text-brand-strong transition-colors hover:bg-brand-soft disabled:opacity-60"><HugeiconsIcon icon={Clock01Icon} size={18} aria-hidden />{busy ? t("Checking…", "जाँच रहे हैं…") : t("Show available times", "उपलब्ध समय देखें")}</button>}
      {data && <SlotGroups slots={data.slots} selected={selected} busy={busy} onSelect={setSelected} hindi={hindi} timezone={timezone} />}
      {data?.slots.find(x => x.startAt === selected)?.alternatives.length ? <p className="mt-3 text-caption text-muted">{t("Nearest alternatives are shown as available times.", "नज़दीकी उपलब्ध समय भी दिखाए गए हैं।")}</p> : null}
    </Card>}

    {party > 12 && <Card icon={PartyIcon} title={t("Large group or event", "बड़ा समूह या कार्यक्रम")}>
      <p className="mt-2 text-caption text-muted">{t("Send an enquiry for 13 or more guests. The restaurant will call to confirm space, end time and any event terms.", "13 या अधिक मेहमानों के लिए पूछताछ भेजें। रेस्टोरेंट जगह, समय और ज़रूरी शर्तों की पुष्टि के लिए कॉल करेगा।")}</p>
      {groupRef ? <p className="mt-4 flex items-start gap-2.5 rounded-2xl bg-[var(--state-available-soft)] p-4 text-caption text-ink"><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} className="mt-px shrink-0 text-success" aria-hidden /><span>{t("Enquiry sent. The restaurant will contact you to confirm the details. No booking or payment has been taken. Reference:", "पूछताछ भेज दी गई है। रेस्टोरेंट विवरण की पुष्टि के लिए संपर्क करेगा। अभी कोई बुकिंग या भुगतान नहीं हुआ है। संदर्भ:")} <strong>{groupRef}</strong></span></p> : <div className="mt-4 grid gap-3">
        <label className="text-caption font-semibold text-muted">{t("Preferred start time", "पसंदीदा शुरू होने का समय")}<input aria-label={t("Preferred event start time", "कार्यक्रम शुरू होने का पसंदीदा समय")} type="time" value={groupTime} onChange={e => setGroupTime(e.target.value)} className={`${field} mt-1.5`} /></label>
        <input aria-label={t("Group request name", "समूह का नाम")} value={groupName} onChange={e => setGroupName(e.target.value)} placeholder={t("Your name", "आपका नाम")} className={field} />
        <input aria-label={t("Group request phone", "फोन नंबर")} type="tel" inputMode="tel" value={groupPhone} onChange={e => setGroupPhone(e.target.value)} placeholder={t("Phone number", "फोन नंबर")} className={field} />
        <textarea aria-label={t("Group request notes", "समूह की जानकारी")} value={groupNotes} onChange={e => setGroupNotes(e.target.value)} placeholder={t("Tell us about the occasion, preferred end time or any needs (optional)", "कार्यक्रम, पसंदीदा समाप्ति समय या ज़रूरी बात बताएँ (वैकल्पिक)")} className={`${field} min-h-24 py-3`} />
        <button type="button" disabled={busy || !groupName || !groupPhone} onClick={() => void submitGroup()} className="min-h-13 rounded-2xl bg-brand px-4 text-button font-bold text-brand-on shadow-[0_8px_20px_-6px_var(--brand-border)] disabled:opacity-50 disabled:shadow-none">{t("Send event enquiry", "कार्यक्रम की पूछताछ भेजें")}</button>
      </div>}
    </Card>}

    {party <= 12 && <p className="mt-5 text-center text-label text-muted">{cancellationText(freeCancellationMinutes, hindi)}</p>}

    {/* Stays at the bottom with what has been picked so far */}
    {party <= 12 && <div className="fixed inset-x-0 bottom-[var(--guest-nav-height)] z-30 mx-auto max-w-[480px] border-t border-line/70 bg-surface/95 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgb(31_41_55/0.08)] backdrop-blur-md min-[380px]:px-5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-label text-muted">{party} {party === 1 ? t("guest", "मेहमान") : t("guests", "मेहमान")}</p>
          <p className="truncate text-body font-bold">{selectedLabel ?? t("Pick a time", "समय चुनें")}</p>
        </div>
        <button type="button" disabled={!selected || busy} onClick={() => void continueBooking()} className="min-h-12 shrink-0 rounded-2xl bg-brand px-6 text-button font-bold text-brand-on shadow-[0_8px_20px_-6px_var(--brand-border)] transition-transform active:scale-[0.98] disabled:bg-line disabled:text-muted disabled:shadow-none">{busy ? t("Working…", "प्रक्रिया जारी है…") : t("Continue", "आगे बढ़ें")}</button>
      </div>
    </div>}
  </main>;
}
