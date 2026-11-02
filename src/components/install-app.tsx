"use client";

import { Cancel01Icon, Download04Icon, Share08Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";

// "Install the app" card. Chrome, Edge and Samsung Internet hand us an install prompt only while the
// app is NOT installed, so on those browsers the card shows only when that prompt arrives: someone
// who already installed it never sees the card, even when they open the link in the browser.
// iPhones never send a prompt, so they get the two steps (Share, then Add to Home Screen). Never
// shown inside the installed app or the Android rider app, and hidden for a while after "Not now".

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
const HIDE_KEY = "tq_install_hidden_until";

// The prompt can arrive before React is ready; catch it as soon as this file loads
let earlyPrompt: InstallEvent | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); earlyPrompt = e as InstallEvent; });
  window.addEventListener("appinstalled", () => { earlyPrompt = null; });
}

/** Already running as the app: the installed web app, or the Android app's built-in browser */
function runningAsApp() {
  const native = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
  // Android app screens (WebView) carry "; wv)" in their user agent; Chrome itself never does
  const webView = /; wv\)/.test(navigator.userAgent);
  return native || webView || window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function hiddenForNow(key = HIDE_KEY) {
  try {
    return Number(localStorage.getItem(key) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

export function InstallApp({ className = "", name = "Tableeqr", logoUrl = null, compact = false, pill = false, title, blurb, guest = false, downloadHref }: { /** A small button for a top bar, instead of the card */ pill?: boolean; className?: string; name?: string; logoUrl?: string | null; compact?: boolean; title?: string; blurb?: string; /** A customer page: its own "not now", and only for a day */ guest?: boolean; /** A native app to download instead of installing this site (the rider's Android app) */ downloadHref?: string }) {
  const hideKey = guest ? "tq_guest_install_hidden_until" : HIDE_KEY;
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [show, setShow] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    // "Not now" on a card hides that card; the small top-bar button has no close, so it ignores it
    if (runningAsApp() || (!pill && hiddenForNow(hideKey))) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallEvent);
      setShow(true);
    };
    const onInstalled = () => { setPrompt(null); setShow(false); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // Caught before React was ready
    const caught = earlyPrompt;
    // Browsers with no install prompt (iPhone, Safari, Firefox) cannot say whether the app is
    // installed, so they get the card with the manual steps; prompt browsers wait for the prompt
    const promptBrowser = "onbeforeinstallprompt" in window;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    queueMicrotask(() => {
      // A download link works on every browser; it only hides inside the app
      if (downloadHref) setShow(true);
      else if (caught) { setPrompt(caught); setShow(true); }
      else if (isIos) { setIos(true); setShow(true); }
      else if (!promptBrowser) setShow(true);
    });
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [hideKey, downloadHref, pill]);

  if (!show) return null;

  const close = () => {
    setShow(false);
    try {
      localStorage.setItem(hideKey, String(Date.now() + (guest ? 1 : 7) * 86_400_000));
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

  if (pill) return (
    <div className="relative">
      <button type="button" onClick={() => void install()} className={className}><HugeiconsIcon icon={Download04Icon} size={16} aria-hidden className="shrink-0" />Install</button>
      {helpOpen && <p role="status" className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-border bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-xl">{ios ? "Tap Share, then Add to Home Screen." : "Open your browser menu and choose Install app or Add to Home screen."}</p>}
    </div>
  );

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
        <p className={`min-w-0 flex-1 break-words font-semibold text-ink ${compact ? "text-caption leading-snug" : "text-body leading-snug"}`}>{title ?? `Install ${name} on this phone`}</p>
        <button type="button" onClick={close} aria-label="Not now" className={`grid shrink-0 place-items-center rounded-input text-muted hover:bg-ink/5 hover:text-ink ${compact ? "size-7" : "size-9"}`}>
          <HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden />
        </button>
      </div>
      {downloadHref ? (
        <>
          <p className={`mt-2 text-muted ${small}`}>{blurb ?? "Get the Android app for live location and delivery alerts."}</p>
          <a href={downloadHref} className={`mt-2.5 inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-input bg-ink px-3.5 font-semibold text-white hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${compact ? "min-h-8 px-2 text-caption" : "min-h-10 text-body"}`}>
            <HugeiconsIcon icon={Download04Icon} size={18} aria-hidden className="shrink-0" />
            Download app
          </a>
        </>
      ) : ios ? (
        <p className={`mt-2 text-muted ${small}`}>
          Tap <HugeiconsIcon icon={Share08Icon} size={14} className="inline align-[-2px]" aria-label="Share" /> Share, then <span className="font-semibold text-ink">Add to Home Screen</span>.
        </p>
      ) : (
        <>
          <p className={`mt-2 text-muted ${small}`}>{blurb ?? "Opens like an app, full screen, straight from your home screen."}</p>
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
