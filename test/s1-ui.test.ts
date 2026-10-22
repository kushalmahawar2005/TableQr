import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FloorScreen } from "@/app/(console)/console/(app)/floor/_components/floor-screen";
import { StaffShell } from "@/app/(console)/console/(app)/_components/staff-shell";
import { s1Cases } from "@/app/dev/s1/_fixtures";
import { consoleSections } from "@/lib/console-nav";
import { canSee, type StaffRole } from "@/lib/staff-permissions";

// S1 Host Floor rendered to HTML: states never by colour alone, role-aware actions, offline.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {} }), usePathname: () => "/console/floor" }));
vi.mock("@/app/(console)/console/(app)/floor/actions", () => ({}));
vi.mock("@/app/(console)/console/login/actions", () => ({ signOutAction() {} }));

const caseOf = (id: string) => s1Cases().find((c) => c.id === id)!;
const floor = (id: string) => {
  const c = caseOf(id);
  return renderToStaticMarkup(createElement(FloorScreen, { data: c.data, lang: c.lang ?? "en", realtimeUrl: null, preview: c.preview }));
};
const buttonWith = (html: string, text: string) => {
  const at = html.indexOf(`>${text}<`);
  const start = html.lastIndexOf("<button", at);
  return at === -1 ? "" : html.slice(start, html.indexOf(">", start) + 1);
};

describe("S1 floor map", () => {
  it("labels every table with its state in words, not colour alone", () => {
    const html = floor("dinner");
    for (const label of ["T1, Seated", "T2, Available", "T4, Bill requested", "T7, Reserved", "T8, Needs cleaning", "T9, Paid, waiting to clear", "B3, Held for online booking", "B5, Blocked"]) expect(html).toContain(`aria-label="${label}`);
    for (const word of [">Seated<", ">Free<", ">Bill<", ">Reserved<", ">Cleaning<", ">Paid<", ">Held<", ">Blocked<"]) expect(html).toContain(word);
  });

  it("filters by zone and marks the selected table", () => {
    const indoor = floor("indoor");
    expect(indoor).toContain(">T5<");
    expect(indoor).not.toContain(">B1<");
    expect(floor("seated")).toMatch(/aria-pressed="true" aria-label="T3,/);
  });
});

describe("S1 actions by state and role", () => {
  it("offers Seat walk-in on a free table and lifecycle steps on paid and cleaning tables", () => {
    expect(floor("free")).toContain(">Seat walk-in<");
    expect(floor("paid")).toContain(">Mark needs cleaning<");
    expect(floor("cleaning")).toContain(">Ready<");
    const seated = floor("seated");
    for (const a of ["Guest needs more time? +15 min", "Move party", "Swap tables"]) expect(seated).toContain(`>${a}<`);
  });

  it("lets only managers block or unblock; hosts see the reason", () => {
    const host = floor("blocked");
    expect(host).toContain("Maintenance");
    expect(host).toContain("Stool being repaired");
    expect(host).not.toContain(">Unblock<");
    expect(host).toContain("Only a manager can block or unblock tables.");
    expect(floor("blocked-manager")).toContain(">Unblock<");
    expect(floor("free")).not.toContain(">Block table<");
  });

  it("disables every change while offline and says so", () => {
    const html = floor("offline");
    expect(html).toContain("Offline. Showing the last floor.");
    expect(buttonWith(html, "Guest needs more time? +15 min")).toContain('disabled=""');
    expect(buttonWith(floor("seated"), "Guest needs more time? +15 min")).not.toContain('disabled=""');
  });

  it("offers a short turn when a walk-in would run into a booking", () => {
    const html = floor("seat-conflict");
    expect(html).toContain("Booked for Das (6) at 9:30 pm.");
    expect(html).toMatch(/Seat until 9:15/);
  });
});

describe("S1 arrivals, waitlist and tonight", () => {
  it("shows arrivals with confirmation, lateness, occasion and no fake messaging", () => {
    const html = floor("arrivals");
    for (const t of ["Khanna", "22 min late", "Iyer", "Birthday", "No reply", "T11 + T12", ">No-show<"]) expect(html).toContain(t);
    expect(html).not.toMatch(/Message guest|>Message</);
    expect(floor("no-arrivals")).toContain("No bookings in the next 90 minutes.");
  });

  it("shows the waitlist in queue order with waits, quotes and draggable rows", () => {
    const html = floor("waitlist");
    const queue = html.slice(html.indexOf("<ol"));
    expect(queue.indexOf("Gupta")).toBeLessThan(queue.indexOf("Bose"));
    expect(queue.indexOf("Bose")).toBeLessThan(queue.indexOf(">Khan<"));
    expect(html).toContain("Waiting 18 min · quoted 15");
    expect(html).toContain('draggable="true"');
    expect(html).toContain(">Mark notified<");
  });

  it("shows pacing and the online booking switch", () => {
    expect(floor("pacing")).toContain("Taking online bookings tonight");
    expect(floor("paused")).toContain("Online bookings paused for tonight");
    expect(floor("paused")).toContain(">Resume<");
    expect(floor("pacing-full")).toContain("At limit");
  });

  it("renders in Hindi; names stay as entered", () => {
    const html = floor("hindi");
    expect(html).toContain("फ़्लोर");
    expect(html).toContain("बैठे हैं");
    expect(html).toContain("Aarav");
  });
});

describe("S1 final polish", () => {
  it("summarises all eight table states with counts from the floor", () => {
    const html = floor("dinner");
    const data = caseOf("dinner").data;
    const n = (st: string) => data.tables.filter((t) => t.state === st).length;
    const summary = html.slice(html.indexOf('aria-label="Legend"'), html.indexOf("</ul>", html.indexOf('aria-label="Legend"')));
    for (const [st, label] of [["available", "Free"], ["held", "Held"], ["reserved", "Reserved"], ["seated", "Seated"], ["bill_requested", "Bill"], ["paid", "Paid"], ["needs_cleaning", "Cleaning"], ["blocked", "Blocked"]]) {
      expect(summary).toContain(`${label} ${n(st)}`);
    }
    expect(n("held")).toBe(1);
    expect(n("blocked")).toBe(2);
  });

  it("a held table shows the booking in progress and offers no check-in or seating", () => {
    const held = floor("held");
    expect(held).toContain("Booking in progress");
    expect(held).toMatch(/Held until 8:22/);
    expect(held).toContain("Expires in 7m");
    expect(held).not.toContain(">Seat booking<");
    expect(held).not.toContain(">Check in<");
    const reserved = floor("reserved");
    expect(reserved).toContain(">Seat booking<");
    expect(reserved).toContain(">Check in<");
  });

  it("an already-combined party shows its tables and Manage tables, not Combine table", () => {
    const html = floor("drawer");
    expect(html).toContain(">T5 + T6<");
    expect(html).toContain("Combined");
    expect(html).toContain("4–8 seats");
    expect(html).toContain(">Manage tables<");
    expect(html).not.toContain(">Combine table<");
    expect(html).not.toContain(">Move party<");
    // A single table only offers Combine when a configured partner is free
    expect(floor("seated")).not.toContain(">Combine table<");
    expect(floor("combine")).toContain(">Combine table<");
  });

  it("names every table of a multi-table booking and refuses while one is taken", () => {
    const ready = floor("das-ready");
    expect(buttonWith(ready, "Seat on T11 + T12")).not.toContain('disabled=""');
    const blocked = floor("das-blocked");
    expect(buttonWith(blocked, "Seat on T11 + T12")).toContain('disabled=""');
    expect(blocked).toContain("T12 is seated");
  });

  it("confirms success with a short contextual toast, never a bare Done.", () => {
    const html = floor("toast");
    expect(html).toMatch(/role="status" aria-live="polite"[^>]*>.*Khanna marked no-show/);
    expect(html).not.toContain("Done.");
  });

  it("lets a host resume paused online bookings", () => {
    expect(buttonWith(floor("paused"), "Resume")).not.toContain('disabled=""');
    expect(caseOf("paused").data.may.pause).toBe(true);
    expect(caseOf("paused").data.roles).toEqual(["host"]);
  });
});

describe("staff shell", () => {
  const shell = (roles: StaffRole[]) =>
    renderToStaticMarkup(
      createElement(
        StaffShell,
        {
        lang: "en",
        sections: consoleSections.filter((s) => canSee(roles, s.slug)).map((s) => ({ slug: s.slug, label: s.label })),
        staff: { name: "Anil Kumar", roles, outlet: "Spice Route", shiftEnds: null },
        activeSlug: "floor",
        preview: true,
        } as Parameters<typeof StaffShell>[0],
      ),
    );
  it("hides destinations a role cannot use, and marks the current one", () => {
    const host = shell(["host"]);
    expect(host).toContain('aria-label="Floor"');
    expect(host).not.toContain('aria-label="Settings"');
    expect(host).not.toContain('aria-label="Billing"');
    expect(host).toMatch(/aria-current="page"[^>]*aria-label="Floor"/);
    expect(shell(["owner"])).toContain('aria-label="Settings"');
    expect(shell(["waiter"])).not.toContain('aria-label="Floor"');
  });
});
