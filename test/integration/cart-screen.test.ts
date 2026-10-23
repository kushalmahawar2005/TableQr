import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { uuidv7 } from "@/db/id";
import { AppError } from "@/server/errors";
import { addCartLine, addConfiguredLine, getCart, removeCartLine, setCartLineQty, setPlainItemQty } from "@/server/guest/cart";
import { getCartScreen } from "@/server/guest/cart-screen";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { resetTestDb } from "./setup-db";

// G5 Your order: what the screen shows, Remove/Undo, and placing an order exactly once.

let env: Awaited<ReturnType<typeof resetTestDb>>;
const EVENING = new Date("2026-10-01T14:30:00Z");
const MORNING = new Date("2026-10-01T03:30:00Z");

beforeAll(async () => {
  env = await resetTestDb();
});
afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

async function failsWith(p: Promise<unknown>, code: AppError["code"]) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  return err as AppError;
}

async function seat(table: string, deviceId: string, displayName?: string): Promise<GuestContext> {
  const qr = env.demo.tableQr[table];
  const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId, displayName });
  const guestId = uuidv7();
  await env.db.insert(s.guests).values({ id: guestId, tenantId: env.demo.tenantId, phone: `+91990001${String(guestId.slice(-4)).padStart(4, "0")}`, name: displayName ?? "Mock guest" });
  await env.db.update(s.participants).set({ guestId }).where(eq(s.participants.id, participantId));
  return getGuestContext("SRJ01", qr, participantId, deviceId);
}
const item = (name: string) => env.demo.itemIds[name];
const screen = (table: string, deviceId: string, now?: Date) => getCartScreen("SRJ01", env.demo.tableQr[table], deviceId, now);
const ordersOf = (g: GuestContext) =>
  env.db.select().from(s.orders).where(and(eq(s.orders.tenantId, g.tenantId), eq(s.orders.sessionId, g.sessionId)));
const ticketsOf = async (orderIds: string[]) =>
  (await env.db.select().from(s.tickets)).filter((t) => orderIds.includes(t.orderId));

describe("Your order screen (G5)", () => {
  let me: GuestContext;
  let named: GuestContext;
  beforeAll(async () => {
    me = await seat("T1", "c-me"); // Open mode, no name yet
    named = await seat("T1", "c-aarav", "Aarav");
    await seat("T1", "c-quiet"); // joined, nothing in the cart
    const unnamed = await seat("T1", "c-unnamed");
    await setPlainItemQty(me, item("Paneer Tikka"), 2);
    await addConfiguredLine(me, { itemId: item("Butter Chicken"), qty: 1, modifierIds: [env.demo.modifierIds.butterNaan], note: "Less spicy" });
    await setPlainItemQty(named, item("Garlic Naan"), 2);
    await setPlainItemQty(unnamed, item("Masala Fries"), 1);
  });

  it("shows my lines as plain or configured with live prices and a subtotal", async () => {
    const data = await screen("T1", "c-me");
    expect(data.mine.map((l) => [l.nameEn, l.kind, l.qty, l.linePaise, l.reason])).toEqual([
      ["Paneer Tikka", "plain", 2, 64000, null],
      ["Butter Chicken", "configured", 1, 44000, null],
    ]);
    expect(data.mine[1]).toMatchObject({ note: "Less spicy", options: [{ nameEn: "Butter naan", nameHi: "बटर नान" }] });
    expect(data).toMatchObject({ myCount: 3, subtotalPaise: 108000 });
    expect(data.session).toMatchObject({ people: 4, needsName: true });
  });

  it("groups other people's carts read-only, without prices, naming only real names", async () => {
    const data = await screen("T1", "c-me");
    expect(data.others.map((g) => [g.name, g.count, g.lines.map((l) => [l.nameEn, l.qty])])).toEqual([
      ["Aarav", 2, [["Garlic Naan", 2]]],
      [null, 1, [["Masala Fries", 1]]],
    ]);
    expect(data.others[0].lines[0]).not.toHaveProperty("linePaise");
    expect((await screen("T1", "c-aarav")).session.needsName).toBe(false);
  });

  it("marks lines that cannot be placed and leaves them out of the subtotal", async () => {
    const g = await seat("T2", "c-blocked", "Bhavna");
    await setPlainItemQty(g, item("Dal Makhani"), 1);
    await setPlainItemQty(g, item("Rajma Masala"), 1);
    await addConfiguredLine(g, { itemId: item("Butter Chicken"), qty: 1, modifierIds: [env.demo.modifierIds.tandooriRoti] });
    await setPlainItemQty(g, item("Aloo Paratha"), 1, MORNING);
    await env.db.insert(s.outletItemOverrides).values({ tenantId: g.tenantId, outletId: g.outletId, itemId: item("Rajma Masala"), isAvailable: false });
    await env.db.update(s.modifiers).set({ isAvailable: false }).where(eq(s.modifiers.id, env.demo.modifierIds.tandooriRoti));

    const data = await screen("T2", "c-blocked", EVENING);
    expect(Object.fromEntries(data.mine.map((l) => [l.nameEn, l.reason]))).toEqual({
      "Dal Makhani": null,
      "Rajma Masala": "sold_out",
      "Butter Chicken": "option_unavailable",
      "Aloo Paratha": "outside_hours",
    });
    expect(data.subtotalPaise).toBe(26000);
    await env.db.update(s.modifiers).set({ isAvailable: true }).where(eq(s.modifiers.id, env.demo.modifierIds.tandooriRoti));
  });
});

describe("Remove and Undo (G5)", () => {
  it("restores the configuration at today's price, and refuses if it is no longer available", async () => {
    const g = await seat("T3", "u-guest", "Chirag");
    await addConfiguredLine(g, { itemId: item("Butter Chicken"), qty: 2, modifierIds: [env.demo.modifierIds.butterNaan], note: "No onion" });
    const [line] = (await getCart(g)).mine;
    const snap = (await removeCartLine(g, line.id))!;
    expect((await getCart(g)).mine).toEqual([]);

    // The menu price changes while the line is out of the cart; Undo uses the new price
    await env.db.update(s.outletItemOverrides).set({ pricePaise: 40000 }).where(and(eq(s.outletItemOverrides.outletId, g.outletId), eq(s.outletItemOverrides.itemId, item("Butter Chicken"))));
    await addCartLine(g, snap);
    const [restored] = (await getCart(g)).mine;
    expect(restored).toMatchObject({ qty: 2, note: "No onion", unitPricePaise: 46000, linePaise: 92000 });

    const snap2 = (await removeCartLine(g, restored.id))!;
    await env.db.update(s.modifiers).set({ isAvailable: false }).where(eq(s.modifiers.id, env.demo.modifierIds.butterNaan));
    await failsWith(addCartLine(g, snap2), "invalid_line");
    expect((await getCart(g)).mine).toEqual([]);
    await env.db.update(s.modifiers).set({ isAvailable: true }).where(eq(s.modifiers.id, env.demo.modifierIds.butterNaan));
  });

  it("only removes my own lines, and not while ordering is paused", async () => {
    const a = await seat("T4", "r-a", "Divya");
    const b = await seat("T4", "r-b", "Esha");
    await setPlainItemQty(a, item("Cola"), 1);
    const [line] = (await getCart(a)).mine;
    expect(await removeCartLine(b, line.id)).toBeNull();
    await env.db.update(s.tableSessions).set({ orderingLocked: true }).where(eq(s.tableSessions.id, a.sessionId));
    await failsWith(removeCartLine(a, line.id), "ordering_locked");
    await failsWith(setCartLineQty(a, line.id, 3), "ordering_locked");
    await env.db.update(s.tableSessions).set({ orderingLocked: false }).where(eq(s.tableSessions.id, a.sessionId));
  });
});

describe("Place order exactly once (G5)", () => {
  it("returns the same order for a repeated request id and makes one set of tickets", async () => {
    const g = await seat("T5", "p-guest", "Farah");
    await setPlainItemQty(g, item("Paneer Tikka"), 1);
    await setPlainItemQty(g, item("Masala Lassi"), 1);
    const first = await placeOrder(g, { requestId: "req-1" });
    const again = await placeOrder(g, { requestId: "req-1" });
    expect(again).toMatchObject({ orderId: first.orderId, roundNo: 1, replayed: true });
    const orders = await ordersOf(g);
    expect(orders).toHaveLength(1);
    expect((await ticketsOf([first.orderId])).map((t) => t.station).sort()).toEqual(["Bar", "Tandoor"]);

    // A new attempt is a new round
    await setPlainItemQty(g, item("Cola"), 1);
    expect((await placeOrder(g, { requestId: "req-2" })).roundNo).toBe(2);
  });

  it("survives a double tap that reaches the server twice at the same moment", async () => {
    const g = await seat("T6", "d-guest", "Gita");
    await setPlainItemQty(g, item("Dal Makhani"), 2);
    const [a, b] = await Promise.all([placeOrder(g, { requestId: "tap" }), placeOrder(g, { requestId: "tap" })]);
    expect(a.orderId).toBe(b.orderId);
    expect(await ordersOf(g)).toHaveLength(1);
    expect(await ticketsOf([a.orderId])).toHaveLength(1);
  });

  it("asks an Open-mode guest for a first name and saves it with the order", async () => {
    const g = await seat("T7", "n-guest");
    await setPlainItemQty(g, item("Cola"), 1);
    await failsWith(placeOrder(g, { name: "" }), "name_required");
    await failsWith(placeOrder(g, { name: "Aarav 😀" }), "invalid_name");
    await placeOrder(g, { name: "  हरि " });
    const [p] = await env.db.select().from(s.participants).where(eq(s.participants.id, g.participantId));
    expect(p.displayName).toBe("हरि");
    // Named now: later rounds do not ask again
    await setPlainItemQty(g, item("Cola"), 1);
    await placeOrder(g, {});
  });

  it("does not save the name when the order itself is refused", async () => {
    const g = await seat("T8", "cap-guest");
    await env.db.update(s.outlets).set({ newSessionCapPaise: 50000 }).where(eq(s.outlets.id, g.outletId));
    await setPlainItemQty(g, item("Chicken Chettinad"), 2);
    await failsWith(placeOrder(g, { name: "Ishaan", requestId: "cap-1" }), "needs_staff_confirmation");
    const [p] = await env.db.select().from(s.participants).where(eq(s.participants.id, g.participantId));
    expect(p.displayName).toMatch(/^Guest \d+$/);
    expect((await getCart(g)).mine).toHaveLength(1);
    // Below the outlet's cap the same guest can place it
    await setPlainItemQty(g, item("Chicken Chettinad"), 1);
    expect((await placeOrder(g, { name: "Ishaan", requestId: "cap-1" })).roundNo).toBe(1);
    await env.db.update(s.outlets).set({ newSessionCapPaise: 300000 }).where(eq(s.outlets.id, g.outletId));
  });

  it("places only my cart and leaves everyone else's", async () => {
    const a = await seat("T9", "m-a", "Jaya");
    const b = await seat("T9", "m-b", "Kiran");
    await setPlainItemQty(a, item("Cola"), 1);
    await setPlainItemQty(b, item("Masala Lassi"), 2);
    await placeOrder(a, { requestId: "mine" });
    expect((await getCart(a)).mine).toEqual([]);
    expect((await getCart(b)).mine.map((l) => l.qty)).toEqual([2]);
  });
});
