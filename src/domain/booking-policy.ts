// Booking rules and service-day time maths (PS 4.3 to 4.6). Pure: used by the floor backend,
// the future booking screens and tests alike. All instants are UTC; a "service day" is the
// outlet's local calendar date.

export type BookingPolicy = {
  bookingWindowDays: number;
  onlineCutoffMinutes: number;
  minPartySize: number;
  maxPartySize: number;
  slotIntervalMinutes: number;
  holdMinutes: number;
  /** [[up to N guests, minutes], ...] ascending */
  diningMinutes: [number, number][];
  turnoverBufferMinutes: number;
  graceMinutes: number;
  reserveAheadMinutes: number;
  pacingCoversPerSlot: number;
  freeCancellationMinutes: number;
  lateExtensionMinutes: number;
  readyWindowMinutes: number;
  fallbackWaitMinutes: number;
  minimumHistoryParties: number;
  peakCreditPaise: number;
  repeatNoShowCreditPaise: number;
  repeatNoShowThreshold: number;
};

export const DEFAULT_POLICY: BookingPolicy = {
  bookingWindowDays: 30,
  onlineCutoffMinutes: 60,
  minPartySize: 1,
  maxPartySize: 12,
  slotIntervalMinutes: 30,
  holdMinutes: 5,
  diningMinutes: [
    [2, 60],
    [4, 90],
    [6, 105],
    [99, 120],
  ],
  turnoverBufferMinutes: 10,
  graceMinutes: 15,
  reserveAheadMinutes: 30,
  pacingCoversPerSlot: 40,
  freeCancellationMinutes: 120,
  lateExtensionMinutes: 10,
  readyWindowMinutes: 10,
  fallbackWaitMinutes: 30,
  minimumHistoryParties: 30,
  peakCreditPaise: 0,
  repeatNoShowCreditPaise: 0,
  repeatNoShowThreshold: 2,
};

/** Arrivals shows bookings this far ahead (S1) */
export const ARRIVALS_WINDOW_MINUTES = 90;
/** Extend time adds this much at a time */
export const EXTEND_STEP_MINUTES = 15;
/** Pacing bar turns amber at this share of capacity */
export const NEAR_LIMIT_SHARE = 0.8;

export function diningMinutesFor(partySize: number, policy: Pick<BookingPolicy, "diningMinutes"> = DEFAULT_POLICY): number {
  const steps = policy.diningMinutes.length ? policy.diningMinutes : DEFAULT_POLICY.diningMinutes;
  return (steps.find(([upTo]) => partySize <= upTo) ?? steps[steps.length - 1])[1];
}

/** Two time ranges overlap; `gapMs` is kept free between them */
export const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number, gapMs = 0) => aStart < bEnd + gapMs && bStart < aEnd + gapMs;

/** The outlet-local calendar date of an instant, YYYY-MM-DD */
export function serviceDate(at: Date, timeZone: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Offset of `timeZone` from UTC at an instant, in minutes (IST = 330) */
function offsetMinutes(at: Date, timeZone: string): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(at);
  const get = (t: string) => Number(p.find((x) => x.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The UTC instant of a local wall time: `minutes` after local midnight of `date` */
export function localTime(date: string, minutes: number, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0) + minutes * 60_000;
  const first = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  return new Date(guess - offsetMinutes(new Date(first), timeZone) * 60_000);
}

/**
 * The UTC instant of an outlet wall-clock value from a `datetime-local` input ("2026-10-04T20:00").
 * Null when malformed. The browser's and the server process's own time zones never take part.
 */
export function parseLocalDateTime(value: string, timeZone: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  if (hour > 23 || minute > 59) return null;
  const at = localTime(m[1], hour * 60 + minute, timeZone);
  return Number.isNaN(at.getTime()) || serviceDate(at, timeZone) !== m[1] ? null : at;
}

/** A `datetime-local` value ("2026-10-04T20:00") showing an instant in the outlet's time zone */
export function localDateTimeValue(at: Date | number, timeZone: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(at));
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export type PacingState = "normal" | "near" | "full";

export function pacingState(covers: number, capacity: number): PacingState {
  if (capacity <= 0 || covers >= capacity) return "full";
  return covers >= capacity * NEAR_LIMIT_SHARE ? "near" : "normal";
}
