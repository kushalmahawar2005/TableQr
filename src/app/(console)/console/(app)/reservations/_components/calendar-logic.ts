import { localDateTimeValue } from "@/domain/booking-policy";
import type { CalendarData, CalendarInput, ReservationDetailsPatch } from "@/server/staff/reservations";

// Pure Reservation Calendar logic, shared by the screen and its tests. Every date and time is shown
// in the outlet's time zone, which comes with the data; the browser's own zone is never used.

export type CalendarReservation = CalendarData["reservations"][number];

/** What the screen is looking at. Every reload (user, poll or realtime) sends exactly this. */
export type CalendarQuery = { date: string; view: "day" | "week"; search: string; status: string; zoneId: string; tableId: string; source: string; partySize: string };

export const queryOf = (data: Pick<CalendarData, "date" | "view">): CalendarQuery => ({ date: data.date, view: data.view, search: "", status: "", zoneId: "", tableId: "", source: "", partySize: "" });

export function toInput(q: CalendarQuery): CalendarInput {
  const party = Number(q.partySize);
  return {
    ...(q.date ? { date: q.date } : {}),
    view: q.view,
    ...(q.search.trim() ? { search: q.search.trim() } : {}),
    ...(q.status ? { statuses: [q.status] } : {}),
    ...(q.zoneId ? { zoneId: q.zoneId } : {}),
    ...(q.tableId ? { tableId: q.tableId } : {}),
    ...(q.source ? { source: q.source } : {}),
    ...(Number.isInteger(party) && party > 0 ? { partySize: party } : {}),
  };
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const formatTime = (ms: number, timeZone: string) => new Intl.DateTimeFormat("en-IN", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(ms));

/** "Sun, 4 Oct" for an outlet calendar date (already local, so formatted as UTC) */
export const formatDay = (date: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00Z`));

/** Bookings by outlet-local date, then by start time within each date */
export function groupByDateAndTime(reservations: CalendarReservation[], timeZone: string) {
  const days = new Map<string, Map<string, CalendarReservation[]>>();
  for (const r of [...reservations].sort((a, b) => a.startAt - b.startAt)) {
    const [date, clock] = localDateTimeValue(r.startAt, timeZone).split("T");
    const slots = days.get(date) ?? new Map<string, CalendarReservation[]>();
    slots.set(clock, [...(slots.get(clock) ?? []), r]);
    days.set(date, slots);
  }
  return [...days].map(([date, slots]) => ({
    date,
    label: formatDay(date),
    slots: [...slots].map(([clock, items]) => ({ clock, label: formatTime(items[0].startAt, timeZone), items })),
  }));
}

// Lifecycle: the same rules the server enforces (floor/reservations.ts and booking/core.ts)
const OPEN = ["requested", "confirmed", "reminded"];
export const canArrive = (r: Pick<CalendarReservation, "status">) => OPEN.includes(r.status);
export const canSeat = (r: Pick<CalendarReservation, "status">) => [...OPEN, "arrived"].includes(r.status);
export const canReassign = canSeat;
export const canCancel = canSeat;
export const canReschedule = (r: Pick<CalendarReservation, "status">) => OPEN.includes(r.status);
export const canEditDetails = (r: Pick<CalendarReservation, "status">) => !["cancelled", "no_show", "completed"].includes(r.status);

/** The drawer's form, tagged with the booking it belongs to */
export type DrawerForm = { id: string; name: string; phone: string; when: string; tableIds: string[] };

export const drawerForm = (r: CalendarReservation, timeZone: string): DrawerForm => ({
  id: r.id,
  name: r.name,
  phone: r.phone ?? "",
  when: localDateTimeValue(r.startAt, timeZone),
  tableIds: r.assignments.map((a) => a.tableId),
});

/** The form for the booking on screen: values typed for another booking are never carried over */
export const formFor = (state: DrawerForm, r: CalendarReservation, timeZone: string) => (state.id === r.id ? state : drawerForm(r, timeZone));

/** Only the fields that really changed; everything else on the booking is left alone */
export function detailsPatch(r: CalendarReservation, form: DrawerForm): ReservationDetailsPatch {
  if (form.id !== r.id) throw new Error("Form belongs to another booking");
  const patch: ReservationDetailsPatch = {};
  if (form.name.trim() !== r.name) patch.name = form.name;
  if (form.phone.trim() !== (r.phone ?? "")) patch.phone = form.phone.trim() || null;
  return patch;
}
