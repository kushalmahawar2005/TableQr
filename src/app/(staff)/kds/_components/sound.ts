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

function tone(freq: number, start: number, length: number, peak: number) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  const t = ctx.currentTime + start;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + length + 0.05);
}

/** New ticket: one soft chime */
export function playNewTicket() {
  if (!audioReady()) return;
  tone(880, 0, 0.7, 0.18);
}

/** Ticket turned late: two tones, lower and firmer */
export function playLate() {
  if (!audioReady()) return;
  tone(660, 0, 0.35, 0.22);
  tone(440, 0.38, 0.5, 0.22);
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
