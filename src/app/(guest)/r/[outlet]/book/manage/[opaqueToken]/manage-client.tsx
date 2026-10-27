"use client";

import { useState } from "react";
import { useGuestBase } from "@/lib/guest-base";
import { useRouter } from "next/navigation";
import { arriveBookingAction, cancelBookingAction, lateBookingAction, rescheduleBookingAction } from "../../actions";

type Booking = { reference: string | null; name: string; startAt: number; partySize: number; status: string };

const outletLocalParts = (timestamp: number, timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(timestamp));
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? "00";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, time: `${value("hour")}:${value("minute")}` };
};

export function ManageBookingClient({ outletCode, token, booking, timezone, hindi: initialHindi = false }: { outletCode: string; token: string; timezone: string; hindi?: boolean; booking: Booking }) {
  const base = useGuestBase(outletCode);
  const router = useRouter();
  const [hindi, setHindi] = useState(initialHindi);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(() => outletLocalParts(booking.startAt, timezone).date);
  const [time, setTime] = useState(() => outletLocalParts(booking.startAt, timezone).time);
  const t = (en: string, hi: string) => hindi ? hi : en;
  const closed = ["cancelled", "no_show", "completed"].includes(booking.status);
  const setLanguage = () => {
    const next = !hindi;
    setHindi(next);
    router.replace(`${base}/book/manage/${encodeURIComponent(token)}?lang=${next ? "hi" : "en"}`, { scroll: false });
  };
  const cancel = async () => {
    setBusy(true);
    const result = await cancelBookingAction(outletCode, token);
    setBusy(false);
    setMessage(result.ok ? result.data.manualRefundNeedsRestaurant ? t("Booking cancelled. The restaurant will arrange your QR payment refund.", "बुकिंग रद्द हो गई। QR भुगतान का रिफंड रेस्टोरेंट से मिलेगा।") : result.data.freeCancellation ? t("Booking cancelled. Any eligible online advance refund will be processed.", "बुकिंग रद्द हो गई। ऑनलाइन अग्रिम का योग्य रिफंड प्रोसेस किया जाएगा।") : t("Booking cancelled. Contact the restaurant about any advance payment.", "बुकिंग रद्द हो गई। अग्रिम भुगतान के बारे में रेस्टोरेंट से संपर्क करें।") : result.message);
  };
  const late = async () => {
    setBusy(true);
    const result = await lateBookingAction(outletCode, token);
    setBusy(false);
    setMessage(result.ok ? t(`Late-arrival grace extended by ${result.data.minutes} minutes.`, `देर से आने की छूट ${result.data.minutes} मिनट बढ़ा दी गई है।`) : result.message);
  };
  const reschedule = async () => {
    setBusy(true);
    const result = await rescheduleBookingAction(outletCode, token, { localDateTime: `${date}T${time}` });
    setBusy(false);
    setMessage(result.ok ? t("Booking rescheduled.", "बुकिंग का समय बदल गया है।") : result.message);
  };
  const arrive = async () => {
    setBusy(true);
    const result = await arriveBookingAction(outletCode, token);
    setBusy(false);
    setMessage(result.ok ? t("Arrival marked. Please see the host to be seated.", "आपके पहुँचने की सूचना मिल गई। बैठने के लिए होस्ट से मिलें।") : result.message);
  };

  return <main lang={hindi ? "hi" : "en"} className="flex min-h-dvh w-full min-w-0 flex-col pt-5 pb-10 text-ink">
    <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-[.18em] text-muted">{t("Manage booking", "बुकिंग प्रबंधित करें")}</p><button type="button" onClick={setLanguage} className="min-h-9 rounded-full border border-line/70 bg-surface px-3.5 text-caption font-semibold shadow-[0_1px_3px_rgb(31_41_55/0.05)]">{hindi ? "English" : "हिन्दी"}</button></div>
    <h1 className="mt-2 font-display text-[1.875rem] leading-tight font-bold tracking-tight">{booking.reference}</h1>
    <div className="mt-6 rounded-[22px] border border-line/60 bg-surface p-4 shadow-[0_2px_12px_rgb(31_41_55/0.05)]"><p>{booking.name} · {booking.partySize} {t("guests", "मेहमान")}</p><p className="mt-2">{new Intl.DateTimeFormat(hindi ? "hi-IN-u-nu-latn" : "en-IN", { timeZone: timezone, dateStyle: "full", timeStyle: "short" }).format(new Date(booking.startAt))}</p><p className="mt-2 text-sm text-muted">{t("Status", "स्थिति")}: {t(booking.status, ({ confirmed: "पुष्ट", requested: "अनुरोधित", cancelled: "रद्द", no_show: "नहीं आए", completed: "पूरा" } as Record<string, string>)[booking.status] ?? booking.status)}</p><p className="mt-2 text-xs text-muted">{t("All booking times use the restaurant’s local time.", "बुकिंग का समय रेस्टोरेंट के स्थानीय समय के अनुसार है।")}</p></div>
    <div className="mt-5 grid gap-3"><div className="grid grid-cols-2 gap-2"><label className="text-sm font-semibold">{t("New date", "नई तारीख")}<input type="date" value={date} onChange={event => setDate(event.target.value)} className="mt-1 min-h-12 w-full rounded-2xl border border-line/70 bg-paper px-3 outline-none focus:border-brand" /></label><label className="text-sm font-semibold">{t("New time", "नया समय")}<input type="time" value={time} onChange={event => setTime(event.target.value)} className="mt-1 min-h-12 w-full rounded-2xl border border-line/70 bg-paper px-3 outline-none focus:border-brand" /></label></div>
      <button disabled={busy || booking.status !== "confirmed"} onClick={() => void arrive()} className="min-h-12 rounded-xl bg-brand px-4 font-semibold text-brand-on">{t("I have arrived", "मैं पहुँच गया/गई हूँ")}</button>
      <button disabled={busy || closed} onClick={() => void reschedule()} className="min-h-12 rounded-2xl border border-line/70 bg-surface px-4 font-semibold shadow-[0_1px_3px_rgb(31_41_55/0.05)] hover:border-ink/30">{t("Change booking time", "बुकिंग का समय बदलें")}</button>
      <button disabled={busy || closed} onClick={() => void late()} className="min-h-12 rounded-2xl border border-line/70 bg-surface px-4 font-semibold shadow-[0_1px_3px_rgb(31_41_55/0.05)] hover:border-ink/30">{t("I am arriving late (+10 minutes)", "मुझे देर हो रही है (+10 मिनट)")}</button>
      <button disabled={busy || closed} onClick={() => void cancel()} className="min-h-12 rounded-xl bg-danger px-4 font-semibold text-white">{t("Cancel booking", "बुकिंग रद्द करें")}</button>
    </div>
    {message && <p role="status" className="mt-4 rounded-xl bg-paper p-3 text-sm">{message}</p>}
  </main>;
}
