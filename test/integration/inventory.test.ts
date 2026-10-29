import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { getInventory, moveStock, saveStockItem, setRecipe, takeStockForBill } from "@/server/staff/inventory";
import { resetTestDb } from "./setup-db";

// Inventory: stock items, recipes, purchases, wastage and counts, and a paid bill taking what its
// dishes used.

let env: Awaited<ReturnType<typeof resetTestDb>>;
const owner = () => ({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, roles: ["owner" as const], userId: env.demo.staffIds.owner });

async function refused(p: Promise<unknown>, code: AppError["code"]) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}

beforeAll(async () => {
  env = await resetTestDb();
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("inventory", () => {
  it("adds stock, keeps the price per unit, and a paid bill takes what its dishes used", async () => {
    const { id: paneer } = await saveStockItem(owner(), { name: "Paneer", unit: "kg", low: "1", cost: "" });
    await refused(saveStockItem(owner(), { name: "Paneer", unit: "kg", low: "", cost: "" }), "invalid_state");
    await moveStock(owner(), { stockItemId: paneer, kind: "purchase", qty: "5", cost: "1500", note: "Sharma Dairy" });
    await setRecipe(owner(), env.demo.itemIds["Butter Chicken"], [{ stockItemId: paneer, qty: "0.2" }]);

    // A paid bill of 3 plates
    const { tenantId, outletId, tableIds } = env.demo;
    const sessionId = uuidv7();
    const billId = uuidv7();
    await env.db.insert(s.tableSessions).values({ id: sessionId, tenantId, outletId, tableId: Object.values(tableIds)[0], status: "closed" } as typeof s.tableSessions.$inferInsert);
    await env.db.insert(s.bills).values({ id: billId, tenantId, outletId, sessionId, status: "paid" });
    await appDb.transaction((tx) => takeStockForBill(tx, tenantId, outletId, billId, [{ itemId: env.demo.itemIds["Butter Chicken"], qty: 3 }, { itemId: uuidv7(), qty: 1 }]));

    let inv = await getInventory(owner());
    let item = inv.items.find((i) => i.id === paneer)!;
    expect(item).toMatchObject({ qtyMilli: 4400, costPaise: 30000, usedIn: 1, low: false });
    expect(inv.stockValuePaise).toBe(132000);
    expect(inv.moves.map((m) => [m.kind, m.qtyMilli])).toEqual(expect.arrayContaining([["purchase", 5000], ["sale", -600]]));

    await moveStock(owner(), { stockItemId: paneer, kind: "wastage", qty: "0.4", note: "Spoiled" });
    await moveStock(owner(), { stockItemId: paneer, kind: "count", qty: "0.9" });
    inv = await getInventory(owner());
    item = inv.items.find((i) => i.id === paneer)!;
    expect(item).toMatchObject({ qtyMilli: 900, low: true });
    const [count] = await env.db.select({ qty: s.stockMoves.qtyMilli }).from(s.stockMoves).where(eq(s.stockMoves.kind, "count"));
    expect(count.qty).toBe(-3100);
  });

  it("checks amounts and dishes, and needs a plan with Inventory and an owner or manager", async () => {
    const inv = await getInventory(owner());
    const paneer = inv.items[0].id;
    await refused(moveStock(owner(), { stockItemId: paneer, kind: "purchase", qty: "abc" }), "invalid_state");
    await refused(setRecipe(owner(), uuidv7(), [{ stockItemId: paneer, qty: "1" }]), "invalid_state");
    await refused(getInventory({ ...owner(), roles: ["waiter"] as never }), "forbidden");
    await env.db.update(s.tenants).set({ planCode: "starter" }).where(eq(s.tenants.id, env.demo.tenantId));
    expect((await getInventory(owner())).items.length).toBeGreaterThan(0);
    await refused(setRecipe(owner(), uuidv7(), []), "forbidden");
    await env.db.update(s.tenants).set({ planCode: "pro" }).where(eq(s.tenants.id, env.demo.tenantId));
  });
});
