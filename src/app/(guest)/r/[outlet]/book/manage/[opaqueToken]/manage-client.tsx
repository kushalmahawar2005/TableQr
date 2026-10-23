"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { arriveBookingAction, cancelBookingAction, lateBookingAction, rescheduleBookingAction } from "../../actions";

type Booking = { reference: string | null; name: string; startAt: number; partySize: number; status: string };

export function ManageBookingClient({ outletCode, token, booking, hindi: initialHindi = false }: { outletCode: string; token: string; hindi?: boolean; booking: Booking }) {
  const router = useRouter();
  const [hindi, setHindi] = useState(initialHindi);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(new Date(booking.startAt).toISOString().slice(0, 10));
  const [time, setTime] = useState(new Date(booking.startAt).toTimeString().slice(0, 5));
  const t = (en: string, hi: string) => hindi ? hi : en;
  const closed = ["cancelled", "no_show", "completed"].includes(booking.status);
  const setLanguage = () => {
    const next = !hindi;
    setHindi(next);
    router.replace(`/r/${encodeURIComponent(outletCode)}/book/manage/${encodeURIComponent(token)}?lang=${next ? "hi" : "en"}`, { scroll: false });
  };
  const cancel = async () => {
    setBusy(true);
    const result = await cancelBookingAction(outletCode, token);
    setBusy(false);
    setMessage(result.ok ? t("Booking cancelled. Refund status will follow the booking-credit policy.", "बुकिंग रद्द हो गई। रिफंड की स्थिति अग्रिम राशि की नीति के अनुसार अपडेट होगी।") : result.message);
  };
  const late = async () => {
    setBusy(true);
    const result = await lateBookingAction(outletCode, token);
    setBusy(false);
    setMessage(result.ok ? t(`Late-arrival grace extended by ${result.data.minutes} minutes.`, `देर से आने की छूट ${result.data.minutes} मिनट बढ़ा दी गई है।`) : result.message);
  };
  const reschedule = async () => {
    const startAt = Date.parse(`${date}T${time}`);
    if (!Number.isFinite(startAt)) return;
    setBusy(true);
    const result = await rescheduleBookingAction(outletCode, token, { date, startAt });
    setBusy(false);
    setMessage(result.ok ? t("Booking rescheduled.", "बुकिंग का समय बदल गया है।") : result.message);
  };
  const arrive = async () => {
    setBusy(true);
    const result = await arriveBookingAction(outletCode, token);
    setBusy(false);
    setMessage(result.ok ? t("Arrival marked. Please see the host to be seated.", "आपके पहुँचने की सूचना मिल गई। बैठने के लिए होस्ट से मिलें।") : result.message);
  };

  return <main lang={hindi ? "hi" : "en"} className="mx-auto min-h-dvh max-w-[520px] px-5 py-10 text-ink">
    <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-[.18em] text-muted">{t("Manage booking", "बुकिंग प्रबंधित करें")}</p><button type="button" onClick={setLanguage} className="min-h-11 rounded-xl border border-line px-3 text-sm font-semibold">{hindi ? "English" : "हिन्दी"}</button></div>
    <h1 className="mt-2 font-display text-3xl font-bold">{booking.reference}</h1>
    <div className="mt-6 rounded-2xl border border-line bg-surface p-5"><p>{booking.name} · {booking.partySize} {t("guests", "मेहमान")}</p><p className="mt-2">{new Date(booking.startAt).toLocaleString(hindi ? "hi-IN-u-nu-latn" : "en-IN", { dateStyle: "full", timeStyle: "short" })}</p><p className="mt-2 text-sm text-muted">{t("Status", "स्थिति")}: {t(booking.status, ({ confirmed: "पुष्ट", requested: "अनुरोधित", cancelled: "रद्द", no_show: "नहीं आए", completed: "पूरा" } as Record<string, string>)[booking.status] ?? booking.status)}</p></div>
    <div className="mt-5 grid gap-3"><div className="grid grid-cols-2 gap-2"><label className="text-sm font-semibold">{t("New date", "नई तारीख")}<input type="date" value={date} onChange={event => setDate(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-line px-2" /></label><label className="text-sm font-semibold">{t("New time", "नया समय")}<input type="time" value={time} onChange={event => setTime(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-line px-2" /></label></div>
      <button disabled={busy || booking.status !== "confirmed"} onClick={() => void arrive()} className="min-h-12 rounded-xl bg-brand px-4 font-semibold text-brand-on">{t("I have arrived", "मैं पहुँच गया/गई हूँ")}</button>
      <button disabled={busy || closed} onClick={() => void reschedule()} className="min-h-12 rounded-xl border border-line px-4 font-semibold">{t("Change booking time", "बुकिंग का समय बदलें")}</button>
      <button disabled={busy || closed} onClick={() => void late()} className="min-h-12 rounded-xl border border-line px-4 font-semibold">{t("I am arriving late (+10 minutes)", "मुझे देर हो रही है (+10 मिनट)")}</button>
      <button disabled={busy || closed} onClick={() => void cancel()} className="min-h-12 rounded-xl bg-danger px-4 font-semibold text-white">{t("Cancel booking", "बुकिंग रद्द करें")}</button>
    </div>
    {message && <p role="status" className="mt-4 rounded-xl bg-paper p-3 text-sm">{message}</p>}
  </main>;
}
