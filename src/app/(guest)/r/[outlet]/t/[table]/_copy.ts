import type { Lang } from "@/lib/i18n";

// Every word on G1 in English and Hindi. Hindi is a first draft for native review.
// Layouts must take about 30% longer text, so nothing here is sized to fit.

const en = {
  language: "Language",
  openTill: (time: string) => `Open till ${time}`,
  closedNow: "Closed now",
  youAreAt: "You are at",
  table: (code: string) => `Table ${code}`,
  seats: (n: number) => `Seats ${n}`,
  tableSummary: (code: string, seats: number, zone: string, state: string) =>
    `Table ${code}, seats ${seats}, ${zone}, ${state}`,

  pill: {
    available: "Available",
    inUse: "Table in use",
    codeInactive: "Code inactive",
    notAvailable: "Not available",
    notFound: "Table not found",
    reserved: "Reserved",
    settling: "Settling up",
    preparing: "Being prepared",
    blocked: "Not available",
    closed: "Closed",
    awaitingStaff: "Waiting for staff",
    codeRequired: "Table code needed",
  },

  peopleCount: (n: number) => (n === 1 ? "1 person is at this table" : `${n} people are at this table`),
  // Up to three names in full; from four, the first three and a count
  peopleHere: (names: string[]) =>
    names.length === 1
      ? `${names[0]} is here`
      : names.length <= 3
        ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are here`
        : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more are here`,
  hostIs: (name: string) => `${name} is the host`,

  startOrdering: "Start ordering",
  joinTable: (code: string) => `Join Table ${code}`,
  startingFor: (code: string) => `Start ordering at Table ${code}`,
  checking: "Checking table…",
  opening: "Opening your table…",
  notYourTable: "Not your table? Scan the one you are at.",

  reassurances: [
    { title: "No app to install", body: "Order from this page" },
    { title: "Pay at the end", body: "UPI, card or at the counter" },
    { title: "Order together", body: "Friends can join this table" },
  ],

  askStaffToContinue: "Please ask staff to continue.",
  reserved: {
    title: "This table is reserved",
    body: "It is booked soon, so we cannot start a new order here. Please ask the host for another table.",
  },
  settling: { title: "This table is settling up", body: "Please ask staff if you'd like to join." },
  settlingMine: { title: "Your table is settling up", body: "Please ask staff to continue." },
  preparing: { title: "This table is being prepared", body: "Please ask the host." },
  closed: { title: (outlet: string) => `${outlet} is closed now` },
  opens: (when: "today" | "tomorrow" | string, time: string) =>
    when === "today" ? `Opens today at ${time}` : when === "tomorrow" ? `Opens tomorrow at ${time}` : `Opens ${when} at ${time}`,
  awaitingStaff: {
    title: "Please ask staff to open this table",
    body: "Once they open it, you can order from this page.",
  },
  codeRequired: { title: "Please ask staff to continue", body: "They will help you join this table." },
  revoked: { title: "This code is no longer active", body: "Please ask staff for help." },
  unavailable: { title: "Table ordering is not available right now", body: "Please ask staff." },
  notFound: { title: "We could not find this table", body: "Please ask staff for help." },

  slow: "Slow connection. Still checking your table…",
  loadError: "We could not load this table.",
  actionError: "We could not reach the restaurant. Try again.",
  tryAgain: "Try again",
  poweredBy: "powered by TableQR",

  menuPlaceholder: { title: "Your table is open", body: "Please ask staff to continue." },
};

export type G1Copy = typeof en;

const hi: G1Copy = {
  language: "भाषा",
  openTill: (time) => `${time} तक खुला`,
  closedNow: "अभी बंद है",
  youAreAt: "आपकी टेबल",
  table: (code) => `टेबल ${code}`,
  seats: (n) => `${n} सीटें`,
  tableSummary: (code, seats, zone, state) => `टेबल ${code}, ${seats} सीटें, ${zone}, ${state}`,

  pill: {
    available: "खाली है",
    inUse: "टेबल चालू है",
    codeInactive: "कोड बंद है",
    notAvailable: "उपलब्ध नहीं",
    notFound: "टेबल नहीं मिली",
    reserved: "रिज़र्व्ड",
    settling: "बिल हो रहा है",
    preparing: "तैयार हो रही है",
    blocked: "उपलब्ध नहीं",
    closed: "बंद है",
    awaitingStaff: "स्टाफ का इंतज़ार",
    codeRequired: "टेबल कोड चाहिए",
  },

  peopleCount: (n) => (n === 1 ? "इस टेबल पर 1 व्यक्ति है" : `इस टेबल पर ${n} लोग हैं`),
  peopleHere: (names) =>
    names.length === 1
      ? `${names[0]} यहाँ है`
      : names.length <= 3
        ? `${names.slice(0, -1).join(", ")} और ${names[names.length - 1]} यहाँ हैं`
        : `${names.slice(0, 3).join(", ")} और ${names.length - 3} ${names.length === 4 ? "व्यक्ति" : "लोग"} यहाँ हैं`,
  hostIs: (name) => `${name} होस्ट हैं`,

  startOrdering: "ऑर्डर शुरू करें",
  joinTable: (code) => `टेबल ${code} से जुड़ें`,
  startingFor: (code) => `टेबल ${code} पर ऑर्डर शुरू करें`,
  checking: "टेबल देख रहे हैं…",
  opening: "आपकी टेबल खोल रहे हैं…",
  notYourTable: "यह आपकी टेबल नहीं है? जिस टेबल पर बैठे हैं, उसका QR स्कैन करें।",

  reassurances: [
    { title: "कोई ऐप नहीं चाहिए", body: "इसी पेज से ऑर्डर करें" },
    { title: "आख़िर में पेमेंट करें", body: "UPI, कार्ड या काउंटर पर" },
    { title: "साथ में ऑर्डर करें", body: "दोस्त इस टेबल से जुड़ सकते हैं" },
  ],

  askStaffToContinue: "आगे बढ़ने के लिए कृपया स्टाफ से पूछें।",
  reserved: {
    title: "यह टेबल रिज़र्व्ड है",
    body: "यह टेबल जल्द ही बुक है, इसलिए यहाँ नया ऑर्डर शुरू नहीं हो सकता। कृपया होस्ट से दूसरी टेबल के लिए पूछें।",
  },
  settling: { title: "इस टेबल का बिल हो रहा है", body: "जुड़ना चाहें तो कृपया स्टाफ से पूछें।" },
  settlingMine: { title: "आपकी टेबल का बिल हो रहा है", body: "आगे बढ़ने के लिए कृपया स्टाफ से पूछें।" },
  preparing: { title: "यह टेबल तैयार की जा रही है", body: "कृपया होस्ट से पूछें।" },
  closed: { title: (outlet) => `${outlet} अभी बंद है` },
  opens: (when, time) =>
    when === "today" ? `आज ${time} पर खुलेगा` : when === "tomorrow" ? `कल ${time} पर खुलेगा` : `${when} को ${time} पर खुलेगा`,
  awaitingStaff: {
    title: "कृपया स्टाफ से यह टेबल खुलवाएँ",
    body: "टेबल खुलने के बाद आप इसी पेज से ऑर्डर कर सकेंगे।",
  },
  codeRequired: { title: "आगे बढ़ने के लिए कृपया स्टाफ से पूछें", body: "वे इस टेबल से जुड़ने में आपकी मदद करेंगे।" },
  revoked: { title: "यह कोड अब चालू नहीं है", body: "कृपया स्टाफ से मदद लें।" },
  unavailable: { title: "टेबल से ऑर्डर अभी उपलब्ध नहीं है", body: "कृपया स्टाफ से पूछें।" },
  notFound: { title: "हमें यह टेबल नहीं मिली", body: "कृपया स्टाफ से मदद लें।" },

  slow: "कनेक्शन धीमा है। आपकी टेबल अब भी देख रहे हैं…",
  loadError: "हम यह टेबल लोड नहीं कर सके।",
  actionError: "रेस्टोरेंट से संपर्क नहीं हो सका। फिर से कोशिश करें।",
  tryAgain: "फिर से कोशिश करें",
  poweredBy: "powered by TableQR",

  menuPlaceholder: { title: "आपकी टेबल खुल गई है", body: "आगे बढ़ने के लिए कृपया स्टाफ से पूछें।" },
};

export const g1Copy: Record<Lang, G1Copy> = { en, hi };
