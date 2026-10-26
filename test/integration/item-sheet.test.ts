import { clearMenuCache } from "@/server/guest/menu";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { addCartLine, addConfiguredLine, getCart, setPlainItemQty } from "@/server/guest/cart";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { getItemSheet } from "@/server/guest/item-sheet";
import { getMenuScreen } from "@/server/guest/menu-screen";
import { startOrJoinTable } from "@/server/guest/session";
import { resetTestDb } from "./setup-db";

// G4 item sheet: what it loads and how "Add to cart" lands in the guest's own cart.

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
  return err as AppError;
}

async function seat(table: string, deviceId: string, displayName?: string): Promise<GuestContext> {
  const qr = env.demo.tableQr[table];
  const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId, displayName });
  return getGuestContext("SRJ01", qr, participantId, deviceId);
}

const item = (name: string) => env.demo.itemIds[name];
const mods = () => env.demo.modifierIds;
const myLines = async (g: GuestContext, name: string) => (await getCart(g)).mine.filter((l) => l.nameEn === name);

describe("item sheet data (G4)", () => {
  let g: GuestContext;
  beforeAll(async () => {
    g = await seat("T1", "i-guest", "Aarav");
  });

  it("loads the dish with its option groups in both languages", async () => {
    const sheet = await getItemSheet("SRJ01", env.demo.tableQr.T1, "i-guest", item("Butter Chicken"), EVENING);
    expect(sheet.item).toMatchObject({ nameEn: "Butter Chicken", pricePaise: 38000, available: true, outsideHours: false, allergens: ["dairy", "tree_nuts"] });
    expect(sheet.groups.map((x) => [x.nameEn, x.nameHi, x.minSelect, x.maxSelect, x.modifiers.length])).toEqual([
      ["Choose bread", "रोटी चुनें", 1, 1, 3],
      ["Add-ons", "ऐड-ऑन", 0, 3, 1],
    ]);
  });

  it("shows how many of the plain dish I already have", async () => {
    await setPlainItemQty(g, item("Dal Makhani"), 2);
    expect((await getItemSheet("SRJ01", env.demo.tableQr.T1, "i-guest", item("Dal Makhani"))).plainQty).toBe(2);
    await setPlainItemQty(g, item("Dal Makhani"), 0);
  });

  it("knows when a breakfast dish is outside its hours", async () => {
    const sheet = await getItemSheet("SRJ01", env.demo.tableQr.T1, "i-guest", item("Aloo Paratha"), EVENING);
    expect(sheet.item.outsideHours).toBe(true);
  });

  it("refuses strangers and dishes from elsewhere", async () => {
    await failsWith(getItemSheet("SRJ01", env.demo.tableQr.T1, "stranger", item("Cola")), "session_expired");
    await failsWith(getItemSheet("SRJ01", env.demo.tableQr.T1, "i-guest", env.other.itemId), "not_found");
  });
});

describe("Add to cart from the sheet (G4)", () => {
  let g: GuestContext;
  let friend: GuestContext;
  beforeAll(async () => {
    g = await seat("T2", "a-guest", "Bhavna");
    friend = await seat("T2", "a-friend", "Chirag");
  });

  it("adds a plain dish onto the same line the menu stepper uses", async () => {
    await setPlainItemQty(g, item("Masala Lassi"), 2);
    await addConfiguredLine(g, { itemId: item("Masala Lassi"), qty: 3 });
    expect((await myLines(g, "Masala Lassi")).map((l) => l.qty)).toEqual([5]);
    const data = await getMenuScreen("SRJ01", env.demo.tableQr.T2, "a-guest");
    expect(data.cart.byItem[item("Masala Lassi")]).toEqual({ plain: 5, custom: 0 });
  });

  it("merges a configured line only when options and note are exactly the same", async () => {
    const naan = mods().butterNaan;
    const gravy = mods().extraGravy;
    await addConfiguredLine(g, { itemId: item("Butter Chicken"), qty: 1, modifierIds: [naan, gravy], note: "Less spicy" });
    await addConfiguredLine(g, { itemId: item("Butter Chicken"), qty: 2, modifierIds: [gravy, naan], note: "  Less  spicy " });
    let lines = await myLines(g, "Butter Chicken");
    expect(lines.map((l) => l.qty)).toEqual([3]);

    await addConfiguredLine(g, { itemId: item("Butter Chicken"), qty: 1, modifierIds: [naan], note: "Less spicy" });
    await addConfiguredLine(g, { itemId: item("Butter Chicken"), qty: 1, modifierIds: [naan, gravy], note: "No onion" });
    lines = await myLines(g, "Butter Chicken");
    expect(lines.map((l) => l.qty)).toEqual([3, 1, 1]);
    expect(lines[0]).toMatchObject({ note: "Less spicy", linePaise: 3 * 47000 });
  });

  it("never merges into someone else's line or a shared line", async () => {
    const roti = mods().tandooriRoti;
    await addConfiguredLine(friend, { itemId: item("Butter Chicken"), qty: 1, modifierIds: [roti] });
    await addCartLine(g, { itemId: item("Butter Chicken"), qty: 1, modifierIds: [roti], sharedWith: [g.participantId, friend.participantId] });
    await addConfiguredLine(g, { itemId: item("Butter Chicken"), qty: 1, modifierIds: [roti] });
    const mine = (await myLines(g, "Butter Chicken")).filter((l) => l.modifiers.length === 1 && l.modifiers[0].nameEn === "Tandoori roti");
    expect(mine.map((l) => [l.qty, l.sharedWith.length])).toEqual([
      [1, 2],
      [1, 0],
    ]);
    expect((await myLines(friend, "Butter Chicken")).map((l) => l.qty)).toEqual([1]);
  });

  it("keeps any one line at 50", async () => {
    await setPlainItemQty(g, item("Cola"), 48);
    const err = await failsWith(addConfiguredLine(g, { itemId: item("Cola"), qty: 3 }), "invalid_line");
    expect(err.details?.reason).toBe("max_qty");
    await addConfiguredLine(g, { itemId: item("Cola"), qty: 2 });
    expect((await myLines(g, "Cola")).map((l) => l.qty)).toEqual([50]);
    await setPlainItemQty(g, item("Cola"), 0);
  });

  it("checks the required choice and every option on the server", async () => {
    await failsWith(addConfiguredLine(g, { itemId: item("Butter Chicken"), qty: 1 }), "invalid_line");
    await env.db.update(s.modifiers).set({ isAvailable: false }).where(eq(s.modifiers.id, mods().butterNaan));
    const err = await failsWith(addConfiguredLine(g, { itemId: item("Butter Chicken"), qty: 1, modifierIds: [mods().butterNaan] }), "invalid_line");
    expect(err.details?.modifierIds).toEqual([mods().butterNaan]);
    await env.db.update(s.modifiers).set({ isAvailable: true }).where(eq(s.modifiers.id, mods().butterNaan));
  });

  it("treats a dish as sold out when its required choice has nothing left", async () => {
    const bread = [mods().butterNaan, mods().tandooriRoti, mods().noBread];
    for (const id of bread) await env.db.update(s.modifiers).set({ isAvailable: false }).where(eq(s.modifiers.id, id));
    // The menu actions clear the browsing cache after a change; writing straight to the table skips them
    clearMenuCache(env.demo.tenantId);
    const data = await getMenuScreen("SRJ01", env.demo.tableQr.T2, "a-guest");
    expect(data.menu.flatMap((c) => c.items).find((i) => i.nameEn === "Butter Chicken")!.available).toBe(false);
    await failsWith(addConfiguredLine(g, { itemId: item("Butter Chicken"), qty: 1, modifierIds: [mods().noBread] }), "items_unavailable");
    for (const id of bread) await env.db.update(s.modifiers).set({ isAvailable: true }).where(eq(s.modifiers.id, id));
    clearMenuCache(env.demo.tenantId);
  });

  it("refuses a dish outside its category hours at Add time, from the sheet and the stepper", async () => {
    const err = await failsWith(addConfiguredLine(g, { itemId: item("Aloo Paratha"), qty: 1 }, EVENING), "items_unavailable");
    expect(err.details?.reason).toBe("outside_hours");
    await failsWith(setPlainItemQty(g, item("Aloo Paratha"), 1, EVENING), "items_unavailable");
    await addConfiguredLine(g, { itemId: item("Aloo Paratha"), qty: 1 }, MORNING);
    // Lowering is always allowed
    await setPlainItemQty(g, item("Aloo Paratha"), 0, EVENING);
  });

  it("adds nothing while ordering is paused or after the bill is requested", async () => {
    await env.db.update(s.tableSessions).set({ orderingLocked: true }).where(eq(s.tableSessions.id, g.sessionId));
    await failsWith(addConfiguredLine(g, { itemId: item("Cola"), qty: 1 }), "ordering_locked");
    await env.db.update(s.tableSessions).set({ orderingLocked: false, status: "bill_requested" }).where(eq(s.tableSessions.id, g.sessionId));
    await failsWith(addConfiguredLine(g, { itemId: item("Cola"), qty: 1 }), "table_settling");
    await env.db
      .update(s.tableSessions)
      .set({ status: "open" })
      .where(and(eq(s.tableSessions.tenantId, g.tenantId), eq(s.tableSessions.id, g.sessionId)));
  });

  it("rejects quantities outside 1–50", async () => {
    await failsWith(addConfiguredLine(g, { itemId: item("Cola"), qty: 0 }), "invalid_line");
    await failsWith(addConfiguredLine(g, { itemId: item("Cola"), qty: 51 }), "invalid_line");
  });
});
