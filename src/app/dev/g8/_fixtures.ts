import type { BillPreview } from "@/app/(guest)/r/[outlet]/t/[table]/bill/_components/bill-screen";
import type { BillScreenData } from "@/server/guest/bill-screen";

// Sample bills for the G8 review board: the PS 3.6 worked example. Sample data only.

export const NOW = Date.parse("2026-10-01T15:14:00Z");
type Person = BillScreenData["people"][number];

const person = (id: string, name: string | null, amount: number, extra: Partial<Person> = {}): Person => ({
  id,
  name,
  isMe: false,
  isHost: false,
  removed: false,
  paidAndLeft: false,
  amountPaise: amount * 100,
  paidPaise: 0,
  duePaise: amount * 100,
  status: "unpaid",
  basis: "items",
  paidBy: null,
  paidByMe: false,
  ...extra,
});
const paid = (p: Person, by: string | null = null): Person => ({ ...p, paidPaise: p.amountPaise, duePaise: 0, status: "paid", paidBy: by });

const line = (id: string, nameEn: string, nameHi: string, rupees: number, assignees: string[], qty = 1) => ({ id, nameEn, nameHi, qty, amountPaise: rupees * 100, assignees, settled: false });
const ids = ["A", "B", "C", "D"];

export const g8Base: BillScreenData = {
  renderedAt: NOW,
  outlet: { code: "SRJ01", name: "Spice Route", logoUrl: null, accentColor: "#C9482B" },
  table: { code: "T12" },
  session: { key: "dev-g8", status: "bill_requested", requested: true, isHost: true, hostName: "Aarav", hostIsMe: true, people: 4 },
  bill: {
    mode: "my_items",
    requestedAt: NOW,
    rounds: 3,
    itemCount: 11,
    locked: false,
    canEdit: true,
    reopened: false,
    totals: { subtotalPaise: 199000, discountPaise: 0, serviceChargePaise: 0, serviceChargeBp: 0, serviceChargeWaived: false, taxPaise: 9950, taxBreakup: { "500": 9950 }, roundOffPaise: 50, totalPaise: 209000 },
    paidCount: 0,
    custom: { ids, targetPaise: 209000, amounts: null, valid: false },
  },
  people: [
    person("A", "Aarav", 541, { isMe: true, isHost: true }),
    person("B", "Bhavna", 467),
    person("C", "Chirag", 620),
    person("D", "Divya", 462),
  ],
  mine: {
    amountPaise: 54100,
    paidPaise: 0,
    duePaise: 54100,
    basis: "items",
    detail: { ownItemsPaise: 39000, sharedItemsPaise: 12500, subtotalPaise: 51500, discountPaise: 0, serviceChargePaise: 0, taxPaise: 2575, roundOffPaise: 25 },
    ownItems: [
      { en: "Veg Biryani", hi: "वेज बिरयानी" },
      { en: "Masala Lassi", hi: "मसाला लस्सी" },
    ],
    sharedItems: [
      { en: "Paneer Tikka", hi: "पनीर टिक्का" },
      { en: "Masala Papad", hi: "मसाला पापड़" },
    ],
    equalBetween: 0,
  },
  lines: [
    line("l1", "Veg Biryani", "वेज बिरयानी", 280, ["A"]),
    line("l2", "Masala Lassi", "मसाला लस्सी", 110, ["A"]),
    line("l3", "Paneer Tikka", "पनीर टिक्का", 320, ["A", "B", "C", "D"]),
    line("l4", "Masala Papad", "मसाला पापड़", 90, ["A", "B"]),
    line("l5", "Dal Makhani", "दाल मखनी", 320, ["B"]),
    line("l6", "Butter Chicken", "बटर चिकन", 380, ["C"]),
    line("l7", "Cola", "कोला", 70, ["C"]),
    line("l8", "Garlic Naan", "गार्लिक नान", 60, ["C"]),
    line("l9", "Paneer Butter Masala", "पनीर बटर मसाला", 300, ["D"]),
    line("l10", "Tandoori Roti", "तंदूरी रोटी", 60, ["D"], 2),
  ],
  eligibleIds: ["A", "B", "C", "D"],
  tipPresetsBp: [500, 1000],
  onlinePayment: true,
  latestPayment: null,
  refundPendingPaise: 0,
  payAtCounter: null,
};

export type G8Case = { id: string; label: string; data: BillScreenData; preview: BillPreview; lang?: "en" | "hi"; solo?: boolean; loading?: boolean; width?: number; height?: number };

export function g8Cases(): G8Case[] {
  const b = g8Base;
  const withBill = (over: Partial<BillScreenData["bill"]>, rest: Partial<BillScreenData> = {}): BillScreenData => ({ ...b, ...rest, bill: { ...b.bill, ...over } });
  const somePaid: BillScreenData = withBill({ locked: true, canEdit: false, paidCount: 2 }, { people: [b.people[0], paid(b.people[1]), b.people[2], paid(b.people[3], "Bhavna")] });
  const equal = withBill({ mode: "equal" }, {
    people: b.people.map((p, i) => ({ ...p, amountPaise: [52300, 52300, 52200, 52200][i], duePaise: [52300, 52300, 52200, 52200][i], basis: "equal" as const })),
    mine: { ...b.mine!, amountPaise: 52300, duePaise: 52300, basis: "equal", detail: null, equalBetween: 4 },
  });
  // Custom is amount based: the host's figures, adding up exactly to the ₹2,090 bill
  const customAmounts = { A: 60000, B: 45000, C: 60000, D: 44000 };
  const custom = withBill({ mode: "custom", custom: { ids, targetPaise: 209000, amounts: customAmounts, valid: true } }, {
    people: [person("A", "Aarav", 600, { isMe: true, isHost: true, basis: "custom" }), person("B", "Bhavna", 450, { basis: "custom" }), person("C", "Chirag", 600, { basis: "custom" }), person("D", "Divya", 440, { basis: "custom" })],
    mine: { ...b.mine!, amountPaise: 60000, duePaise: 60000, basis: "custom", detail: null },
  });
  // Just switched to Custom: it starts from each person's My items amount
  const customFresh = withBill({ mode: "custom", custom: { ids, targetPaise: 209000, amounts: { A: 54100, B: 46700, C: 62000, D: 46200 }, valid: true } }, {
    people: b.people.map((p) => ({ ...p, basis: "custom" as const })),
    mine: { ...b.mine!, basis: "custom", detail: null },
  });
  const asGuest = (d: BillScreenData): BillScreenData => ({
    ...d,
    session: { ...d.session, isHost: false, hostIsMe: false },
    bill: { ...d.bill, canEdit: false },
    people: d.people.map((p) => ({ ...p, isMe: p.id === "B", isHost: p.id === "A" })),
    mine: { ...d.mine!, amountPaise: d.people[1].amountPaise, duePaise: d.people[1].duePaise },
  });
  const sc = withBill({ totals: { ...b.bill.totals, serviceChargeBp: 1000, serviceChargePaise: 19900, roundOffPaise: 50, totalPaise: 228900 } }, {
    people: [person("A", "Aarav", 593, { isMe: true, isHost: true }), person("B", "Bhavna", 512), person("C", "Chirag", 679), person("D", "Divya", 505)],
    mine: { ...b.mine!, amountPaise: 59300, duePaise: 59300, detail: { ...b.mine!.detail!, serviceChargePaise: 5150, roundOffPaise: -25 } },
  });
  return [
    {
      id: "before",
      label: "1 · Before bill requested",
      data: withBill({ canEdit: false, requestedAt: null }, { session: { ...b.session, status: "open", requested: false } }),
      preview: {},
    },
    { id: "before-all", label: "1b · Before: all ordered items", data: withBill({ canEdit: false, requestedAt: null }, { session: { ...b.session, status: "open", requested: false } }), preview: { allItems: true } },
    { id: "my-items", label: "2 · My items split", data: b, preview: {} },
    { id: "equal", label: "3 · Equal split", data: equal, preview: {} },
    { id: "custom-edit", label: "4 · Custom: host editing amounts", data: customFresh, preview: { custom: { A: "600", B: "450", C: "600", D: "440" } } },
    { id: "custom-remaining", label: "4b · Custom: Remaining > ₹0 (Save disabled)", data: customFresh, preview: { custom: { A: "600", B: "450", C: "600", D: "430" } } },
    { id: "custom-over", label: "4c · Custom: over the total", data: customFresh, preview: { custom: { A: "600", B: "450", C: "620", D: "440" } } },
    { id: "custom-host", label: "4d · Custom: saved, Remaining ₹0", data: custom, preview: {} },
    { id: "custom-guest", label: "5 · Custom split (non-host, read-only)", data: asGuest(custom), preview: {} },
    {
      id: "custom-locked",
      label: "5b · Custom locked after payment starts",
      data: { ...custom, bill: { ...custom.bill, locked: true, canEdit: false, paidCount: 1 }, people: [custom.people[0], { ...custom.people[1], status: "paying" as const }, paid(custom.people[2]), custom.people[3]] },
      preview: {},
    },
    { id: "some-paid", label: "6 · Some people paid (split locked)", data: somePaid, preview: {} },
    { id: "others", label: "7 · Pay for others picker", data: b, preview: { sheet: "others", payFor: ["A", "C"] }, solo: true },
    { id: "tip", label: "8 · Tip selected (10%)", data: b, preview: { tip: { kind: "bp", bp: 1000 } } },
    { id: "method", label: "9 · Payment method sheet", data: b, preview: { sheet: "method" }, solo: true },
    { id: "starting", label: "10 · Payment starting", data: b, preview: { pay: "starting" } },
    { id: "pending", label: "11 · Pending (checking)", data: { ...somePaid, people: somePaid.people.map((p) => (p.id === "A" ? { ...p, status: "paying" as const } : p)) }, preview: { pay: "verifying" } },
    { id: "unknown", label: "12 · Unknown / verifying", data: b, preview: { pay: "unknown" } },
    { id: "failed", label: "13 · Failed", data: b, preview: { pay: "failed" } },
    { id: "cancelled", label: "13b · Cancelled", data: b, preview: { pay: "cancelled" } },
    { id: "offline", label: "14 · Offline", data: b, preview: { offline: true } },
    { id: "reopened", label: "15 · Bill changed / reopened", data: withBill({ reopened: true, locked: true, canEdit: false, paidCount: 1 }, { people: [{ ...b.people[0] }, paid(b.people[1]), b.people[2], b.people[3]] }), preview: {} },
    { id: "sc-on", label: "16 · Service charge enabled", data: sc, preview: {} },
    { id: "sc-off", label: "17 · Service charge removed", data: { ...sc, bill: { ...sc.bill, totals: { ...sc.bill.totals, serviceChargeWaived: true, serviceChargePaise: 0, totalPaise: 209000 } }, people: b.people, mine: b.mine }, preview: {} },
    { id: "refund", label: "18 · Refund pending", data: { ...somePaid, refundPendingPaise: 27300 }, preview: {} },
    {
      id: "removed-left",
      label: "Removed person + paid and left",
      data: withBill({ locked: true, canEdit: false, paidCount: 1 }, {
        people: [b.people[0], { ...paid(b.people[1]), paidAndLeft: true, basis: "frozen" }, { ...b.people[2], removed: true }, b.people[3]],
      }),
      preview: {},
    },
    { id: "hindi", label: "19 · Hindi", lang: "hi", data: b, preview: { tip: { kind: "bp", bp: 500 } } },
    { id: "w320", label: "21 · 320 × 640", data: b, preview: {}, width: 320, height: 640 },
    { id: "w390", label: "22 · 390 × 844", data: b, preview: {}, width: 390, height: 844 },
    { id: "loading", label: "Loading", data: b, preview: {}, loading: true },
  ];
}
