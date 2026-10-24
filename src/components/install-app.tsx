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

export function InstallApp({ className = "", name = "TableQR", logoUrl = null }: { className?: string; name?: string; logoUrl?: string | null }) {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [show, setShow] = useState(false);

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
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    setPrompt(null);
    if (outcome === "accepted") setShow(false);
  };

  return (
    <div role="region" aria-label="Install the app" className={`flex items-start gap-3 rounded-card border border-line bg-surface p-3.5 shadow-[0_1px_3px_rgb(0_0_0/0.06)] ${className}`}>
      <span aria-hidden className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-input border border-line bg-brand-soft font-display text-section font-bold text-brand-strong">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- tenant logos may be hosted on owner-controlled HTTPS origins
          <img src={logoUrl} alt="" className="size-full object-contain p-1" />
        ) : name.trim().slice(0, 1).toUpperCase() || "T"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words text-body font-semibold text-ink">Install {name} on this phone</p>
        {ios ? (
          <p className="mt-0.5 text-caption text-muted">
            Tap <HugeiconsIcon icon={Share08Icon} size={14} className="inline align-[-2px]" aria-label="Share" /> Share, then <span className="font-semibold text-ink">Add to Home Screen</span>.
          </p>
        ) : (
          <p className="mt-0.5 text-caption text-muted">Opens like an app, full screen, straight from your home screen.</p>
        )}
        {!ios && prompt && (
          <button type="button" onClick={() => void install()} className="mt-2.5 inline-flex min-h-10 items-center gap-2 rounded-input bg-ink px-3.5 text-body font-semibold text-white hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
            <HugeiconsIcon icon={Download04Icon} size={18} aria-hidden />
            Install app
          </button>
        )}
      </div>
      <button type="button" onClick={close} aria-label="Not now" className="grid size-9 shrink-0 place-items-center rounded-input text-muted hover:bg-ink/5 hover:text-ink">
        <HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden />
      </button>
    </div>
  );
}
