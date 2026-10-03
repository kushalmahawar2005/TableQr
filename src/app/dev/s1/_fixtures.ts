import type { FloorPreview } from "@/app/(console)/console/(app)/floor/_components/floor-screen";
import type { FloorData, FloorTable, TableDetail } from "@/server/floor/read";

// Sample Friday dinner at Spice Route for the S1 review board. Sample data only.

export const NOW = Date.parse("2026-10-02T14:45:00Z"); // 8:15 pm IST
const MIN = 60_000;
const zones = [
  { id: "z-in", name: "Indoor" },
  { id: "z-te", name: "Terrace" },
  { id: "z-bar", name: "Bar" },
  { id: "z-pr", name: "Private room" },
];

type Spec = { code: string; zone: string; min: number; max: number; cls: string; shape: "square" | "round" | "long"; x: number; y: number; w?: number; combine?: string[] };
const FLOOR: Spec[] = [
  { code: "T1", zone: "z-in", min: 1, max: 2, cls: "2-top", shape: "round", x: 0, y: 0 },
  { code: "T2", zone: "z-in", min: 1, max: 2, cls: "2-top", shape: "round", x: 3, y: 0 },
  { code: "T3", zone: "z-in", min: 2, max: 4, cls: "4-top", shape: "square", x: 6, y: 0 },
  { code: "T4", zone: "z-in", min: 2, max: 4, cls: "4-top", shape: "square", x: 9, y: 0 },
  { code: "T5", zone: "z-in", min: 2, max: 4, cls: "4-top", shape: "square", x: 0, y: 3, combine: ["T6"] },
  { code: "T6", zone: "z-in", min: 2, max: 4, cls: "4-top", shape: "square", x: 3, y: 3, combine: ["T5"] },
  { code: "T7", zone: "z-in", min: 1, max: 2, cls: "2-top", shape: "round", x: 6, y: 3 },
  { code: "T8", zone: "z-in", min: 4, max: 8, cls: "6-top", shape: "long", x: 9, y: 3, w: 4 },
  { code: "T11", zone: "z-in", min: 2, max: 4, cls: "4-top", shape: "square", x: 0, y: 6, combine: ["T12"] },
  { code: "T12", zone: "z-in", min: 2, max: 4, cls: "4-top", shape: "square", x: 3, y: 6, combine: ["T11"] },
  { code: "T9", zone: "z-te", min: 2, max: 4, cls: "4-top", shape: "square", x: 0, y: 0 },
  { code: "T10", zone: "z-te", min: 2, max: 4, cls: "4-top", shape: "square", x: 3, y: 0 },
  ...[1, 2, 3, 4, 5].map((n): Spec => ({ code: `B${n}`, zone: "z-bar", min: 1, max: 2, cls: "bar", shape: "round", x: (n - 1) * 2, y: 0 })),
  { code: "P1", zone: "z-pr", min: 6, max: 12, cls: "12-top", shape: "long", x: 0, y: 0, w: 4 },
];
const id = (code: string) => `t-${code}`;

type Visit = NonNullable<FloorTable["visit"]>;
const visit = (sessionId: string, tables: string[], over: Partial<Visit> = {}): Visit => ({
  sessionId,
  tableIds: tables.map(id),
  status: "open",
  source: "qr",
  partySize: 4,
  joined: 3,
  guestName: null,
  openedAt: NOW - 52 * MIN,
  expectedEndAt: NOW + 38 * MIN,
  rounds: 2,
  openItems: 3,
  orderedPaise: 184000,
  billTotalPaise: null,
  openRequests: 0,
  isPrimary: true,
  ...over,
});
type Booking = FloorData["arrivals"][number];
const booking = (rid: string, name: string, size: number, inMin: number, tables: string[], over: Partial<Booking> = {}): Booking => ({
  id: rid,
  name,
  phone: "98xxxxxx10",
  partySize: size,
  startAt: NOW + inMin * MIN,
  status: "confirmed",
  held: false,
  confirmed: true,
  noReply: false,
  lateMinutes: inMin < 0 ? -inMin : 0,
  canNoShow: inMin <= -15,
  occasion: null,
  notes: null,
  holdUntil: null,
  tableIds: tables.map(id),
  ...over,
});

const iyer = booking("r-iyer", "Iyer", 4, 15, ["T10"], { occasion: "Birthday", notes: "Cake at 9. Window seat if possible." });
const mehta = booking("r-mehta", "Mehta", 2, 40, ["T2"], { status: "reminded", confirmed: false, noReply: true });
const das = booking("r-das", "Das", 6, 75, ["T11", "T12"]);
const late = booking("r-khanna", "Khanna", 2, -22, ["T7"]);
const held = booking("r-online", "Online guest", 2, 90, ["B3"], { status: "requested", held: true, confirmed: false, holdUntil: NOW + 7 * MIN });

function table(spec: Spec, over: Partial<FloorTable> = {}): FloorTable {
  return {
    id: id(spec.code),
    code: spec.code,
    zoneId: spec.zone,
    minSeats: spec.min,
    maxSeats: spec.max,
    tableClass: spec.cls,
    shape: spec.shape,
    x: spec.x,
    y: spec.y,
    w: spec.w ?? 2,
    h: 2,
    combinableWith: (spec.combine ?? []).map(id),
    state: "available",
    stateChangedAt: NOW - 20 * MIN,
    blocked: null,
    visit: null,
    booking: null,
    ...over,
  };
}

const dinner: Record<string, Partial<FloorTable>> = {
  T1: { state: "seated", visit: visit("s1", ["T1"], { partySize: 2, joined: 2, openedAt: NOW - 25 * MIN, rounds: 1, orderedPaise: 64000 }) },
  T3: { state: "seated", visit: visit("s3", ["T3"], { openedAt: NOW - 95 * MIN, expectedEndAt: NOW - 5 * MIN, rounds: 3, openRequests: 1 }) },
  T4: { state: "bill_requested", visit: visit("s4", ["T4"], { status: "bill_requested", billTotalPaise: 209000, rounds: 3, openItems: 0 }) },
  T5: { state: "seated", visit: visit("s5", ["T5", "T6"], { partySize: 7, joined: 4, source: "reservation", guestName: "Kapoor" }) },
  T6: { state: "seated", visit: { ...visit("s5", ["T5", "T6"], { partySize: 7, joined: 4, source: "reservation", guestName: "Kapoor" }), isPrimary: false } },
  T7: { state: "reserved", booking: late },
  T8: { state: "needs_cleaning", stateChangedAt: NOW - 6 * MIN },
  T10: { state: "reserved", booking: iyer },
  T2: { booking: mehta },
  T11: { booking: das },
  T12: { booking: das },
  T9: { state: "paid", stateChangedAt: NOW - 3 * MIN },
  B1: { state: "seated", visit: visit("sb1", ["B1"], { partySize: 1, joined: 0, source: "walk_in", openedAt: NOW - 8 * MIN, rounds: 0, openItems: 0, orderedPaise: 0 }) },
  B3: { state: "held", booking: held },
  B5: { state: "blocked", blocked: { reason: "maintenance", note: "Stool being repaired", until: NOW + 90 * MIN } },
  P1: { state: "blocked", blocked: { reason: "private_event", note: "Sharma family dinner", until: null } },
};

const slots = Array.from({ length: 22 }, (_, i) => {
  const startAt = Date.parse("2026-10-02T06:30:00Z") + i * 30 * MIN; // 12:00 pm IST onward
  const covers = [6, 10, 14, 8, 4, 0, 0, 0, 0, 0, 0, 2, 8, 16, 26, 34, 40, 38, 30, 18, 8, 2][i];
  const capacity = i === 16 ? 50 : 40;
  return { startAt, covers, capacity, extraCovers: i === 16 ? 10 : 0, state: (covers >= capacity ? "full" : covers >= capacity * 0.8 ? "near" : "normal") as "normal" | "near" | "full" };
});

export function floorData(over: Record<string, Partial<FloorTable>> = dinner, extra: Partial<FloorData> = {}): FloorData {
  return {
    renderedAt: NOW,
    outlet: { code: "SRJ01", name: "Spice Route", timezone: "Asia/Kolkata" },
    serviceDate: "2026-10-02",
    roles: ["host"],
    may: { seat: true, reset: true, block: false, bookings: true, pause: true, capacity: false, waitlist: true },
    layout: { version: "live", zones },
    tables: FLOOR.map((sp) => table(sp, over[sp.code] ?? {})),
    arrivals: [late, iyer, mehta, das],
    waitlist: [
      { id: "w1", name: "Gupta", phone: null, partySize: 2, joinedAt: NOW - 18 * MIN, waitedMinutes: 18, quotedMinutes: 15, estimateMinutes: 15, estimateSource: "staff", seatingPreference: null, readyDeadline: NOW + 5 * MIN, status: "notified", notes: null },
      { id: "w2", name: "Bose", phone: "98xxxxxx22", partySize: 4, joinedAt: NOW - 9 * MIN, waitedMinutes: 9, quotedMinutes: 25, estimateMinutes: 25, estimateSource: "fallback", seatingPreference: "Indoor", readyDeadline: null, status: "waiting", notes: "High chair" },
      { id: "w3", name: "Khan", phone: null, partySize: 3, joinedAt: NOW - 2 * MIN, waitedMinutes: 2, quotedMinutes: 30, estimateMinutes: 30, estimateSource: "fallback", seatingPreference: null, readyDeadline: null, status: "waiting", notes: null },
    ],
    pacing: { date: "2026-10-02", slots, paused: false, pausedAt: null },
    policy: { graceMinutes: 15, turnoverBufferMinutes: 15 },
    messaging: false,
    ...extra,
  };
}

const detail = (code: string, d: Partial<NonNullable<TableDetail["visit"]>> = {}): TableDetail => ({
  tableId: id(code),
  visit: {
    sessionId: "s3",
    status: "open",
    people: [
      { id: "p1", name: "Aarav", isHost: true, paidOut: false },
      { id: "p2", name: "Bhavna", isHost: false, paidOut: false },
      { id: "p3", name: null, isHost: false, paidOut: false },
    ],
    rounds: [
      { roundNo: 1, status: "served", placedAt: NOW - 80 * MIN, items: 5 },
      { roundNo: 2, status: "served", placedAt: NOW - 45 * MIN, items: 3 },
      { roundNo: 3, status: "preparing", placedAt: NOW - 10 * MIN, items: 2 },
    ],
    kitchen: [
      { name: "Butter Chicken", qty: 1, status: "preparing" },
      { name: "Garlic Naan", qty: 2, status: "accepted" },
    ],
    orderedPaise: 184000,
    bill: null,
    requests: [{ id: "q1", kind: "water", minutes: 6, escalated: true }],
    reservation: null,
    ...d,
  },
});

export type S1Case = { id: string; label: string; data: FloorData; preview: FloorPreview; lang?: "en" | "hi"; width?: number; height?: number; loading?: boolean; denied?: boolean };

export function s1Cases(): S1Case[] {
  const d = floorData();
  const manager = { ...d, roles: ["manager"] as FloorData["roles"], may: { ...d.may, block: true, capacity: true } };
  return [
    { id: "dinner", label: "1 · Normal dinner floor", data: d, preview: {} },
    { id: "indoor", label: "2 · Indoor", data: d, preview: { zone: "Indoor" } },
    { id: "terrace", label: "3 · Terrace", data: d, preview: { zone: "Terrace" } },
    { id: "bar", label: "4 · Bar", data: d, preview: { zone: "Bar" } },
    { id: "free", label: "5 · Free table selected", data: d, preview: { selected: "T12" } },
    { id: "reserved", label: "6 · Reserved table", data: d, preview: { selected: "T10" } },
    { id: "held", label: "7 · Held (online booking hold)", data: d, preview: { selected: "B3" } },
    { id: "seated", label: "8 · Seated (over time, request waiting)", data: d, preview: { selected: "T3", detail: detail("T3") } },
    { id: "bill", label: "9 · Bill requested", data: d, preview: { selected: "T4", detail: detail("T4", { bill: { totalPaise: 209000, requestedAt: NOW - 4 * MIN }, kitchen: [], requests: [] }) } },
    { id: "paid", label: "10 · Paid", data: d, preview: { selected: "T9" } },
    { id: "cleaning", label: "11 · Needs cleaning", data: d, preview: { selected: "T8" } },
    { id: "blocked", label: "12 · Blocked (host view)", data: d, preview: { selected: "B5" } },
    { id: "blocked-manager", label: "12b · Blocked (manager can unblock)", data: manager, preview: { selected: "P1" } },
    { id: "drawer", label: "13 · Combined party drawer", data: d, preview: { selected: "T5", detail: detail("T5", { reservation: { id: "r-k", name: "Kapoor", partySize: 7, startAt: NOW - 55 * MIN, occasion: "Anniversary", notes: null } }) } },
    { id: "seat", label: "14 · Seat walk-in", data: d, preview: { selected: "T12", sheet: { kind: "seat", tableId: id("T12") } } },
    { id: "seat-conflict", label: "14b · Walk-in before a booking (short turn)", data: d, preview: { selected: "T12", sheet: { kind: "seat", tableId: id("T12"), partySize: 4, error: { message: "Booked for Das (6) at 9:30 pm.", latestEndAt: NOW + 60 * MIN } } } },
    { id: "move", label: "15 · Move party", data: d, preview: { selected: "T1", sheet: { kind: "pick", mode: "move", tableId: id("T1") } } },
    { id: "swap", label: "16 · Swap tables", data: d, preview: { selected: "T1", sheet: { kind: "pick", mode: "swap", tableId: id("T1") } } },
    { id: "combine", label: "17 · Combine", data: floorData({ ...dinner, T6: {}, T5: { state: "seated", visit: visit("s5", ["T5"]) } }), preview: { selected: "T5", sheet: { kind: "pick", mode: "combine", tableId: id("T5") } } },
    { id: "extend-conflict", label: "18 · Extend refused (booking)", data: d, preview: { selected: "T3", detail: detail("T3"), notice: { text: "Booked for Iyer (4) at 8:30 pm.", error: true } } },
    { id: "arrivals", label: "19 · Arrivals", data: d, preview: { tab: "arrivals" } },
    { id: "late", label: "20 · Late arrival (no-show allowed)", data: d, preview: { tab: "arrivals", selected: "T7" } },
    { id: "no-show", label: "21 · After no-show", data: floorData({ ...dinner, T7: {} }, { arrivals: [iyer, mehta, das] }), preview: { tab: "arrivals", toast: "Khanna marked no-show" } },
    { id: "no-arrivals", label: "22 · Empty arrivals", data: floorData(dinner, { arrivals: [] }), preview: { tab: "arrivals" } },
    { id: "waitlist", label: "23 · Waitlist", data: d, preview: { tab: "waitlist" } },
    { id: "waitlist-drag", label: "24 · Waitlist drag / seat", data: d, preview: { tab: "waitlist", dragging: true, sheet: { kind: "pick", mode: "seat_waitlist", entryId: "w2" } } },
    { id: "pacing", label: "25 · Pacing normal", data: d, preview: { tab: "tonight" } },
    { id: "pacing-full", label: "26 · Pacing full (manager)", data: { ...manager, pacing: { ...d.pacing, slots: d.pacing.slots.map((s, i) => (i >= 14 && i <= 18 ? { ...s, covers: s.capacity, state: "full" as const } : s)) } }, preview: { tab: "tonight" } },
    { id: "paused", label: "27 · Online booking paused", data: { ...d, pacing: { ...d.pacing, paused: true, pausedAt: NOW - 20 * MIN } }, preview: { tab: "tonight" } },
    { id: "offline", label: "28 · Offline", data: d, preview: { offline: true, selected: "T3", detail: detail("T3") } },
    { id: "denied", label: "29 · Permission denied (waiter)", data: d, preview: {}, denied: true },
    { id: "loading", label: "30 · Loading", data: d, preview: {}, loading: true },
    { id: "w768", label: "31 · 768 landscape", data: d, preview: { selected: "T3", detail: detail("T3") }, width: 1024, height: 768 },
    { id: "w1024", label: "32 · 1280 desktop", data: d, preview: { tab: "arrivals" }, width: 1280, height: 800 },
    { id: "hindi", label: "33 · Hindi", lang: "hi", data: d, preview: { selected: "T3", detail: detail("T3") } },
    { id: "das-ready", label: "Multi-table booking: Seat on T11 + T12", data: d, preview: { selected: "T11" } },
    {
      id: "das-blocked",
      label: "Multi-table booking: one table taken",
      data: floorData({ ...dinner, T12: { state: "seated", booking: das, visit: visit("s12", ["T12"], { partySize: 2, joined: 2, openedAt: NOW - 30 * MIN, expectedEndAt: NOW + 45 * MIN }) } }),
      preview: { selected: "T11" },
    },
    { id: "toast", label: "Contextual success toast", data: floorData({ ...dinner, T7: {} }, { arrivals: [iyer, mehta, das] }), preview: { tab: "arrivals", toast: "Khanna marked no-show" } },
    { id: "block", label: "Block sheet (manager)", data: manager, preview: { selected: "T12", sheet: { kind: "block", tableId: id("T12") } } },
    { id: "waitlist-add", label: "Add to waitlist", data: d, preview: { tab: "waitlist", sheet: { kind: "waitlist_add" } } },
    { id: "empty", label: "Empty floor", data: floorData({}, { tables: [], arrivals: [], waitlist: [] }), preview: {} },
  ];
}
