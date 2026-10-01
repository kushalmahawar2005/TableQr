import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LandingView } from "@/app/(guest)/r/[outlet]/t/[table]/_components/landing-view";
import { DiningNav } from "@/app/(guest)/r/[outlet]/t/[table]/_components/dining-nav";
import { MenuScreen } from "@/app/(guest)/r/[outlet]/t/[table]/menu/_components/menu-screen";
import { TableScreen, type TablePreview } from "@/app/(guest)/r/[outlet]/t/[table]/table/_components/table-screen";
import { g7Base, g7Cases } from "@/app/dev/g7/_fixtures";
import type { Lang } from "@/lib/i18n";
import type { MenuScreenData } from "@/server/guest/menu-screen";
import type { TableScreenData } from "@/server/guest/table-screen";

// G7 screens rendered to HTML: navigation, the G3 table badge, host-only controls, offline.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {} }) }));
// Server actions are not called while rendering; keep their server modules out of this test
vi.mock("@/app/(guest)/r/[outlet]/t/[table]/table/actions", () => ({}));
vi.mock("@/app/(guest)/r/[outlet]/t/[table]/orders/actions", () => ({}));
vi.mock("@/app/(guest)/r/[outlet]/t/[table]/menu/actions", () => ({}));
vi.mock("@/app/(guest)/r/[outlet]/t/[table]/actions", () => ({ setLanguage() {} }));

const invite = { qrPath: "M4 4h1v1h-1z", qrBox: 37 };
const table = (data: TableScreenData, preview?: TablePreview, lang: Lang = "en") =>
  renderToStaticMarkup(createElement(TableScreen, { data, lang, shortCode: "k7Qm", realtimeUrl: null, invite, preview }));
const caseData = (id: string) => g7Cases().find((c) => c.id === id)!.data;
/** The opening tag of the first button whose text contains `text` */
const buttonWith = (html: string, text: string) => {
  const at = html.indexOf(text);
  const start = html.lastIndexOf("<button", at);
  return html.slice(start, html.indexOf(">", start) + 1);
};

describe("dining navigation", () => {
  it("shows exactly Menu, Orders and Table, with Table active on G7 and no Bill", () => {
    const html = renderToStaticMarkup(createElement(DiningNav, { tablePath: "/r/SRJ01/t/k7Qm", active: "table", lang: "en" }));
    const links = [...html.matchAll(/<a([^>]*)>([^<]*)</g)].map((m) => [m[2], /aria-current="page"/.test(m[1]), /href="([^"]+)"/.exec(m[1])?.[1]]);
    expect(links).toEqual([
      ["Menu", false, "/r/SRJ01/t/k7Qm/menu"],
      ["Orders", false, "/r/SRJ01/t/k7Qm/orders"],
      ["Table", true, "/r/SRJ01/t/k7Qm/table"],
    ]);
    expect(html).not.toMatch(/Bill/);
    const hi = renderToStaticMarkup(createElement(DiningNav, { tablePath: "/x", active: "menu", lang: "hi" }));
    expect(hi).toContain("टेबल");
  });

  it("is on the G7 screen with Table current", () => {
    expect(table(g7Base)).toMatch(/aria-current="page"[^>]*href="\/r\/SRJ01\/t\/k7Qm\/table"|href="\/r\/SRJ01\/t\/k7Qm\/table"[^>]*aria-current="page"/);
  });
});

describe("G3 table badge", () => {
  it("links the table line on the menu to G7", () => {
    const data = {
      outlet: { code: "SRJ01", name: "Spice Route", logoUrl: null, accentColor: null },
      table: { code: "T12" },
      renderedAt: 0,
      inProgress: 0,
      session: { key: "k", people: 3, status: "open", orderingLocked: false, hostName: "Aarav" },
      menu: [],
      popularIds: [],
      cart: { byItem: {}, count: 0, subtotalPaise: 0 },
    } as unknown as MenuScreenData;
    const html = renderToStaticMarkup(createElement(MenuScreen, { data, lang: "en", shortCode: "k7Qm", realtimeUrl: null }));
    expect(html).toMatch(/<a[^>]*href="\/r\/SRJ01\/t\/k7Qm\/table"[^>]*>Table T12 · 3 here/);
  });
});

describe("G7 rendering", () => {
  it("shows host controls only to the host; others see who the host is", () => {
    const host = table(g7Base);
    expect(host).toContain("Host controls");
    expect(host).toContain("Pause ordering");
    expect(host).toContain("Manage people");
    expect(host).toContain("More for Riya");

    const guest = table(caseData("non-host"));
    expect(guest).not.toContain("Host controls");
    expect(guest).not.toContain("Pause ordering");
    expect(guest).not.toContain("Manage people");
    expect(guest).not.toContain("More for");
    expect(guest).toContain("Aarav is the host");
    expect(guest).toContain("Host can pause ordering, manage people, and more.");
  });

  it("shows You, Another guest and a muted Paid and left group, never a stand-in name", () => {
    const html = table(caseData("paid"));
    expect(html).toContain("Aarav <span class=\"font-normal text-muted\">(You)</span>");
    expect(html).toContain("Paid and left (1)");
    expect(table(g7Base)).toContain("Another guest");
    expect(table(caseData("single-placeholder"))).toMatch(/>You</);
    expect(table(g7Base)).not.toMatch(/Guest \d/);
  });

  it("shows ordered so far in rupees, never INR", () => {
    const html = table(g7Base);
    expect(html).toContain("₹1,990");
    expect(html).toContain("3 rounds");
    expect(html).toContain("7 items in kitchen");
    expect(html).not.toContain("INR");
  });

  it("disables every server change while offline", () => {
    const online = table(g7Base);
    const offline = table(g7Base, { offline: true });
    expect(offline).toContain("You’re offline");
    for (const label of ["Pause ordering", "Water", "Call waiter", "Request bill"]) {
      expect(buttonWith(online, label)).not.toContain(' disabled=""');
      expect(buttonWith(offline, label)).toContain(' disabled=""');
    }
    // Inviting needs no server: it stays available
    expect(buttonWith(offline, "Invite someone")).not.toContain(' disabled=""');
  });

  it("shows the join code only in Host-confirmed mode", () => {
    const open = table(g7Base, { sheet: "invite" });
    expect(open).toContain("Ask them to scan this QR to join.");
    expect(open).toContain("Join code is not shown in this mode.");
    expect(open).not.toContain("Share this code with someone near your table.");
    // v1 has no remote invite: no share or copy, and no link text, only the QR
    for (const html of [open, table(caseData("invite-code"), { sheet: "invite" })]) {
      expect(html).not.toMatch(/Share table link|Copy table link|\/r\/SRJ01/);
      expect(html).toContain('aria-label="QR code to join Table T12"');
    }
    const code = table(caseData("invite-code"), { sheet: "invite" });
    expect(code).toContain("Join code 4 7 2 9");
    expect(code).toContain("Share this code with someone near your table.");
  });

  it("asks before removing and passing host", () => {
    expect(table(g7Base, { confirm: "remove", targetId: "p-karan" })).toContain("They won&#x27;t be able to order or rejoin this table session.");
    expect(table(g7Base, { confirm: "pass", targetId: "p-riya" })).toContain("Make Riya the host?");
  });

  it("shows the bill as requested and keeps ordering blocked, without host changes", () => {
    const html = table(caseData("bill"));
    expect(html).toContain("Bill requested");
    expect(html).toContain("New orders are paused. Our staff will come to your table shortly.");
    expect(html).not.toContain("Pause ordering");
  });

  it("renders in Hindi", () => {
    const html = table(caseData("hindi"), {}, "hi");
    expect(html).toContain("आपकी टेबल");
    expect(html).toContain("आरव");
    expect(html).toContain("होस्ट कंट्रोल");
  });
});

describe("G1 Host-confirmed join", () => {
  it("offers Join Table with the code sheet instead of asking staff", () => {
    const html = renderToStaticMarkup(
      createElement(LandingView, {
        lang: "en",
        shortCode: "k7Qm",
        data: {
          outlet: { code: "SRJ01", name: "Spice Route", city: "Jaipur", logoUrl: null, accentColor: null, sessionMode: "host_confirmed", isOpen: true, closesAt: "23:30", nextOpen: null, poweredBy: false },
          table: { code: "T12", maxSeats: 4, zone: "Indoor", state: "seated" },
          landing: { kind: "code_required" },
        },
      }),
    );
    expect(html).toContain("Table code needed");
    expect(html).toMatch(/<button type="button"[^>]*>Join Table T12/);
    expect(html).not.toContain("Please ask staff to continue");
  });
});
