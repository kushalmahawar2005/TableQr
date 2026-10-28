import type { Lang } from "@/lib/i18n";
import type { SetupStepKey } from "@/server/staff/guide";

// Words for the first-run guide: the welcome slides, the spotlight tour and the setup list.
// Plain, short sentences; Hindi uses everyday words staff already say.

type Copy = {
  welcome: { title: (name: string) => string; body: string; slides: { title: string; body: string }[]; start: string; skip: string; next: string; back: string };
  tour: {
    intro: { title: string; body: string };
    sections: Partial<Record<string, string>>;
    kitchen: { title: string; body: string };
    bell: { title: string; body: string };
    help: { title: string; body: string };
    next: string;
    back: string;
    skip: string;
    done: string;
    of: (n: number, total: number) => string;
  };
  help: string;
  setup: {
    title: string;
    body: string;
    progress: (done: number, total: number) => string;
    hide: string;
    allDone: string;
    allDoneBody: string;
    go: string;
    tour: string;
    steps: Record<SetupStepKey, { title: string; body: string }>;
  };
};

const en: Copy = {
  welcome: {
    title: (name) => `Welcome to Tableeqr, ${name}`,
    body: "Your whole restaurant on one simple screen. Here is how it works.",
    slides: [
      { title: "Guests scan and order", body: "Every table gets a QR code. Guests open your menu on their phone and order. No app to install." },
      { title: "The kitchen gets it at once", body: "Orders go straight to the kitchen screen. Waiters get a ping when food is ready." },
      { title: "Bills and reports, done for you", body: "GST bills, daily sales and your best-selling dishes are worked out on their own." },
    ],
    start: "Show me around",
    skip: "I'll explore myself",
    next: "Next",
    back: "Back",
  },
  tour: {
    intro: { title: "A quick tour", body: "One minute. We'll show you where everything is. You can skip at any time." },
    sections: {
      dashboard: "Today at a glance: sales, open tables, bookings and what needs you now.",
      floor: "Your tables live here. See who is sitting where and open any table.",
      rooms: "Hotel rooms: check guests in and out, and see room service requests.",
      reservations: "Table bookings. Add one for a phone call, or see what guests booked online.",
      orders: "Every order, live. Confirm, cancel or move items between tables.",
      billing: "Make the bill, take payment by cash, card or UPI, and print or WhatsApp it.",
      menu: "Your dishes and prices. Mark a dish out of stock in one tap.",
      inventory: "Stock of raw items. It goes down on its own as dishes sell.",
      reports: "Sales, GST, best dishes and staff reports. Download for your CA.",
      team: "Add waiters, cashiers and kitchen staff, each with their own PIN.",
      settings: "Restaurant name, timings, GST number and how ordering works.",
    },
    kitchen: { title: "Kitchen screen", body: "Open the kitchen board here. Put it on a tablet in the kitchen." },
    bell: { title: "Alerts", body: "New orders, waiter calls and bill requests ring here." },
    help: { title: "Need help later?", body: "Tap here to see this tour again whenever you like." },
    next: "Next",
    back: "Back",
    skip: "Skip tour",
    done: "Got it",
    of: (n, total) => `${n} of ${total}`,
  },
  help: "Take the tour",
  setup: {
    title: "Get your restaurant ready",
    body: "A few steps and guests can start ordering. Each one ticks itself when it's done.",
    progress: (d, t) => `${d} of ${t} done`,
    hide: "Hide",
    allDone: "You're all set!",
    allDoneBody: "Your restaurant is ready for guests.",
    go: "Start",
    tour: "Take the tour",
    steps: {
      details: { title: "Add your opening hours", body: "So guests know when they can book and order." },
      menu: { title: "Add your menu", body: "Dishes, prices and photos. Pick from our ready list to go faster." },
      tables: { title: "Set up your tables", body: "Match the tables to your real floor." },
      rooms: { title: "Add your rooms", body: "One per room, so guests can order from their room." },
      qr: { title: "Print the QR codes", body: "Stick one on each table. Guests scan it to see the menu." },
      team: { title: "Add your staff", body: "Give waiters and kitchen staff their own sign-in." },
      order: { title: "Place a test order", body: "Scan a table QR with your phone and order something." },
    },
  },
};

const hi: Copy = {
  welcome: {
    title: (name) => `Tableeqr में स्वागत है, ${name}`,
    body: "पूरा रेस्टोरेंट एक आसान स्क्रीन पर। देखिए कैसे काम करता है।",
    slides: [
      { title: "ग्राहक स्कैन करके ऑर्डर करें", body: "हर टेबल पर एक QR कोड। ग्राहक फ़ोन पर मेन्यू खोलकर ऑर्डर करते हैं। कोई ऐप नहीं चाहिए।" },
      { title: "किचन को तुरंत ऑर्डर मिले", body: "ऑर्डर सीधे किचन स्क्रीन पर जाता है। खाना तैयार होते ही वेटर को सूचना मिलती है।" },
      { title: "बिल और रिपोर्ट अपने आप", body: "GST बिल, रोज़ की बिक्री और सबसे ज़्यादा बिकने वाली डिश, सब अपने आप।" },
    ],
    start: "मुझे दिखाइए",
    skip: "मैं खुद देख लूँगा",
    next: "आगे",
    back: "पीछे",
  },
  tour: {
    intro: { title: "छोटा सा टूर", body: "एक मिनट। हम दिखाएँगे कौन सी चीज़ कहाँ है। कभी भी छोड़ सकते हैं।" },
    sections: {
      dashboard: "आज का पूरा हाल: बिक्री, भरी टेबल, बुकिंग और ज़रूरी काम।",
      floor: "आपकी टेबल यहाँ हैं। कौन कहाँ बैठा है देखिए, कोई भी टेबल खोलिए।",
      rooms: "होटल रूम: चेक-इन, चेक-आउट और रूम सर्विस की रिक्वेस्ट।",
      reservations: "टेबल बुकिंग। फ़ोन पर आई बुकिंग जोड़िए या ऑनलाइन बुकिंग देखिए।",
      orders: "हर ऑर्डर, लाइव। कन्फ़र्म, कैंसल या टेबल बदलिए।",
      billing: "बिल बनाइए, कैश, कार्ड या UPI से पैसे लीजिए, प्रिंट या WhatsApp कीजिए।",
      menu: "आपकी डिश और दाम। एक टैप में डिश को खत्म दिखाइए।",
      inventory: "कच्चे सामान का स्टॉक। डिश बिकते ही अपने आप घटता है।",
      reports: "बिक्री, GST, टॉप डिश और स्टाफ रिपोर्ट। CA के लिए डाउनलोड कीजिए।",
      team: "वेटर, कैशियर और किचन स्टाफ जोड़िए, हर किसी का अपना PIN।",
      settings: "रेस्टोरेंट का नाम, समय, GST नंबर और ऑर्डर कैसे चलें।",
    },
    kitchen: { title: "किचन स्क्रीन", body: "किचन बोर्ड यहाँ से खोलिए। किचन में एक टैबलेट पर लगा दीजिए।" },
    bell: { title: "अलर्ट", body: "नए ऑर्डर, वेटर बुलाना और बिल की माँग यहाँ बजती है।" },
    help: { title: "बाद में मदद चाहिए?", body: "यह टूर दोबारा देखने के लिए यहाँ टैप कीजिए।" },
    next: "आगे",
    back: "पीछे",
    skip: "टूर छोड़ें",
    done: "समझ गया",
    of: (n, total) => `${n} / ${total}`,
  },
  help: "टूर देखें",
  setup: {
    title: "रेस्टोरेंट तैयार कीजिए",
    body: "बस कुछ काम, फिर ग्राहक ऑर्डर कर सकते हैं। काम होते ही अपने आप टिक हो जाता है।",
    progress: (d, t) => `${t} में से ${d} पूरे`,
    hide: "छुपाएँ",
    allDone: "सब तैयार है!",
    allDoneBody: "आपका रेस्टोरेंट ग्राहकों के लिए तैयार है।",
    go: "शुरू करें",
    tour: "टूर देखें",
    steps: {
      details: { title: "खुलने का समय डालिए", body: "ताकि ग्राहक जानें कब बुक और ऑर्डर कर सकते हैं।" },
      menu: { title: "मेन्यू जोड़िए", body: "डिश, दाम और फ़ोटो। जल्दी के लिए हमारी तैयार लिस्ट से चुनिए।" },
      tables: { title: "टेबल सेट कीजिए", body: "टेबल को अपने असली फ़्लोर जैसा बनाइए।" },
      rooms: { title: "रूम जोड़िए", body: "हर रूम का एक, ताकि ग्राहक रूम से ऑर्डर कर सकें।" },
      qr: { title: "QR कोड प्रिंट कीजिए", body: "हर टेबल पर एक चिपकाइए। ग्राहक स्कैन करके मेन्यू देखते हैं।" },
      team: { title: "स्टाफ जोड़िए", body: "वेटर और किचन स्टाफ को उनका अपना साइन-इन दीजिए।" },
      order: { title: "एक टेस्ट ऑर्डर कीजिए", body: "अपने फ़ोन से किसी टेबल का QR स्कैन करके कुछ ऑर्डर कीजिए।" },
    },
  },
};

export const guideCopy = (lang: Lang) => (lang === "hi" ? hi : en);

/** The tour opens from the top bar's help button and from the setup list */
export const TOUR_EVENT = "tq:tour";
export const startTour = () => window.dispatchEvent(new Event(TOUR_EVENT));
