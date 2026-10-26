"use client";
import { useEffect, useState } from "react";
import { enableGuestPush, guestPushSupported } from "@/lib/guest-push-client";
import { bookingPushAction, bookingPushKeyAction } from "../actions";

/** "Remind me on this phone": a push the day before and two hours before the booking */
export function BookingPushOffer({ outlet, token, hindi }: { outlet: string; token: string; hindi: boolean }) {
  const t = (en: string, hi: string) => (hindi ? hi : en);
  const [state, setState] = useState<"idle" | "busy" | "on" | "blocked" | "hidden">("hidden");
  // Decided after the page loads, since the server cannot know what this browser supports
  useEffect(() => { queueMicrotask(() => setState(!guestPushSupported() ? "hidden" : Notification.permission === "denied" ? "blocked" : "idle")); }, []);
  if (state === "hidden") return null;
  if (state === "on") return <p className="mt-4 rounded-2xl bg-[var(--state-available-soft)] px-4 py-3 text-caption font-semibold text-[var(--state-available-text)]">🔔 {t("We will remind you on this phone.", "हम इस फ़ोन पर याद दिलाएँगे।")}</p>;
  if (state === "blocked") return <p className="mt-4 rounded-2xl bg-ink/5 px-4 py-3 text-caption text-muted">{t("Notifications are blocked for this site. Allow them in your browser settings to get reminders.", "इस साइट की सूचनाएँ बंद हैं। रिमाइंडर के लिए ब्राउज़र सेटिंग में अनुमति दें।")}</p>;
  return (
    <button type="button" disabled={state === "busy"} onClick={() => { setState("busy"); void enableGuestPush(bookingPushKeyAction, (sub) => bookingPushAction(outlet, token, sub)).then((r) => setState(r.ok ? "on" : r.error === "blocked" ? "blocked" : r.error === "off" || r.error === "unsupported" ? "hidden" : "idle")); }}
      className="mt-4 flex w-full items-center gap-3 rounded-[22px] border border-brand/30 bg-brand-soft/50 p-4 text-left disabled:opacity-60">
      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-lg text-brand-on">🔔</span>
      <span className="min-w-0 flex-1"><span className="block text-body font-bold">{state === "busy" ? t("Turning on…", "चालू कर रहे हैं…") : t("Remind me on this phone", "इस फ़ोन पर याद दिलाएँ")}</span><span className="block text-caption text-muted">{t("The day before and two hours before your table.", "एक दिन पहले और टेबल से दो घंटे पहले।")}</span></span>
    </button>
  );
}
