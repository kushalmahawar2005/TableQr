"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { availabilityAction, groupRequestAction, holdAction } from "./actions";

const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const label = (date: string) => new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00`));
const money = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;
type Slot = { startAt: number; available: boolean; creditRequiredPaise: number; reason: string; alternatives: number[] };

export function BookingClient({ outletCode, zones }: { outletCode: string; zones: { id: string; name: string }[] }) {
  const router = useRouter();
  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + i); return dateKey(d); }), []);
  const [party, setParty] = useState(2);
  const [date, setDate] = useState(dates[0]);
  const [zoneId, setZoneId] = useState("");
  const [data, setData] = useState<{ slots: Slot[] } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [groupName, setGroupName] = useState(""); const [groupPhone, setGroupPhone] = useState(""); const [groupNotes, setGroupNotes] = useState(""); const [groupRef, setGroupRef] = useState("");
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
    if (r.ok) router.push(`/r/${encodeURIComponent(outletCode)}/book/details?token=${encodeURIComponent(String(r.data.manageToken))}&ref=${encodeURIComponent(String(r.data.publicReference ?? ""))}`);
    else alert(r.message);
  };
  const submitGroup = async () => { setBusy(true); const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`; const r = await groupRequestAction(outletCode, { requestId, name: groupName, phone: groupPhone, partySize: party, desiredDate: date, desiredStartAt: selected ?? Date.parse(`${date}T19:00:00`), notes: groupNotes }); setBusy(false); if (r.ok) setGroupRef(r.data.publicReference); else alert(r.message); };
  return <main className="mx-auto min-h-dvh max-w-[520px] px-5 py-8 text-ink"><p className="text-xs font-semibold uppercase tracking-[.18em] text-muted">TableQR booking</p><h1 className="mt-2 font-display text-3xl font-bold">Book a table</h1><p className="mt-2 text-sm text-muted">Choose a time and we will hold the table for five minutes.</p>
    <section className="mt-7 rounded-2xl border border-line bg-surface p-4"><h2 className="font-semibold">Guests</h2><div className="mt-3 flex items-center gap-4"><button type="button" aria-label="Fewer guests" disabled={party <= 1} onClick={() => chooseParty(Math.max(1, party - 1))} className="grid size-11 place-items-center rounded-full border border-line text-xl">−</button><span className="min-w-12 text-center text-2xl font-bold tabular">{party}</span><button type="button" aria-label="More guests" onClick={() => chooseParty(party + 1)} className="grid size-11 place-items-center rounded-full border border-line text-xl">+</button><span className="text-sm text-muted">{party > 12 ? "Group request" : "guests"}</span></div>{party > 12 && <p className="mt-3 rounded-xl bg-paper p-3 text-sm">Parties above 12 need a group request. Please contact the restaurant.</p>}</section>
    <section className="mt-4 rounded-2xl border border-line bg-surface p-4"><h2 className="font-semibold">Date</h2><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{dates.map(d => <button type="button" key={d} onClick={() => chooseDate(d)} className={`min-h-11 rounded-xl border px-2 text-sm ${date === d ? "border-brand bg-brand-soft font-semibold" : "border-line"}`}>{label(d)}</button>)}</div></section>
    <section className="mt-4 rounded-2xl border border-line bg-surface p-4"><label className="font-semibold" htmlFor="seat-pref">Seating preference</label><select id="seat-pref" value={zoneId} onChange={e => { setZoneId(e.target.value); if (data) void load(date, party); }} className="mt-3 min-h-11 w-full rounded-xl border border-line bg-paper px-3"><option value="">No preference</option>{zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></section>
    {party <= 12 && <section className="mt-4 rounded-2xl border border-line bg-surface p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">Time</h2>{busy && <span className="text-sm text-muted">Checking…</span>}</div>{!data && <button type="button" onClick={() => void load()} className="mt-3 min-h-11 w-full rounded-xl bg-brand px-4 font-semibold text-brand-on">Show available times</button>}{data && <div className="mt-3 grid grid-cols-2 gap-2">{data.slots.map(slot => <button type="button" key={slot.startAt} disabled={!slot.available || busy} onClick={() => setSelected(slot.startAt)} className={`min-h-12 rounded-xl border px-2 text-left text-sm ${selected === slot.startAt ? "border-brand bg-brand-soft" : slot.available ? "border-line" : "border-line bg-paper text-muted"}`}><span className="block font-semibold">{new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date(slot.startAt))}</span><span>{slot.available ? slot.creditRequiredPaise ? `Credit ${money(slot.creditRequiredPaise)}` : "Available" : slot.reason === "cutoff" ? "Closed for online booking" : "Full"}</span></button>)}{data.slots.length === 0 && <p className="col-span-2 rounded-xl bg-paper p-3 text-sm text-muted">No slots are available for this date.</p>}</div>}{data?.slots.find(x => x.startAt === selected)?.alternatives.length ? <p className="mt-3 text-sm text-muted">Nearest alternatives are shown as available times.</p> : null}</section>}
    {party > 12 ? <section className="mt-4 rounded-2xl border border-line bg-surface p-4"><h2 className="font-semibold">Group request</h2>{groupRef ? <p className="mt-3 rounded-xl bg-brand-soft p-3">Request received. Reference: <strong>{groupRef}</strong></p> : <div className="mt-3 grid gap-3"><input aria-label="Group request name" value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Name" className="min-h-11 rounded-xl border border-line px-3" /><input aria-label="Group request phone" value={groupPhone} onChange={e => setGroupPhone(e.target.value)} placeholder="Phone" className="min-h-11 rounded-xl border border-line px-3" /><textarea aria-label="Group request notes" value={groupNotes} onChange={e => setGroupNotes(e.target.value)} placeholder="Notes (optional)" className="min-h-20 rounded-xl border border-line px-3 py-2" /><button type="button" disabled={busy || !groupName || !groupPhone} onClick={() => void submitGroup()} className="min-h-12 rounded-xl bg-brand px-4 font-semibold text-brand-on">Send group request</button></div>}</section> : <button type="button" disabled={!selected || busy} onClick={() => void continueBooking()} className="mt-6 min-h-12 w-full rounded-xl bg-brand px-4 font-semibold text-brand-on disabled:opacity-50">Continue</button>}
    <p className="mt-4 text-center text-xs text-muted">Free cancellation up to two hours before your reservation.</p>
  </main>;
}
