import type { Lang } from "@/lib/i18n";
import { placeEn, placeHi } from "@/domain/rooms";

// Every word on G2 in English and Hindi. Hindi keeps the meaning rather than the exact words and
// is a first draft for native review. Numbers, codes and countdowns stay in 0–9 in both.

const en = {
  back: "Back to table",
  language: "Language",
  table: (code: string) => `${placeEn(code)}`,

  heading: "Confirm your number",
  starting: "You're starting this table",
  joining: (n: number) => (n === 1 ? "Joining 1 person" : `Joining ${n} people`),
  trust: "We send a 4-digit code so only people at this table can order.",
  whyLink: "Why we ask for your number",

  nameLabel: "First name",
  nameHelp: "Shown to others at the table and on kitchen tickets",
  nameError: "Use letters, spaces, hyphens or apostrophes.",
  phoneLabel: "Mobile number",
  countryLabel: "Country code",
  phoneError: "Enter a 10 digit mobile number",
  intlUnavailable: "International OTP isn't available yet. Please ask staff to continue.",

  sendCode: "Send code",
  sending: "Sending code…",
  codeSentTo: "Code sent to",
  change: "Change",
  changeNumber: "Change mobile number",
  codeLabel: "4-digit code",
  didntGet: "Didn't get the code?",
  resendIn: (t: string) => `Resend code in ${t}`,
  resend: "Resend code",
  verify: "Verify and continue",
  verifying: "Verifying…",

  wrong: "That code didn't match. Check and try again.",
  locked: "Too many tries. Please wait a minute.",
  tryAgainIn: (t: string) => `Try again in ${t}`,
  expired: "This code has expired. Send a new one.",
  sendNew: "Send a new code",
  smsFailed: "We could not send the code.",
  askStaff: "Please ask staff to continue.",
  rateLimited: "Too many codes requested.",
  rateLimitedBody: "Please try again later, or ask staff to continue.",
  tryAgain: "Try again",
  network: "We could not reach the restaurant. Try again.",
  slow: "Slow connection. Still working on it…",

  consent: (outlet: string) => `Remember my favourites and send me offers from ${outlet}`,
  optional: "(optional)",

  why: {
    title: "Why we ask for your number",
    rows: [
      { title: "Confirm you're at this table", body: "The code helps prevent orders from outside the restaurant." },
      { title: "Remember your favourites", body: "Optional personalisation can make future visits quicker." },
      { title: "You're in control", body: "Personalisation and offers are optional. Ordering works without them." },
    ],
    close: "Close",
  },
};

export type G2Copy = typeof en;

const hi: G2Copy = {
  back: "टेबल पर वापस",
  language: "भाषा",
  table: (code) => `${placeHi(code)}`,

  heading: "अपना नंबर कन्फ़र्म करें",
  starting: "आप यह टेबल शुरू कर रहे हैं",
  joining: (n) => (n === 1 ? "1 व्यक्ति के साथ जुड़ रहे हैं" : `${n} लोगों के साथ जुड़ रहे हैं`),
  trust: "हम 4 अंकों का कोड भेजते हैं, ताकि सिर्फ़ इसी टेबल पर बैठे लोग ऑर्डर कर सकें।",
  whyLink: "हम आपका नंबर क्यों पूछते हैं",

  nameLabel: "पहला नाम",
  nameHelp: "टेबल पर बाकी लोगों को और किचन की पर्ची पर दिखेगा",
  nameError: "सिर्फ़ अक्षर, स्पेस, हाइफ़न (-) या अपॉस्ट्रॉफ़ी (') लिखें।",
  phoneLabel: "मोबाइल नंबर",
  countryLabel: "देश का कोड",
  phoneError: "10 अंकों का मोबाइल नंबर डालें",
  intlUnavailable: "विदेशी नंबर पर अभी OTP नहीं भेजा जा सकता। आगे बढ़ने के लिए कृपया स्टाफ से पूछें।",

  sendCode: "कोड भेजें",
  sending: "कोड भेज रहे हैं…",
  codeSentTo: "कोड भेजा गया",
  change: "बदलें",
  changeNumber: "मोबाइल नंबर बदलें",
  codeLabel: "4 अंकों का कोड",
  didntGet: "कोड नहीं मिला?",
  resendIn: (t) => `${t} में दोबारा भेजें`,
  resend: "कोड दोबारा भेजें",
  verify: "कन्फ़र्म करें और आगे बढ़ें",
  verifying: "कन्फ़र्म कर रहे हैं…",

  wrong: "यह कोड मेल नहीं खाया। जाँचकर फिर से डालें।",
  locked: "कई बार गलत कोड डाला गया। कृपया एक मिनट रुकें।",
  tryAgainIn: (t) => `${t} बाद फिर कोशिश करें`,
  expired: "इस कोड का समय खत्म हो गया। नया कोड मँगाएँ।",
  sendNew: "नया कोड भेजें",
  smsFailed: "हम कोड नहीं भेज सके।",
  askStaff: "आगे बढ़ने के लिए कृपया स्टाफ से पूछें।",
  rateLimited: "बहुत बार कोड माँगा गया।",
  rateLimitedBody: "कृपया थोड़ी देर बाद कोशिश करें, या स्टाफ से पूछें।",
  tryAgain: "फिर से कोशिश करें",
  network: "रेस्टोरेंट से संपर्क नहीं हो सका। फिर से कोशिश करें।",
  slow: "कनेक्शन धीमा है। काम जारी है…",

  consent: (outlet) => `मेरी पसंद याद रखें और ${outlet} के ऑफ़र मुझे भेजें`,
  optional: "(वैकल्पिक)",

  why: {
    title: "हम आपका नंबर क्यों पूछते हैं",
    rows: [
      { title: "पक्का हो कि आप इसी टेबल पर हैं", body: "यह कोड रेस्टोरेंट के बाहर से होने वाले ऑर्डर रोकने में मदद करता है।" },
      { title: "आपकी पसंद याद रहे", body: "आप चाहें, तो अगली बार ऑर्डर करना और जल्दी हो सकता है।" },
      { title: "फ़ैसला आपका है", body: "पसंद याद रखना और ऑफ़र, दोनों आपकी मर्ज़ी पर हैं। इनके बिना भी ऑर्डर कर सकते हैं।" },
    ],
    close: "बंद करें",
  },
};

export const g2Copy: Record<Lang, G2Copy> = { en, hi };
