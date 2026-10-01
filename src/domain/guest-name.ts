// Guests give their first name at their first order (G1 decision N3). Until then a participant
// carries a stand-in name, which guest screens must never show as if it were a person's name.

export const placeholderName = (n: number) => `Guest ${n}`;

export const isPlaceholderName = (name: string) => /^Guest \d+$/.test(name);

// Verified mode (G2) takes the first name before ordering instead.

export const MAX_NAME_LENGTH = 40;

// Letters of the Latin or Devanagari scripts with their accents and vowel signs, spaces, hyphens
// and apostrophes (straight or curly, as phone keyboards type them). Zero-width joiners stay
// because Hindi keyboards use them for half letters. No emoji: kitchen printers cannot print them.
const ALLOWED =
  /^(?:(?=\p{Script_Extensions=Latin})\p{L}|(?=\p{Script_Extensions=Devanagari})[\p{L}\p{M}]|(?![︀-️])\p{M}|[ '’\-‌‍])+$/u;

export type NameCheck = { ok: true; name: string } | { ok: false; reason: "empty" | "too_long" | "invalid" };

/** First name: letters with spaces, hyphens or apostrophes, at most 40 characters */
export function checkFirstName(raw: string): NameCheck {
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, reason: "empty" };
  if (Array.from(name).length > MAX_NAME_LENGTH) return { ok: false, reason: "too_long" };
  if (!ALLOWED.test(name) || !/\p{L}/u.test(name)) return { ok: false, reason: "invalid" };
  return { ok: true, name };
}
