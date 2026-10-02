import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { ticketUrgency } from "@/domain/kitchen";
import { AppError } from "@/server/errors";
import { combineTables } from "@/server/floor/table-actions";
import { addCartLine } from "@/server/guest/cart";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { markServed } from "@/server/kitchen/actions";
import { kdsSetupOptions, resolveKdsDevice, revokeKdsDevice, setupKdsDevice, updateKdsDevice, type KdsDevice } from "@/server/kitchen/device";
import { getKitchenDisplay } from "@/server/kitchen/display";
import { kdsAccept, kdsActor, kdsBoard, kdsBumpLine, kdsBumpTicket, kdsRecall, kdsSearch, kdsStart, kdsStock, viewStation } from "@/server/kitchen/kds";
import { onPublish, type RealtimeEvent } from "@/server/realtime/publish";
import { resolveStaff, signInStaff } from "@/server/staff/auth";
import { resetTestDb } from "./setup-db";

// S2 Kitchen Display: trusted screen credential, station permissions, lifecycle, recall,
// urgency, order-time snapshots, stock and tenant isolation.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let guest: GuestContext;
let orderId: string;
let tandoor: KdsDevice;
let main: KdsDevice;
let expo: KdsDevice;
let tandoorToken: string;
const events: RealtimeEvent[] = [];
const T0 = new Date();
const MIN = 60_000;
const later = (m: number) => new Date(T0.getTime() + m * MIN);
const MANAGER = { outletCode: "SRJ01", phone: "9000000002", pin: "2222" };

async function failsWith(p: Promise<unknown>, code: AppError["code"], reason?: string) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  if (reason) expect((err as AppError).details?.reason).toBe(reason);
  return err as AppError;
}
const lineOf = async (name: string, order = orderId) => (await env.db.select().from(s.orderLines).where(eq(s.orderLines.orderId, order))).find((l) => l.nameEn === name)!;
const ticketOf = async (station: string, order = orderId) => (await env.db.select().from(s.tickets).where(eq(s.tickets.orderId, order))).find((t) => t.station === station)!;
const audits = async (action: string) => env.db.select().from(s.auditLog).where(eq(s.auditLog.action, action));
const kitchenEvents = () => events.filter((e) => e.topic === "kitchen").map((e) => e.type);

async function device(station: string | null, expeditor = false) {
  const { token } = await setupKdsDevice({ ...MANAGER, station, expeditor });
  return { token, device: (await resolveKdsDevice(token))! };
}

beforeAll(async () => {
  env = await resetTestDb();
  onPublish((_scope, e) => events.push(...e));
  const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: "k7Qm", deviceId: "s2-aarav", displayName: "Aarav" });
  guest = await getGuestContext("SRJ01", "k7Qm", participantId, "s2-aarav");
  await addCartLine(guest, { itemId: env.demo.itemIds["Butter Chicken"], qty: 1, modifierIds: [env.demo.modifierIds.butterNaan] });
  await addCartLine(guest, { itemId: env.demo.itemIds["Paneer Tikka"], qty: 2, note: "extra charred" });
  await addCartLine(guest, { itemId: env.demo.itemIds["Hara Bhara Kebab"], qty: 1 });
  await addCartLine(guest, { itemId: env.demo.itemIds["Cola"], qty: 1 });
  ({ orderId } = await placeOrder(guest, {}, T0));
  ({ token: tandoorToken, device: tandoor } = await device("Tandoor"));
  ({ device: main } = await device("Main"));
  ({ device: expo } = await device(null, true));
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("trusted kitchen screen", () => {
  it("only a manager or owner sets a screen up; stations come from this outlet's menu", async () => {
    await failsWith(kdsSetupOptions({ outletCode: "SRJ01", phone: "9000000006", pin: "6666" }), "forbidden");
    await failsWith(setupKdsDevice({ outletCode: "SRJ01", phone: "9000000006", pin: "6666", station: "Main", expeditor: false }), "forbidden");
    await failsWith(setupKdsDevice({ ...MANAGER, pin: "9999", station: "Main", expeditor: false }), "sign_in_failed");
    expect((await kdsSetupOptions(MANAGER)).stations).toEqual(["Bar", "Cold", "Dessert", "Main", "Tandoor"]);
    await failsWith(setupKdsDevice({ ...MANAGER, station: "Grill", expeditor: false }), "invalid_state", "station");
    await failsWith(setupKdsDevice({ ...MANAGER, station: null, expeditor: false }), "invalid_state", "station");
    // Owner can too
    await setupKdsDevice({ outletCode: "SRJ01", phone: "9000000001", pin: "1111", station: "Bar", expeditor: false });
  });

  it("stores only the token's hash, binds tenant and outlet, and is not a staff session", async () => {
    const [row] = await env.db.select().from(s.kdsDevices).where(eq(s.kdsDevices.id, tandoor.deviceId));
    expect(row.tokenHash).not.toBe(tandoorToken);
    expect(row.tokenHash).toHaveLength(64);
    expect(tandoor).toMatchObject({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, station: "Tandoor", expeditor: false });
    expect(await resolveStaff(tandoorToken)).toBeNull();
    expect((await audits("kds.setup")).length).toBeGreaterThanOrEqual(4);
  });

  it("expires after 30 days", async () => {
    expect(await resolveKdsDevice(tandoorToken, new Date(Date.now() + 29 * 86_400_000))).not.toBeNull();
    expect(await resolveKdsDevice(tandoorToken, new Date(Date.now() + 31 * 86_400_000))).toBeNull();
    expect(await resolveKdsDevice("not-a-token")).toBeNull();
  });

  it("settings and logout need a manager PIN; a revoked screen is signed out", async () => {
    const { token } = await device("Cold");
    await failsWith(updateKdsDevice(token, { phone: "9000000006", pin: "6666", station: "Main", expeditor: false, lang: "hi" }), "forbidden");
    await updateKdsDevice(token, { phone: MANAGER.phone, pin: MANAGER.pin, station: "Main", expeditor: false, lang: "hi" });
    expect(await resolveKdsDevice(token)).toMatchObject({ station: "Main", lang: "hi" });
    await failsWith(revokeKdsDevice(token, { phone: "9000000006", pin: "6666" }), "forbidden");
    await revokeKdsDevice(token, { phone: MANAGER.phone, pin: MANAGER.pin });
    expect(await resolveKdsDevice(token)).toBeNull();
    expect((await audits("kds.revoke")).length).toBe(1);
  });
});

describe("stations", () => {
  it("a station screen sees only its station; All needs an expeditor screen", async () => {
    expect(viewStation(tandoor, null)).toBe("Tandoor");
    expect(() => viewStation(tandoor, "Main")).toThrow(AppError);
    await failsWith(kdsBoard(tandoor, "Main", later(1)), "forbidden");
    const own = await kdsBoard(tandoor, null, later(1));
    expect(own.cards.map((c) => c.station)).toEqual(["Tandoor"]);
    const all = await kdsBoard(expo, null, later(1));
    expect(all.cards.map((c) => c.station).sort()).toEqual(["Bar", "Main", "Tandoor"]);
    expect((await kdsBoard(expo, "Bar", later(1))).cards.map((c) => c.station)).toEqual(["Bar"]);
    expect(all.stations).toEqual(["Bar", "Cold", "Dessert", "Main", "Tandoor"]);
  });

  it("other stations' lines show dimmed for context, and a station screen cannot change them", async () => {
    const card = (await kdsBoard(tandoor, null, later(1))).cards[0];
    expect(card.lines.filter((l) => l.otherStation).map((l) => l.nameEn).sort()).toEqual(["Butter Chicken", "Cola"]);
    await failsWith(kdsAccept(tandoor, (await ticketOf("Main")).id), "forbidden", "station");
    await failsWith(kdsBumpLine(tandoor, (await lineOf("Butter Chicken")).id), "forbidden", "station");
    await failsWith(kdsBumpTicket(main, (await ticketOf("Tandoor")).id), "forbidden", "station");
    expect((await lineOf("Butter Chicken")).status).toBe("placed");
  });
});

describe("order-time snapshots", () => {
  it("keeps allergens ([] declared none, NULL unknown), Jain, spice and Hindi names from the order", async () => {
    const card = (await kdsBoard(expo, "Tandoor", later(1))).cards[0];
    const byName = Object.fromEntries(card.lines.map((l) => [l.nameEn, l]));
    expect(byName["Paneer Tikka"]).toMatchObject({ allergens: ["dairy"], spice: 2, jain: false, nameHi: "पनीर टिक्का", note: "extra charred", qty: 2 });
    expect(byName["Hara Bhara Kebab"].allergens).toBeNull();
    expect(byName["Cola"]).toMatchObject({ allergens: ["sulphites"], jain: true });
    expect(byName["Butter Chicken"].modifiers[0]).toMatchObject({ en: "Butter naan" });
    const [cola] = await env.db.select().from(s.orderLines).where(and(eq(s.orderLines.orderId, orderId), eq(s.orderLines.nameEn, "Cola")));
    expect(cola.allergensSnapshot).toEqual(["sulphites"]);
  });

  it("prep time, allergens and Jain survive a menu edit after the order", async () => {
    await env.db.update(s.menuItems).set({ prepMinutes: 99, allergens: [], isJain: true }).where(eq(s.menuItems.id, env.demo.itemIds["Paneer Tikka"]));
    const card = (await kdsBoard(tandoor, null, later(1))).cards[0];
    expect(card.targetMinutes).toBe(15);
    expect(card.lines.find((l) => l.nameEn === "Paneer Tikka")).toMatchObject({ allergens: ["dairy"], jain: false });
  });

  it("historical lines without a snapshot stay unknown, never converted to none", async () => {
    const line = await lineOf("Paneer Tikka");
    await env.db.update(s.orderLines).set({ allergensSnapshot: null, isJainSnapshot: null }).where(eq(s.orderLines.id, line.id));
    const l = (await kdsBoard(tandoor, null, later(1))).cards[0].lines.find((x) => x.id === line.id)!;
    expect(l.allergens).toBeNull();
    expect(l.jain).toBeNull();
    await env.db.update(s.orderLines).set({ allergensSnapshot: ["dairy"], isJainSnapshot: false }).where(eq(s.orderLines.id, line.id));
  });
});

describe("urgency", () => {
  it("turns amber exactly at the target and red exactly at 1.5 times it", () => {
    expect(ticketUrgency(15 * MIN - 1, 15, true)).toBe("on_time");
    expect(ticketUrgency(15 * MIN, 15, true)).toBe("getting_late");
    expect(ticketUrgency(22.5 * MIN - 1, 15, true)).toBe("getting_late");
    expect(ticketUrgency(22.5 * MIN, 15, true)).toBe("late");
    expect(ticketUrgency(MIN, 15, false)).toBe("new");
  });

  it("targets the slowest live dish on the ticket, from elapsed since the order was placed", async () => {
    const at = async (m: number) => (await kdsBoard(tandoor, null, later(m))).cards[0];
    expect((await at(1)).targetMinutes).toBe(15); // Paneer Tikka 15 > Hara Bhara 12
    expect((await at(15)).urgency).toBe("getting_late");
    expect((await at(22.5)).urgency).toBe("late");
  });

  it("sorts the most urgent first, then the oldest", async () => {
    const cards = (await kdsBoard(expo, null, later(25))).cards;
    // At 25 min Bar (Cola, 1 min) and Tandoor (15 min) are late; Main (18 min) is only getting late
    expect(cards.slice(0, 2).map((c) => c.station).sort()).toEqual(["Bar", "Tandoor"]);
    expect(cards.map((c) => c.urgency)).toEqual(["late", "late", "getting_late"]);
  });
});

describe("lifecycle from the screen", () => {
  it("Accept moves only this station's placed lines, once, and is audited", async () => {
    const before = events.length;
    const ticket = await ticketOf("Tandoor");
    await kdsAccept(tandoor, ticket.id, later(2));
    expect((await lineOf("Paneer Tikka")).status).toBe("accepted");
    expect((await lineOf("Butter Chicken")).status).toBe("placed");
    expect(kitchenEvents().slice(-2)).toEqual(["ticket.updated", "ticket.item_status"]);
    const n = events.length;
    await kdsAccept(tandoor, ticket.id, later(2));
    expect(events.length).toBe(n);
    expect(events.length).toBeGreaterThan(before);
    const [a] = await audits("kitchen.accept");
    expect(a.actorLabel).toMatch(/^kds:Tandoor:/);
    expect((await audits("kitchen.accept")).length).toBe(1);
    expect((await kdsBoard(tandoor, null, later(2))).cards[0].stage).toBe("accepted");
  });

  it("Start preparing records when cooking began, on the lines and the order", async () => {
    await kdsStart(tandoor, (await ticketOf("Tandoor")).id, later(3));
    const l = await lineOf("Paneer Tikka");
    expect(l.status).toBe("preparing");
    expect(l.preparingAt?.getTime()).toBe(later(3).getTime());
    const [order] = await env.db.select().from(s.orders).where(eq(s.orders.id, orderId));
    expect(order.status).toBe("preparing");
    expect(order.preparingAt?.getTime()).toBe(later(3).getTime());
    expect((await audits("kitchen.start")).length).toBe(1);
  });

  it("a line bump marks one dish ready (kept, struck through) and a repeat changes nothing", async () => {
    const line = await lineOf("Hara Bhara Kebab");
    await kdsBumpLine(tandoor, line.id, later(8));
    const card = (await kdsBoard(tandoor, null, later(8))).cards[0];
    expect(card.lines.find((l) => l.id === line.id)).toMatchObject({ done: true, status: "ready" });
    const n = events.length;
    await kdsBumpLine(tandoor, line.id, later(8));
    expect(events.length).toBe(n);
    expect((await audits("kitchen.bump_line")).length).toBe(1);
  });

  it("two screens bumping the same ticket at once change it once and announce once", async () => {
    const ticket = await ticketOf("Tandoor");
    const n = events.length;
    await Promise.all([kdsBumpTicket(tandoor, ticket.id, later(10)), kdsBumpTicket(expo, ticket.id, later(10))]);
    expect((await ticketOf("Tandoor")).status).toBe("done");
    expect((await audits("kitchen.bump_ticket")).length).toBe(1);
    expect(events.slice(n).filter((e) => e.type === "ticket.item_status")).toHaveLength(1);
    expect((await kdsBoard(tandoor, null, later(10))).cards).toHaveLength(0);
  });
});

describe("recall", () => {
  it("brings a ticket back within 10 minutes without resetting its timer", async () => {
    const ticket = await ticketOf("Tandoor");
    const board = await kdsBoard(tandoor, null, later(12));
    expect(board.lastBumped).toMatchObject({ ticketId: ticket.id, blocked: null });
    await kdsRecall(tandoor, ticket.id, later(12));
    expect((await lineOf("Paneer Tikka")).status).toBe("preparing");
    const card = (await kdsBoard(tandoor, null, later(12))).cards[0];
    expect(card.placedAt).toBe(T0.getTime());
    expect((await audits("kitchen.recall")).length).toBe(1);
    await kdsBumpTicket(tandoor, ticket.id, later(13));
  });

  it("refuses after 10 minutes", async () => {
    const ticket = await ticketOf("Tandoor");
    expect((await kdsBoard(tandoor, null, later(24))).lastBumped?.blocked).toBe("expired");
    await failsWith(kdsRecall(tandoor, ticket.id, later(24)), "recall_expired");
  });

  it("never reopens plates already served; zero eligible lines leaves the ticket closed", async () => {
    const ticket = await ticketOf("Tandoor");
    const lines = (await env.db.select().from(s.orderLines).where(eq(s.orderLines.orderId, orderId))).filter((l) => l.station === "Tandoor");
    await markServed({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, userId: null }, lines.map((l) => l.id), later(14));
    expect((await kdsBoard(tandoor, null, later(14))).lastBumped?.blocked).toBe("served");
    await failsWith(kdsRecall(tandoor, ticket.id, later(14)), "invalid_state", "nothing_to_recall");
    expect((await ticketOf("Tandoor")).status).toBe("done");
    expect((await lineOf("Paneer Tikka")).status).toBe("served");
  });
});

describe("combined tables", () => {
  it("labels a combined party's ticket T12 + T11 from the active assignments", async () => {
    const host = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000004", pin: "4444" })).token))!;
    await combineTables(host, { tableId: env.demo.tableIds.T12, addTableId: env.demo.tableIds.T11 });
    const card = (await kdsBoard(main, null, later(15))).cards[0];
    expect(card.tableCodes).toEqual(["T12", "T11"]);
  });
});

describe("one ticket per order and station", () => {
  it("the database refuses a second ticket for the same station on the same order", async () => {
    const t = await ticketOf("Main");
    const dup = env.db.insert(s.tickets).values({ ...t, id: "dup-ticket-0000000000000000000" });
    await expect(dup).rejects.toThrow();
  });
});

describe("out of stock from the screen", () => {
  it("marks and restores a dish for guests, audits who, and leaves placed orders alone", async () => {
    const before = await env.db.select().from(s.orderLines).where(eq(s.orderLines.orderId, orderId));
    const hits = await kdsSearch(main, "dal");
    expect(hits.map((h) => h.nameEn)).toContain("Dal Makhani");
    expect(await kdsSearch(main, "d")).toEqual([]);
    await kdsStock(main, env.demo.itemIds["Butter Chicken"], true);
    expect((await kdsBoard(main, null)).unavailable.map((u) => u.nameEn)).toContain("Butter Chicken");
    expect(kitchenEvents()).toContain("item.out_of_stock");
    const after = await env.db.select().from(s.orderLines).where(eq(s.orderLines.orderId, orderId));
    expect(after.map((l) => [l.id, l.status])).toEqual(before.map((l) => [l.id, l.status]));
    const [a] = await audits("menu.out_of_stock");
    expect(a.actorLabel).toMatch(/^kds:Main:/);
    await kdsStock(main, env.demo.itemIds["Butter Chicken"], false);
    expect((await kdsBoard(main, null)).unavailable.map((u) => u.nameEn)).not.toContain("Butter Chicken");
    expect((await audits("menu.restore")).length).toBe(1);
  });
});

describe("realtime", () => {
  it("a new order reaches the kitchen as ticket.created", async () => {
    const n = events.length;
    await addCartLine(guest, { itemId: env.demo.itemIds["Jeera Rice"], qty: 1 });
    await placeOrder(guest, {}, later(16));
    expect(events.slice(n).filter((e) => e.topic === "kitchen").map((e) => e.type)).toContain("ticket.created");
  });
});

describe("tenant isolation", () => {
  it("another restaurant's screen sees nothing here and changes nothing here", async () => {
    const nukkad: KdsDevice = { ...expo, tenantId: env.other.tenantId, outletId: env.other.outletId, deviceId: "x", outlet: { ...expo.outlet, brandId: "other-brand" } };
    expect((await kdsBoard(nukkad, null)).cards).toEqual([]);
    expect(await kdsSearch(nukkad, "Butter")).toEqual([]);
    const main = await ticketOf("Main");
    await failsWith(kdsBumpTicket(nukkad, main.id), "not_found");
    await failsWith(kdsAccept(nukkad, main.id), "not_found");
    await failsWith(kdsBumpLine(nukkad, (await lineOf("Butter Chicken")).id), "not_found");
    await failsWith(kdsStock(nukkad, env.demo.itemIds["Dal Makhani"], true), "not_found");
    // Same tenant, wrong outlet id still has to match
    const wrongOutlet = { ...expo, outletId: env.other.outletId };
    await failsWith(kdsBumpTicket(wrongOutlet, main.id), "not_found");
    expect((await getKitchenDisplay(kdsActor(nukkad), {})).cards).toEqual([]);
  });
});
