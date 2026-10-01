// Guest mobile numbers (G2). India first: +91 is the default and the only country OTP is sent to
// for now (DLT registration is India-only). The list stays small and static, no phone library.

export type Country = { iso: string; dial: string; flag: string; name: { en: string; hi: string }; otp: boolean };

export const COUNTRIES: readonly Country[] = [
  { iso: "IN", dial: "+91", flag: "🇮🇳", name: { en: "India", hi: "भारत" }, otp: true },
  { iso: "AE", dial: "+971", flag: "🇦🇪", name: { en: "United Arab Emirates", hi: "संयुक्त अरब अमीरात" }, otp: false },
  { iso: "US", dial: "+1", flag: "🇺🇸", name: { en: "United States", hi: "अमेरिका" }, otp: false },
  { iso: "GB", dial: "+44", flag: "🇬🇧", name: { en: "United Kingdom", hi: "ब्रिटेन" }, otp: false },
  { iso: "SG", dial: "+65", flag: "🇸🇬", name: { en: "Singapore", hi: "सिंगापुर" }, otp: false },
  { iso: "SA", dial: "+966", flag: "🇸🇦", name: { en: "Saudi Arabia", hi: "सऊदी अरब" }, otp: false },
  { iso: "AU", dial: "+61", flag: "🇦🇺", name: { en: "Australia", hi: "ऑस्ट्रेलिया" }, otp: false },
  { iso: "NP", dial: "+977", flag: "🇳🇵", name: { en: "Nepal", hi: "नेपाल" }, otp: false },
];

export const DEFAULT_COUNTRY = "IN";

export const countryByIso = (iso: string) => COUNTRIES.find((c) => c.iso === iso) ?? null;

/** Whether OTP can be sent to numbers from this country today */
export const otpSupported = (iso: string) => countryByIso(iso)?.otp === true;

/** Digits only, with Devanagari digits (०–९) turned into 0–9 */
export function toAsciiDigits(input: string): string {
  return input.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x966)).replace(/\D/g, "");
}

/**
 * What a guest typed or pasted as an Indian mobile, as up to 10 digits. A pasted "+91 98765 43210"
 * or "098765 43210" keeps only the 10-digit number.
 */
export function normaliseIndianMobile(input: string): string {
  let d = toAsciiDigits(input);
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d.slice(0, 10);
}

/** 10 digits starting with 6, 7, 8 or 9 */
export const isValidIndianMobile = (digits: string) => /^[6-9]\d{9}$/.test(digits);

/** "9876543210" as "98765 43210"; partial input is grouped the same way while typing */
export const formatIndianMobile = (digits: string) => (digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits);

/** Stored form, e.g. "+919876543210" */
export const toE164 = (dial: string, digits: string) => `${dial}${digits}`;

/** "+919876543210" as "+91 98765 43210" for screens */
export function displayPhone(e164: string): string {
  if (e164.startsWith("+91")) return `+91 ${formatIndianMobile(e164.slice(3))}`;
  return e164;
}
