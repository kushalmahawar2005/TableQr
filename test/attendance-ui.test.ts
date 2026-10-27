import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AttendanceScreen } from "@/app/(console)/console/(app)/attendance/_components/attendance-screen";
import { addDays, addMonths, csvRows, datesOfMonth, dayValue, isDate, isMonth, monthCounts } from "@/lib/attendance";
import { consoleSections, isLiveSection } from "@/lib/console-nav";
import { canSee } from "@/lib/staff-permissions";
import type { Month, Register } from "@/server/attendance/register";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {} }) }));
vi.mock("@/app/(console)/console/(app)/attendance/actions", () => ({ markAction: vi.fn(), markAllPresentAction: vi.fn() }));

describe("register arithmetic", () => {
  it("counts a half day as half a day and leave and a week off as no worked day", () => {
    expect(dayValue("present")).toBe(1);
    expect(dayValue("half_day")).toBe(0.5);
    for (const s of ["absent", "leave", "week_off"] as const) expect(dayValue(s)).toBe(0);
    expect(monthCounts([{ status: "present" }, { status: "present" }, { status: "half_day" }, { status: "leave" }], 10)).toEqual({ present: 2, half_day: 1, absent: 0, leave: 1, week_off: 0, unmarked: 6, daysWorked: 2.5 });
    expect(monthCounts([], 3).unmarked).toBe(3);
    expect(monthCounts([{ status: "present" }], 0).unmarked).toBe(0);
  });

  it("knows real dates and months, month lengths and moving about", () => {
    expect(isDate("2026-02-28")).toBe(true);
    expect(isDate("2026-02-30")).toBe(false);
    expect(isDate("26-02-01")).toBe(false);
    expect(isMonth("2026-13")).toBe(false);
    expect(datesOfMonth("2026-02")).toHaveLength(28);
    expect(datesOfMonth("2028-02")).toHaveLength(29);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("quotes spreadsheet cells and defuses formulas", () => {
    expect(csvRows([["a,b", 'say "hi"', "=1+1", 3]])).toBe('"a,b","say ""hi""",\'=1+1,3\r\n');
  });
});

const day = (over: Partial<Register> = {}): Register => ({
  date: "2026-11-20", today: "2026-11-20", outletId: "o1", outlets: [{ id: "o1", name: "Spice Route" }],
  people: [
    { id: "u1", name: "Rahul Verma", photoUrl: null, roles: ["waiter"], status: "present", note: null },
    { id: "u2", name: "Priya Singh", photoUrl: null, roles: ["cashier"], status: "half_day", note: "doctor" },
    { id: "u3", name: "Ramesh Yadav", photoUrl: null, roles: ["kitchen"], status: null, note: null },
  ],
  counts: { present: 1, half_day: 1, absent: 0, leave: 0, week_off: 0, unmarked: 1 }, ...over,
});
const month = (): Month => ({
  month: "2026-11", dates: datesOfMonth("2026-11"), outletId: "o1", outlets: [{ id: "o1", name: "Spice Route" }], daysCounted: 20,
  rows: [{ id: "u1", name: "Rahul Verma", photoUrl: null, roles: ["waiter"], counts: { present: 15, half_day: 2, absent: 1, leave: 1, week_off: 1, unmarked: 0, daysWorked: 16 }, days: datesOfMonth("2026-11").map((_, i) => (i === 0 ? "present" : i === 1 ? "half_day" : null)) }],
});
const render = (d: Register | null, m: Month | null) => renderToStaticMarkup(createElement(AttendanceScreen, { day: d, month: m }));

describe("the attendance screen", () => {
  it("shows each person with the five choices, the chosen one pressed, and the day's counts", () => {
    const html = render(day(), null);
    for (const label of ["Present", "Half day", "Absent", "Leave", "Week off"]) expect(html).toContain(`>${label}</button>`);
    expect(html).toContain("Rahul Verma");
    expect(html).toContain("Waiter");
    expect(html).toContain("Friday, 20 November 2026");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Not marked");
    expect(html).toContain("Mark all present (1)");
    expect(html).toContain('aria-label="Note for Priya Singh"');
  });

  it("blocks a day that has not happened", () => {
    const html = render(day({ date: "2026-11-21" }), null);
    expect(html).toContain("hasn&#x27;t happened yet");
    expect(html).toMatch(/disabled=""[^>]*>Present/);
  });

  it("offers the outlet filter only with several outlets, and has Daily and Monthly tabs", () => {
    expect(render(day(), null)).not.toContain('aria-label="Outlet"');
    expect(render(day({ outlets: [{ id: "o1", name: "A" }, { id: "o2", name: "B" }] }), null)).toContain('aria-label="Outlet"');
    expect(render(day(), null)).toContain("Daily");
    expect(render(day(), null)).toContain("Monthly");
  });

  it("shows the month with totals, days worked, a day strip and the download", () => {
    const html = render(null, month());
    expect(html).toContain("November 2026");
    expect(html).toContain("Days worked");
    expect(html).toContain(">16<");
    expect(html).toContain("Download for Excel");
    expect(html).toContain("/console/attendance/export?month=2026-11&amp;outlet=o1");
    expect(html).toContain("half a day");
  });

  it("is a console section for managers and owners only", () => {
    expect(consoleSections.some((x) => x.slug === "attendance")).toBe(true);
    expect(isLiveSection("attendance")).toBe(true);
    expect(canSee(["manager"], "attendance") && canSee(["owner"], "attendance")).toBe(true);
    for (const r of ["cashier", "host", "waiter", "kitchen", "accountant", "reception"] as const) expect(canSee([r], "attendance")).toBe(false);
  });
});
