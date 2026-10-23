import { localTime } from "@/domain/booking-policy";
import type { CalendarData } from "@/server/staff/reservations";

// Sample data for the Reservation Calendar review board and its render tests. Outlet in IST.

const TZ = "Asia/Kolkata";
const DATE = "2026-10-05";
const at = (date: string, hh: number, mm = 0) => localTime(date, hh * 60 + mm, TZ).getTime();
const zones = [
  { id: "z-in", name: "Indoor" },
  { id: "z-out", name: "Terrace" },
];
const tables = [
  { id: "t10", code: "T10", zoneId: "z-in", maxSeats: 2 },
  { id: "t11", code: "T11", zoneId: "z-in", maxSeats: 4 },
  { id: "t12", code: "T12", zoneId: "z-in", maxSeats: 4 },
  { id: "b1", code: "B1", zoneId: "z-out", maxSeats: 6 },
];
const assign = (...ids: string[]) =>
  ids.map((id) => {
    const t = tables.find((x) => x.id === id)!;
    return { reservationId: "", tableId: t.id, code: t.code, zoneId: t.zoneId, zoneName: zones.find((z) => z.id === t.zoneId)!.name };
  });

type Res = CalendarData["reservations"][number];
const booking = (id: string, over: Partial<Res> & { date?: string; hh?: number; mm?: number }): Res => {
  const startAt = at(over.date ?? DATE, over.hh ?? 20, over.mm ?? 0);
  return {
    id,
    publicReference: `TQ-${id.toUpperCase()}`,
    name: "Guest",
    phone: "9876543210",
    partySize: 2,
    startAt,
    expectedEndAt: startAt + 90 * 60_000,
    status: "confirmed",
    source: "phone",
    seatingPreference: null,
    requestedZoneId: null,
    requestedTableClass: null,
    occasion: null,
    notes: null,
    confirmedAt: startAt - 86_400_000,
    arrivedAt: null,
    seatedAt: null,
    completedAt: null,
    cancelledAt: null,
    lateMinutes: 0,
    canNoShow: false,
    assignments: assign("t10"),
    credit: null,
    preorder: [],
    preorderTotalPaise: 0,
    ...over,
    advanceReceivedPaise: over.advanceReceivedPaise ?? 0,
  };
};

const base = (over: Partial<CalendarData> = {}): CalendarData => ({
  date: DATE,
  today: DATE,
  view: "day",
  timezone: TZ,
  from: at(DATE, 0),
  to: at(DATE, 24),
  graceMinutes: 15,
  reservations: [],
  groupRequests: [],
  zones,
  tables,
  sources: ["online", "phone", "walk_in", "staff"],
  waitlist: [],
  walkIns: [],
  roles: ["owner"],
  mayEdit: true,
  mayOperate: true,
  ...over,
});

const busy = [
  booking("a", { name: "Meera Kapoor", hh: 19, occasion: "Birthday", notes: "Window please", seatingPreference: "window" }),
  booking("b", { name: "Aarav Sharma", phone: "9123456780", hh: 19, assignments: assign("t11"), partySize: 4 }),
  booking("c", { name: "Kabir Rao", hh: 20, mm: 30, status: "requested", source: "online", assignments: assign("t12") }),
  booking("d", { name: "Isha Patel", hh: 21, status: "arrived", assignments: assign("b1"), partySize: 6 }),
];

export type CalendarCase = { id: string; label: string; data: CalendarData; selectedId?: string };

export function calendarCases(): CalendarCase[] {
  return [
    { id: "empty", label: "Empty day", data: base() },
    { id: "busy-day", label: "Busy day", data: base({ reservations: busy }) },
    {
      id: "week",
      label: "Week: same time on two dates",
      data: base({
        view: "week",
        to: at("2026-10-12", 0),
        reservations: [booking("w1", { name: "Monday Guest", date: "2026-10-05", hh: 20 }), booking("w2", { name: "Tuesday Guest", date: "2026-10-06", hh: 20, assignments: assign("t11") })],
      }),
    },
    { id: "drawer", label: "Drawer open (owner)", data: base({ reservations: busy }), selectedId: "a" },
    { id: "host", label: "Drawer open (host)", data: base({ reservations: busy, roles: ["host"], mayEdit: false }), selectedId: "a" },
    { id: "requested", label: "Requested booking", data: base({ reservations: busy }), selectedId: "c" },
    { id: "arrived", label: "Arrived booking", data: base({ reservations: busy }), selectedId: "d" },
    { id: "late", label: "Late, past grace", data: base({ reservations: [booking("l", { name: "Late Guest", hh: 19, lateMinutes: 22, canNoShow: true })] }), selectedId: "l" },
    { id: "cancelled", label: "Cancelled booking", data: base({ reservations: [booking("x", { name: "Cancelled Guest", status: "cancelled" })] }), selectedId: "x" },
    { id: "credit", label: "Booking credit", data: base({ reservations: [booking("cr", { name: "Credit Guest", credit: { reservationId: "cr", amountPaise: 80_000, paidPaise: 80_000, appliedPaise: 0, status: "paid" } })] }) },
    { id: "multi-table", label: "Combined tables", data: base({ reservations: [booking("m", { name: "Big Party", partySize: 8, assignments: assign("t11", "t12") })] }), selectedId: "m" },
    {
      id: "waitlist",
      label: "Waitlist and walk-ins",
      data: base({
        reservations: busy.slice(0, 1),
        waitlist: [{ id: "wl1", name: "Rohit", partySize: 3, status: "waiting", sortOrder: 1, estimateMinutes: 20, readyDeadline: null, joinedAt: at(DATE, 19) }],
        walkIns: [{ sessionId: "s1", tableId: "t12", code: "T12", partySize: 2, status: "open", openedAt: at(DATE, 19, 15) }],
      }),
    },
  ];
}
