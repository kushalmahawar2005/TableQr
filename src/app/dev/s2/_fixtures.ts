import type { KdsDeviceView, KdsPreview } from "@/app/(staff)/kds/_components/kds-screen";
import type { KdsCard } from "@/app/(staff)/kds/_components/kds-logic";
import type { Lang } from "@/lib/i18n";
import type { KdsBoard } from "@/server/kitchen/kds";

// Sample Friday dinner at Spice Route for the S2 review board. Sample data only; station names
// here are this sample outlet's own, not a fixed list in the product.

export const NOW = Date.parse("2026-10-02T14:45:00Z"); // 8:15 pm IST
const MIN = 60_000;
const SEC = 1000;
const STATIONS = ["Bar", "Cold", "Dessert", "Main", "Tandoor"];

type Line = KdsCard["lines"][number];
let seq = 0;
const line = (nameEn: string, station: string, over: Partial<Line> = {}): Line => ({
  id: `l-${++seq}`,
  qty: 1,
  nameEn,
  nameHi: null,
  modifiers: [],
  note: null,
  personalForPickup: false,
  allergens: [],
  jain: false,
  spice: null,
  station,
  status: "preparing",
  otherStation: false,
  done: false,
  ...over,
});

const card = (ticketId: string, station: string, ageMs: number, lines: Line[], over: Partial<KdsCard> = {}): KdsCard => {
  const stage = over.stage ?? "preparing";
  return {
    ticketId,
    orderId: `o-${ticketId}`,
    station,
    stage,
    isNew: stage === "placed",
    tableCodes: ["T3"],
    roundNo: 1,
    placedAt: NOW - ageMs,
    elapsedMs: ageMs,
    targetMinutes: 15,
    urgency: "on_time",
    guests: 4,
    source: "qr",
    placedBy: null,
    orderNote: null,
    lines: lines.map((l) => ({ ...l, otherStation: l.station !== station, status: l.station !== station ? l.status : stage === "preparing" ? l.status : stage, done: l.done || l.status === "ready" || l.status === "served" })),
    ...over,
  };
};

// The sample floor tonight
const C = {
  tandoorT3: card("tk-1", "Tandoor", 6 * MIN, [line("Paneer Tikka", "Tandoor", { qty: 2, allergens: ["dairy"] }), line("Garlic Naan", "Tandoor", { qty: 3, allergens: ["gluten", "dairy"] }), line("Butter Chicken", "Main", { allergens: ["dairy", "tree_nuts"] })], { targetMinutes: 14, placedBy: { kind: "guest", name: "Aarav" } }),
  mainT8: card("tk-2", "Main", 21 * MIN, [line("Dal Makhani", "Main", { qty: 2, allergens: ["dairy"] }), line("Butter Chicken", "Main", { allergens: ["dairy", "tree_nuts"], modifiers: [{ en: "Extra gravy", hi: "एक्स्ट्रा ग्रेवी" }] }), line("Jeera Rice", "Main", { qty: 2 })], { tableCodes: ["T8"], targetMinutes: 18, guests: 6, roundNo: 2, placedBy: { kind: "staff", name: "Ravi" }, source: "walk_in" }),
  coldB2: card("tk-3", "Cold", 3 * MIN, [line("Kachumber Salad", "Cold", { jain: true }), line("Masala Papad", "Cold", { qty: 2, allergens: [] })], { tableCodes: ["B2"], targetMinutes: 6, guests: 2 }),
  barT10: card("tk-4", "Bar", 9 * MIN, [line("Masala Chaas", "Bar", { qty: 3, allergens: ["dairy"] }), line("Fresh Lime Soda", "Bar", { qty: 2, modifiers: [{ en: "Sweet", hi: "मीठा" }] })], { tableCodes: ["T10"], targetMinutes: 5, guests: 5 }),
  dessertP1: card("tk-5", "Dessert", 2 * MIN, [line("Gulab Jamun", "Dessert", { qty: 4, allergens: ["dairy", "gluten"] }), line("Kulfi", "Dessert", { qty: 2, allergens: ["dairy", "tree_nuts"] })], { tableCodes: ["P1"], targetMinutes: 8, guests: 10, roundNo: 3 }),
  mainT4placed: card("tk-6", "Main", 40 * SEC, [line("Kadai Paneer", "Main", { allergens: ["dairy"], spice: 2 }), line("Tandoori Roti", "Tandoor", { qty: 4, allergens: ["gluten"] })], { tableCodes: ["T4"], stage: "placed", targetMinutes: 16, guests: 3, placedBy: { kind: "guest", name: "Neha" } }),
};

function board(cards: KdsCard[], over: Partial<KdsBoard> = {}): KdsBoard {
  // Counts come from this state's own tickets (awaiting confirmation is not a cookable ticket),
  // exactly as the live board counts open tickets
  const live = cards.filter((c) => !c.awaitingStaff);
  const counts: Record<string, number> = { All: live.length };
  for (const c of live) counts[c.station] = (counts[c.station] ?? 0) + 1;
  // A station screen's last bump is always its own station's, as the server scopes it
  const station = over.station ?? null;
  return {
    station,
    stations: STATIONS,
    counts,
    staleOpen: over.staleOpen ?? 0,
    cards,
    lastBumped: { ticketId: "tk-old", station: station ?? "Tandoor", tableCode: "T2", roundNo: 1, bumpedAt: NOW - 3 * MIN, recallUntil: NOW + 7 * MIN, blocked: null },
    unavailable: [{ id: "i-1", nameEn: "Mutton Rogan Josh", nameHi: "मटन रोगन जोश", station: "Main", until: NOW + 6 * 60 * MIN }],
    avgMinutes: 17,
    renderedAt: NOW,
    ...over,
  };
}

const expeditor: KdsDeviceView = { station: null, expeditor: true, lang: "en", outletName: "Spice Route · Indiranagar", timezone: "Asia/Kolkata" };
const at = (station: string, lang: Lang = "en"): KdsDeviceView => ({ ...expeditor, station, expeditor: false, lang });

export type S2Case = {
  id: string;
  label: string;
  /** Viewport for screenshots: 1366×768 unless set */
  size?: [number, number];
  setup?: { step?: "creds" | "station"; stations?: string[]; error?: string; outlet?: string; phone?: string; lang?: Lang };
  board?: KdsBoard;
  device?: KdsDeviceView;
  preview?: KdsPreview;
};

const mixed = [C.mainT8, C.barT10, C.tandoorT3, C.coldB2, C.dessertP1, C.mainT4placed];
const only = (st: string) => board(mixed.filter((c) => c.station === st), { station: st });

export function s2Cases(): S2Case[] {
  return [
    { id: "01-mixed", label: "1 · Normal mixed service (expeditor)", board: board(mixed), device: expeditor, preview: { conn: "live" } },
    { id: "02-new", label: "2 · New ticket arrives", board: board([C.mainT4placed, C.mainT8], { station: "Main" }), device: at("Main"), preview: { conn: "live" } },
    { id: "03-placed", label: "3 · Placed, waiting for Accept", board: board([card("tk-p", "Main", 4 * MIN, [line("Chicken Biryani", "Main", { qty: 2, spice: 3 }), line("Raita", "Cold", { allergens: ["dairy"] })], { tableCodes: ["T7"], stage: "placed", targetMinutes: 20 })], { station: "Main" }), device: at("Main"), preview: { conn: "live" } },
    { id: "04-accepted", label: "4 · Accepted, Start preparing next", board: board([card("tk-a", "Main", 2 * MIN, [line("Chicken Biryani", "Main", { qty: 2, spice: 3 })], { tableCodes: ["T7"], stage: "accepted", targetMinutes: 20 })], { station: "Main" }), device: at("Main"), preview: { conn: "live" } },
    { id: "05-preparing", label: "5 · Preparing, bump lines or ticket", board: board([card("tk-pr", "Main", 7 * MIN, [line("Chicken Biryani", "Main", { qty: 2, spice: 3 }), line("Mirchi Salan", "Main")], { tableCodes: ["T7"], targetMinutes: 20 })], { station: "Main" }), device: at("Main"), preview: { conn: "live" } },
    { id: "06-on-time", label: "6 · On time", board: board([C.tandoorT3], { station: "Tandoor" }), device: at("Tandoor"), preview: { conn: "live" } },
    { id: "07-amber", label: "7 · Getting late (≥ target)", board: board([card("tk-am", "Tandoor", 15 * MIN, [line("Tandoori Chicken", "Tandoor", { allergens: ["dairy"] })], { tableCodes: ["T9"], targetMinutes: 15 })], { station: "Tandoor" }), device: at("Tandoor"), preview: { conn: "live" } },
    { id: "08-red", label: "8 · Late (≥ 1.5× target)", board: board([card("tk-red", "Tandoor", 22 * MIN + 30 * SEC, [line("Tandoori Chicken", "Tandoor", { allergens: ["dairy"] })], { tableCodes: ["T9"], targetMinutes: 15 })], { station: "Tandoor" }), device: at("Tandoor"), preview: { conn: "live" } },
    {
      id: "09-several-late",
      label: "9 · Several late, oldest first",
      board: board(
        [
          card("tk-l1", "Main", 31 * MIN, [line("Dal Makhani", "Main", { allergens: ["dairy"] })], { tableCodes: ["T1"], targetMinutes: 18 }),
          card("tk-l2", "Main", 40 * MIN, [line("Butter Chicken", "Main", { allergens: ["dairy", "tree_nuts"] })], { tableCodes: ["T2"], targetMinutes: 18 }),
          card("tk-l3", "Main", 19 * MIN, [line("Kadai Paneer", "Main", { allergens: ["dairy"] })], { tableCodes: ["T3"], targetMinutes: 16 }),
          card("tk-l4", "Main", 5 * MIN, [line("Jeera Rice", "Main")], { tableCodes: ["T4"], targetMinutes: 12 }),
        ],
        { station: "Main" },
      ),
      device: at("Main"),
      preview: { conn: "live" },
    },
    { id: "10-tandoor", label: "10 · Tandoor station", board: only("Tandoor"), device: at("Tandoor"), preview: { conn: "live" } },
    { id: "11-main", label: "11 · Main station", board: only("Main"), device: at("Main"), preview: { conn: "live" } },
    { id: "12-cold", label: "12 · Cold station", board: only("Cold"), device: at("Cold"), preview: { conn: "live" } },
    { id: "13-bar", label: "13 · Bar station", board: only("Bar"), device: at("Bar"), preview: { conn: "live" } },
    { id: "14-dessert", label: "14 · Dessert station", board: only("Dessert"), device: at("Dessert"), preview: { conn: "live" } },
    { id: "15-all", label: "15 · All / expeditor", size: [1920, 1080], board: board(mixed), device: expeditor, preview: { conn: "live" } },
    { id: "16-mixed-station", label: "16 · Mixed-station order (others dimmed)", board: board([C.tandoorT3], { station: "Tandoor" }), device: at("Tandoor"), preview: { conn: "live" } },
    {
      id: "17-notes",
      label: "17 · Note-heavy ticket",
      board: board(
        [card("tk-n", "Main", 6 * MIN, [line("Butter Chicken", "Main", { note: "Mild — child eating, no green chilli", allergens: ["dairy", "tree_nuts"] }), line("Dal Makhani", "Main", { note: "Less butter, no cream on top" }), line("Jeera Rice", "Main", { note: "Pack separately" })], { tableCodes: ["T11"], orderNote: "Guest celebrating birthday. Serve mains together.", targetMinutes: 18 })],
        { station: "Main" },
      ),
      device: at("Main"),
      preview: { conn: "live" },
    },
    {
      id: "18-modifiers",
      label: "18 · Modifiers",
      board: board([card("tk-m", "Main", 4 * MIN, [line("Thali", "Main", { qty: 2, modifiers: [{ en: "Paneer curry", hi: null }, { en: "Extra roti", hi: null }, { en: "No onion", hi: null }] }), line("Butter Chicken", "Main", { modifiers: [{ en: "Boneless", hi: null }, { en: "Butter naan", hi: null }] })], { tableCodes: ["T5"] })], { station: "Main" }),
      device: at("Main"),
      preview: { conn: "live" },
    },
    { id: "19-allergens", label: "19 · Allergen warnings", board: board([card("tk-al", "Main", 5 * MIN, [line("Kaju Curry", "Main", { allergens: ["tree_nuts", "dairy"] }), line("Prawn Masala", "Main", { allergens: ["shellfish", "mustard"] }), line("Peanut Chaat", "Cold", { allergens: ["peanuts"] })], { tableCodes: ["T6"] })], { station: "Main" }), device: at("Main"), preview: { conn: "live" } },
    { id: "20-allergen-unknown", label: "20 · Allergens unknown (older order)", board: board([card("tk-un", "Main", 5 * MIN, [line("Chef's Special Curry", "Main", { allergens: null, jain: null }), line("Dal Tadka", "Main", { allergens: [] })], { tableCodes: ["T3"] })], { station: "Main" }), device: at("Main"), preview: { conn: "live" } },
    { id: "21-jain", label: "21 · Jain", board: board([card("tk-j", "Main", 4 * MIN, [line("Jain Paneer Masala", "Main", { jain: true, allergens: ["dairy"] }), line("Jain Dal", "Main", { qty: 2, jain: true })], { tableCodes: ["T7"], orderNote: "Strict Jain table — no onion, garlic or root vegetables" })], { station: "Main" }), device: at("Main"), preview: { conn: "live" } },
    {
      id: "22-hindi",
      label: "22 · Hindi screen and names",
      board: board(
        [
          card("tk-h", "Main", 8 * MIN, [line("Butter Chicken", "Main", { nameHi: "बटर चिकन", modifiers: [{ en: "Butter naan", hi: "बटर नान" }], allergens: ["dairy", "tree_nuts"], note: "कम तीखा" }), line("Dal Makhani", "Main", { nameHi: "दाल मखनी", qty: 2 }), line("Chef Special", "Main", { nameHi: null, allergens: null })], { tableCodes: ["T5", "T6"], roundNo: 2 }),
          card("tk-h2", "Main", 20 * MIN, [line("Kadai Paneer", "Main", { nameHi: "कड़ाही पनीर", jain: true })], { tableCodes: ["T2"], targetMinutes: 16 }),
        ],
        { station: "Main" },
      ),
      device: at("Main", "hi"),
      preview: { conn: "live", sound: "locked" },
    },
    {
      id: "23-partial",
      label: "23 · Partially bumped",
      board: board([card("tk-pb", "Tandoor", 9 * MIN, [line("Paneer Tikka", "Tandoor", { status: "ready", allergens: ["dairy"] }), line("Garlic Naan", "Tandoor", { qty: 3, allergens: ["gluten"] }), line("Tandoori Roti", "Tandoor", { qty: 2, status: "ready", allergens: ["gluten"] })], { tableCodes: ["T3"] })], { station: "Tandoor" }),
      device: at("Tandoor"),
      preview: { conn: "live" },
    },
    {
      id: "24-finished",
      label: "24 · Ticket bumped, leaving calmly",
      board: board([card("tk-f", "Tandoor", 11 * MIN, [line("Paneer Tikka", "Tandoor", { status: "ready" }), line("Garlic Naan", "Tandoor", { status: "ready" })], { tableCodes: ["T3"] }), C.tandoorT3], { station: "Tandoor" }),
      device: at("Tandoor"),
      preview: { conn: "live", leaving: ["tk-f"], toast: "Ticket bumped" },
    },
    { id: "25-recall", label: "25 · Recall available", board: board([C.tandoorT3], { station: "Tandoor" }), device: at("Tandoor"), preview: { conn: "live" } },
    { id: "26-recall-expired", label: "26 · Recall expired (> 10 min)", board: board([C.tandoorT3], { station: "Tandoor", lastBumped: { ticketId: "tk-old", station: "Tandoor", tableCode: "T2", roundNo: 1, bumpedAt: NOW - 14 * MIN, recallUntil: NOW - 4 * MIN, blocked: "expired" } }), device: at("Tandoor"), preview: { conn: "live" } },
    { id: "27-recall-served", label: "27 · Recall blocked, already served", board: board([C.tandoorT3], { station: "Tandoor", lastBumped: { ticketId: "tk-old", station: "Tandoor", tableCode: "T2", roundNo: 1, bumpedAt: NOW - 4 * MIN, recallUntil: NOW + 6 * MIN, blocked: "served" } }), device: at("Tandoor"), preview: { conn: "live" } },
    {
      id: "28-stock",
      label: "28 · Out-of-stock panel",
      board: board([C.mainT8], { station: "Main" }),
      device: at("Main"),
      preview: { conn: "live", panel: "stock", stockQuery: "pan", stockHits: [{ id: "i-2", nameEn: "Paneer Tikka", nameHi: "पनीर टिक्का", station: "Tandoor" }, { id: "i-3", nameEn: "Kadai Paneer", nameHi: null, station: "Main" }, { id: "i-4", nameEn: "Palak Paneer", nameHi: null, station: "Main" }] },
    },
    { id: "29-restored", label: "29 · Dish restored", board: board([C.mainT8], { station: "Main", unavailable: [] }), device: at("Main"), preview: { conn: "live", panel: "stock", toast: "Mutton Rogan Josh is back on the menu" } },
    {
      id: "30-awaiting",
      label: "30 · Awaiting staff confirmation (read-only)",
      board: board([{ ...card("tk-aw", "Main", 1 * MIN, [line("Chicken Biryani", "Main", { qty: 8 }), line("Butter Chicken", "Main", { qty: 6, allergens: ["dairy", "tree_nuts"] })], { tableCodes: ["P1"], stage: "placed", guests: 14 }), awaitingStaff: true }], { station: "Main" }),
      device: at("Main"),
      preview: { conn: "live" },
    },
    { id: "31-combined", label: "31 · Combined tables T5 + T6", board: board([card("tk-c", "Main", 7 * MIN, [line("Butter Chicken", "Main", { qty: 2, allergens: ["dairy", "tree_nuts"] }), line("Dal Makhani", "Main", { qty: 2, allergens: ["dairy"] })], { tableCodes: ["T5", "T6"], roundNo: 3, guests: 8, source: "reservation" })], { station: "Main" }), device: at("Main"), preview: { conn: "live" } },
    { id: "32-empty", label: "32 · Empty station", board: board([], { station: "Dessert", counts: { All: 0 }, lastBumped: null, unavailable: [] }), device: at("Dessert"), preview: { conn: "live" } },
    { id: "33-offline", label: "33 · Offline", board: board([C.mainT8, C.mainT4placed], { station: "Main" }), device: at("Main"), preview: { conn: "offline", offline: true } },
    { id: "34-reconnecting", label: "34 · Reconnecting", board: board([C.mainT8], { station: "Main" }), device: at("Main"), preview: { conn: "reconnecting" } },
    { id: "35-realtime-new", label: "35 · Realtime: new ticket just in", board: board([card("tk-rt", "Main", 8 * SEC, [line("Veg Pulao", "Main"), line("Boondi Raita", "Cold", { allergens: ["dairy"] })], { tableCodes: ["T12"], stage: "placed", targetMinutes: 14, placedBy: { kind: "guest", name: "Kabir" } }), C.mainT8], { station: "Main" }), device: at("Main"), preview: { conn: "live", sound: "on" } },
    { id: "36-sound-on", label: "36 · Sound enabled", board: board([C.mainT8], { station: "Main" }), device: at("Main"), preview: { conn: "live", sound: "on" } },
    { id: "37-sound-off", label: "37 · Sound muted", board: board([C.mainT8], { station: "Main" }), device: at("Main"), preview: { conn: "live", sound: "off" } },
    { id: "38-denied", label: "38 · Permission denied (kitchen PIN at setup)", setup: { step: "creds", outlet: "SRJ01", phone: "9000000006", error: "Only a manager or owner can do this." } },
    { id: "39-setup", label: "39 · Device setup", setup: { step: "creds" } },
    { id: "39b-setup-station", label: "39b · Device setup: pin station", setup: { step: "station", stations: STATIONS, outlet: "SRJ01", phone: "9000000002" } },
    { id: "39c-settings", label: "39c · Device settings (PIN protected)", board: board([C.mainT8], { station: "Main" }), device: at("Main"), preview: { conn: "live", panel: "settings" } },
    { id: "40-1366", label: "40 · 1366×768 wall screen", size: [1366, 768], board: board(mixed), device: expeditor, preview: { conn: "live", sound: "on" } },
    { id: "41-1920", label: "41 · 1920×1080 wall screen", size: [1920, 1080], board: board([...mixed, card("tk-x1", "Main", 13 * MIN, [line("Rogan Josh", "Main")], { tableCodes: ["T1"], targetMinutes: 18 }), card("tk-x2", "Tandoor", 16 * MIN, [line("Seekh Kebab", "Tandoor", { qty: 2 })], { tableCodes: ["B4"], targetMinutes: 12 })]), device: expeditor, preview: { conn: "live", sound: "on" } },
  ];
}
