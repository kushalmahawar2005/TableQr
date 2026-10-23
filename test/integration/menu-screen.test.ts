import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { requestBill } from "@/server/billing/payments";
import { AppError } from "@/server/errors";
import { addCartLine, getCart, setPlainItemQty } from "@/server/guest/cart";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { getMenuScreen } from "@/server/guest/menu-screen";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { onPublish, type RealtimeEvent } from "@/server/realtime/publish";
import { attachVerifiedTestGuest, resetTestDb } from "./setup-db";

// G3 Menu: the screen's data, the stepper's cart writes and the rules around them.

let env: Awaited<ReturnType<typeof resetTestDb>>;
const EVENING = new Date("2026-10-01T14:30:00Z"); // 20:00 in Jaipur
const MORNING = new Date("2026-10-01T03:30:00Z"); // 09:00 in Jaipur

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
}

async function seat(table: string, deviceId: string, displayName?: string): Promise<GuestContext> {
  const qr = env.demo.tableQr[table];
  const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId, displayName });
  return attachVerifiedTestGuest(appDb, await getGuestContext("SRJ01", qr, participantId, deviceId), displayName ?? "Guest");
}

const item = (name: string) => env.demo.itemIds[name];
const screen = (table: string, deviceId: string, now = EVENING) => getMenuScreen("SRJ01", env.demo.tableQr[table], deviceId, now);
const row = (data: Awaited<ReturnType<typeof screen>>, name: string) => data.menu.flatMap((c) => c.items).find((i) => i.nameEn === name)!;

describe("menu screen data (G3)", () => {
  it("shows the table, Just you, and only bestsellers in Popular", async () => {
    await seat("T1", "m-solo", "Aarav");
    const data = await screen("T1", "m-solo");
    expect(data.table.code).toBe("T1");
    expect(data.session).toMatchObject({ people: 1, status: "open", orderingLocked: false, hostName: "Aarav" });
    const names = data.popularIds.map((id) => data.menu.flatMap((c) => c.items).find((i) => i.id === id)!.nameEn);
    expect(names).toEqual(["Paneer Tikka", "Butter Chicken", "Dal Makhani", "Masala Lassi"]);
  });

  it("counts everyone at the table and never names a stand-in host", async () => {
    await seat("T2", "m-a"); // Open mode: placeholder name until the first order
    await seat("T2", "m-b");
    const data = await screen("T2", "m-b");
    expect(data.session).toMatchObject({ people: 2, hostName: null });
  });

  it("describes each row: options, From price, tag, allergens and spice as stated", async () => {
    const data = await screen("T1", "m-solo");
    expect(row(data, "Butter Chicken")).toMatchObject({ options: "required", price: { paise: 38000, from: true }, tag: "bestseller" });
    expect(row(data, "Dal Makhani")).toMatchObject({ options: "none", price: { paise: 26000, from: false }, tag: "bestseller" });
    expect(row(data, "Mutton Curry")).toMatchObject({ available: false, tag: "chefs_pick", allergens: null });
    expect(row(data, "Hara Bhara Kebab")).toMatchObject({ spice: null, allergens: null });
    expect(row(data, "Jeera Rice")).toMatchObject({ spice: 0, allergens: [] });
    expect(row(data, "Paneer Tikka")).toMatchObject({ searchTerms: "panir tikka, paner tikka", allergens: ["dairy"] });
    // Option trees are left for the item sheet
    expect(row(data, "Butter Chicken")).not.toHaveProperty("groups");
  });

  it("shows Breakfast only in its hours", async () => {
    expect((await screen("T1", "m-solo", EVENING)).menu.map((c) => c.nameEn)).not.toContain("Breakfast");
    expect((await screen("T1", "m-solo", MORNING)).menu[0].nameEn).toBe("Breakfast");
  });

  it("hides sold-out dishes when the outlet chooses to", async () => {
    await env.db.update(s.outlets).set({ soldOutDisplay: "hide" }).where(eq(s.outlets.id, env.demo.outletId));
    expect(row(await screen("T1", "m-solo"), "Mutton Curry")).toBeUndefined();
    await env.db.update(s.outlets).set({ soldOutDisplay: "grey" }).where(eq(s.outlets.id, env.demo.outletId));
  });

  it("refuses a phone that is not at the table", async () => {
    await failsWith(screen("T1", "m-stranger"), "session_expired");
    await failsWith(getMenuScreen("SRJ01", env.demo.tableQr.T1, null), "session_expired");
  });

  it("counts outstanding dishes for the whole table, excluding carts, other tables and finished lines", async () => {
    const me = await seat("T7", "badge-me", "Gita");
    const friend = await seat("T7", "badge-friend", "Hari");
    const elsewhere = await seat("T8", "badge-other", "Isha");
    expect((await screen("T7", "badge-me")).inProgress).toBe(0);
    await addCartLine(me, { itemId: item("Cola"), qty: 2 });
    await addCartLine(me, { itemId: item("Jeera Rice"), qty: 3 });
    await addCartLine(me, { itemId: item("Dal Makhani"), qty: 4 });
    await placeOrder(me, {}, EVENING);
    await addCartLine(friend, { itemId: item("Masala Lassi"), qty: 1 });
    await placeOrder(friend, {}, EVENING);
    await addCartLine(elsewhere, { itemId: item("Cola"), qty: 7 });
    await placeOrder(elsewhere, {}, EVENING);
    await addCartLine(me, { itemId: item("Cola"), qty: 5 });
    expect((await screen("T7", "badge-me")).inProgress).toBe(10);
    for (const [name, status] of [["Cola", "served"], ["Jeera Rice", "cancelled"], ["Dal Makhani", "voided"]] as const) {
      await env.db.update(s.orderLines).set({ status }).where(and(eq(s.orderLines.sessionId, me.sessionId), eq(s.orderLines.itemId, item(name))));
    }
    await env.db.update(s.orderLines).set({ status: "ready" }).where(and(eq(s.orderLines.sessionId, me.sessionId), eq(s.orderLines.itemId, item("Masala Lassi"))));
    expect((await screen("T7", "badge-me")).inProgress).toBe(1);
    expect((await screen("T7", "badge-friend")).inProgress).toBe(1);
  });
});

describe("plain-line stepper (G3)", () => {
  let me: GuestContext;
  let friend: GuestContext;

  beforeAll(async () => {
    me = await seat("T3", "s-me", "Chirag");
    friend = await seat("T3", "s-friend", "Divya");
  });

  it("adds, raises and lowers one line, and removes it at 0", async () => {
    await setPlainItemQty(me, item("Dal Makhani"), 1);
    await setPlainItemQty(me, item("Dal Makhani"), 3);
    let cart = await getCart(me);
    expect(cart.mine.map((l) => [l.nameEn, l.qty])).toEqual([["Dal Makhani", 3]]);
    await setPlainItemQty(me, item("Dal Makhani"), 2);
    expect((await getCart(me)).mine.map((l) => l.qty)).toEqual([2]);
    await setPlainItemQty(me, item("Dal Makhani"), 0);
    cart = await getCart(me);
    expect(cart.mine).toEqual([]);
  });

  it("collapses older duplicate plain lines into one", async () => {
    await addCartLine(me, { itemId: item("Cola"), qty: 1 });
    await addCartLine(me, { itemId: item("Cola"), qty: 2 });
    await setPlainItemQty(me, item("Cola"), 4);
    expect((await getCart(me)).mine.filter((l) => l.nameEn === "Cola").map((l) => l.qty)).toEqual([4]);
    await setPlainItemQty(me, item("Cola"), 0);
  });

  it("leaves lines with notes or options alone and reports them separately", async () => {
    await addCartLine(me, { itemId: item("Paneer Tikka"), qty: 1, note: "less spicy" });
    await setPlainItemQty(me, item("Paneer Tikka"), 2);
    const data = await screen("T3", "s-me");
    expect(data.cart.byItem[item("Paneer Tikka")]).toEqual({ plain: 2, custom: 1 });
    expect(data.cart.count).toBe(3);
    expect(data.cart.subtotalPaise).toBe(3 * 32000);
    await setPlainItemQty(me, item("Paneer Tikka"), 0);
    expect((await getCart(me)).mine.map((l) => l.note)).toEqual(["less spicy"]);
  });

  it("allows up to 50 and nothing outside 0–50", async () => {
    await setPlainItemQty(me, item("Tandoori Roti"), 50);
    await failsWith(setPlainItemQty(me, item("Tandoori Roti"), 51), "invalid_line");
    await failsWith(setPlainItemQty(me, item("Tandoori Roti"), -1), "invalid_line");
    await failsWith(setPlainItemQty(me, item("Tandoori Roti"), 1.5), "invalid_line");
    await setPlainItemQty(me, item("Tandoori Roti"), 0);
  });

  it("sends dishes with a required choice to the item sheet, but adds optional-only dishes plain", async () => {
    await failsWith(setPlainItemQty(me, item("Butter Chicken"), 1), "needs_choice");
    // Make Garlic Naan optional-only for this test
    const group = "11111111-1111-7111-8111-111111111111";
    await env.db.insert(s.modifierGroups).values({ id: group, tenantId: env.demo.tenantId, itemId: item("Garlic Naan"), nameEn: "Extras", minSelect: 0, maxSelect: 1 });
    await setPlainItemQty(me, item("Garlic Naan"), 1);
    expect((await getCart(me)).mine.find((l) => l.nameEn === "Garlic Naan")!.qty).toBe(1);
    await setPlainItemQty(me, item("Garlic Naan"), 0);
    await env.db.delete(s.modifierGroups).where(eq(s.modifierGroups.id, group));
  });

  it("will not add a sold-out dish but lets the guest lower it", async () => {
    await setPlainItemQty(me, item("Rajma Masala"), 2);
    await env.db.insert(s.outletItemOverrides).values({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, itemId: item("Rajma Masala"), isAvailable: false });
    await failsWith(setPlainItemQty(me, item("Rajma Masala"), 3), "items_unavailable");
    await setPlainItemQty(me, item("Rajma Masala"), 1);
    await setPlainItemQty(me, item("Rajma Masala"), 0);
    await env.db.delete(s.outletItemOverrides).where(and(eq(s.outletItemOverrides.outletId, env.demo.outletId), eq(s.outletItemOverrides.itemId, item("Rajma Masala"))));
  });

  it("keeps each person's cart their own", async () => {
    await setPlainItemQty(me, item("Masala Lassi"), 2);
    await setPlainItemQty(friend, item("Masala Lassi"), 1);
    expect((await screen("T3", "s-me")).cart.byItem[item("Masala Lassi")]).toEqual({ plain: 2, custom: 0 });
    expect((await screen("T3", "s-friend")).cart.byItem[item("Masala Lassi")]).toEqual({ plain: 1, custom: 0 });
    await setPlainItemQty(friend, item("Masala Lassi"), 0);
    expect((await getCart(me)).mine.find((l) => l.nameEn === "Masala Lassi")!.qty).toBe(2);
  });

  it("freezes carts while ordering is paused, and after the bill is requested", async () => {
    await env.db.update(s.tableSessions).set({ orderingLocked: true }).where(eq(s.tableSessions.id, me.sessionId));
    expect((await screen("T3", "s-me")).session.orderingLocked).toBe(true);
    await failsWith(setPlainItemQty(me, item("Masala Lassi"), 3), "ordering_locked");
    await failsWith(setPlainItemQty(me, item("Masala Lassi"), 0), "ordering_locked");
    await env.db.update(s.tableSessions).set({ orderingLocked: false }).where(eq(s.tableSessions.id, me.sessionId));

    await requestBill({ tenantId: me.tenantId, outletId: me.outletId, sessionId: me.sessionId });
    expect((await screen("T3", "s-me")).session.status).toBe("bill_requested");
    await failsWith(setPlainItemQty(me, item("Masala Lassi"), 3), "table_settling");
  });
});

describe("place order checks (G3 support)", () => {
  it("does not place a breakfast dish after breakfast hours", async () => {
    const g = await seat("T5", "w-guest", "Esha");
    await setPlainItemQty(g, item("Aloo Paratha"), 1, MORNING);
    const err = await placeOrder(g, {}, EVENING).then(
      () => null,
      (e: AppError) => e,
    );
    expect(err?.code).toBe("items_unavailable");
    expect((err?.details?.outsideHoursLineIds as string[]).length).toBe(1);
    // In its hours it goes through
    await placeOrder(g, {}, MORNING);
  });

  it("announces a dish whose portion counter reaches zero", async () => {
    const sent: RealtimeEvent[] = [];
    const stop = onPublish((_scope, events) => sent.push(...events));
    try {
      await env.db
        .update(s.outletItemOverrides)
        .set({ portionsLeft: 2 })
        .where(and(eq(s.outletItemOverrides.outletId, env.demo.outletId), eq(s.outletItemOverrides.itemId, item("Butter Chicken"))));
      const g = await seat("T6", "p-guest", "Farah");
      await addCartLine(g, { itemId: item("Butter Chicken"), qty: 2, modifierIds: [env.demo.modifierIds.noBread] });
      await placeOrder(g);
      expect(sent).toContainEqual({ topic: "menu", type: "item.availability", data: { itemId: item("Butter Chicken"), available: false } });
    } finally {
      stop();
    }
  });
});
