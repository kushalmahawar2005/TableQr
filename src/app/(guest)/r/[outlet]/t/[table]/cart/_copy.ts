import type { Lang } from "@/lib/i18n";
import { placeEn, placeHi } from "@/domain/rooms";

// G5 "Your order" in English and Hindi. Dish and option names are the restaurant's own.

const en = {
  back: "Back to menu",
  language: "Language",
  tableLine: (code: string, people: number) => `${placeEn(code)} · ${people === 1 ? "Just you" : `${people} here`}`,
  title: "Your order",
  tabs: "Cart view",
  mine: "Mine",
  wholeTable: "Whole table",
  you: "You",
  anotherGuest: "Another guest",
  items: (n: number) => (n === 1 ? "1 item" : `${n} items`),
  othersNote: "You can see other people's items, but you can only change your own.",
  othersEmpty: "No one else has anything in their cart yet.",

  shared: "Shared",
  decrease: (name: string) => `Decrease ${name} quantity`,
  increase: (name: string) => `Increase ${name} quantity`,
  removeLabel: (name: string) => `Remove ${name}`,
  remove: "Remove",
  qtyOf: (n: number, name: string) => `${n} ${name}`,
  maxReached: "Maximum 50",
  reason: {
    sold_out: "Sold out",
    outside_hours: "No longer available at this time",
    option_unavailable: "Selected option unavailable",
  },

  subtotal: "Subtotal",
  taxNote: "Taxes are added on the bill",

  nameLabel: "First name",
  nameHelp: "Shown on your kitchen ticket",
  orderNoteLabel: "Note for the whole order (optional)",
  orderNotePlaceholder: "E.g. less spicy, serve together",
  nameError: "Use letters, spaces, hyphens or apostrophes.",

  place: (table: string) => `Place order for Table ${table}`,
  placing: "Placing order…",
  addName: "Add your name to order",
  removeUnavailable: "Remove unavailable items to order",
  ctaPaused: "Ordering paused",
  ctaBill: "Bill requested",
  ctaOffline: "You're offline",
  goesStraight: "Goes straight to the kitchen.",
  addMoreAnyTime: "You can add more any time.",

  failed: "Couldn't place your order. Your cart is safe. Try again.",
  capTitle: "This is a large first order.",
  capBody: "Please ask your waiter to confirm it.",
  itemsChanged: "Some items just became unavailable. Remove them to order.",
  pricesChanged: "Prices have changed. Please review your cart before placing the order.",
  slow: "Slow connection. Still placing your order…",

  pausedBy: (name: string | null) => (name ? `Ordering paused by ${name}` : "Ordering paused by the host"),
  canStillReview: "You can still review your cart.",
  billRequested: "Bill requested. New orders are paused.",
  offline: "You're offline",
  offlineBody: "Cart changes and ordering are paused until you're back online.",

  removed: (name: string) => `${name} removed`,
  undo: "Undo",
  restoreFailed: (name: string) => `Couldn't restore ${name}. It is no longer available.`,
  updateFailed: "Couldn't update your cart. Try again.",

  emptyTitle: "Your cart is empty",
  emptyBody: "Add something from the menu to start your order.",
};

export type G5Copy = typeof en;

const hi: G5Copy = {
  back: "मेन्यू पर वापस",
  language: "भाषा",
  tableLine: (code, people) => `${placeHi(code)} · ${people === 1 ? "सिर्फ़ आप" : `${people} लोग`}`,
  title: "आपका ऑर्डर",
  tabs: "कार्ट व्यू",
  mine: "मेरा",
  wholeTable: "पूरी टेबल",
  you: "आप",
  anotherGuest: "दूसरे मेहमान",
  items: (n) => `${n} आइटम`,
  othersNote: "आप दूसरों के आइटम देख सकते हैं, पर बदल सिर्फ़ अपने सकते हैं।",
  othersEmpty: "अभी किसी और के कार्ट में कुछ नहीं है।",

  shared: "साझा",
  decrease: (name) => `${name} की मात्रा कम करें`,
  increase: (name) => `${name} की मात्रा बढ़ाएँ`,
  removeLabel: (name) => `${name} हटाएँ`,
  remove: "हटाएँ",
  qtyOf: (n, name) => `${n} ${name}`,
  maxReached: "अधिकतम 50",
  reason: {
    sold_out: "ख़त्म हो गया",
    outside_hours: "इस समय उपलब्ध नहीं",
    option_unavailable: "चुना गया विकल्प उपलब्ध नहीं",
  },

  subtotal: "सबटोटल",
  taxNote: "टैक्स बिल में जोड़े जाएँगे",

  nameLabel: "पहला नाम",
  nameHelp: "आपकी किचन पर्ची पर दिखेगा",
  orderNoteLabel: "पूरे ऑर्डर के लिए नोट (ज़रूरी नहीं)",
  orderNotePlaceholder: "जैसे कम तीखा, सब साथ में लाएँ",
  nameError: "सिर्फ़ अक्षर, स्पेस, हाइफ़न (-) या अपॉस्ट्रॉफ़ी (') लिखें।",

  place: (table) => `टेबल ${table} के लिए ऑर्डर करें`,
  placing: "ऑर्डर भेज रहे हैं…",
  addName: "ऑर्डर के लिए अपना नाम लिखें",
  removeUnavailable: "ऑर्डर के लिए अनुपलब्ध आइटम हटाएँ",
  ctaPaused: "ऑर्डर रुका है",
  ctaBill: "बिल माँगा गया है",
  ctaOffline: "आप ऑफ़लाइन हैं",
  goesStraight: "सीधे किचन में जाएगा।",
  addMoreAnyTime: "आप कभी भी और जोड़ सकते हैं।",

  failed: "ऑर्डर नहीं जा सका। आपका कार्ट सुरक्षित है। फिर से कोशिश करें।",
  capTitle: "यह बड़ा पहला ऑर्डर है।",
  capBody: "कृपया अपने वेटर से इसे कन्फ़र्म करवाएँ।",
  itemsChanged: "कुछ आइटम अभी उपलब्ध नहीं रहे। ऑर्डर के लिए उन्हें हटाएँ।",
  pricesChanged: "दाम बदल गए हैं। ऑर्डर करने से पहले अपना कार्ट देख लें।",
  slow: "कनेक्शन धीमा है। ऑर्डर भेज रहे हैं…",

  pausedBy: (name) => (name ? `${name} ने ऑर्डर रोका है` : "होस्ट ने ऑर्डर रोका है"),
  canStillReview: "आप अपना कार्ट देख सकते हैं।",
  billRequested: "बिल माँगा गया है। नए ऑर्डर रुके हैं।",
  offline: "आप ऑफ़लाइन हैं",
  offlineBody: "ऑनलाइन आने तक कार्ट में बदलाव और ऑर्डर रुके हैं।",

  removed: (name) => `${name} हटाया गया`,
  undo: "वापस लाएँ",
  restoreFailed: (name) => `${name} वापस नहीं आ सका। यह अब उपलब्ध नहीं है।`,
  updateFailed: "कार्ट अपडेट नहीं हो सका। फिर से कोशिश करें।",

  emptyTitle: "आपका कार्ट ख़ाली है",
  emptyBody: "ऑर्डर शुरू करने के लिए मेन्यू से कुछ जोड़ें।",
};

export const g5Copy: Record<Lang, G5Copy> = { en, hi };
