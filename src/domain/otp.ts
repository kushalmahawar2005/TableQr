import { toAsciiDigits } from "./phone";

// One-time code rules for Verified mode (G2 locked decisions 3, 4, 6 and the approved limits).

export const OTP = {
  length: 4,
  /** A code works for 5 minutes */
  validSeconds: 5 * 60,
  /** A new code for the same number after 30 seconds */
  resendSeconds: 30,
  /** Three wrong codes lock the number and the phone for 60 seconds */
  maxAttempts: 3,
  lockSeconds: 60,
  /** Sending limits: per number per day, per phone (device) and per table per 10 minutes */
  perPhonePerDay: 5,
  perDevicePer10Min: 3,
  perTablePer10Min: 10,
  /** A table verified on this phone in the last 12 hours does not ask again */
  skipHours: 12,
} as const;

/** Consent wording version stored with the guest's choice */
export const CONSENT_VERSION = "v1";

/** Typed, pasted or SMS-filled code as up to 4 digits 0–9 */
export const normaliseCode = (input: string) => toAsciiDigits(input).slice(0, OTP.length);

export const isCompleteCode = (code: string) => new RegExp(`^\\d{${OTP.length}}$`).test(code);

/** Seconds left as "0:47" or "4:05" */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
