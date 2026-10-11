import { ringBell } from "@/lib/bell-sound";

// Kitchen sounds, generated with Web Audio (no audio files). Browsers only allow sound after a
// tap on the page, so the screen asks once with "Enable sound". Mute is remembered per screen.

const PREF_KEY = "tq_kds_sound";

export function soundPreference(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveSoundPreference(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? "on" : "off");
  } catch {
    // Private mode: the choice lasts until reload
  }
}

let ctx: AudioContext | null = null;

/** Call from a tap: creates or resumes the audio context. Returns whether sound can play. */
export async function unlockAudio(): Promise<boolean> {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    ctx ??= new Ctor();
    if (ctx.state === "suspended") await ctx.resume();
    return ctx.state === "running";
  } catch {
    return false;
  }
}

export const audioReady = () => ctx?.state === "running";

/** New ticket: a loud service bell, rung three times */
export function playNewTicket() {
  if (!audioReady() || !ctx) return;
  ringBell(ctx, { times: 3 });
}

/** Ticket turned late: a lower bell, rung four times */
export function playLate() {
  if (!audioReady() || !ctx) return;
  ringBell(ctx, { times: 4, urgent: true });
}

const SEEN_KEY = "tq_kds_announced";

export function rememberedAnnouncements(): { arrived?: string[]; late?: string[] } {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function saveAnnouncements(value: { arrived: string[]; late: string[] }) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(value));
  } catch {
    // Not critical: worst case a reload re-primes without sound
  }
}

// Mute preference as a tiny external store, so the screen reads it without a hydration mismatch
const listeners = new Set<() => void>();
export function subscribeSoundPref(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function setSoundPref(on: boolean) {
  saveSoundPreference(on);
  listeners.forEach((fn) => fn());
}
