import type { DashboardPreview } from "@/app/(console)/console/(app)/dashboard/_components/dashboard-screen";
import { localTime } from "@/domain/booking-policy";
import { addDays } from "@/domain/dashboard";
import type { DashboardData, RevenueTrend } from "@/server/staff/dashboard";

// Sample data for the O1 dashboard review board. Not used by the product.

const TZ = "Asia/Kolkata";
const DATE = "2026-10-04";
/** 8:10 pm at the outlet */
const NOW = localTime(DATE, 20 * 60 + 10, TZ).getTime();
const min = (m: number) => NOW + m * 60_000;
const floorTiles = Array.from({ length: 18 }, (_, index) => {
  const number = index + 1;
  const state: DashboardData["operations"]["tableTiles"][number]["state"] = number <= 4 ? "available" : number <= 6 ? "reserved" : number <= 15 ? "seated" : number <= 17 ? "bill_requested" : "blocked";
  return {
    id: `table-${number}`,
    code: `T${number}`,
    seats: [2, 4, 4, 4, 2, 4, 6, 4, 2, 4, 4, 6, 4, 2, 4, 4, 2, 4][index],
    state,
    guests: state === "seated" || state === "bill_requested" ? number % 5 + 1 : undefined,
    runningPaise: state === "seated" || state === "bill_requested" ? number * 185 * 100 : undefined,
    runningAmountKind: state === "bill_requested" ? "bill" as const : state === "seated" ? "orders" as const : undefined,
  };
});

const trendOf = (rupees: number[]): RevenueTrend => rupees.map((r, i) => ({ date: addDays(DATE, i - 6), revenuePaise: r * 100 }));

const busy: DashboardData = {
  outletName: "Spice Route",
  timezone: TZ,
  date: DATE,
  greeting: "Good evening",
  generatedAt: NOW,
  view: "full",
  kpis: {
    revenue: { today: 8_462_500, yesterday: 7_540_000 },
    orders: { today: 64, yesterday: 71 },
    covers: { today: 118, yesterday: 118 },
    averageBill: { today: 241_786, yesterday: 209_444 },
    paidBills: 35,
    openTables: { open: 11, total: 18 },
    upcomingReservations: 4,
    waitlist: 3,
    outstandingPaise: 1_294_000,
  },
  secondary: { taxPaise: 402_976, serviceChargePaise: 0, tipPaise: 61_000 },
  operations: {
    tables: { available: 4, reserved: 2, seated: 9, billRequested: 2, blocked: 1, total: 18 },
    waitlist: { waiting: 2, notified: 1 },
    upcoming: [
      { id: "u1", name: "Kapoor", partySize: 4, startAt: min(15), status: "confirmed", tables: ["T4"] },
      { id: "u2", name: "Anjali Mehta", partySize: 2, startAt: min(35), status: "confirmed", tables: ["T2"] },
      { id: "u3", name: "Verma family", partySize: 6, startAt: min(50), status: "reminded", tables: ["T10", "T11"] },
      { id: "u4", name: null, partySize: 3, startAt: min(80), status: "confirmed", tables: [] },
    ],
    billRequestedTables: 2,
    tableTiles: floorTiles,
    kitchenOrders: [],
    customerRequests: [],
    recentPayments: [],
    activityFeed: [],
  },
  alerts: {
    slowBills: [{ sessionId: "s1", tableCode: "T12", waitedMinutes: 14 }],
    soldOut: 2,
    late: [{ id: "l1", name: "Rao", partySize: 2, startAt: min(-22), status: "confirmed", tables: ["T6"], lateMinutes: 22, noShowEligible: true }],
    pendingRefunds: { count: 1, paise: 34_000 },
    blockedTables: 1, lowStock: [],
  },
  topItems: [
    { itemId: "a", name: "Butter Chicken", qty: 23, grossPaise: 874_000 },
    { itemId: "b", name: "Butter Naan", qty: 41, grossPaise: 246_000 },
    { itemId: "c", name: "Paneer Tikka", qty: 17, grossPaise: 476_000 },
    { itemId: "d", name: "Dal Makhani", qty: 15, grossPaise: 390_000 },
    { itemId: "e", name: "Masala Chaas", qty: 12, grossPaise: 96_000 },
  ].sort((x, y) => y.qty - x.qty),
};

const calm = { slowBills: [], soldOut: 0, late: [], pendingRefunds: { count: 0, paise: 0 }, blockedTables: 0, lowStock: [] };

const quiet: DashboardData = {
  ...busy,
  greeting: "Good morning",
  generatedAt: localTime(DATE, 9 * 60 + 5, TZ).getTime(),
  view: "full",
  kpis: { revenue: { today: 0, yesterday: 0 }, orders: { today: 0, yesterday: 0 }, covers: { today: 0, yesterday: 0 }, averageBill: { today: 0, yesterday: 0 }, paidBills: 0, openTables: { open: 0, total: 18 }, upcomingReservations: 0, waitlist: 0, outstandingPaise: 0 },
  secondary: { taxPaise: 0, serviceChargePaise: 0, tipPaise: 0 },
  operations: { tables: { available: 18, reserved: 0, seated: 0, billRequested: 0, blocked: 0, total: 18 }, tableTiles: [], waitlist: { waiting: 0, notified: 0 }, upcoming: [], billRequestedTables: 0, kitchenOrders: [], customerRequests: [], recentPayments: [], activityFeed: [] },
  alerts: calm,
  topItems: [],
};

const withAlerts = (alerts: Partial<DashboardData["alerts"]>): DashboardData => ({ ...busy, alerts: { ...calm, ...alerts } });

export type DashboardCase = { id: string; label: string; data: DashboardData; trend: RevenueTrend; preview?: DashboardPreview; staff?: { name: string; roles: string[] } };

const steady = trendOf([62_400, 58_100, 71_900, 66_300, 80_250, 75_400, 84_625]);
const owner = { name: "Rohan Sharma", roles: ["owner"] };
const manager = { name: "Meera Joshi", roles: ["manager"] };

export function dashboardCases(): DashboardCase[] {
  return [
    { id: "busy", label: "Normal busy evening", data: busy, trend: steady, staff: owner },
    { id: "quiet", label: "Quiet / empty day", data: quiet, trend: trendOf([0, 0, 0, 0, 0, 0, 0]), staff: owner },
    { id: "no-revenue", label: "Orders but no revenue yet (yesterday baseline zero)", data: { ...busy, kpis: { ...busy.kpis, revenue: { today: 0, yesterday: 0 }, averageBill: { today: 0, yesterday: 0 }, paidBills: 0, covers: { today: 0, yesterday: 12 } }, secondary: { taxPaise: 0, serviceChargePaise: 0, tipPaise: 0 }, alerts: calm }, trend: trendOf([41_000, 0, 39_500, 44_200, 0, 51_000, 0]), staff: owner },
    { id: "no-baseline", label: "Revenue today, none yesterday", data: { ...busy, kpis: { ...busy.kpis, revenue: { today: 1_250_000, yesterday: 0 }, orders: { today: 9, yesterday: 0 }, covers: { today: 14, yesterday: 0 }, averageBill: { today: 250_000, yesterday: 0 }, paidBills: 5 } }, trend: trendOf([0, 0, 0, 0, 0, 0, 12_500]), staff: owner },
    { id: "outstanding", label: "High outstanding", data: { ...busy, kpis: { ...busy.kpis, outstandingPaise: 4_785_050 }, operations: { ...busy.operations, tables: { ...busy.operations.tables, seated: 6, billRequested: 7 }, billRequestedTables: 7 } }, trend: steady, staff: owner },
    { id: "bill-alert", label: "Bills waiting too long", data: withAlerts({ slowBills: [{ sessionId: "a", tableCode: "T12", waitedMinutes: 27 }, { sessionId: "b", tableCode: "T3", waitedMinutes: 11 }] }), trend: steady, staff: owner },
    { id: "sold-out", label: "Sold-out items", data: withAlerts({ soldOut: 5 }), trend: steady, staff: owner },
    { id: "late", label: "Late reservation", data: withAlerts({ late: [{ id: "x", name: "Rao", partySize: 2, startAt: min(-9), status: "confirmed", tables: ["T6"], lateMinutes: 9, noShowEligible: false }, { id: "y", name: "Singh", partySize: 5, startAt: min(-31), status: "reminded", tables: ["T9"], lateMinutes: 31, noShowEligible: true }] }), trend: steady, staff: owner },
    { id: "refund", label: "Pending refunds", data: withAlerts({ pendingRefunds: { count: 3, paise: 128_050 } }), trend: steady, staff: owner },
    { id: "blocked", label: "All tables blocked", data: { ...quiet, kpis: { ...quiet.kpis, openTables: { open: 0, total: 18 } }, operations: { ...quiet.operations, tables: { available: 0, reserved: 0, seated: 0, billRequested: 0, blocked: 18, total: 18 } }, alerts: { ...calm, blockedTables: 18, lowStock: [] } }, trend: steady, staff: owner },
    { id: "waitlist", label: "Full waitlist", data: { ...busy, kpis: { ...busy.kpis, waitlist: 14, openTables: { open: 18, total: 18 } }, operations: { ...busy.operations, tables: { available: 0, reserved: 0, seated: 15, billRequested: 3, blocked: 0, total: 18 }, waitlist: { waiting: 11, notified: 3 } } }, trend: steady, staff: owner },
    { id: "trend", label: "7-day revenue variation", data: busy, trend: trendOf([12_000, 148_900, 3_400, 0, 96_250, 210_000, 84_625]), staff: owner },
    { id: "mobile", label: "Mobile (open in a 375px-wide window)", data: { ...busy, outletName: "Spice Route — Malviya Nagar" }, trend: steady, staff: owner },
    { id: "manager", label: "Manager view", data: busy, trend: steady, staff: manager },
    { id: "refreshing", label: "Refreshing / error banner", data: busy, trend: steady, preview: { refreshing: true, error: "Could not refresh the dashboard. Retrying." }, staff: owner },
  ];
}
