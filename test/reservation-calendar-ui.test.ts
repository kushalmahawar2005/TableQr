import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localDateTimeValue, localTime, parseLocalDateTime } from "@/domain/booking-policy";
import { ReservationCalendar } from "@/app/(console)/console/(app)/reservations/_components/reservation-calendar";
import { detailsPatch, drawerForm, formFor, groupByDateAndTime, queryOf, toInput } from "@/app/(console)/console/(app)/reservations/_components/calendar-logic";
import { createCalendarSync, startCalendarSync } from "@/app/(console)/console/(app)/reservations/_components/calendar-sync";
import { calendarCases } from "@/app/dev/reservation-calendar/_fixtures";
import type { CalendarData, CalendarInput } from "@/server/staff/reservations";

// Reservation Calendar: pure logic, live-sync controller and the screen rendered to HTML.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {} }) }));
vi.mock("@/app/(console)/console/(app)/reservations/actions", () => ({}));

const realTz = process.env.TZ;
afterEach(() => {
  if (realTz === undefined) delete process.env.TZ;
  else process.env.TZ = realTz;
});

const caseOf = (id: string) => calendarCases().find((c) => c.id === id)!;
const render = (id: string, selectedId?: string) => {
  const c = caseOf(id);
  return renderToStaticMarkup(createElement(ReservationCalendar, { initial: c.data, realtimeUrl: null, preview: true, initialSelectedId: selectedId ?? c.selectedId ?? null }));
};
const busy = caseOf("busy-day").data;
const byId = (id: string) => busy.reservations.find((r) => r.id === id)!;
const TZ = busy.timezone;

describe("outlet-local date and time", () => {
  it("G: the same datetime-local input gives the same instant under any process time zone", () => {
    const results = ["UTC", "America/New_York", "Asia/Kolkata", "Pacific/Auckland"].map((tz) => {
      process.env.TZ = tz;
      return parseLocalDateTime("2026-10-05T20:00", "Asia/Kolkata")!.toISOString();
    });
    expect(new Set(results)).toEqual(new Set(["2026-10-05T14:30:00.000Z"]));
  });

  it("3: shows a booking's outlet wall-clock time in the drawer, never the UTC slice", () => {
    const at = localTime("2026-10-05", 20 * 60, "Asia/Kolkata");
    for (const tz of ["UTC", "America/New_York"]) {
      process.env.TZ = tz;
      expect(localDateTimeValue(at, "Asia/Kolkata")).toBe("2026-10-05T20:00");
    }
    expect(at.toISOString().slice(0, 16)).toBe("2026-10-05T14:30"); // what the old drawer showed
    expect(parseLocalDateTime(localDateTimeValue(at, "Asia/Kolkata"), "Asia/Kolkata")!.getTime()).toBe(at.getTime());
  });

  it("rejects malformed and impossible input", () => {
    for (const bad of ["", "2026-10-05", "2026-02-30T20:00", "2026-10-05T24:00", "2026-10-05 20:00", "1759680000000"]) expect(parseLocalDateTime(bad, "Asia/Kolkata")).toBeNull();
  });
});

describe("D: drawer state never crosses bookings", () => {
  it("a form typed for A is replaced by B's values once B is on screen", () => {
    const a = byId("a");
    const b = byId("b");
    const typedForA = { ...drawerForm(a, TZ), name: "Typed for A", phone: "9000000000" };
    const shown = formFor(typedForA, b, TZ);
    expect(shown).toEqual(drawerForm(b, TZ));
    expect(shown.name).toBe("Aarav Sharma");
    expect(detailsPatch(b, shown)).toEqual({});
  });

  it("a form belonging to A can never become a patch for B", () => {
    const a = byId("a");
    const b = byId("b");
    expect(() => detailsPatch(b, { ...drawerForm(a, TZ), name: "A value" })).toThrow();
  });

  it("patches only the fields that changed (A/B/C at the client)", () => {
    const a = byId("a");
    expect(detailsPatch(a, { ...drawerForm(a, TZ), name: "Meera K" })).toEqual({ name: "Meera K" });
    expect(detailsPatch(a, { ...drawerForm(a, TZ), phone: "" })).toEqual({ phone: null });
    const patch = detailsPatch(a, { ...drawerForm(a, TZ), name: "Meera K", phone: "9111111111" });
    for (const k of ["occasion", "notes", "seatingPreference"]) expect(patch).not.toHaveProperty(k);
  });

  it("renders B's own values when B is selected", () => {
    const html = render("busy-day", "b");
    expect(html).toContain('value="Aarav Sharma"');
    expect(html).toContain('value="9123456780"');
    expect(html).not.toContain('value="Meera Kapoor"');
  });
});

describe("K: week view groups by date, then time", () => {
  it("Monday 8 PM and Tuesday 8 PM never share a heading", () => {
    const week = caseOf("week").data;
    const days = groupByDateAndTime(week.reservations, week.timezone);
    expect(days.map((d) => d.date)).toEqual(["2026-10-05", "2026-10-06"]);
    expect(days.map((d) => d.slots.map((s) => s.items.map((r) => r.name)))).toEqual([[["Monday Guest"]], [["Tuesday Guest"]]]);
    const html = render("week");
    const mon = html.indexOf('data-date="2026-10-05"');
    const tue = html.indexOf('data-date="2026-10-06"');
    expect(mon).toBeGreaterThan(-1);
    expect(tue).toBeGreaterThan(mon);
    expect(html.indexOf("Monday Guest")).toBeLessThan(tue);
    expect(html.indexOf("Tuesday Guest")).toBeGreaterThan(tue);
    expect(html).toContain(">Mon, 5 Oct<");
    expect(html).toContain(">Tue, 6 Oct<");
  });

  it("groups by outlet date even when the instant falls on another UTC date", () => {
    // 02:00 IST on 6 Oct is 20:30 UTC on 5 Oct
    const late = { ...byId("a"), id: "late", startAt: localTime("2026-10-06", 120, TZ).getTime() };
    expect(groupByDateAndTime([late], TZ)[0].date).toBe("2026-10-06");
  });
});

describe("L/M/N/O: live refresh keeps what the user is looking at", () => {
  const data = (over: Partial<CalendarData> = {}): CalendarData => ({ ...busy, ...over });
  function setup() {
    const calls: CalendarInput[] = [];
    const seen: CalendarData[] = [];
    let next = data();
    const sync = createCalendarSync({
      query: queryOf(busy),
      load: async (input) => {
        calls.push(input);
        return { ok: true, data: { ...next, date: input.date ?? "2026-10-07", view: input.view ?? "day" } };
      },
      onData: (d) => seen.push(d),
      onError: () => {},
    });
    let poll = () => {};
    let realtime: { onEvents: (e: never[]) => void; onResync: () => void } | null = null;
    const stop = startCalendarSync(sync, {
      realtimeUrl: "wss://example.test",
      getToken: async () => "t",
      every: (fn) => {
        poll = fn;
        return () => {};
      },
      connect: (o) => {
        realtime = o;
        return () => {};
      },
      visible: () => true,
    });
    return { sync, calls, seen, setNext: (d: CalendarData) => (next = d), poll: () => poll(), realtime: () => realtime!, stop };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const expected: CalendarInput = { date: "2026-10-10", view: "week", search: "meera", statuses: ["confirmed"], zoneId: "z-in", tableId: "t10", source: "phone", partySize: 2 };

  it("L: the 20-second poll sends the current date, view, search and every filter", async () => {
    const t = setup();
    await t.sync.refresh({ date: "2026-10-10", view: "week", search: "meera", status: "confirmed", zoneId: "z-in", tableId: "t10", source: "phone", partySize: "2" });
    t.poll();
    await flush();
    expect(t.calls.at(-1)).toEqual(expected);
    expect(t.calls.at(-2)).toEqual(expected);
  });

  it("M: realtime events and reconnect resyncs send the same query", async () => {
    const t = setup();
    await t.sync.refresh({ date: "2026-10-10", view: "week", search: "meera", status: "confirmed", zoneId: "z-in", tableId: "t10", source: "phone", partySize: "2" });
    t.realtime().onEvents([]);
    await flush();
    t.realtime().onResync();
    await flush();
    expect(t.calls.slice(-2)).toEqual([expected, expected]);
  });

  it("N: the waitlist and walk-in companion refresh with the same data", async () => {
    const t = setup();
    t.setNext(data({ waitlist: [{ id: "w9", name: "New Waiter", partySize: 2, status: "waiting", sortOrder: 1, estimateMinutes: 10, readyDeadline: null, joinedAt: 0 }] }));
    t.poll();
    await flush();
    expect(t.seen.at(-1)!.waitlist.map((w) => w.name)).toEqual(["New Waiter"]);
    // and the screen renders the companion from that same data object
    const html = renderToStaticMarkup(createElement(ReservationCalendar, { initial: t.seen.at(-1)!, realtimeUrl: null, preview: true }));
    expect(html).toContain("New Waiter");
    expect(render("waitlist")).toContain("Rohit");
    expect(render("waitlist")).toContain("T12");
  });

  it("O: Today asks the server for the outlet's today and keeps view, search and filters", async () => {
    const t = setup();
    await t.sync.refresh({ date: "2026-12-25", view: "week", search: "meera" });
    await t.sync.today();
    const { date, ...rest } = t.calls.at(-1)!;
    expect(date).toBeUndefined();
    expect(rest).toMatchObject({ view: "week", search: "meera" });
    // the server's answer (outlet today) becomes the current date for later polls
    expect(t.sync.query.date).toBe("2026-10-07");
    t.poll();
    await flush();
    expect(t.calls.at(-1)!.date).toBe("2026-10-07");
  });

  it("applies only the newest answer when reloads overlap", async () => {
    const seen: string[] = [];
    const resolvers: ((v: { ok: true; data: CalendarData }) => void)[] = [];
    const sync = createCalendarSync({ query: queryOf(busy), load: () => new Promise((r) => resolvers.push(r)), onData: (d) => seen.push(d.date), onError: () => {} });
    const first = sync.refresh({ date: "2026-10-01" });
    const second = sync.refresh({ date: "2026-10-02" });
    resolvers[1]({ ok: true, data: data({ date: "2026-10-02" }) });
    resolvers[0]({ ok: true, data: data({ date: "2026-10-01" }) });
    await Promise.all([first, second]);
    expect(seen).toEqual(["2026-10-02"]);
  });

  it("toInput leaves out empty filters", () => {
    expect(toInput(queryOf(busy))).toEqual({ date: busy.date, view: "day" });
  });
});

describe("drawer actions by role and lifecycle", () => {
  it("Owner gets guest edit, reschedule, reassign and seat on a confirmed booking", () => {
    const html = render("drawer");
    for (const label of [">Save guest<", ">Save new time<", ">Reassign tables<", ">Seat at T10<", ">Mark arrived<", ">Cancel reservation<"]) expect(html).toContain(label);
    expect(html).toContain('value="2026-10-05T19:00"'); // outlet wall clock in the reschedule field
  });

  it("T: Host operates but cannot edit or reschedule", () => {
    const html = render("host");
    for (const label of [">Reassign tables<", ">Seat at T10<", ">Mark arrived<", ">Cancel reservation<"]) expect(html).toContain(label);
    expect(html).not.toContain(">Save guest<");
    expect(html).not.toContain(">Save new time<");
  });

  it("arrived: seat and cancel, no reschedule or arrive", () => {
    const html = render("arrived");
    expect(html).toContain(">Seat at B1<");
    expect(html).not.toContain(">Save new time<");
    expect(html).not.toContain(">Mark arrived<");
  });

  it("No-show only when the server says the grace period has passed", () => {
    expect(render("late")).toContain(">No-show<");
    expect(render("drawer")).not.toContain(">No-show<");
  });

  it("cancelled: no actions at all", () => {
    const html = render("cancelled");
    for (const label of [">Save guest<", ">Save new time<", ">Reassign tables<", ">Mark arrived<", ">No-show<", ">Cancel reservation<"]) expect(html).not.toContain(label);
    expect(html).not.toMatch(/>Seat( at [^<]*)?</);
  });

  it("12: errors are shown inline, never with alert()", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/app/(console)/console/(app)/reservations/_components/reservation-calendar.tsx", "utf8");
    expect(src).not.toMatch(/\balert\(/);
    expect(src).toContain('role="alert"');
  });
});

describe("phone width", () => {
  it("the search box shrinks to the row instead of pushing the page wider than the screen", () => {
    const html = render("busy-day");
    expect(html).toMatch(/<form class="flex min-w-0 flex-1 gap-2 sm:max-w-md"/);
    expect(html).toMatch(/aria-label="Search guest, phone or reference"[^>]*class="[^"]*min-w-0 flex-1"/);
  });
});
