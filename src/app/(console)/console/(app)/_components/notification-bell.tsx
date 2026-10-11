"use client";

import { Cancel01Icon, Notification01Icon, NotificationOff01Icon, VolumeHighIcon, VolumeOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { chime } from "@/lib/bell-sound";
import type { ConsoleNotice } from "@/server/staff/notifications";
import { noticesAction } from "./notification-actions";

const POLL_MS = 8_000;
const SOUND_KEY = "tq_console_sound";
const KEEP = 30;

const timeAgo = (at: number, now: number) => {
  const m = Math.floor((now - at) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`;
};

/**
 * Console bell: checks for new orders, requests, payments, bookings and waitlist joins every few
 * seconds, rings, shows a toast, and (when allowed) a system notification while the tab is hidden.
 */
export function NotificationBell({ preview = false, className = "", placement = "header", showLabel = false }: { preview?: boolean; className?: string; placement?: "header" | "sidebar"; showLabel?: boolean }) {
  const [items, setItems] = useState<ConsoleNotice[]>([]);
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState<ConsoleNotice[]>([]);
  const [open, setOpen] = useState(false);
  const [sound, setSound] = useState(true);
  const [clock, setClock] = useState(() => Date.now());
  const since = useRef<number | null>(null);
  const seen = useRef(new Set<string>());
  const audio = useRef<AudioContext | null>(null);
  const soundOn = useRef(true);
  // On the Kitchen board new orders already ring the kitchen bell; the chime stays for the rest
  const path = usePathname();
  const onKitchen = useRef(false);
  useEffect(() => {
    onKitchen.current = path?.startsWith("/console/kitchen") ?? false;
  }, [path]);

  // Sound preference lives on this device only
  useEffect(() => {
    try {
      const off = localStorage.getItem(SOUND_KEY) === "off";
      soundOn.current = !off;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading a per-device setting after mount
      setSound(!off);
    } catch {
      // Storage blocked: keep the sound on
    }
  }, []);

  // Browsers only allow sound after the person has touched the page once
  useEffect(() => {
    const unlock = () => {
      if (!audio.current) {
        try {
          audio.current = new AudioContext();
        } catch {
          return;
        }
      }
      void audio.current.resume();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    if (preview) return;
    let stopped = false;
    const check = async () => {
      let res: Awaited<ReturnType<typeof noticesAction>>;
      try {
        res = await noticesAction(since.current);
      } catch {
        return; // offline for a moment: the next check catches up
      }
      if (stopped || !res.ok) return;
      // A little overlap so nothing falls between two checks; seen ids stop repeats
      since.current = res.now - 2_000;
      const fresh = res.notices.filter((n) => !seen.current.has(n.id));
      fresh.forEach((n) => seen.current.add(n.id));
      setClock(res.now);
      if (!fresh.length) return;
      setItems((old) => [...fresh, ...old].slice(0, KEEP));
      setUnread((u) => u + fresh.length);
      setToasts((old) => [...fresh.slice(0, 3), ...old].slice(0, 3));
      fresh.slice(0, 3).forEach((n) => setTimeout(() => setToasts((old) => old.filter((x) => x.id !== n.id)), 6_000));
      const ring = onKitchen.current ? fresh.filter((n) => n.kind !== "order") : fresh;
      if (ring.length && soundOn.current && audio.current?.state === "running") chime(audio.current, { repeat: true });
      if (document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
        for (const n of fresh.slice(0, 3)) new Notification(n.title, { body: n.body, tag: n.id });
      }
    };
    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    const onVisible = () => { if (!document.hidden) void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [preview]);

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    soundOn.current = next;
    try {
      localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {
      // Storage blocked: the choice lasts for this page only
    }
    if (next && audio.current) chime(audio.current);
  };
  const askDesktop = () => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
  };
  const canAskDesktop = typeof window !== "undefined" && typeof Notification !== "undefined" && Notification.permission === "default";

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setUnread(0); }}
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        aria-expanded={open}
        className={`relative flex min-h-10 items-center gap-3 rounded-input text-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink ${showLabel ? "min-h-11 w-full px-3 text-body font-semibold" : "size-10 justify-center"}`}
      >
        <HugeiconsIcon icon={Notification01Icon} size={20} className="shrink-0" aria-hidden />
        {showLabel && <span className="hidden lg:inline">Notifications</span>}
        {unread > 0 && (
          <span className="absolute top-1 left-6 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] leading-4 font-bold text-white">{unread > 9 ? "9+" : unread}</span>
        )}
      </button>

      {open && (
        <div className={`absolute z-50 w-80 max-w-[calc(100vw-2rem)] rounded-card border border-line bg-surface shadow-[var(--shadow-float)] ${placement === "sidebar" ? "bottom-0 left-full ml-2" : "top-12 right-0 max-h-[calc(100dvh-5rem)]"}`}>
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <p className="font-display text-body font-bold">Notifications</p>
            <div className="flex items-center gap-1">
              <button type="button" onClick={toggleSound} aria-pressed={sound} title={sound ? "Sound on" : "Sound off"} aria-label={sound ? "Turn sound off" : "Turn sound on"} className="grid size-9 place-items-center rounded-input text-muted hover:bg-ink/5 hover:text-ink">
                <HugeiconsIcon icon={sound ? VolumeHighIcon : VolumeOffIcon} size={18} aria-hidden />
              </button>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid size-9 place-items-center rounded-input text-muted hover:bg-ink/5 hover:text-ink">
                <HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden />
              </button>
            </div>
          </div>
          {canAskDesktop && (
            <button type="button" onClick={askDesktop} className="w-full border-b border-line px-4 py-2.5 text-left text-caption font-semibold text-brand hover:bg-ink/5">
              Also alert me when this tab is in the background
            </button>
          )}
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-caption text-muted">
              <HugeiconsIcon icon={NotificationOff01Icon} size={24} aria-hidden />
              Nothing new since you opened this screen. New orders, requests, payments and bookings ring here.
            </div>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <Link href={n.href} onClick={() => setOpen(false)} className="block px-4 py-3 hover:bg-ink/5">
                    <span className="block text-body font-semibold text-ink">{n.title}</span>
                    <span className="block text-caption text-muted">{n.body} · {timeAgo(n.at, clock)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div aria-live="polite" className="pointer-events-none fixed top-16 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((n) => (
          <Link key={n.id} href={n.href} className="pointer-events-auto flex items-start gap-3 rounded-card border border-line bg-surface p-3 shadow-[var(--shadow-float)] animate-fade">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-strong">
              <HugeiconsIcon icon={Notification01Icon} size={18} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-body font-semibold text-ink">{n.title}</span>
              <span className="block text-caption text-muted">{n.body}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
