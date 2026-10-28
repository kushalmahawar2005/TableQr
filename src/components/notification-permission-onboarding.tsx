"use client";

import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import type { Lang } from "@/lib/i18n";
import { notificationSetupMode } from "@/lib/notification-onboarding";
import { enableStaffPushNotifications, serializePushSubscription } from "@/lib/staff-push-client";
import { pushSetupAction, savePushSubscriptionAction } from "@/app/(console)/console/(app)/_components/push-actions";

const SEEN_KEY = "tq_notification_setup_seen_v1";

/**
 * Ask for notification permission only on the first launch of the installed staff PWA.
 * Browsers require the permission request to follow a direct user action, so this is an
 * explainer with an explicit button rather than an automatic permission popup.
 */
export function NotificationPermissionOnboarding({ lang = "en", audience = "staff" }: { lang?: Lang; audience?: "staff" | "rider" }) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsPermission, setNeedsPermission] = useState(true);
  const hi = lang === "hi";

  useEffect(() => {
    const installed = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if ((!installed && !capacitor?.isNativePlatform?.()) || !("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window) || Notification.permission === "denied") return;
    let active = true;
    void pushSetupAction().then((config) => {
      if (!active || !config.enabled) return;
      if (Notification.permission === "granted") {
        let dismissed = false;
        try { dismissed = localStorage.getItem(SEEN_KEY) === "yes"; } catch { /* continue with session-only setup */ }
        void navigator.serviceWorker.getRegistration("/").then(async (registration) => {
          const subscription = await registration?.pushManager.getSubscription();
          if (subscription) {
            const saved = await savePushSubscriptionAction(serializePushSubscription(subscription));
            if (saved.ok) return;
            if (!active || dismissed) return;
            setNeedsPermission(false);
            setError(saved.error);
            setVisible(true);
            return;
          }
          if (!active || notificationSetupMode("granted", dismissed, false) === "hidden") return;
          setNeedsPermission(false);
          setVisible(true);
        }).catch(() => {});
        return;
      }
      let dismissed = false;
      try { dismissed = localStorage.getItem(SEEN_KEY) === "yes"; } catch { /* keep the prompt available if storage is blocked */ }
      if (notificationSetupMode(Notification.permission, dismissed, false) === "hidden") return;
      setNeedsPermission(true);
      setVisible(true);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(SEEN_KEY, "yes"); } catch { /* session-only dismissal */ }
    setVisible(false);
  };

  const enable = async () => {
    if (!("Notification" in window) || busy) return;
    setBusy(true);
    setError("");
    const result = await enableStaffPushNotifications();
    setBusy(false);
    if (result.ok) dismiss();
    else if (result.permission === "denied" || result.permission === "default") dismiss();
    else setError(result.error);
  };

  if (!visible) return null;

  return (
    <aside role="region" aria-label={hi ? "नोटिफिकेशन सेटअप" : "Notification setup"} className="mx-auto w-full max-w-screen-2xl px-4 pt-3 sm:px-6 print:hidden">
      <div className="flex w-full min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm sm:flex-row sm:items-center sm:gap-3 sm:px-5">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong">
            <BellRing className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="break-words font-semibold text-ink">{audience === "rider" ? (hi ? "नई डिलीवरी के अलर्ट पाएं" : "Get alerts for assigned deliveries") : (hi ? "नए ऑर्डर और अनुरोधों के अलर्ट पाएं" : "Get alerts for new orders and requests")}</p>
            <p className="mt-0.5 break-words text-sm text-muted">{audience === "rider" ? (needsPermission ? (hi ? "डिलीवरी मिलने पर स्क्रीन लॉक होने पर भी अलर्ट पाएं।" : "Get an alert when a delivery is assigned, even with your screen locked.") : (hi ? "नोटिफिकेशन चालू हैं। नई डिलीवरी का अलर्ट पाने के लिए सेटअप पूरा करें।" : "Notifications are allowed. Finish setup to receive delivery alerts.")) : needsPermission ? (hi ? "नए ऑर्डर और टेबल अनुरोधों के अलर्ट ऐप बंद होने पर भी पाएं।" : "Get alerts for new orders and table requests, even when the app is closed.") : (hi ? "इस फ़ोन पर नोटिफिकेशन चालू हैं। नए ऑर्डर अलर्ट सेटअप पूरा करें।" : "Notifications are allowed on this phone. Finish setting up new order alerts.")}</p>
            {error && <p role="alert" className="mt-1 break-words text-sm font-medium text-danger">{error}</p>}
          </div>
        </div>
        <div className="flex w-full min-w-0 items-center gap-2 sm:ml-auto sm:w-auto sm:shrink-0">
          <button type="button" disabled={busy} onClick={() => void enable()} className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-center rounded-xl bg-brand px-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:opacity-60 sm:flex-none">
            {busy ? (hi ? "एक पल…" : "One moment…") : needsPermission ? (hi ? "चालू करें" : "Enable notifications") : (hi ? "सेटअप पूरा करें" : "Finish setup")}
          </button>
          <button type="button" onClick={dismiss} aria-label={hi ? "अभी नहीं" : "Not now"} className="grid size-10 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-ink/5 hover:text-ink">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>
  );
}
