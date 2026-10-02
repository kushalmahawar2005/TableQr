import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { KdsScreen } from "@/app/(staff)/kds/_components/kds-screen";
import { KdsSetup } from "@/app/(staff)/kds/_components/kds-setup";
import { createAnnouncer, formatElapsed, liveCard, sortCards } from "@/app/(staff)/kds/_components/kds-logic";
import { isKitchenHint } from "@/app/(staff)/kds/_components/use-kds-sync";
import { NOW, s2Cases } from "@/app/dev/s2/_fixtures";

// S2 Kitchen Display rendered to HTML, plus the pure rules behind the timer and sound.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {} }) }));
vi.mock("@/app/(staff)/kds/actions", () => ({}));

const caseOf = (id: string) => s2Cases().find((c) => c.id === id)!;
const render = (id: string) => {
  const c = caseOf(id);
  if (c.setup) return renderToStaticMarkup(createElement(KdsSetup, { initialLang: c.setup.lang ?? "en", preview: c.setup }));
  return renderToStaticMarkup(createElement(KdsScreen, { initial: c.board!, device: c.device!, realtimeUrl: null, preview: c.preview ?? {} }));
};
const buttonWith = (html: string, text: string) => {
  const at = html.indexOf(`>${text}<`);
  const start = html.lastIndexOf("<button", at);
  return at === -1 ? "" : html.slice(start, html.indexOf(">", start) + 1);
};

describe("review board", () => {
  it("has every required state and each renders", () => {
    const ids = s2Cases().map((c) => c.id);
    expect(ids.length).toBeGreaterThanOrEqual(41);
    for (const id of ids) expect(render(id).length).toBeGreaterThan(200);
  });
});

describe("ticket cards", () => {
  it("shows table, round, elapsed and urgency in words, not colour alone", () => {
    const html = render("09-several-late");
    expect(html).toContain(">Late<");
    expect(html).toContain(">Getting late<");
    expect(html).toContain(">On time<");
    expect(html).toContain("40:00");
  });

  it("labels combined tables T5 + T6", () => {
    expect(render("31-combined")).toContain("T5 + T6");
  });

  it("shows the stage's one primary action: Accept, Start preparing, Bump ticket", () => {
    expect(render("03-placed")).toContain(">Accept<");
    expect(render("04-accepted")).toContain(">Start preparing<");
    expect(render("05-preparing")).toContain(">Bump ticket<");
  });

  it("known allergens are red pills; unknown is said plainly and never as none", () => {
    const html = render("20-allergen-unknown");
    expect(html).toContain("Allergens not recorded");
    expect(html).not.toMatch(/No allergens/i);
    expect(render("19-allergens")).toContain(">Shellfish<");
  });

  it("Jain, notes and Hindi names are on the card", () => {
    expect(render("21-jain")).toContain(">JAIN<");
    expect(render("17-notes")).toContain("Serve mains together");
    const hi = render("22-hindi");
    expect(hi).toContain("बटर चिकन");
    expect(hi).toContain("+ बटर नान");
    expect(hi).toContain("Chef Special"); // no Hindi name: falls back to English
    expect(hi).toContain("टिकट पूरा");
  });

  it("other stations' lines are dimmed, tagged and not tappable", () => {
    const html = render("16-mixed-station");
    expect(html).toContain("Main station");
    expect(html).toMatch(/opacity-45"><button type="button" disabled=""/);
  });

  it("a partly bumped ticket keeps ready dishes, struck through", () => {
    expect(render("23-partial")).toContain("line-through");
  });

  it("a ticket awaiting staff confirmation is read-only", () => {
    const html = render("30-awaiting");
    expect(html).toContain("Awaiting staff confirmation");
    expect(html).not.toContain(">Accept<");
  });
});

describe("screen states", () => {
  it("offline: persistent red bar and every change disabled", () => {
    const html = render("33-offline");
    expect(html).toContain("Offline — showing last loaded tickets.");
    expect(buttonWith(html, "Accept")).toContain("disabled");
    expect(buttonWith(html, "Bump ticket")).toContain("disabled");
  });

  it("recall: available with time left, expired, or blocked once served", () => {
    expect(render("25-recall")).toContain("Recall last bump · 7:00 left");
    expect(render("26-recall-expired")).toContain("Recall closed (10 min)");
    expect(render("27-recall-served")).toContain("Already served — can&#x27;t recall");
  });

  it("station screens have no tabs; the expeditor sees All and every station", () => {
    expect(render("11-main")).not.toContain(">All<");
    const all = render("15-all");
    for (const t of ["All", "Bar", "Cold", "Dessert", "Main", "Tandoor"]) expect(all).toContain(`>${t}<`);
  });

  it("sound: enable after a tap, on, muted", () => {
    expect(render("22-hindi")).toContain("आवाज़ चालू करें");
    expect(render("36-sound-on")).toContain(">Sound on<");
    expect(render("37-sound-off")).toContain(">Sound off<");
  });

  it("connection, empty, stock panel, setup and denied", () => {
    expect(render("34-reconnecting")).toContain("Reconnecting…");
    expect(render("32-empty")).toContain("No open tickets");
    const stock = render("28-stock");
    expect(stock).toContain(">Mark out of stock<");
    expect(stock).toContain(">Restore<");
    expect(render("39-setup")).toContain("Set up this kitchen screen");
    expect(render("39b-setup-station")).toContain("Expeditor — all stations");
    expect(render("38-denied")).toContain("Only a manager or owner can do this.");
    expect(render("39c-settings")).toContain("Log out this screen");
  });
});

describe("timer rules", () => {
  it("formats elapsed time", () => {
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(formatElapsed(3_725_000)).toBe("1:02:05");
  });

  it("recomputes urgency locally at the exact thresholds and keeps urgent-oldest-first", () => {
    const base = caseOf("06-on-time").board!.cards[0];
    const card = { ...base, placedAt: NOW, targetMinutes: 10, stage: "preparing" as const };
    expect(liveCard(card, NOW + 10 * 60_000 - 1).urgency).toBe("on_time");
    expect(liveCard(card, NOW + 10 * 60_000).urgency).toBe("getting_late");
    expect(liveCard(card, NOW + 15 * 60_000).urgency).toBe("late");
    const older = { ...card, ticketId: "old", placedAt: NOW - 60_000, urgency: "on_time" as const };
    const late = { ...card, ticketId: "late", urgency: "late" as const };
    expect(sortCards([{ ...card, urgency: "on_time" }, older, late]).map((c) => c.ticketId)).toEqual(["late", "old", base.ticketId]);
  });
});

describe("sound de-duplication", () => {
  it("the first load primes silently; each ticket chimes once on arrival and once when late", () => {
    const a = createAnnouncer();
    expect(a.next([{ ticketId: "t1", urgency: "on_time" }, { ticketId: "t2", urgency: "late" }])).toEqual({ arrived: [], late: [] });
    expect(a.next([{ ticketId: "t1", urgency: "on_time" }, { ticketId: "t3", urgency: "new" }])).toEqual({ arrived: ["t3"], late: [] });
    // Polls and re-renders repeat the same data: silence
    expect(a.next([{ ticketId: "t1", urgency: "on_time" }, { ticketId: "t3", urgency: "new" }])).toEqual({ arrived: [], late: [] });
    expect(a.next([{ ticketId: "t1", urgency: "late" }])).toEqual({ arrived: [], late: ["t1"] });
    expect(a.next([{ ticketId: "t1", urgency: "late" }])).toEqual({ arrived: [], late: [] });
  });

  it("a reload remembers what this screen already announced", () => {
    const a = createAnnouncer();
    a.next([]);
    a.next([{ ticketId: "t9", urgency: "late" }]);
    const b = createAnnouncer(a.snapshot());
    b.next([]);
    expect(b.next([{ ticketId: "t9", urgency: "late" }])).toEqual({ arrived: [], late: [] });
  });

  it("switching tabs takes the new tickets in silently", () => {
    const a = createAnnouncer();
    a.next([{ ticketId: "t1", urgency: "on_time" }]);
    a.prime([{ ticketId: "t5", urgency: "late" }]);
    expect(a.next([{ ticketId: "t5", urgency: "late" }])).toEqual({ arrived: [], late: [] });
  });
});

describe("realtime hints", () => {
  it("reloads for kitchen and availability events only", () => {
    expect(isKitchenHint({ topic: "kitchen", type: "ticket.created" })).toBe(true);
    expect(isKitchenHint({ topic: "kitchen", type: "ticket.item_status" })).toBe(true);
    expect(isKitchenHint({ topic: "menu", type: "item.availability" })).toBe(true);
    expect(isKitchenHint({ topic: "floor", type: "floor.session_updated" })).toBe(false);
  });
});

describe("migration 0006", () => {
  it("adds the ticket uniqueness without deleting any rows", () => {
    const sql = readFileSync(path.resolve(import.meta.dirname, "../drizzle/0006_s2_kds.sql"), "utf8");
    expect(sql).toContain("tickets_order_station_uq");
    expect(sql).not.toMatch(/^\s*DELETE\s+FROM/im);
    expect(sql).not.toMatch(/UPDATE\s+`order_lines`/i);
  });
});
