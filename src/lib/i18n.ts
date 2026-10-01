// Guest languages (UI spec 9.2). English is the default; Hindi is chosen by the guest and
// remembered on the phone. Numbers stay in international digits in both languages.

export const LANGS = ["en", "hi"] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_COOKIE = "tq_lang";

export function parseLang(value: string | undefined | null): Lang {
  return value === "hi" ? "hi" : "en";
}

const locale = { en: "en-IN", hi: "hi-IN-u-nu-latn" } as const;

/** "23:30" (outlet local time) as "11:30 pm" */
export function formatClock(hhmm: string, lang: Lang): string {
  const [h, m] = hhmm.split(":").map(Number);
  const at = new Date(Date.UTC(2026, 0, 1, h % 24, m));
  return new Intl.DateTimeFormat(locale[lang], { hour: "numeric", minute: "2-digit", timeZone: "UTC" })
    .format(at)
    .replace(/\s?(am|pm)$/i, (s) => s.toLowerCase());
}

/** "mon" as "Monday" / "सोमवार" */
export function formatWeekday(day: string, lang: Lang): string {
  const index = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(day);
  // 2026-01-04 was a Sunday
  const at = new Date(Date.UTC(2026, 0, 4 + index));
  return new Intl.DateTimeFormat(locale[lang], { weekday: "long", timeZone: "UTC" }).format(at);
}
