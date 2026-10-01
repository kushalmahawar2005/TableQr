import type { QuickNote } from "@/domain/item-sheet";
import type { Lang } from "@/lib/i18n";

// G4 item sheet words in English and Hindi. Quick-note chips are labelled in the guest's
// language but always save their English text for the kitchen.

const en = {
  close: "Close",
  sheetLabel: (name: string) => `${name}, details`,

  required: "Required",
  optional: "Optional",
  choose: {
    one: () => "Choose 1",
    exact: (n: number) => `Choose ${n}`,
    upTo: (n: number) => `Choose up to ${n}`,
    range: (a: number, b: number) => `Choose ${a} to ${b}`,
  },
  unavailable: "Unavailable",
  upToReached: (n: number) => `You can choose up to ${n}`,
  // Group names may already start with "Choose" ("Choose bread")
  chooseToAdd: (group: string) => (/^choose\b/i.test(group) ? `${group} to add` : `Choose ${group.toLowerCase()} to add`),

  quantity: "Quantity",
  lessOne: (name: string) => `One less ${name}`,
  moreOne: (name: string) => `One more ${name}`,
  maxReached: "Maximum 50",
  alreadyInCart: (n: number) => `${n} already in your cart`,

  noteLabel: "Add a note (optional)",
  notePlaceholder: "For example, less oil",
  noteCount: (n: number) => `${n}/140`,
  quickNotes: "Quick notes",
  chip: { "Less spicy": "Less spicy", "No onion": "No onion", Jain: "Jain" } as Record<QuickNote, string>,

  contains: (list: string) => `Contains: ${list}`,
  declaredNone: "None of the listed allergens declared by the restaurant",
  allergenUnknown: "Allergen information is incomplete. Please ask staff.",
  clashTitle: (list: string) => `Contains ${list}`,
  clashBody: (list: string) => `You chose to avoid ${list.toLowerCase()}. This dish contains ${list.toLowerCase()}.`,
  ackClash: (list: string) => `I understand this dish contains ${list}.`,
  ackUnknown: "I understand allergen information is incomplete.",
  ackToAdd: "Tick the allergen note to add",

  addToCart: (price: string) => `Add to cart · ${price}`,
  adding: "Adding…",
  backSoon: "Back soon",
  soldOutTitle: "Currently sold out",
  soldOutBody: "This dish isn't available right now.",
  nowSoldOut: "This item is now sold out.",
  outsideHours: "This dish isn't available at this time.",
  pausedBy: (name: string | null) => (name ? `Ordering paused by ${name}` : "Ordering paused by the host"),
  billRequested: "Bill requested. New orders are paused.",
  canStillView: "You can still view this dish.",
  ctaPaused: "Ordering paused",
  ctaBill: "Bill requested",
  ctaUnavailable: "Not available right now",

  failed: "Couldn't add to cart. Try again.",
  optionGone: "One of your choices just became unavailable.",
  maxQty: "You can have up to 50 of this dish.",
  slow: "Slow connection. Still adding…",
};

export type G4Copy = typeof en;

const hi: G4Copy = {
  close: "बंद करें",
  sheetLabel: (name) => `${name}, जानकारी`,

  required: "ज़रूरी",
  optional: "वैकल्पिक",
  choose: {
    one: () => "1 चुनें",
    exact: (n) => `${n} चुनें`,
    upTo: (n) => `${n} तक चुनें`,
    range: (a, b) => `${a} से ${b} चुनें`,
  },
  unavailable: "उपलब्ध नहीं",
  upToReached: (n) => `आप ${n} तक चुन सकते हैं`,
  chooseToAdd: (group) => (group.endsWith("चुनें") ? `जोड़ने के लिए ${group}` : `जोड़ने के लिए ${group} चुनें`),

  quantity: "मात्रा",
  lessOne: (name) => `एक ${name} कम`,
  moreOne: (name) => `एक ${name} और`,
  maxReached: "अधिकतम 50",
  alreadyInCart: (n) => `आपके कार्ट में पहले से ${n}`,

  noteLabel: "नोट जोड़ें (वैकल्पिक)",
  notePlaceholder: "जैसे, कम तेल",
  noteCount: (n) => `${n}/140`,
  quickNotes: "झटपट नोट",
  chip: { "Less spicy": "कम तीखा", "No onion": "प्याज़ नहीं", Jain: "जैन" },

  contains: (list) => `इसमें है: ${list}`,
  declaredNone: "रेस्टोरेंट ने सूची की कोई एलर्जी वाली चीज़ नहीं बताई है",
  allergenUnknown: "एलर्जी जानकारी अधूरी है। कृपया स्टाफ से पूछें।",
  clashTitle: (list) => `इसमें ${list} है`,
  clashBody: (list) => `आपने ${list} से बचना चुना है। इस डिश में ${list} है।`,
  ackClash: (list) => `मैं समझता/समझती हूँ कि इस डिश में ${list} है।`,
  ackUnknown: "मैं समझता/समझती हूँ कि एलर्जी जानकारी अधूरी है।",
  ackToAdd: "जोड़ने के लिए एलर्जी नोट पर टिक करें",

  addToCart: (price) => `कार्ट में जोड़ें · ${price}`,
  adding: "जोड़ रहे हैं…",
  backSoon: "जल्द वापस",
  soldOutTitle: "अभी ख़त्म है",
  soldOutBody: "यह डिश अभी उपलब्ध नहीं है।",
  nowSoldOut: "यह डिश अभी ख़त्म हो गई।",
  outsideHours: "यह डिश इस समय उपलब्ध नहीं है।",
  pausedBy: (name) => (name ? `${name} ने ऑर्डर रोका है` : "होस्ट ने ऑर्डर रोका है"),
  billRequested: "बिल माँगा गया है। नए ऑर्डर रुके हैं।",
  canStillView: "आप यह डिश देख सकते हैं।",
  ctaPaused: "ऑर्डर रुका है",
  ctaBill: "बिल माँगा गया है",
  ctaUnavailable: "अभी उपलब्ध नहीं",

  failed: "कार्ट में नहीं जुड़ सका। फिर से कोशिश करें।",
  optionGone: "आपका एक चुना हुआ विकल्प अभी उपलब्ध नहीं रहा।",
  maxQty: "इस डिश की अधिकतम 50 मात्रा हो सकती है।",
  slow: "कनेक्शन धीमा है। अभी जोड़ रहे हैं…",
};

export const g4Copy: Record<Lang, G4Copy> = { en, hi };
