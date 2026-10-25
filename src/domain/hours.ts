// Opening hours and time windows, evaluated in the outlet's own timezone.

export type WeeklyHours = Partial<Record<Day, [string, string][]>>;
export type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

const DAYS: Day[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Day of week and minutes since midnight at `at` in `timeZone` */
export function localClock(at: Date, timeZone: string): { day: Day; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const day = get("weekday").toLowerCase().slice(0, 3) as Day;
  return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** The next local midnight after `at` in `timeZone`, as a UTC instant ("off for today") */
export function nextLocalMidnight(at: Date, timeZone: string): Date {
  const { minutes } = localClock(at, timeZone);
  const seconds = at.getUTCSeconds();
  const ms = at.getUTCMilliseconds();
  return new Date(at.getTime() + (24 * 60 - minutes) * 60_000 - seconds * 1000 - ms);
}

/** "HH:MM" or "HH:MM:SS" to minutes; "24:00" is end of day */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** True when `minutes` falls in [from, to); windows past midnight (22:00 to 02:00) wrap */
export function inWindow(minutes: number, from: string, to: string): boolean {
  const a = toMinutes(from);
  const b = toMinutes(to);
  return a <= b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}

/**
 * Whether the outlet is open. A late window such as Friday 18:00 to 02:00 keeps it
 * open in the early hours of Saturday too. No hours configured means always open.
 */
export function isOpenAt(hours: WeeklyHours | null | undefined, timeZone: string, at: Date): boolean {
  if (!hours || Object.keys(hours).length === 0) return true;
  const { day, minutes } = localClock(at, timeZone);
  const today = hours[day] ?? [];
  if (today.some(([from, to]) => {
    const a = toMinutes(from);
    const b = toMinutes(to);
    return a <= b ? minutes >= a && minutes < b : minutes >= a;
  })) return true;

  const yesterday = hours[DAYS[(DAYS.indexOf(day) + 6) % 7]] ?? [];
  return yesterday.some(([from, to]) => toMinutes(from) > toMinutes(to) && minutes < toMinutes(to));
}

/**
 * When the outlet's business day ends, in minutes after midnight. An outlet open past midnight
 * (Friday 18:00 to 02:00) keeps counting the night's bills on the day it opened: the day ends an
 * hour after the latest such closing, rounded up to the hour, so late payments still fall inside.
 * Capped at 6 am; 0 (midnight) when no window runs past midnight.
 */
export function dayCutoffMinutes(hours: WeeklyHours | null | undefined): number {
  let latest = -1;
  for (const ranges of Object.values(hours ?? {})) {
    for (const [from, to] of ranges ?? []) if (toMinutes(to) < toMinutes(from)) latest = Math.max(latest, toMinutes(to));
  }
  return latest < 0 ? 0 : Math.min(6 * 60, Math.ceil(latest / 60) * 60 + 60);
}

export type OpeningInfo = {
  isOpen: boolean;
  /** "HH:MM" local time the current window ends; null when closed or no hours are set */
  closesAt: string | null;
  /** The next window start when closed: 0 = later today, 1 = tomorrow, and so on */
  nextOpen: { day: Day; time: string; inDays: number } | null;
};

/**
 * What the guest landing says about hours: "Open till 11:30 pm" or "Opens Mon at 12:00 pm".
 * Holidays are not modelled yet; they arrive with the reservation and hours phase.
 */
export function openingInfo(hours: WeeklyHours | null | undefined, timeZone: string, at: Date): OpeningInfo {
  if (!hours || Object.keys(hours).length === 0) return { isOpen: true, closesAt: null, nextOpen: null };
  const { day, minutes } = localClock(at, timeZone);
  const today = DAYS.indexOf(day);

  const current = (hours[day] ?? []).find(([from, to]) => {
    const a = toMinutes(from);
    const b = toMinutes(to);
    return a <= b ? minutes >= a && minutes < b : minutes >= a;
  });
  // An all-day window has no closing time worth showing
  if (current) {
    const allDay = toMinutes(current[0]) === 0 && toMinutes(current[1]) >= 24 * 60;
    return { isOpen: true, closesAt: allDay ? null : current[1], nextOpen: null };
  }

  const overnight = (hours[DAYS[(today + 6) % 7]] ?? []).find(
    ([from, to]) => toMinutes(from) > toMinutes(to) && minutes < toMinutes(to),
  );
  if (overnight) return { isOpen: true, closesAt: overnight[1], nextOpen: null };

  for (let inDays = 0; inDays < 7; inDays++) {
    const d = DAYS[(today + inDays) % 7];
    const starts = (hours[d] ?? [])
      .map(([from]) => from)
      .filter((from) => inDays > 0 || toMinutes(from) > minutes)
      .sort((a, b) => toMinutes(a) - toMinutes(b));
    if (starts.length) return { isOpen: false, closesAt: null, nextOpen: { day: d, time: starts[0], inDays } };
  }
  return { isOpen: false, closesAt: null, nextOpen: null };
}
