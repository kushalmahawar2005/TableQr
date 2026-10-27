"use client";
import { Camera, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { shrinkPhotoFile } from "@/lib/shrink-photo";
import type { MyMonth } from "@/server/attendance/register";
import type { AttendanceStatus } from "@/lib/attendance";
import { meAction, savePhotoAction } from "../actions";

// The waiter's own page: their photo, whether today is marked, and the month at a glance

const TONE: Record<AttendanceStatus, { bg: string; fg: string; en: string; hi: string; short: string }> = {
  present: { bg: "var(--state-available)", fg: "#fff", en: "Present", hi: "उपस्थित", short: "P" },
  half_day: { bg: "var(--state-held)", fg: "#fff", en: "Half day", hi: "आधा दिन", short: "½" },
  absent: { bg: "var(--danger, #c0392b)", fg: "#fff", en: "Absent", hi: "अनुपस्थित", short: "A" },
  leave: { bg: "var(--state-cleaning, #5b6bd6)", fg: "#fff", en: "Leave", hi: "छुट्टी", short: "L" },
  week_off: { bg: "color-mix(in srgb, var(--ink) 18%, transparent)", fg: "var(--ink)", en: "Week off", hi: "साप्ताहिक छुट्टी", short: "W" },
};

const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export function MyProfile({ name, subtitle, hi, preview = false }: { name: string; subtitle: string; hi: boolean; preview?: boolean }) {
  const L = (en: string, h: string) => (hi ? h : en);
  const [photo, setPhoto] = useState<string | null>(null);
  const [att, setAtt] = useState<MyMonth | null>(null);
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (preview) return;
    let live = true;
    void meAction(month).then((r) => { if (!live) return; if (r.ok) { setPhoto(r.data.photoUrl); setAtt(r.data.attendance); } else setError(r.error); });
    return () => { live = false; };
  }, [month, preview]);

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setError(null);
    const form = new FormData();
    form.set("photo", await shrinkPhotoFile(f));
    const r = await savePhotoAction(form);
    setBusy(false);
    if (r.ok) setPhoto(r.data.photoUrl); else setError(r.error);
  };

  const card = "rounded-2xl border border-line bg-surface p-4";
  const today = att?.todayStatus ? TONE[att.todayStatus] : null;
  // Monday-first calendar: blanks before the 1st
  const lead = att ? (new Date(`${att.days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7 : 0;
  const monthName = att ? new Date(`${att.month}-01T00:00:00Z`).toLocaleDateString(hi ? "hi-IN" : "en-IN", { month: "long", year: "numeric", timeZone: "UTC" }) : "";

  return (
    <>
      <div className={`${card} flex items-center gap-4`}>
        <button type="button" onClick={() => file.current?.click()} disabled={busy || preview} aria-label={L("Change photo", "फ़ोटो बदलें")} className="relative size-16 shrink-0 rounded-full">
          {/* Staff photos live in the photo bucket, so this stays a plain image */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photo ? <img src={photo} alt="" className="size-16 rounded-full object-cover" /> : <span className="grid size-16 place-items-center rounded-full bg-brand-soft font-display text-3xl font-bold text-brand-strong">{name.trim().slice(0, 1).toUpperCase()}</span>}
          <span className="absolute -right-0.5 -bottom-0.5 grid size-7 place-items-center rounded-full border-2 border-surface bg-ink text-paper">{busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Camera className="size-3.5" aria-hidden="true" />}</span>
        </button>
        <input ref={file} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
        <div className="min-w-0"><h2 className="truncate font-display text-xl font-bold">{name}</h2><p className="text-sm text-muted">{subtitle}</p>{!photo && <p className="mt-0.5 text-xs font-semibold text-brand-strong">{L("Tap to add your photo", "अपनी फ़ोटो जोड़ने के लिए टैप करें")}</p>}</div>
      </div>
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}

      <div className={card}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-lg font-bold">{L("Today's attendance", "आज की हाज़िरी")}</h3>
          {att && <span className="rounded-full px-3 py-1 text-sm font-bold" style={today ? { background: today.bg, color: today.fg } : undefined}>{today ? (hi ? today.hi : today.en) : <span className="text-muted">{L("Not marked yet", "अभी नहीं लगी")}</span>}</span>}
        </div>
        {att && !today && <p className="mt-1 text-sm text-muted">{L("Your manager marks attendance. Ask them if it is missing.", "हाज़िरी मैनेजर लगाते हैं। नहीं लगी हो तो उनसे पूछें।")}</p>}
      </div>

      <div className={card}>
        <div className="flex items-center justify-between gap-2">
          <button type="button" aria-label={L("Previous month", "पिछला महीना")} onClick={() => att && setMonth(shiftMonth(att.month, -1))} className="grid size-10 place-items-center rounded-xl border border-line"><ChevronLeft className="size-5" aria-hidden="true" /></button>
          <h3 className="font-display text-lg font-bold">{monthName || L("This month", "इस महीने")}</h3>
          <button type="button" aria-label={L("Next month", "अगला महीना")} disabled={!att || att.month >= att.today.slice(0, 7)} onClick={() => att && setMonth(shiftMonth(att.month, 1))} className="grid size-10 place-items-center rounded-xl border border-line disabled:opacity-30"><ChevronRight className="size-5" aria-hidden="true" /></button>
        </div>
        {!att ? <div className="grid h-40 place-items-center"><Loader2 className="size-6 animate-spin text-muted" aria-hidden="true" /></div> : <>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-[var(--state-available-soft)] p-2"><p className="font-display text-2xl font-bold tabular text-[var(--state-available-text)]">{att.counts.daysWorked}</p><p className="text-xs font-semibold text-muted">{L("Days worked", "काम के दिन")}</p></div>
            <div className="rounded-xl bg-ink/5 p-2"><p className="font-display text-2xl font-bold tabular">{att.counts.absent}</p><p className="text-xs font-semibold text-muted">{L("Absent", "अनुपस्थित")}</p></div>
            <div className="rounded-xl bg-ink/5 p-2"><p className="font-display text-2xl font-bold tabular">{att.counts.leave + att.counts.week_off}</p><p className="text-xs font-semibold text-muted">{L("Leave / off", "छुट्टी")}</p></div>
          </div>
          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted">{(hi ? ["सो", "मं", "बु", "गु", "शु", "श", "र"] : ["M", "T", "W", "T", "F", "S", "S"]).map((d, i) => <span key={i}>{d}</span>)}</div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
            {att.days.map(({ date, status }) => {
              const tone = status ? TONE[status] : null, future = date > att.today, isToday = date === att.today;
              return <span key={date} title={tone ? (hi ? tone.hi : tone.en) : undefined} className={`grid aspect-square place-items-center rounded-lg text-xs font-bold tabular ${isToday ? "ring-2 ring-ink" : ""} ${future ? "text-muted/40" : tone ? "" : "bg-ink/5 text-muted"}`} style={tone && !future ? { background: tone.bg, color: tone.fg } : undefined}>{Number(date.slice(8))}</span>;
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">{(Object.keys(TONE) as AttendanceStatus[]).map((k) => <span key={k} className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full" style={{ background: TONE[k].bg }} />{hi ? TONE[k].hi : TONE[k].en}{att.counts[k] ? ` ${att.counts[k]}` : ""}</span>)}</div>
        </>}
      </div>
    </>
  );
}
