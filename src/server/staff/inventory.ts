import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { isLow, toMilli, usage, type StockUnit } from "@/domain/inventory";
import type { Tx } from "../db-types";
import { AppError } from "../errors";
import { requireFeature } from "../plan";
import type { StaffSession } from "./auth";

// Inventory at one outlet: stock items, the recipe of each dish, and every change to stock.
// A paid bill takes what its dishes used (see takeStockForBill); people add purchases, wastage and
// counts. Owners and managers only, on plans with Inventory.

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "roles" | "userId">;
const bad = (message: string) => new AppError("invalid_state", message);

async function guard(staff: Staff) {
  if (!staff.roles.some((r) => r === "owner" || r === "manager")) throw new AppError("forbidden", "Ask the owner or a manager to manage stock.");
  await requireFeature(staff.tenantId, "inventory");
}

export async function getInventory(staff: Staff) {
  await guard(staff);
  const [[outlet], items, recipes, moves] = await Promise.all([
    db.select({ brandId: s.outlets.brandId }).from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId))),
    db.select().from(s.stockItems).where(and(eq(s.stockItems.tenantId, staff.tenantId), eq(s.stockItems.outletId, staff.outletId))).orderBy(asc(s.stockItems.name)),
    db.select({ itemId: s.recipeLines.itemId, stockItemId: s.recipeLines.stockItemId, qtyMilli: s.recipeLines.qtyMilli }).from(s.recipeLines).where(and(eq(s.recipeLines.tenantId, staff.tenantId), eq(s.recipeLines.outletId, staff.outletId))),
    db
      .select({ id: s.stockMoves.id, stockItemId: s.stockMoves.stockItemId, kind: s.stockMoves.kind, qtyMilli: s.stockMoves.qtyMilli, costPaise: s.stockMoves.costPaise, note: s.stockMoves.note, createdAt: s.stockMoves.createdAt, by: s.users.name })
      .from(s.stockMoves)
      .leftJoin(s.users, and(eq(s.users.tenantId, s.stockMoves.tenantId), eq(s.users.id, s.stockMoves.byUserId)))
      .where(and(eq(s.stockMoves.tenantId, staff.tenantId), eq(s.stockMoves.outletId, staff.outletId)))
      .orderBy(desc(s.stockMoves.createdAt))
      .limit(150),
  ]);
  const dishes = outlet
    ? await db
        .select({ id: s.menuItems.id, name: s.menuItems.nameEn, category: s.menuCategories.nameEn })
        .from(s.menuItems)
        .innerJoin(s.menuCategories, and(eq(s.menuCategories.tenantId, s.menuItems.tenantId), eq(s.menuCategories.id, s.menuItems.categoryId)))
        .where(and(eq(s.menuItems.tenantId, staff.tenantId), eq(s.menuItems.brandId, outlet.brandId), eq(s.menuItems.isActive, true)))
        .orderBy(asc(s.menuCategories.nameEn), asc(s.menuItems.nameEn))
    : [];
  const active = items.filter((i) => i.isActive);
  return {
    items: active.map((i) => ({
      id: i.id, name: i.name, unit: i.unit as StockUnit, qtyMilli: i.qtyMilli, lowMilli: i.lowMilli, costPaise: i.costPaise, low: isLow(i),
      usedIn: recipes.filter((r) => r.stockItemId === i.id).length,
    })),
    stockValuePaise: active.reduce((n, i) => n + (i.costPaise && i.qtyMilli > 0 ? Math.round((i.costPaise * i.qtyMilli) / 1000) : 0), 0),
    dishes: dishes.map((d) => ({ ...d, recipe: recipes.filter((r) => r.itemId === d.id).map((r) => ({ stockItemId: r.stockItemId, qtyMilli: r.qtyMilli })) })),
    moves: moves.map((m) => ({ ...m, createdAt: m.createdAt.getTime(), by: m.by ?? null })),
  };
}
export type Inventory = Awaited<ReturnType<typeof getInventory>>;

/** Add a stock item, or change its name, unit, alert level or price */
export async function saveStockItem(staff: Staff, input: { id?: string | null; name: string; unit: string; low: string; cost: string }) {
  await guard(staff);
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (name.length < 2) throw bad("Enter the item's name, like Paneer or Milk.");
  if (!(["kg", "g", "l", "ml", "pcs"] as string[]).includes(input.unit)) throw bad("Choose a unit.");
  const lowText = String(input.low ?? "").trim();
  const lowMilli = lowText === "" ? null : toMilli(lowText);
  if (lowText !== "" && (lowMilli === null || lowMilli < 0)) throw bad("Enter the alert level as a number, or leave it empty.");
  const costText = String(input.cost ?? "").trim();
  const costPaise = costText === "" ? null : Math.round(Number(costText) * 100);
  if (costPaise !== null && (!Number.isFinite(costPaise) || costPaise < 0 || costPaise > 100_000_000)) throw bad("Enter the price as a number, or leave it empty.");
  const unit = input.unit as StockUnit;
  try {
    if (input.id) {
      const [row] = await db.select({ id: s.stockItems.id }).from(s.stockItems).where(and(eq(s.stockItems.tenantId, staff.tenantId), eq(s.stockItems.outletId, staff.outletId), eq(s.stockItems.id, input.id)));
      if (!row) throw bad("This stock item was not found.");
      await db.update(s.stockItems).set({ name, unit, lowMilli, costPaise }).where(and(eq(s.stockItems.tenantId, staff.tenantId), eq(s.stockItems.outletId, staff.outletId), eq(s.stockItems.id, input.id)));
      return { id: input.id };
    }
    const id = uuidv7();
    await db.insert(s.stockItems).values({ id, tenantId: staff.tenantId, outletId: staff.outletId, name, unit, lowMilli, costPaise });
    return { id };
  } catch (err) {
    if (err instanceof Error && /Duplicate entry/.test(err.message + String((err as { cause?: unknown }).cause ?? ""))) throw bad(`${name} is already in your stock list.`);
    throw err;
  }
}

/** Take an item off the stock list; its history stays */
export async function removeStockItem(staff: Staff, id: string) {
  await guard(staff);
  await db.transaction(async (tx) => {
    await tx.delete(s.recipeLines).where(and(eq(s.recipeLines.tenantId, staff.tenantId), eq(s.recipeLines.outletId, staff.outletId), eq(s.recipeLines.stockItemId, id)));
    await tx.update(s.stockItems).set({ isActive: false }).where(and(eq(s.stockItems.tenantId, staff.tenantId), eq(s.stockItems.outletId, staff.outletId), eq(s.stockItems.id, id)));
  });
}

/** Stock bought, thrown away, or counted on the shelf */
export async function moveStock(staff: Staff, input: { stockItemId: string; kind: "purchase" | "wastage" | "count"; qty: string; cost?: string; note?: string }) {
  await guard(staff);
  if (!["purchase", "wastage", "count"].includes(input.kind)) throw bad("Choose what happened.");
  const qty = toMilli(input.qty);
  if (qty === null || qty < 0 || (input.kind !== "count" && qty === 0)) throw bad("Enter how much, as a number.");
  const costText = String(input.cost ?? "").trim();
  const costPaise = input.kind === "purchase" && costText !== "" ? Math.round(Number(costText) * 100) : null;
  if (costPaise !== null && (!Number.isFinite(costPaise) || costPaise < 0)) throw bad("Enter what it cost, as a number.");
  const note = String(input.note ?? "").trim().slice(0, 140) || null;
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(s.stockItems).where(and(eq(s.stockItems.tenantId, staff.tenantId), eq(s.stockItems.outletId, staff.outletId), eq(s.stockItems.id, input.stockItemId), eq(s.stockItems.isActive, true))).for("update");
    if (!item) throw bad("This stock item was not found.");
    const delta = input.kind === "purchase" ? qty : input.kind === "wastage" ? -qty : qty - item.qtyMilli;
    const next = item.qtyMilli + delta;
    await tx.update(s.stockItems).set({
      qtyMilli: next,
      // The price of one unit from this purchase becomes the item's price
      ...(costPaise !== null && qty > 0 ? { costPaise: Math.round((costPaise * 1000) / qty) } : {}),
    }).where(and(eq(s.stockItems.tenantId, staff.tenantId), eq(s.stockItems.outletId, staff.outletId), eq(s.stockItems.id, item.id)));
    await tx.insert(s.stockMoves).values({ tenantId: staff.tenantId, outletId: staff.outletId, stockItemId: item.id, kind: input.kind, qtyMilli: delta, costPaise, note, byUserId: staff.userId });
    return { qtyMilli: next };
  });
}

/** What one plate of a dish uses; replaces the dish's whole recipe */
export async function setRecipe(staff: Staff, itemId: string, lines: { stockItemId: string; qty: string }[]) {
  await guard(staff);
  const clean = new Map<string, number>();
  for (const l of lines ?? []) {
    if (!l?.stockItemId || String(l.qty ?? "").trim() === "") continue;
    const q = toMilli(l.qty);
    if (q === null || q <= 0) throw bad("Each ingredient needs an amount above zero.");
    clean.set(l.stockItemId, q);
  }
  const [[outlet], [dish]] = await Promise.all([
    db.select({ brandId: s.outlets.brandId }).from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId))),
    db.select({ id: s.menuItems.id, brandId: s.menuItems.brandId }).from(s.menuItems).where(and(eq(s.menuItems.tenantId, staff.tenantId), eq(s.menuItems.id, itemId))),
  ]);
  if (!dish || !outlet || dish.brandId !== outlet.brandId) throw bad("This dish was not found.");
  const ids = [...clean.keys()];
  if (ids.length) {
    const found = await db.select({ id: s.stockItems.id }).from(s.stockItems).where(and(eq(s.stockItems.tenantId, staff.tenantId), eq(s.stockItems.outletId, staff.outletId), eq(s.stockItems.isActive, true), inArray(s.stockItems.id, ids)));
    if (found.length !== ids.length) throw bad("One of the ingredients is not in your stock list.");
  }
  await db.transaction(async (tx) => {
    await tx.delete(s.recipeLines).where(and(eq(s.recipeLines.tenantId, staff.tenantId), eq(s.recipeLines.outletId, staff.outletId), eq(s.recipeLines.itemId, itemId)));
    if (ids.length) await tx.insert(s.recipeLines).values(ids.map((stockItemId) => ({ id: uuidv7(), tenantId: staff.tenantId, outletId: staff.outletId, itemId, stockItemId, qtyMilli: clean.get(stockItemId)! })));
  });
}

/**
 * A bill was paid: take from stock what its dishes used, by their recipes. Runs inside the bill's
 * own transaction, so stock moves only if the bill really closes. Dishes without a recipe use nothing.
 */
export async function takeStockForBill(tx: Tx, tenantId: string, outletId: string, billId: string, sold: { itemId: string; qty: number }[]) {
  if (!sold.length) return;
  const recipes = await tx
    .select({ itemId: s.recipeLines.itemId, stockItemId: s.recipeLines.stockItemId, qtyMilli: s.recipeLines.qtyMilli })
    .from(s.recipeLines)
    .where(and(eq(s.recipeLines.tenantId, tenantId), eq(s.recipeLines.outletId, outletId), inArray(s.recipeLines.itemId, [...new Set(sold.map((x) => x.itemId))])));
  const used = usage(sold, recipes);
  for (const [stockItemId, milli] of used) {
    await tx.update(s.stockItems).set({ qtyMilli: sql`${s.stockItems.qtyMilli} - ${milli}` }).where(and(eq(s.stockItems.tenantId, tenantId), eq(s.stockItems.id, stockItemId)));
    await tx.insert(s.stockMoves).values({ tenantId, outletId, stockItemId, kind: "sale", qtyMilli: -milli, billId });
  }
}

/** Items at or below their alert level, for the dashboard */
export async function lowStock(scope: { tenantId: string; outletId: string }) {
  const rows = await db
    .select({ name: s.stockItems.name, qtyMilli: s.stockItems.qtyMilli, lowMilli: s.stockItems.lowMilli, unit: s.stockItems.unit })
    .from(s.stockItems)
    .where(and(eq(s.stockItems.tenantId, scope.tenantId), eq(s.stockItems.outletId, scope.outletId), eq(s.stockItems.isActive, true), isNotNull(s.stockItems.lowMilli)));
  return rows.filter(isLow).map((r) => ({ name: r.name, qtyMilli: r.qtyMilli, unit: r.unit as StockUnit }));
}
