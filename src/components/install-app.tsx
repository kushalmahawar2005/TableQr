"use client";

import { Cancel01Icon, Download04Icon, Share08Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";

// "Install the app" card for staff phones. Android and desktop Chrome hand us an install prompt;
// iPhones never do, so they get the two steps (Share, then Add to Home Screen). Hidden once the
// app is installed, and for a week after someone closes it.

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
const HIDE_KEY = "tq_install_hidden_until";

function hiddenForNow() {
  try {
    return Number(localStorage.getItem(HIDE_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

export function InstallApp({ className = "", name = "TableQR", logoUrl = null, compact = false }: { className?: string; name?: string; logoUrl?: string | null; compact?: boolean }) {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [show, setShow] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (installed || hiddenForNow()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallEvent);
      setShow(true);
    };
    const onInstalled = () => setShow(false);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // Keep the install entry visible even if Chromium fired before React hydrated, or the
    // browser does not expose a prompt event (desktop Safari and some managed browsers).
    // The click then gives browser-specific instructions instead of silently hiding the feature.
    const showTimer = window.setTimeout(() => setShow(true), 0);
    // iPhone and iPad Safari: no prompt event, so explain the Share menu instead
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIos) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the device is only known in the browser
      setIos(true);
      setShow(true);
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.clearTimeout(showTimer);
    };
  }, []);

  if (!show) return null;

  const close = () => {
    setShow(false);
    try {
      localStorage.setItem(HIDE_KEY, String(Date.now() + 7 * 86_400_000));
    } catch {
      // Storage blocked: it shows again next time, which is fine
    }
  };
  const install = async () => {
    if (!prompt) {
      setHelpOpen(true);
      return;
    }
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    setPrompt(null);
    if (outcome === "accepted") setShow(false);
  };

  const small = compact ? "text-[11px] leading-snug" : "text-caption";
  return (
    <div role="region" aria-label="Install the app" className={`rounded-card border border-line bg-surface p-3.5 shadow-[0_1px_3px_rgb(0_0_0/0.06)] ${compact ? "rounded-input p-2 shadow-none" : ""} ${className}`}>
      {/* Icon, title and close share the first row; the text and button below use the full card width, so a narrow card never squeezes them into one word per line */}
      <div className={`flex items-center ${compact ? "gap-2" : "gap-3"}`}>
        <span aria-hidden className={`grid shrink-0 place-items-center overflow-hidden rounded-input font-display font-bold text-brand-strong ${logoUrl ? "" : "border border-line bg-brand-soft"} ${compact ? "size-8 rounded-md text-sm" : "size-10 text-section"}`}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- tenant logos may be hosted on owner-controlled HTTPS origins
            <img src={logoUrl} alt="" className="size-full object-contain" />
          ) : name.trim().slice(0, 1).toUpperCase() || "T"}
        </span>
        <p className={`min-w-0 flex-1 break-words font-semibold text-ink ${compact ? "text-caption leading-snug" : "text-body leading-snug"}`}>Install {name} on this phone</p>
        <button type="button" onClick={close} aria-label="Not now" className={`grid shrink-0 place-items-center rounded-input text-muted hover:bg-ink/5 hover:text-ink ${compact ? "size-7" : "size-9"}`}>
          <HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden />
        </button>
      </div>
      {ios ? (
        <p className={`mt-2 text-muted ${small}`}>
          Tap <HugeiconsIcon icon={Share08Icon} size={14} className="inline align-[-2px]" aria-label="Share" /> Share, then <span className="font-semibold text-ink">Add to Home Screen</span>.
        </p>
      ) : (
        <>
          <p className={`mt-2 text-muted ${small}`}>Opens like an app, full screen, straight from your home screen.</p>
          <button type="button" onClick={() => void install()} className={`mt-2.5 inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-input bg-ink px-3.5 font-semibold text-white hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${compact ? "min-h-8 px-2 text-caption" : "min-h-10 text-body"}`}>
            <HugeiconsIcon icon={Download04Icon} size={18} aria-hidden className="shrink-0" />
            Install app
          </button>
        </>
      )}
      {helpOpen && !ios && <div role="status" className={`mt-2 rounded-lg bg-paper p-2 text-xs leading-relaxed text-muted ${compact ? "text-[11px]" : ""}`}>
        { /android/i.test(navigator.userAgent)
          ? "In Chrome, open ⋮ and choose Install app or Add to Home screen."
          : /iphone|ipad|ipod/i.test(navigator.userAgent)
            ? "Tap Share, then Add to Home Screen."
            : /safari/i.test(navigator.userAgent) && !/chrome|chromium|android/i.test(navigator.userAgent)
              ? "In Safari, choose File → Add to Dock."
              : "In Chrome, open ⋮ → Cast, save and share → Install page as app."}
      </div>}
    </div>
  );
}
