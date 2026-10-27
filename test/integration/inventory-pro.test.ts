import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { loadItems } from "@/server/guest/menu";
import { addFromLibrary, getInventory, moveStock, removeStockItem, saveStockItem, setRecipe, takeStockForBill } from "@/server/staff/inventory";
import { getPurchasing, getStockReport, makePrep, paySupplier, recordCount, recordPurchase, saveSupplier, setPrepRecipe, setStockSoldOut } from "@/server/staff/inventory-pro";
import { resetTestDb } from "./setup-db";

// Inventory the way a counter POS does it: suppliers and their bills (by the unit or the pack),
// returns, what is owed and paid, the day-end count and its variance, prep items, dishes going
// sold out when stock runs out, and the stock report with food cost.

let env: Awaited<ReturnType<typeof resetTestDb>>;
const owner = () => ({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, roles: ["owner" as const], userId: env.demo.staffIds.owner });
const item = async (id: string) => (await getInventory(owner())).items.find((i) => i.id === id)!;

async function refused(p: Promise<unknown>, code: AppError["code"]) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}

async function paidBill(sold: { itemId: string; qty: number }[]) {
  const { tenantId, outletId, tableIds } = env.demo;
  const sessionId = uuidv7();
  const billId = uuidv7();
  await env.db.insert(s.tableSessions).values({ id: sessionId, tenantId, outletId, tableId: Object.values(tableIds)[0], status: "closed" } as typeof s.tableSessions.$inferInsert);
  await env.db.insert(s.bills).values({ id: billId, tenantId, outletId, sessionId, status: "paid" });
  return appDb.transaction((tx) => takeStockForBill(tx, tenantId, outletId, billId, sold));
}

beforeAll(async () => {
  env = await resetTestDb();
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("inventory: suppliers, bills and payments", () => {
  let dairy: string;
  let milk: string;
  let eggs: string;

  it("records a supplier bill with many lines, by the unit and by the pack, and what is owed", async () => {
    dairy = (await saveSupplier(owner(), { name: "Sharma Dairy", phone: "98765 43210" })).id;
    await refused(saveSupplier(owner(), { name: "Sharma Dairy" }), "invalid_state");
    milk = (await saveStockItem(owner(), { name: "Milk", unit: "l", low: "5", cost: "", category: "Dairy" })).id;
    eggs = (await saveStockItem(owner(), { name: "Eggs", unit: "pcs", low: "", cost: "", category: "Dairy", packName: "crate", packSize: "30" })).id;

    const bill = await recordPurchase(owner(), { supplierId: dairy, billNo: "SD-101", lines: [{ stockItemId: milk, qty: "20", amount: "1200" }, { stockItemId: eggs, qty: "2", byPack: true, amount: "360" }], paid: "500", method: "upi" });
    expect(bill.totalPaise).toBe(156000);
    expect(await item(milk)).toMatchObject({ qtyMilli: 20000, costPaise: 6000 });
    expect(await item(eggs)).toMatchObject({ qtyMilli: 60000, costPaise: 600 });

    let p = await getPurchasing(owner());
    expect(p.suppliers.find((x) => x.id === dairy)).toMatchObject({ billedPaise: 156000, paidPaise: 50000, duePaise: 106000 });
    expect(p.bills[0]).toMatchObject({ billNo: "SD-101", paidPaise: 50000, totalPaise: 156000 });
    expect(p.bills[0].lines).toHaveLength(2);

    // Sent back 5 litres of sour milk, then paid the rest
    await recordPurchase(owner(), { supplierId: dairy, note: "Sour", lines: [{ stockItemId: milk, qty: "5", amount: "300" }] }, "return");
    expect((await item(milk)).qtyMilli).toBe(15000);
    await paySupplier(owner(), { supplierId: dairy, amount: "760", method: "cash" });
    p = await getPurchasing(owner());
    expect(p.suppliers.find((x) => x.id === dairy)).toMatchObject({ returnedPaise: 30000, duePaise: 0 });
  });

  it("refuses bad bills", async () => {
    await refused(recordPurchase(owner(), { supplierId: dairy, lines: [] }), "invalid_state");
    await refused(recordPurchase(owner(), { supplierId: dairy, lines: [{ stockItemId: milk, qty: "-1", amount: "10" }] }), "invalid_state");
    await refused(recordPurchase(owner(), { supplierId: dairy, lines: [{ stockItemId: milk, qty: "1", amount: "10" }], paid: "50" }), "invalid_state");
    await refused(recordPurchase(owner(), { supplierId: dairy, lines: [{ stockItemId: milk, qty: "999", amount: "1" }] }, "return"), "invalid_state");
    await refused(recordPurchase(owner(), { supplierId: null, lines: [{ stockItemId: milk, qty: "1", amount: "1" }] }, "return"), "invalid_state");
    await refused(recordPurchase(owner(), { supplierId: dairy, billDate: "2999-01-01", lines: [{ stockItemId: milk, qty: "1", amount: "1" }] }), "invalid_state");
    // A cash purchase from a shop not on the list is fine
    await recordPurchase(owner(), { supplierId: null, lines: [{ stockItemId: milk, qty: "1", amount: "60" }] });
    expect((await item(milk)).qtyMilli).toBe(16000);
  });

  it("counts many items at once and reports the variance", async () => {
    const { variance } = await recordCount(owner(), { counts: [{ stockItemId: milk, qty: "14.5" }, { stockItemId: eggs, qty: "60" }] });
    expect(variance.find((v) => v.stockItemId === milk)).toMatchObject({ expectedMilli: 16000, countedMilli: 14500, diffMilli: -1500, valuePaise: -9000 });
    expect(variance.find((v) => v.stockItemId === eggs)?.diffMilli).toBe(0);
    expect((await item(milk)).qtyMilli).toBe(14500);
  });
});

describe("inventory: prep items, sold out by stock, and the report", () => {
  it("makes a prep item from raw stock, at the cost of what went in", async () => {
    const tomato = (await saveStockItem(owner(), { name: "Tomato", unit: "kg", low: "", cost: "" })).id;
    const butter = (await saveStockItem(owner(), { name: "Butter", unit: "kg", low: "", cost: "" })).id;
    await recordPurchase(owner(), { lines: [{ stockItemId: tomato, qty: "10", amount: "400" }, { stockItemId: butter, qty: "2", amount: "1000" }] });
    const gravy = (await saveStockItem(owner(), { name: "Makhani gravy", unit: "kg", low: "", cost: "", isPrep: true })).id;
    await refused(makePrep(owner(), { prepItemId: gravy, qty: "1" }), "invalid_state");
    await refused(setPrepRecipe(owner(), gravy, [{ stockItemId: gravy, qty: "1" }]), "invalid_state");
    await setPrepRecipe(owner(), gravy, [{ stockItemId: tomato, qty: "0.8" }, { stockItemId: butter, qty: "0.1" }]);
    await makePrep(owner(), { prepItemId: gravy, qty: "5" });
    expect(await item(tomato)).toMatchObject({ qtyMilli: 6000 });
    expect(await item(butter)).toMatchObject({ qtyMilli: 1500 });
    // 4 kg tomato at ₹40 + 0.5 kg butter at ₹500 = ₹410 for 5 kg: ₹82 a kg
    expect(await item(gravy)).toMatchObject({ qtyMilli: 5000, costPaise: 8200 });
  });

  it("switches a dish off when an ingredient runs out and back on when it is restocked, never a dish switched off by hand", async () => {
    const dish = env.demo.itemIds["Butter Chicken"];
    const other = env.demo.itemIds["Dal Makhani"];
    const chicken = (await saveStockItem(owner(), { name: "Chicken", unit: "kg", low: "", cost: "" })).id;
    await moveStock(owner(), { stockItemId: chicken, kind: "purchase", qty: "0.5", cost: "" });
    await setRecipe(owner(), dish, [{ stockItemId: chicken, qty: "0.25" }]);
    await setRecipe(owner(), other, [{ stockItemId: chicken, qty: "0.1" }]);
    // The owner switched Dal Makhani off by hand
    await env.db.insert(s.outletItemOverrides).values({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, itemId: other, isAvailable: false });
    await setStockSoldOut(owner(), true);

    const available = async (id: string) => (await loadItems(appDb, { tenantId: env.demo.tenantId, outletId: env.demo.outletId, brandId: env.demo.brandId }, new Date(), [id]))[0].pricing.isAvailable;
    expect(await available(dish)).toBe(true);
    const changed = await paidBill([{ itemId: dish, qty: 2 }]);
    expect(changed).toEqual([{ itemId: dish, available: false }]);
    expect(await available(dish)).toBe(false);
    expect((await getInventory(owner())).dishes.find((d) => d.id === dish)?.heldByStock).toBe(true);

    await recordPurchase(owner(), { lines: [{ stockItemId: chicken, qty: "3", amount: "600" }] });
    expect(await available(dish)).toBe(true);
    expect(await available(other)).toBe(false);
    const [o] = await env.db.select().from(s.outletItemOverrides).where(and(eq(s.outletItemOverrides.outletId, env.demo.outletId), eq(s.outletItemOverrides.itemId, other)));
    expect(o.soldOutByStock).toBe(false);

    // Off again: a dish held by stock comes back on
    await moveStock(owner(), { stockItemId: chicken, kind: "count", qty: "0" });
    expect(await available(dish)).toBe(false);
    await setStockSoldOut(owner(), false);
    expect(await available(dish)).toBe(true);
  });

  it("reports opening, in, out and closing per item, with food cost", async () => {
    const r = await getStockReport(owner(), {});
    const milk = r.rows.find((x) => x.name === "Milk")!;
    expect(milk).toMatchObject({ openingMilli: 0, purchasedMilli: 21000, returnedMilli: 5000, varianceMilli: -1500, closingMilli: 14500 });
    const tomato = r.rows.find((x) => x.name === "Tomato")!;
    expect(tomato).toMatchObject({ purchasedMilli: 10000, prepUsedMilli: 4000, closingMilli: 6000 });
    const gravy = r.rows.find((x) => x.name === "Makhani gravy")!;
    expect(gravy.madeMilli).toBe(5000);
    const chicken = r.rows.find((x) => x.name === "Chicken")!;
    expect(chicken.usedMilli).toBe(500);
    expect(r.totals.usedPaise).toBeGreaterThan(0);
    await refused(getStockReport(owner(), { from: "2020-01-01", to: "2026-01-01" }), "invalid_state");
  });

  it("is for owners and managers only", async () => {
    await refused(getPurchasing({ ...owner(), roles: ["cashier"] as never }), "forbidden");
    await refused(recordCount({ ...owner(), roles: ["waiter"] as never }, { counts: [] }), "forbidden");
  });
});

describe("inventory: the stock library", () => {
  it("adds ticked items with their unit, group and pack, skips ones already listed and brings back removed ones", async () => {
    const atta = (await saveStockItem(owner(), { name: "Atta", unit: "kg", low: "", cost: "" })).id;
    await removeStockItem(owner(), atta);
    const r = await addFromLibrary(owner(), ["Atta", "Milk", "Coca-Cola 250 ml", "Not a real item"]);
    expect(r).toEqual({ added: 2, skipped: 1 });
    const inv = await getInventory(owner());
    expect(inv.items.find((i) => i.name === "Atta")?.id).toBe(atta);
    expect(inv.items.find((i) => i.name === "Coca-Cola 250 ml")).toMatchObject({ unit: "pcs", category: "Drinks (bottled)", packName: "crate", packMilli: 24000 });
    await refused(addFromLibrary(owner(), ["Not a real item"]), "invalid_state");
  });
});
