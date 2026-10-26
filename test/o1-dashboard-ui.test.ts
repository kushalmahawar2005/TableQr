import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DashboardScreen, alertsOf } from "@/app/(console)/console/(app)/dashboard/_components/dashboard-screen";
import { FLOOR_PREVIEW_LIMIT, floorGridClass, floorPreview, floorTileClass } from "@/app/(console)/console/(app)/dashboard/_components/live-floor";
import { SalesPerformance } from "@/app/(console)/console/(app)/dashboard/_components/sales-performance";
import { OPS_POLL_MS, TREND_POLL_MS, createDashboardSync, startDashboardSync } from "@/app/(console)/console/(app)/dashboard/_components/dashboard-sync";
import { dashboardCases } from "@/app/dev/o1/_fixtures";
import { addDays, dayRange, deltaLabel, deltaOf, lastDays, lateness } from "@/domain/dashboard";
import { consoleSections, homeFor, isLiveSection, landingSection, visibleSections } from "@/lib/console-nav";
import { canSee, staffRoles, type StaffRole } from "@/lib/staff-permissions";
import type { DashboardData, RevenueTrend } from "@/server/staff/dashboard";

// O1 Owner Dashboard: pure helpers, landing, polling controller and the screen rendered to HTML.

vi.mock("@/app/(console)/console/(app)/dashboard/actions", () => ({
  dashboardAction: vi.fn(),
  dashboardTokenAction: vi.fn(),
  revenueTrendAction: vi.fn(),
  resolveServiceRequestAction: vi.fn(),
  checkInReservationAction: vi.fn(),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => ({ refresh: vi.fn() }),
}));

const caseOf = (id: string) => dashboardCases().find((c) => c.id === id)!;
const render = (id: string) => {
  const c = caseOf(id);
  return renderToStaticMarkup(createElement(DashboardScreen, { initial: c.data, initialTrend: c.trend, preview: c.preview ?? {} }));
};
const ok = <T,>(data: T) => ({ ok: true as const, data });

describe("deltas and days", () => {
  it("today vs yesterday never shows infinity", () => {
    expect(deltaLabel(deltaOf(112, 100))).toBe("+12%");
    expect(deltaLabel(deltaOf(92, 100))).toBe("−8%");
    expect(deltaLabel(deltaOf(100, 100))).toBe("No change");
    expect(deltaLabel(deltaOf(0, 0))).toBe("No change");
    expect(deltaLabel(deltaOf(50, 0))).toBe("Nothing yesterday to compare");
  });

  it("days are outlet-local, contiguous and seven long", () => {
    const now = new Date("2026-10-04T14:30:00Z");
    const days = lastDays(now, "Asia/Kolkata");
    expect(days).toHaveLength(7);
    expect(days[6].date).toBe("2026-10-04");
    expect(days[6].start.toISOString()).toBe("2026-10-03T18:30:00.000Z");
    for (let i = 1; i < 7; i++) expect(days[i].start.getTime()).toBe(days[i - 1].end.getTime());
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(dayRange("2026-11-01", "America/New_York").end.getTime() - dayRange("2026-11-01", "America/New_York").start.getTime()).toBe(25 * 3600_000);
  });

  it("no-show eligibility waits for the grace period", () => {
    const start = 1_000_000_000_000;
    expect(lateness(start, start + 14 * 60_000, 15)).toEqual({ lateMinutes: 14, noShowEligible: false });
    expect(lateness(start, start + 15 * 60_000, 15)).toEqual({ lateMinutes: 15, noShowEligible: true });
  });
});

describe("navigation and landing", () => {
  // What /console chose before O1: the same list without the dashboard
  const before = (roles: StaffRole[]) => visibleSections.filter((s) => s.slug !== "dashboard").find((s) => canSee(roles, s.slug))?.slug ?? null;

  it("AT/AU: owner and manager land on the dashboard, first in the sidebar", () => {
    expect(consoleSections[0].slug).toBe("dashboard");
    expect(landingSection(["owner"])).toBe("dashboard");
    expect(landingSection(["manager"])).toBe("dashboard");
  });

  it("AO–AS/AV: every other role keeps its previous landing and never sees Dashboard", () => {
    for (const role of ["host", "waiter", "cashier", "kitchen", "accountant"] as const) {
      expect(canSee([role], "dashboard")).toBe(false);
      expect(landingSection([role])).toBe(before([role]));
    }
    expect(landingSection(["host"])).toBe("floor");
    expect(landingSection(["cashier"])).toBe("orders");
    expect(landingSection(["accountant"])).toBe("billing");
    expect(landingSection(["kitchen"])).toBe("kitchen");
    // After sign-in they still go to their own app, not the console
    expect(homeFor(["cashier"])).toBe("/pos");
    expect(homeFor(["accountant"])).toBe("/pos");
    expect(homeFor(["kitchen"])).toBe("/console/kitchen");
    expect(staffRoles.filter((r) => canSee([r], "dashboard"))).toEqual(["owner", "manager"]);
  });
});

describe("console sections", () => {
  it("every section has its own screen and shows in the sidebar; unknown slugs are not sections", () => {
    expect(visibleSections.map((s) => s.slug)).toEqual(consoleSections.map((s) => s.slug));
    for (const s of consoleSections) expect(isLiveSection(s.slug)).toBe(true);
    expect(isLiveSection("nope")).toBe(false);
  });
});

describe("home after sign-in", () => {
  it("sends each role to the screen where it works", () => {
    expect(homeFor(["owner"])).toBe("/console/dashboard");
    expect(homeFor(["manager"])).toBe("/console/dashboard");
    expect(homeFor(["host"])).toBe("/console/floor");
    expect(homeFor(["waiter"])).toBe("/waiter");
    expect(homeFor(["cashier"])).toBe("/pos");
    expect(homeFor(["accountant"])).toBe("/pos");
    expect(homeFor(["kitchen"])).toBe("/console/kitchen");
    expect(homeFor(["host", "waiter"])).toBe("/console/floor"); // unchanged: a host-waiter kept the floor
    expect(homeFor(["cashier", "manager"])).toBe("/console/dashboard");
  });
});

describe("polling controller", () => {
  const data = (n: number) => ({ generatedAt: n }) as unknown as DashboardData;
  const trend = (n: number) => [{ date: "2026-10-04", revenuePaise: n }] as RevenueTrend;

  it("AW/AX/AY: operations every 12 seconds, the trend every five minutes, nothing while the tab is hidden", () => {
    const timers: { fn: () => void; ms: number }[] = [];
    const sync = { ops: vi.fn(async () => {}), trend: vi.fn(async () => {}) };
    let visible = true;
    const stop = startDashboardSync(sync, { every: (fn, ms) => (timers.push({ fn, ms }), () => {}), visible: () => visible });
    expect(timers.map((t) => t.ms)).toEqual([OPS_POLL_MS, TREND_POLL_MS]);
    const opsTick = timers.find((t) => t.ms === OPS_POLL_MS)!.fn;
    for (let i = 0; i < 5; i++) opsTick();
    expect(sync.ops).toHaveBeenCalledTimes(5);
    expect(sync.trend).not.toHaveBeenCalled();
    timers.find((t) => t.ms === TREND_POLL_MS)!.fn();
    expect(sync.trend).toHaveBeenCalledTimes(1);
    visible = false;
    opsTick();
    timers.find((t) => t.ms === TREND_POLL_MS)!.fn();
    expect(sync.ops).toHaveBeenCalledTimes(5);
    expect(sync.trend).toHaveBeenCalledTimes(1);
    stop();
  });

  it("AZ/BA: manual refresh loads both; an older answer that arrives late never replaces a newer one", async () => {
    const resolvers: ((v: ReturnType<typeof ok<DashboardData>>) => void)[] = [];
    const shown: number[] = [];
    const trends: number[] = [];
    const sync = createDashboardSync({
      loadOps: () => new Promise((r) => resolvers.push(r)),
      loadTrend: async () => ok(trend(7)),
      onOps: (d) => shown.push(d.generatedAt),
      onTrend: (t) => trends.push(t[0].revenuePaise),
      onError: () => {},
    });
    const first = sync.ops();
    const second = sync.all();
    resolvers[1](ok(data(2)));
    await second;
    resolvers[0](ok(data(1)));
    await first;
    expect(shown).toEqual([2]);
    expect(trends).toEqual([7]);
  });

  it("BB: a failed refresh reports an error and keeps the last data", async () => {
    const shown: number[] = [];
    const errors: string[] = [];
    let fail = false;
    const sync = createDashboardSync({
      loadOps: async () => (fail ? Promise.reject(new Error("offline")) : ok(data(1))),
      loadTrend: async () => ok(trend(1)),
      onOps: (d) => shown.push(d.generatedAt),
      onTrend: () => {},
      onError: (m) => errors.push(m),
    });
    await sync.ops();
    fail = true;
    await sync.ops();
    expect(shown).toEqual([1]);
    expect(errors).toHaveLength(1);
  });
});

describe("screen", () => {
  it("shows the seven KPIs, deltas, trend, operations, attention and top items", () => {
    const html = render("busy");
    for (const label of ["Today&#x27;s Sales", "Orders Today", "Average Bill", "Tables in Use", "Bookings Coming Up", "Waiting List", "Delivery Orders"]) expect(html).toContain(label);
    expect(html).toContain("₹84,625");
    expect(html).toContain("+12%");
    expect(html).toContain("1 on the way · ₹840 cash");
    expect(html).toContain("Money from paid bills");
    expect(html).toContain("Revenue trend for the last 7 days");
    expect(html).toContain("Sales, Last 7 Days");
    expect(html).toContain("Top 5 Dishes Today");
    expect(html).toContain("T12");
    expect(html).toContain("No-show eligible");
    expect(html).toContain("pending refund");
    expect(html).not.toMatch(/<form|type="submit"/);
  });

  it("handles empty days, missing baselines and calm outlets", () => {
    const quiet = render("quiet");
    expect(quiet).toContain("Nothing needs your attention");
    expect(quiet).toContain("No items sold yet today.");
    expect(quiet).toContain("No reservations due");
    expect(quiet).toContain("No recent sales trend");
    expect(render("no-baseline")).toContain("No baseline");
    expect(alertsOf(caseOf("quiet").data)).toEqual([]);
    expect(alertsOf(caseOf("blocked").data).map((a) => a.key)).toEqual(["blocked"]);
  });

  it("plots real daily sales as bars and leaves zero-sales days empty", () => {
    const active = renderToStaticMarkup(createElement(SalesPerformance, { trend: caseOf("trend").trend }));
    expect(active).toContain("Sales, Last 7 Days");
    expect(active).toContain("Today");
    expect(active).toContain("bg-forest");
    expect(active).toContain("—");

    const empty = renderToStaticMarkup(createElement(SalesPerformance, { trend: caseOf("quiet").trend }));
    expect(empty).toContain("No sales recorded in the last 7 days");
    expect(empty).not.toContain("bg-[#103B2C]");
  });

  it("links only to screens that exist and loads no chart library", () => {
    const html = render("busy");
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    // Every link on the dashboard resolves to a real console route. The kitchen panel links to
    // the KDS; the inventory and team links appear only when their data does (low stock / duty
    // rows), so they are not part of this fixture render.
    expect(new Set(hrefs)).toEqual(new Set(["/console/floor", "/console/billing", "/console/orders", "/console/orders?view=delivery", "/console/reservations", "/console/reports", "/console/reports/day-close", "/console/waitlist", "/console/menu", "/console/kitchen"]));
    expect(html).not.toMatch(/recharts|chart\.js|echarts|<canvas/i);
  });
});

describe("live floor sizing", () => {
  it("labels live order value separately from a bill that is ready to pay", () => {
    const html = render("busy");
    expect(html).toContain("Orders so far");
    expect(html).toContain("Bill due");
  });

  it("gives a small table count larger cards and adds columns as the count grows", () => {
    expect(floorGridClass(1)).toBe("grid-cols-1 max-w-sm");
    expect(floorTileClass(1)).toContain("min-h-[124px]");
    expect(floorGridClass(2)).toBe("grid-cols-2 max-w-xl");
    expect(floorGridClass(4)).toBe("grid-cols-2");
    expect(floorGridClass(6)).toBe("grid-cols-2 sm:grid-cols-3");
    expect(floorGridClass(7)).toBe("grid-cols-2 sm:grid-cols-3 xl:grid-cols-4");
    expect(floorTileClass(7)).toContain("min-h-[106px]");
  });

  it("keeps a small floor complete and caps a large dashboard preview", () => {
    const tables = Array.from({ length: FLOOR_PREVIEW_LIMIT + 2 }, (_, i) => ({
      id: `table-${i + 1}`,
      code: `T${i + 1}`,
      seats: 2 + (i % 5),
      state: "available",
    }));
    tables[12].state = "seated";
    tables[13].state = "bill_requested";

    const smallFloor = floorPreview(tables.slice(0, 3));
    const largeFloor = floorPreview(tables);

    expect(smallFloor).toHaveLength(3);
    expect(largeFloor).toHaveLength(FLOOR_PREVIEW_LIMIT);
    expect(largeFloor[0].state).toBe("bill_requested");
    expect(largeFloor.some((table) => table.state === "seated")).toBe(true);
  });
});
