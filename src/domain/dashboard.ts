import { localTime, serviceDate } from "./booking-policy";
import { localClock } from "./hours";

// O1 Owner Dashboard: pure helpers. Every day is the outlet's own calendar day, local midnight to
// the next local midnight; the browser's and the server process's time zones never take part.

/** A bill waiting this long after the guest asked for it is shown as an alert */
export const BILL_REQUESTED_ALERT_MINUTES = 10;
/** Upcoming reservations: the same 90-minute window S1 Arrivals uses */
export { ARRIVALS_WINDOW_MINUTES as UPCOMING_WINDOW_MINUTES } from "./booking-policy";
/** Late bookings are looked for this far back, as on the S1 floor */
export const LATE_LOOKBACK_HOURS = 6;
export const TREND_DAYS = 7;
export const TOP_ITEMS = 5;

/** YYYY-MM-DD `days` after `date` (negative goes back); pure calendar arithmetic */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export type DayRange = { date: string; start: Date; end: Date };

/** One outlet-local calendar day as a half-open UTC range [start, end) */
export function dayRange(date: string, timeZone: string): DayRange {
  return { date, start: localTime(date, 0, timeZone), end: localTime(addDays(date, 1), 0, timeZone) };
}

/** Today and yesterday in the outlet's time zone */
export function todayAndYesterday(now: Date, timeZone: string) {
  const today = serviceDate(now, timeZone);
  return { today: dayRange(today, timeZone), yesterday: dayRange(addDays(today, -1), timeZone) };
}

/** The last `days` outlet-local days, oldest first, ending with today */
export function lastDays(now: Date, timeZone: string, days = TREND_DAYS): DayRange[] {
  const today = serviceDate(now, timeZone);
  return Array.from({ length: days }, (_, i) => dayRange(addDays(today, i - (days - 1)), timeZone));
}

/** Index of the range holding `at`, or -1 */
export function bucketOf(at: Date, ranges: readonly DayRange[]): number {
  const t = at.getTime();
  return ranges.findIndex((r) => t >= r.start.getTime() && t < r.end.getTime());
}

/** Covers for a visit: what staff entered, or the people who joined if more (as on the S1 floor) */
export const coversOf = (partySize: number | null, joined: number) => Math.max(partySize ?? 0, joined);

/** Revenue over paid bills, never divided by zero */
export const averageOf = (totalPaise: number, bills: number) => (bills > 0 ? Math.round(totalPaise / bills) : 0);

export type Delta = { kind: "up" | "down"; pct: number } | { kind: "same" } | { kind: "no_baseline" };

/** Today against yesterday. No baseline when yesterday was zero, so never "+∞%". */
export function deltaOf(today: number, yesterday: number): Delta {
  if (yesterday === 0) return today === 0 ? { kind: "same" } : { kind: "no_baseline" };
  const pct = Math.round(((today - yesterday) / yesterday) * 100);
  if (pct === 0) return { kind: "same" };
  return pct > 0 ? { kind: "up", pct } : { kind: "down", pct: -pct };
}

export function deltaLabel(d: Delta): string {
  if (d.kind === "up") return `+${d.pct}%`;
  if (d.kind === "down") return `−${d.pct}%`;
  if (d.kind === "same") return "No change";
  return "No prior-day baseline";
}

/** Late and no-show eligibility, the same rule as the S1 floor: no-show only after the grace period */
export function lateness(startAt: number, now: number, graceMinutes: number) {
  return { lateMinutes: now > startAt ? Math.floor((now - startAt) / 60_000) : 0, noShowEligible: now >= startAt + graceMinutes * 60_000 };
}

/** Minutes a bill has waited since it was requested */
export const waitedMinutes = (requestedAt: number, now: number) => Math.max(0, Math.floor((now - requestedAt) / 60_000));

export function greeting(now: Date, timeZone: string): "Good morning" | "Good afternoon" | "Good evening" {
  const { minutes } = localClock(now, timeZone);
  if (minutes < 12 * 60) return "Good morning";
  if (minutes < 17 * 60) return "Good afternoon";
  return "Good evening";
}
