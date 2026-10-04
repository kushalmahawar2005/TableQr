import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { computeDraft, loadBillInputs } from "@/server/billing/bill";
import { addCartLine, addConfiguredLine, getCart } from "@/server/guest/cart";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { getItemSheet } from "@/server/guest/item-sheet";
import { getGuestMenu } from "@/server/guest/menu";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { onPublish, type RealtimeEvent } from "@/server/realtime/publish";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { bulkPrice, saveModifierGroup } from "@/server/staff/menu-manager";
import { bulkOutletPrice, clearOutletPrice, getPricingData, setOutletPrice } from "@/server/staff/pricing";
import { staffPlaceOrder } from "@/server/staff/waiter-mutations";
import { resetTestDb } from "./setup-db";

// O4 Pricing: outlet overrides, the approved O3 money fixes, and open-cart price safety.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let owner: StaffSession;
let manager: StaffSession;
let waiter: StaffSession;
const EVENING = new Date("2026-10-01T14:30:00Z");
let events: RealtimeEvent[] = [];
let stop: () => void;

const signIn = async (phone: string, pin: string) => (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone, pin })).token))!;
const item = (name: string) => env.demo.itemIds[name];
const brandPrice = async (id: string) => (await env.db.select().from(s.menuItems).where(eq(s.menuItems.id, id)))[0].pricePaise;
const override = async (id: string, outletId = env.demo.outletId) =>
  (await env.db.select().from(s.outletItemOverrides).where(and(eq(s.outletItemOverrides.outletId, outletId), eq(s.outletItemOverrides.itemId, id))))[0];
const setBrand = (id: string, pricePaise: number) => env.db.update(s.menuItems).set({ pricePaise }).where(eq(s.menuItems.id, id));
const setDelta = (id: string, priceDeltaPaise: number) => env.db.update(s.modifiers).set({ priceDeltaPaise }).where(eq(s.modifiers.id, id));
const auditOf = (action: string) => env.db.select().from(s.auditLog).where(eq(s.auditLog.action, action));
const menuChanged = () => events.filter((e) => e.topic === "menu" && e.type === "menu.changed");
const ordersOf = (g: GuestContext) => env.db.select().from(s.orders).where(eq(s.orders.sessionId, g.sessionId));
const linesOf = (orderId: string) => env.db.select().from(s.orderLines).where(eq(s.orderLines.orderId, orderId));

async function failsWith(p: Promise<unknown>, code: AppError["code"]) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  return err as AppError;
}
async function seat(table: string, deviceId: string): Promise<GuestContext> {
  const qr = env.demo.tableQr[table];
  const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId, displayName: "Aarav" });
  return getGuestContext("SRJ01", qr, participantId, deviceId);
}
const clearAll = () => env.db.update(s.outletItemOverrides).set({ pricePaise: null }).where(eq(s.outletItemOverrides.outletId, env.demo.outletId));

beforeAll(async () => {
  env = await resetTestDb();
  owner = await signIn("9000000001", "1111");
  manager = await signIn("9000000002", "2222");
  waiter = await signIn("9000000005", "5555");
  stop = onPublish((_scope, e) => events.push(...e));
});
beforeEach(() => {
  events = [];
});
afterAll(async () => {
  stop();
  await env.conn.end();
  await appDb.$client.end();
});

describe("permissions", () => {
  it("C/D: owner and manager can view; manager read-only; every other role is denied", async () => {
    expect((await getPricingData(owner)).canEdit).toBe(true);
    const view = await getPricingData(manager);
    expect(view.canEdit).toBe(false);
    expect(view.rows.length).toBeGreaterThan(0);
    for (const role of ["host", "waiter", "cashier", "kitchen", "accountant"] as const) {
      await failsWith(getPricingData({ ...owner, roles: [role] }), "forbidden");
    }
  });

  it("A/B: owner can set an override; manager cannot (server-side)", async () => {
    await failsWith(setOutletPrice(manager, item("Dal Makhani"), 27000), "forbidden");
    await failsWith(clearOutletPrice(manager, item("Dal Makhani")), "forbidden");
    await failsWith(bulkOutletPrice(manager, { action: "reset", itemIds: [item("Dal Makhani")] }), "forbidden");
    await setOutletPrice(owner, item("Dal Makhani"), 27000);
    expect((await override(item("Dal Makhani"))).pricePaise).toBe(27000);
  });
});

describe("single override and reset", () => {
  beforeEach(clearAll);

  it("F/G/T: effective price is override first, brand otherwise; reset returns to brand", async () => {
    const id = item("Paneer Tikka");
    const row = async () => (await getPricingData(owner)).rows.find((r) => r.id === id)!;
    expect(await row()).toMatchObject({ pricePaise: 32000, source: "brand_base", outletPricePaise: null });
    await setOutletPrice(owner, id, 34900);
    expect(await row()).toMatchObject({ brandPricePaise: 32000, outletPricePaise: 34900, pricePaise: 34900, source: "outlet_override" });
    await clearOutletPrice(owner, id);
    expect(await row()).toMatchObject({ pricePaise: 32000, source: "brand_base", outletPricePaise: null });
  });

  it("E: set and clear touch price only; availability and portions on the same row survive", async () => {
    const id = item("Butter Chicken");
    const before = await override(id);
    expect(before.portionsLeft).toBe(12);
    await setOutletPrice(owner, id, 40000);
    await clearOutletPrice(owner, id);
    const after = await override(id);
    expect(after).toMatchObject({ id: before.id, pricePaise: null, portionsLeft: 12, isAvailable: before.isAvailable, soldOutUntil: before.soldOutUntil });
    // Off items stay off
    const off = item("Mutton Curry");
    await setOutletPrice(owner, off, 50000);
    expect((await override(off)).isAvailable).toBe(false);
  });

  it("M: whole rupees only, never negative", async () => {
    for (const bad of [34950, -100, 1.5, Number.NaN]) await failsWith(setOutletPrice(owner, item("Paneer Tikka"), bad), "invalid_state");
    await setOutletPrice(owner, item("Paneer Tikka"), 0);
    expect((await override(item("Paneer Tikka"))).pricePaise).toBe(0);
  });

  it("refuses a stale edit", async () => {
    await setOutletPrice(owner, item("Paneer Tikka"), 30000);
    await failsWith(setOutletPrice(owner, item("Paneer Tikka"), 31000, { expectedOutletPricePaise: null }), "conflict");
    expect((await override(item("Paneer Tikka"))).pricePaise).toBe(30000);
  });

  it("N/O/Q/R: audit and realtime for set and clear", async () => {
    const id = item("Dal Makhani");
    await setOutletPrice(owner, id, 28000);
    const [set] = (await auditOf("pricing.outlet_price_set")).filter((a) => a.entityId === id).slice(-1);
    expect(set).toMatchObject({ tenantId: owner.tenantId, outletId: owner.outletId, actorUserId: owner.userId });
    expect(set.before).toMatchObject({ outletPricePaise: null, pricePaise: 26000 });
    expect(set.after).toMatchObject({ outletPricePaise: 28000, pricePaise: 28000, source: "outlet_override" });
    expect(menuChanged()).toHaveLength(1);
    await clearOutletPrice(owner, id);
    const [cleared] = (await auditOf("pricing.outlet_price_cleared")).filter((a) => a.entityId === id).slice(-1);
    expect(cleared.before).toMatchObject({ outletPricePaise: 28000 });
    expect(cleared.after).toMatchObject({ outletPricePaise: null, pricePaise: 26000 });
    expect(menuChanged()).toHaveLength(2);
  });

  it("U: an older brand price with paise still reads and prices correctly", async () => {
    const id = item("Garlic Naan");
    await setBrand(id, 7950);
    const row = (await getPricingData(owner)).rows.find((r) => r.id === id)!;
    expect(row).toMatchObject({ pricePaise: 7950, source: "brand_base" });
    const g = await seat("T6", "o4-odd");
    await addCartLine(g, { itemId: id, qty: 2 });
    expect((await getCart(g, EVENING)).mine[0]).toMatchObject({ unitPricePaise: 7950, linePaise: 15900 });
    await setBrand(id, 8000);
  });
});

describe("bulk", () => {
  let otherOutletId: string;
  let otherBrandItem: string;
  beforeAll(async () => {
    // A second outlet of the same brand, and a second brand in the same tenant
    otherOutletId = uuidv7();
    await env.db.insert(s.outlets).values({ id: otherOutletId, tenantId: owner.tenantId, brandId: env.demo.brandId, code: "SRJ02", name: "Saffron Two", city: "Jaipur", address: "MI Road" });
    await env.db.insert(s.outletItemOverrides).values({ tenantId: owner.tenantId, outletId: otherOutletId, itemId: item("Paneer Tikka"), pricePaise: 50000 });
    const brandId = uuidv7();
    await env.db.insert(s.brands).values({ id: brandId, tenantId: owner.tenantId, name: "Other Brand" });
    const categoryId = uuidv7();
    await env.db.insert(s.menuCategories).values({ id: categoryId, tenantId: owner.tenantId, brandId, nameEn: "Other" });
    otherBrandItem = uuidv7();
    await env.db.insert(s.menuItems).values({ id: otherBrandItem, tenantId: owner.tenantId, brandId, categoryId, nameEn: "Other Dish", pricePaise: 10000, isVeg: true, station: "Main" });
  });
  beforeEach(clearAll);

  it("H: percent adjustment from the current effective price, whole rupees, half up", async () => {
    await setOutletPrice(owner, item("Dal Makhani"), 27500); // ₹275 -> +10% = 302.50 -> ₹303
    const out = await bulkOutletPrice(owner, { action: "adjust", itemIds: [item("Paneer Tikka"), item("Dal Makhani")], mode: "percent", amount: 10 });
    expect(out.map((c) => c.after.outletPricePaise)).toEqual(expect.arrayContaining([35200, 30300]));
    expect((await override(item("Dal Makhani"))).pricePaise).toBe(30300);
    expect((await override(item("Paneer Tikka"))).pricePaise).toBe(35200);
    expect(await brandPrice(item("Paneer Tikka"))).toBe(32000);
  });

  it("I: fixed adjustment up and down; never below zero", async () => {
    await bulkOutletPrice(owner, { action: "adjust", itemIds: [item("Garlic Naan")], mode: "fixed", amount: -2000 });
    expect((await override(item("Garlic Naan"))).pricePaise).toBe(6000);
    await bulkOutletPrice(owner, { action: "adjust", itemIds: [item("Garlic Naan")], mode: "fixed", amount: -10000 });
    expect((await override(item("Garlic Naan"))).pricePaise).toBe(0);
    await failsWith(bulkOutletPrice(owner, { action: "adjust", itemIds: [item("Garlic Naan")], mode: "fixed", amount: 1050 }), "invalid_state");
  });

  it("J/K/L/V: outlet and brand scoped, and all-or-nothing", async () => {
    await failsWith(bulkOutletPrice(owner, { action: "adjust", itemIds: [item("Paneer Tikka"), otherBrandItem], mode: "percent", amount: 10 }), "not_found");
    expect((await override(item("Paneer Tikka"))).pricePaise).toBeNull();
    await failsWith(setOutletPrice(owner, otherBrandItem, 20000), "not_found");
    expect(await env.db.select().from(s.outletItemOverrides).where(eq(s.outletItemOverrides.itemId, otherBrandItem))).toHaveLength(0);
    // A stale preview cancels everything
    await failsWith(bulkOutletPrice(owner, { action: "adjust", itemIds: [item("Paneer Tikka"), item("Dal Makhani")], mode: "percent", amount: 10, expected: { [item("Paneer Tikka")]: 32000, [item("Dal Makhani")]: 1 } }), "conflict");
    expect((await override(item("Paneer Tikka"))).pricePaise).toBeNull();
    await bulkOutletPrice(owner, { action: "adjust", itemIds: [item("Paneer Tikka")], mode: "percent", amount: 10 });
    // The other outlet of the same brand is untouched
    expect((await override(item("Paneer Tikka"), otherOutletId)).pricePaise).toBe(50000);
  });

  it("P/S: one bulk audit event with before and after, and one realtime event", async () => {
    await bulkOutletPrice(owner, { action: "adjust", itemIds: [item("Paneer Tikka"), item("Dal Makhani")], mode: "fixed", amount: 1000 });
    const [entry] = (await auditOf("pricing.outlet_price_bulk")).slice(-1);
    expect(entry.actorUserId).toBe(owner.userId);
    const after = entry.after as { action: string; changes: { itemId: string; before: { pricePaise: number }; after: { outletPricePaise: number } }[] };
    expect(after.action).toBe("adjust");
    expect(after.changes.find((c) => c.itemId === item("Paneer Tikka"))).toMatchObject({ before: { pricePaise: 32000 }, after: { outletPricePaise: 33000 } });
    expect(menuChanged()).toHaveLength(1);
  });

  it("bulk reset clears price only, atomically, with audit and realtime", async () => {
    await setOutletPrice(owner, item("Butter Chicken"), 40000);
    await setOutletPrice(owner, item("Dal Makhani"), 30000);
    events = [];
    await bulkOutletPrice(owner, { action: "reset", itemIds: [item("Butter Chicken"), item("Dal Makhani")] });
    expect((await override(item("Butter Chicken"))).pricePaise).toBeNull();
    expect((await override(item("Butter Chicken"))).portionsLeft).toBe(12);
    expect((await override(item("Dal Makhani"))).pricePaise).toBeNull();
    expect((await auditOf("pricing.outlet_price_bulk")).some((a) => (a.after as { action: string }).action === "reset")).toBe(true);
    expect(menuChanged()).toHaveLength(1);
  });

  it("Y/Z: O3 brand bulk stays inside the brand and announces the change", async () => {
    await failsWith(bulkPrice(owner, [item("Paneer Tikka"), otherBrandItem], "percent", 10), "not_found");
    expect(await brandPrice(otherBrandItem)).toBe(10000);
    expect(await brandPrice(item("Paneer Tikka"))).toBe(32000);
    const changes = await bulkPrice(owner, [item("Paneer Tikka")], "percent", 5); // 336
    expect(changes[0].after).toBe(33600);
    expect(menuChanged()).toHaveLength(1);
    await setBrand(item("Paneer Tikka"), 32000);
  });
});

describe("O3 option prices", () => {
  const group = () => env.db.select().from(s.modifiers).where(eq(s.modifiers.id, env.demo.modifierIds.butterNaan));
  async function breadInput(naanDelta: number) {
    const [naan] = await group();
    const mods = await env.db.select().from(s.modifiers).where(eq(s.modifiers.groupId, naan.groupId));
    return {
      id: naan.groupId,
      itemId: item("Butter Chicken"),
      nameEn: "Choose bread",
      minSelect: 1,
      maxSelect: 1,
      options: mods.map((m) => ({ id: m.id, nameEn: m.nameEn, nameHi: m.nameHi, priceDeltaPaise: m.id === naan.id ? naanDelta : m.priceDeltaPaise, isAvailable: m.isAvailable })),
    };
  }

  it("W: a manager cannot change an option price but can edit content", async () => {
    await failsWith(saveModifierGroup(manager, await breadInput(9000)), "forbidden");
    expect((await group())[0].priceDeltaPaise).toBe(6000);
    await saveModifierGroup(manager, { ...(await breadInput(6000)), nameEn: "Pick a bread" });
    expect(menuChanged()).toHaveLength(1); // AA
  });

  it("X/AA: an owner can, in whole rupees, and it is announced", async () => {
    await saveModifierGroup(owner, await breadInput(7000));
    expect((await group())[0].priceDeltaPaise).toBe(7000);
    expect(menuChanged()).toHaveLength(1);
    await failsWith(saveModifierGroup(owner, await breadInput(7050)), "invalid_state");
    await saveModifierGroup(owner, await breadInput(6000));
  });

  it("AB: an option that would make the dish negative is refused, and an order never goes negative", async () => {
    await failsWith(saveModifierGroup(owner, await breadInput(-50000)), "invalid_state");
    // Configured directly (e.g. older data): the order is refused, nothing written
    await clearAll();
    await setOutletPrice(owner, item("Butter Chicken"), 1000);
    const g = await seat("T7", "o4-negative");
    await addConfiguredLine(g, { itemId: item("Butter Chicken"), qty: 1, modifierIds: [env.demo.modifierIds.tandooriRoti] });
    await setDelta(env.demo.modifierIds.tandooriRoti, -2000);
    const cart = await getCart(g, EVENING);
    expect(cart.mine[0].unitPricePaise).toBeNull();
    await failsWith(placeOrder(g, { quote: cart.quote }, EVENING), "items_unavailable");
    expect(await ordersOf(g)).toHaveLength(0);
    await setDelta(env.demo.modifierIds.tandooriRoti, 4000);
    await clearAll();
  });
});

describe("open cart: price changes before Place order", () => {
  beforeEach(clearAll);

  it("1: a price rise stops the order; the refreshed cart shows it; the second try orders at the new price", async () => {
    const g = await seat("T8", "o4-open-1");
    await setOutletPrice(owner, item("Paneer Tikka"), 30000);
    await addCartLine(g, { itemId: item("Paneer Tikka"), qty: 1 });
    const reviewed = await getCart(g, EVENING);
    expect(reviewed.mine[0].unitPricePaise).toBe(30000);
    await setOutletPrice(owner, item("Paneer Tikka"), 35000);
    const orderLinesBefore = (await env.db.select().from(s.orderLines)).length;
    await failsWith(placeOrder(g, { quote: reviewed.quote, requestId: "o4-open-1" }, EVENING), "price_changed");
    expect(await ordersOf(g)).toHaveLength(0);
    expect((await env.db.select().from(s.orderLines)).length).toBe(orderLinesBefore);
    const refreshed = await getCart(g, EVENING);
    expect(refreshed.mine[0].unitPricePaise).toBe(35000);
    const res = await placeOrder(g, { quote: refreshed.quote, requestId: "o4-open-1" }, EVENING);
    expect((await linesOf(res.orderId))[0].unitPricePaise).toBe(35000);
  });

  it("2: an option price change is caught the same way", async () => {
    const g = await seat("T9", "o4-open-2");
    await addConfiguredLine(g, { itemId: item("Butter Chicken"), qty: 1, modifierIds: [env.demo.modifierIds.butterNaan] });
    const reviewed = await getCart(g, EVENING);
    expect(reviewed.mine[0].unitPricePaise).toBe(44000);
    await setDelta(env.demo.modifierIds.butterNaan, 8000);
    await failsWith(placeOrder(g, { quote: reviewed.quote }, EVENING), "price_changed");
    expect(await ordersOf(g)).toHaveLength(0);
    const refreshed = await getCart(g, EVENING);
    expect(refreshed.mine[0].unitPricePaise).toBe(46000);
    const res = await placeOrder(g, { quote: refreshed.quote }, EVENING);
    const [line] = await linesOf(res.orderId);
    expect(line.unitPricePaise).toBe(46000);
    expect(line.modifiers).toEqual([expect.objectContaining({ priceDeltaPaise: 8000 })]);
    await setDelta(env.demo.modifierIds.butterNaan, 6000);
  });

  it("3: a forged lower quote never buys a lower price", async () => {
    const g = await seat("T10", "o4-open-3");
    await addCartLine(g, { itemId: item("Dal Makhani"), qty: 1 });
    const real = await getCart(g, EVENING);
    const forged = Object.fromEntries(Object.keys(real.quote).map((k) => [k, 100]));
    await failsWith(placeOrder(g, { quote: forged }, EVENING), "price_changed");
    await failsWith(placeOrder(g, { quote: {} }, EVENING), "price_changed");
    expect(await ordersOf(g)).toHaveLength(0);
    const res = await placeOrder(g, { quote: real.quote }, EVENING);
    expect((await linesOf(res.orderId))[0].unitPricePaise).toBe(26000);
  });

  it("4: a price drop also needs review", async () => {
    const g = await seat("T11", "o4-open-4");
    await addCartLine(g, { itemId: item("Garlic Naan"), qty: 2 });
    const reviewed = await getCart(g, EVENING);
    await setOutletPrice(owner, item("Garlic Naan"), 5000);
    await failsWith(placeOrder(g, { quote: reviewed.quote }, EVENING), "price_changed");
    const res = await placeOrder(g, { quote: (await getCart(g, EVENING)).quote }, EVENING);
    expect((await linesOf(res.orderId))[0].unitPricePaise).toBe(5000);
  });
});

describe("snapshots, staff orders and billing", () => {
  beforeEach(clearAll);

  it("placed orders and bills never move; the next order uses the new price", async () => {
    const g = await seat("T12", "o4-snap");
    await setOutletPrice(owner, item("Butter Chicken"), 40000);
    await addConfiguredLine(g, { itemId: item("Butter Chicken"), qty: 1, modifierIds: [env.demo.modifierIds.butterNaan] });
    const first = await placeOrder(g, { quote: (await getCart(g, EVENING)).quote }, EVENING);
    const [before] = await linesOf(first.orderId);
    expect(before).toMatchObject({ unitPricePaise: 46000, taxRateBp: 500 });
    const scope = { tenantId: g.tenantId, outletId: g.outletId, sessionId: g.sessionId };
    const billBefore = computeDraft(await loadBillInputs(appDb, scope)).totals;

    await setOutletPrice(owner, item("Butter Chicken"), 45000);
    await setBrand(item("Butter Chicken"), 39000);
    await setDelta(env.demo.modifierIds.butterNaan, 9000);
    await env.db.update(s.menuItems).set({ taxRateBp: 1800 }).where(eq(s.menuItems.id, item("Butter Chicken")));

    const [after] = await linesOf(first.orderId);
    expect(after).toMatchObject({ unitPricePaise: 46000, taxRateBp: 500, modifiers: before.modifiers });
    expect(computeDraft(await loadBillInputs(appDb, scope)).totals).toEqual(billBefore);

    await addConfiguredLine(g, { itemId: item("Butter Chicken"), qty: 1, modifierIds: [env.demo.modifierIds.butterNaan] });
    const second = await placeOrder(g, { quote: (await getCart(g, EVENING)).quote }, EVENING);
    expect((await linesOf(second.orderId))[0]).toMatchObject({ unitPricePaise: 54000, taxRateBp: 1800 });

    await setBrand(item("Butter Chicken"), 38000);
    await setDelta(env.demo.modifierIds.butterNaan, 6000);
    await env.db.update(s.menuItems).set({ taxRateBp: 500 }).where(eq(s.menuItems.id, item("Butter Chicken")));
  });

  it("staff orders use the outlet override and ignore any price from the client", async () => {
    const g = await seat("T2", "o4-staff");
    await setOutletPrice(owner, item("Dal Makhani"), 30000);
    const lines = [{ itemId: item("Dal Makhani"), qty: 2, modifierIds: [], unitPricePaise: 1 } as unknown as { itemId: string; qty: number; modifierIds: string[] }];
    const res = await staffPlaceOrder(waiter, { sessionId: g.sessionId, tableId: g.tableId, participantId: g.participantId, clientRequestId: "o4-staff-1", lines }, EVENING);
    expect((await linesOf(res.orderId))[0].unitPricePaise).toBe(30000);
    await setOutletPrice(owner, item("Dal Makhani"), 20000);
    expect((await linesOf(res.orderId))[0].unitPricePaise).toBe(30000);
    const draft = computeDraft(await loadBillInputs(appDb, { tenantId: g.tenantId, outletId: g.outletId, sessionId: g.sessionId }));
    expect(draft.totals.subtotalPaise).toBe(60000);
  });

  it("G3, G4 and G5 show the same effective price the order uses", async () => {
    await setOutletPrice(owner, item("Paneer Tikka"), 33000);
    const g = await seat("T3", "o4-g3");
    const menu = await getGuestMenu({ tenantId: g.tenantId, brandId: g.brandId, outletId: g.outletId, timezone: g.timezone, soldOutDisplay: "grey" }, EVENING);
    const row = menu.flatMap((c) => c.items).find((i) => i.id === item("Paneer Tikka"))!;
    expect(row.pricePaise).toBe(33000);
    const sheet = await getItemSheet("SRJ01", env.demo.tableQr.T3, "o4-g3", item("Paneer Tikka"), EVENING);
    expect(sheet.item.pricePaise).toBe(33000);
    await addCartLine(g, { itemId: item("Paneer Tikka"), qty: 1 });
    const cart = await getCart(g, EVENING);
    expect(cart.mine[0].unitPricePaise).toBe(33000);
    const res = await placeOrder(g, { quote: cart.quote }, EVENING);
    expect((await linesOf(res.orderId))[0].unitPricePaise).toBe(33000);
  });
});
