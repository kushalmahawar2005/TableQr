"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { availabilityAction, groupRequestAction, holdAction } from "./actions";

const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const money = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;
type Slot = { startAt: number; available: boolean; creditRequiredPaise: number; reason: string; alternatives: number[] };
const PARTS = [["Morning", "सुबह", 0, 12], ["Afternoon", "दोपहर", 12, 17], ["Evening", "शाम", 17, 21], ["Night", "रात", 21, 24]] as const;

/** Times grouped by part of the day; times already gone (too soon or outside the booking window) are left out */
function SlotGroups({ slots, selected, busy, onSelect, hindi }: { slots: Slot[]; selected: number | null; busy: boolean; onSelect: (at: number) => void; hindi: boolean }) {
  const open = slots.filter(s => s.reason !== "cutoff" && s.reason !== "outside_window");
  if (!open.length) return <p className="mt-3 rounded-xl bg-paper p-3 text-sm text-muted">{hindi ? "इस तारीख के लिए समय उपलब्ध नहीं है। कृपया कोई और दिन चुनें।" : "No times are left for this date. Please pick another day."}</p>;
  return <div className="mt-3 grid gap-4">{PARTS.map(([name, hindiName, from, to]) => {
    const part = open.filter(s => { const h = new Date(s.startAt).getHours(); return h >= from && h < to; });
    if (!part.length) return null;
    return <div key={name}><p className="text-xs font-semibold uppercase tracking-wide text-muted">{hindi ? hindiName : name}</p><div className="mt-2 grid grid-cols-3 gap-2">{part.map(slot => <button type="button" key={slot.startAt} disabled={!slot.available || busy} onClick={() => onSelect(slot.startAt)} className={`min-h-12 rounded-xl border px-1 text-center text-sm ${selected === slot.startAt ? "border-brand bg-brand-soft font-semibold text-brand-strong" : slot.available ? "border-line" : "border-line bg-paper text-muted"}`}><span className="block font-semibold">{new Intl.DateTimeFormat(hindi ? "hi-IN-u-nu-latn" : "en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date(slot.startAt))}</span>{!slot.available ? <span className="block text-xs">{hindi ? "भर गया" : "Full"}</span> : slot.creditRequiredPaise ? <span className="block text-xs">{hindi ? "अग्रिम" : "Credit"} {money(slot.creditRequiredPaise)}</span> : null}</button>)}</div></div>;
  })}</div>;
}

export function BookingClient({ outletCode, zones, hindi: initialHindi = false }: { outletCode: string; zones: { id: string; name: string }[]; hindi?: boolean }) {
  const router = useRouter();
  const [hindi, setHindi] = useState(initialHindi);
  const t = (en: string, hi: string) => hindi ? hi : en;
  const lang = hindi ? "hi" : "en";
  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + i); return dateKey(d); }), []);
  const [party, setParty] = useState(2);
  const [date, setDate] = useState(dates[0]);
  const [zoneId, setZoneId] = useState("");
  const [data, setData] = useState<{ slots: Slot[] } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [groupName, setGroupName] = useState(""); const [groupPhone, setGroupPhone] = useState(""); const [groupNotes, setGroupNotes] = useState(""); const [groupRef, setGroupRef] = useState(""); const [groupTime, setGroupTime] = useState("19:00");
  const load = async (nextDate = date, nextParty = party) => { setBusy(true); const r = await availabilityAction(outletCode, { date: nextDate, partySize: nextParty, zoneId: zoneId || null }); if (r.ok) setData(r.data); setSelected(null); setBusy(false); };
  const chooseDate = (d: string) => { setDate(d); void load(d, party); };
  const chooseParty = (n: number) => { setParty(n); if (n <= 12) void load(date, n); else { setData(null); setSelected(null); } };
  const continueBooking = async () => {
    if (selected == null || !data) return;
    setBusy(true);
    const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const holdToken = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const r = await holdAction(outletCode, { date, startAt: selected, partySize: party, requestId, holdToken, zoneId: zoneId || null });
    setBusy(false);
    if (r.ok) router.push(`/r/${encodeURIComponent(outletCode)}/book/details?token=${encodeURIComponent(String(r.data.manageToken))}&ref=${encodeURIComponent(String(r.data.publicReference ?? ""))}&lang=${lang}`);
    else alert(r.message);
  };
  const submitGroup = async () => { setBusy(true); const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`; const r = await groupRequestAction(outletCode, { requestId, name: groupName, phone: groupPhone, partySize: party, desiredDate: date, desiredStartAt: Date.parse(`${date}T${groupTime}:00`), notes: groupNotes }); setBusy(false); if (r.ok) setGroupRef(r.data.publicReference); else alert(r.message); };
  return <main lang={lang} className="mx-auto min-h-dvh max-w-[520px] px-5 py-8 text-ink"><Link href={`/r/${encodeURIComponent(outletCode)}`} className="inline-flex min-h-11 items-center py-2 text-sm font-semibold text-brand-strong">← {t("Back to restaurant", "रेस्टोरेंट पर वापस जाएँ")}</Link><div className="flex items-start justify-between gap-3"><div><p className="mt-2 text-xs font-semibold uppercase tracking-[.18em] text-muted">{t("TableQR booking", "TableQR बुकिंग")}</p><h1 className="mt-2 font-display text-3xl font-bold">{t("Book a table", "टेबल बुक करें")}</h1><p className="mt-2 text-sm text-muted">{t("Choose a time and we will hold the table for five minutes.", "समय चुनें, हम आपकी टेबल पाँच मिनट के लिए रोकेंगे।")}</p></div><button type="button" onClick={() => { const next = !hindi; setHindi(next); router.replace(`/r/${encodeURIComponent(outletCode)}/book?lang=${next ? "hi" : "en"}`, { scroll: false }); }} className="mt-2 min-h-11 shrink-0 rounded-xl border border-line px-3 py-2 text-sm font-semibold">{hindi ? "English" : "हिन्दी"}</button></div>
    <section className="mt-7 rounded-2xl border border-line bg-surface p-4"><h2 className="font-semibold">{t("Guests", "मेहमान")}</h2><div className="mt-3 flex items-center gap-4"><button type="button" aria-label={t("Fewer guests", "कम मेहमान")} disabled={party <= 1} onClick={() => chooseParty(Math.max(1, party - 1))} className="grid size-11 place-items-center rounded-full border border-line text-xl">−</button><span className="min-w-12 text-center text-2xl font-bold tabular">{party}</span><button type="button" aria-label={t("More guests", "ज़्यादा मेहमान")} onClick={() => chooseParty(party + 1)} className="grid size-11 place-items-center rounded-full border border-line text-xl">+</button><span className="text-sm text-muted">{party > 12 ? t("Event enquiry", "कार्यक्रम की पूछताछ") : t("guests", "मेहमान")}</span></div>{party > 12 && <p className="mt-3 rounded-xl bg-paper p-3 text-sm">{t("For 13 or more guests, send an enquiry so the restaurant can confirm arrangements with you.", "13 या अधिक मेहमानों के लिए पूछताछ भेजें ताकि रेस्टोरेंट व्यवस्था की पुष्टि कर सके।")}</p>}</section>
    <section className="mt-4 rounded-2xl border border-line bg-surface p-4"><h2 className="font-semibold">{t("Date", "तारीख")}</h2><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{dates.map(d => <button type="button" key={d} onClick={() => chooseDate(d)} className={`min-h-11 rounded-xl border px-2 text-sm ${date === d ? "border-brand bg-brand-soft font-semibold" : "border-line"}`}>{new Intl.DateTimeFormat(hindi ? "hi-IN-u-nu-latn" : "en-IN", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${d}T12:00:00`))}</button>)}</div></section>
    <section className="mt-4 rounded-2xl border border-line bg-surface p-4"><label className="font-semibold" htmlFor="seat-pref">{t("Seating preference", "बैठने की पसंद")}</label><select id="seat-pref" value={zoneId} onChange={e => { setZoneId(e.target.value); if (data) void load(date, party); }} className="mt-3 min-h-11 w-full rounded-xl border border-line bg-paper px-3"><option value="">{t("No preference", "कोई पसंद नहीं")}</option>{zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></section>
    {party <= 12 && <section className="mt-4 rounded-2xl border border-line bg-surface p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">{t("Time", "समय")}</h2>{busy && <span className="text-sm text-muted">{t("Checking…", "जाँच रहे हैं…")}</span>}</div>{!data && <button type="button" onClick={() => void load()} className="mt-3 min-h-11 w-full rounded-xl bg-brand px-4 font-semibold text-brand-on">{t("Show available times", "उपलब्ध समय देखें")}</button>}{data && <SlotGroups slots={data.slots} selected={selected} busy={busy} onSelect={setSelected} hindi={hindi} />}{data?.slots.find(x => x.startAt === selected)?.alternatives.length ? <p className="mt-3 text-sm text-muted">{t("Nearest alternatives are shown as available times.", "नज़दीकी उपलब्ध समय भी दिखाए गए हैं।")}</p> : null}</section>}
    {party > 12 ? <section className="mt-4 rounded-2xl border border-line bg-surface p-4"><h2 className="font-semibold">{t("Large group or event", "बड़ा समूह या कार्यक्रम")}</h2><p className="mt-1 text-sm text-muted">{t("Send an enquiry for 13 or more guests. The restaurant will call to confirm space, end time and any event terms.", "13 या अधिक मेहमानों के लिए पूछताछ भेजें। रेस्टोरेंट जगह, समय और ज़रूरी शर्तों की पुष्टि के लिए कॉल करेगा।")}</p>{groupRef ? <p className="mt-3 rounded-xl bg-brand-soft p-3">{t("Enquiry sent. The restaurant will contact you to confirm the details. No booking or payment has been taken. Reference:", "पूछताछ भेज दी गई है। रेस्टोरेंट विवरण की पुष्टि के लिए संपर्क करेगा। अभी कोई बुकिंग या भुगतान नहीं हुआ है। संदर्भ:")} <strong>{groupRef}</strong></p> : <div className="mt-3 grid gap-3"><label className="text-sm font-semibold">{t("Preferred start time", "पसंदीदा शुरू होने का समय")}<input aria-label={t("Preferred event start time", "कार्यक्रम शुरू होने का पसंदीदा समय")} type="time" value={groupTime} onChange={e => setGroupTime(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-line px-3" /></label><input aria-label={t("Group request name", "समूह का नाम")} value={groupName} onChange={e => setGroupName(e.target.value)} placeholder={t("Your name", "आपका नाम")} className="min-h-11 rounded-xl border border-line px-3" /><input aria-label={t("Group request phone", "फोन नंबर")} value={groupPhone} onChange={e => setGroupPhone(e.target.value)} placeholder={t("Phone number", "फोन नंबर")} className="min-h-11 rounded-xl border border-line px-3" /><textarea aria-label={t("Group request notes", "समूह की जानकारी")} value={groupNotes} onChange={e => setGroupNotes(e.target.value)} placeholder={t("Tell us about the occasion, preferred end time or any needs (optional)", "कार्यक्रम, पसंदीदा समाप्ति समय या ज़रूरी बात बताएँ (वैकल्पिक)")} className="min-h-20 rounded-xl border border-line px-3 py-2" /><button type="button" disabled={busy || !groupName || !groupPhone} onClick={() => void submitGroup()} className="min-h-12 rounded-xl bg-brand px-4 font-semibold text-brand-on">{t("Send event enquiry", "कार्यक्रम की पूछताछ भेजें")}</button></div>}</section> : <button type="button" disabled={!selected || busy} onClick={() => void continueBooking()} className="mt-6 min-h-12 w-full rounded-xl bg-brand px-4 font-semibold text-brand-on disabled:opacity-50">{busy ? t("Working…", "प्रक्रिया जारी है…") : t("Continue", "आगे बढ़ें")}</button>}
    {party <= 12 && <p className="mt-4 text-center text-xs text-muted">{t("Free cancellation up to two hours before your reservation.", "बुकिंग से दो घंटे पहले तक मुफ़्त रद्दीकरण उपलब्ध है।")}</p>}
  </main>;
}
