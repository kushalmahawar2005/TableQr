import type { KdsCard } from "@/app/(staff)/kds/_components/kds-logic";
import type { OrderSlip } from "@/app/(console)/console/(app)/orders/_components/order-slip-print";
import type { PosBillDetail } from "@/server/staff/pos-read";
import type { DayClose } from "@/server/staff/day-close";

// Sample slips for the print layout tests and for previewing by hand (scripts/print-previews.ts).
// Every builder takes overrides so a test can change just what it is about.

export const ADDRESS_LONG = "Shop No. 14, Ground Floor, Raja Park Commercial Complex, Opposite Metro Pillar 123, Behind Central Bank, Jaipur";

type Line = { name: string; qty: number; unitPricePaise: number; note?: string | null; status?: string };

export const billDetail = (over: Partial<PosBillDetail> = {}) => ({
  tableCode: "T4",
  takeaway: false,
  seller: { name: "Spice Route", address: "MI Road", city: "Jaipur", gstin: "08AABCS1234F1Z5", fssai: "12345678901234" },
  invoice: { number: "SRJ01/26-27/000007", issuedAt: Date.UTC(2026, 9, 25, 9, 0) },
  lines: [{ name: "Paneer Tikka", qty: 2, unitPricePaise: 32000, note: null, status: "served" }],
  payments: [{ method: "upi", status: "success", amountPaise: 67200, tipPaise: 0 }],
  bill: { subtotalPaise: 64000, discountPaise: 0, serviceChargePaise: 0, deliveryFeePaise: 0, taxPaise: 3201, taxBreakup: { "500": 3201 }, roundOffPaise: -1, totalPaise: 67200 },
  ...over,
}) as unknown as PosBillDetail;

/** n different dishes, one to three of each, at different prices; the bill adds up to what it prints */
export function manyLines(n: number): { lines: PosBillDetail["lines"]; bill: PosBillDetail["bill"] } {
  const lines: Line[] = Array.from({ length: n }, (_, i) => ({ name: `Dish number ${i + 1}`, qty: (i % 3) + 1, unitPricePaise: 9000 + i * 1250, note: null, status: "served" }));
  const subtotalPaise = lines.reduce((s, l) => s + l.qty * l.unitPricePaise, 0);
  const taxPaise = Math.round(subtotalPaise * 0.05);
  return { lines: lines as unknown as PosBillDetail["lines"], bill: { subtotalPaise, discountPaise: 0, serviceChargePaise: 0, deliveryFeePaise: 0, taxPaise, taxBreakup: { "500": taxPaise }, roundOffPaise: 0, totalPaise: subtotalPaise + taxPaise } as unknown as PosBillDetail["bill"] };
}

export const kotCard = (over: Partial<KdsCard> = {}): KdsCard => ({
  ticketId: "t1", orderId: "o1", station: "Tandoor", stage: "placed", isNew: true, tableCodes: ["T4"], roundNo: 2, placedAt: Date.UTC(2026, 9, 12, 8, 30), elapsedMs: 0, targetMinutes: 15, urgency: "ok",
  orderNote: null, placedBy: null,
  lines: [{ id: "l1", qty: 2, nameEn: "Butter Naan", nameHi: null, modifiers: [], note: null, personalForPickup: false, allergens: null, jain: null, spice: null }],
  ...over,
} as unknown as KdsCard);

export const kotLine = (over: Record<string, unknown> = {}) => ({ id: `l-${Math.random()}`, qty: 1, nameEn: "Dal Makhani", nameHi: null, modifiers: [], note: null, personalForPickup: false, allergens: null, jain: null, spice: null, ...over }) as unknown as KdsCard["lines"][number];

export const orderSlip = (over: Partial<OrderSlip> = {}): OrderSlip => ({
  table: "T4", takeaway: false, roundNo: 2, placedAt: "2026-10-25T09:10:00.000Z", statusLabel: "Cooking",
  items: [{ name: "Paneer Tikka", qty: 2 }, { name: "Butter Naan", qty: 4 }], note: null, totalPaise: 112500, ...over,
});

export const dayClose = (over: Partial<DayClose> = {}) => ({
  date: "2026-10-12", isToday: true, cutoffMinutes: 0,
  bills: { count: 2, subtotalPaise: 30000, discountPaise: 0, serviceChargePaise: 0, taxPaise: 1500, tipsPaise: 0, roundOffPaise: 0, totalPaise: 31500 },
  methods: [{ method: "upi", paise: 21000, count: 1 }, { method: "cash", paise: 10500, count: 1 }],
  collectedPaise: 31500, refunds: { count: 0, paise: 0 }, netPaise: 31500, orders: 7, itemsSold: 5,
  removed: { qty: 2, paise: 10000 }, visits: { count: 4, covers: 4 }, averageBillPaise: 15750,
  topItems: [{ name: "Tomato <Soup>", qty: 4, paise: 40000 }], openTables: [{ table: "T1", totalPaise: 0, takeaway: false }],
  ...over,
}) as DayClose;

/** A busy day: many methods, discounts, a refund, ten open tables and long dish names */
export const busyDayClose = () => dayClose({
  isToday: false,
  bills: { count: 148, subtotalPaise: 18_425_000, discountPaise: 420_000, serviceChargePaise: 310_000, taxPaise: 905_000, tipsPaise: 120_000, roundOffPaise: -35, totalPaise: 19_220_000 },
  methods: [{ method: "upi", paise: 11_000_000, count: 90 }, { method: "cash", paise: 6_500_000, count: 40 }, { method: "card", paise: 1_720_000, count: 18 }],
  collectedPaise: 19_220_000, refunds: { count: 2, paise: 45_000 }, netPaise: 19_175_000, orders: 210, itemsSold: 620, removed: { qty: 9, paise: 123_000 }, visits: { count: 150, covers: 410 }, averageBillPaise: 129_864,
  topItems: ["Hyderabadi Dum Biryani with Raita and Salan Combo", "Paneer Butter Masala", "Butter Naan", "Masala Chai", "Cold Coffee With Ice Cream"].map((name, i) => ({ name, qty: 80 - i * 9, paise: 2_400_000 - i * 300_000 })),
  openTables: [...Array.from({ length: 9 }, (_, i) => ({ table: `T${i + 1}`, totalPaise: 120_000 + i * 5000, takeaway: false })), { table: "TA-4", totalPaise: 45_000, takeaway: true }],
});
