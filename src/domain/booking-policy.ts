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
};

export const DEFAULT_POLICY: BookingPolicy = {
  bookingWindowDays: 30,
  onlineCutoffMinutes: 60,
  minPartySize: 1,
  maxPartySize: 8,
  slotIntervalMinutes: 30,
  holdMinutes: 10,
  diningMinutes: [
    [2, 75],
    [4, 90],
    [6, 105],
    [99, 120],
  ],
  turnoverBufferMinutes: 15,
  graceMinutes: 15,
  reserveAheadMinutes: 30,
  pacingCoversPerSlot: 40,
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

export type PacingState = "normal" | "near" | "full";

export function pacingState(covers: number, capacity: number): PacingState {
  if (capacity <= 0 || covers >= capacity) return "full";
  return covers >= capacity * NEAR_LIMIT_SHARE ? "near" : "normal";
}
