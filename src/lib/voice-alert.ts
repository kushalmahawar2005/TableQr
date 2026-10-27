"use client";

// Spoken alerts ("Table 1 needs water"), using the phone's own text-to-speech: no audio files and
// no service. Hindi uses a Hindi voice when the phone has one, else the default voice reads it.
// Browsers speak only after a tap on the page, the same rule as the beep.

export type VoiceLang = "en" | "hi";

const PREF_KEY = "tq_voice_alerts";

export function voicePreference(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveVoicePreference(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? "on" : "off");
  } catch {
    // Private mode: the choice lasts until reload
  }
}

export const voiceSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** "T1" → "table 1", "Room 101" → "room 101"; a delivery's code is never read out */
export function spokenPlace(code: string, lang: VoiceLang) {
  const table = /^T(\d+)$/i.exec(code);
  if (table) return lang === "hi" ? `टेबल ${table[1]}` : `table ${table[1]}`;
  // Room tables are named "Room 204"
  const room = /^Room\s+(\S+)$/i.exec(code);
  if (room) return lang === "hi" ? `रूम ${room[1]}` : `room ${room[1]}`;
  if (/^DL-/i.test(code)) return lang === "hi" ? "डिलीवरी" : "delivery";
  return lang === "hi" ? `टेबल ${code}` : `table ${code}`;
}

const REQUEST_LINES: Record<string, [(p: string) => string, (p: string) => string]> = {
  water: [(p) => `${p} needs water`, (p) => `${p} को पानी चाहिए`],
  cutlery: [(p) => `${p} needs cutlery and napkins`, (p) => `${p} को कटलरी और नैपकिन चाहिए`],
  call_waiter: [(p) => `${p} is calling you`, (p) => `${p} आपको बुला रही है`],
  clean_table: [(p) => `${p} needs cleaning`, (p) => `${p} साफ़ करनी है`],
  request_bill: [(p) => `${p} wants the bill`, (p) => `${p} बिल माँग रही है`],
  pay_at_counter: [(p) => `${p} will pay at the counter`, (p) => `${p} काउंटर पर पेमेंट करेगी`],
  paid_upi: [(p) => `${p} paid by UPI, please check`, (p) => `${p} ने UPI से पेमेंट किया, चेक करें`],
};

/** What to say for a guest's request at a table */
export function requestPhrase(kind: string, tableCode: string, lang: VoiceLang) {
  const place = spokenPlace(tableCode, lang);
  const line = REQUEST_LINES[kind];
  if (line) { const said = line[lang === "hi" ? 1 : 0](place); return said.charAt(0).toUpperCase() + said.slice(1); }
  return lang === "hi" ? `${place} पर नया काम है` : `New request at ${place}`;
}

export const readyPhrase = (tableCode: string, lang: VoiceLang) =>
  lang === "hi" ? `${spokenPlace(tableCode, lang)} का खाना तैयार है` : `Food is ready for ${spokenPlace(tableCode, lang)}`;

/** Say it now, replacing anything still being said, so alerts never queue up behind each other */
export function speak(text: string, lang: VoiceLang) {
  if (!voiceSupported() || !text) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === "hi" ? "hi-IN" : "en-IN";
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang === "hi" ? "hi" : "en-in"))
      ?? synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang === "hi" ? "hi" : "en"));
    if (voice) u.voice = voice;
    u.rate = 0.95;
    synth.speak(u);
  } catch {
    // Speech not available on this phone: the beep still plays
  }
}
