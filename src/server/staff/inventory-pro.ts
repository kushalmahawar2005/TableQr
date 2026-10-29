import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { toMilli } from "@/domain/inventory";
import type { Tx } from "../db-types";
import { AppError } from "../errors";
import { requireFeature } from "../plan";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import type { StaffSession } from "./auth";
import { outletDayCutoff } from "./business-day";
import { istDayStart, istToday } from "./day-close";

// Inventory beyond the shelf list (see inventory.ts): suppliers and their bills, stock sent back,
// what is owed and paid, the day-end count with its variance, prep items cooked from other stock,
// dishes going sold out when an ingredient runs out, and the stock report. Owners and managers.

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "roles" | "userId">;
const bad = (message: string) => new AppError("invalid_state", message);
const DAY = 86_400_000;
const METHODS = ["cash", "upi", "bank", "card", "cheque"] as const;
type Method = (typeof METHODS)[number];

async function guard(staff: Staff) {
  if (!staff.roles.some((r) => r === "owner" || r === "manager")) throw new AppError("forbidden", "Ask the owner or a manager to manage stock.");
  await requireFeature(staff.tenantId, "inventory");
}
const scopeOf = (staff: Staff) => ({ tenantId: staff.tenantId, outletId: staff.outletId });
const clean = (v: unknown, max: number) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max) || null;
const rupees = (v: unknown, what: string) => {
  const text = String(v ?? "").trim().replace(/,/g, "");
  if (text === "") return 0;
  const paise = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(paise) || paise < 0 || paise > 1_000_000_000) throw bad(`Enter ${what} as a number of rupees.`);
  return paise;
};
const isDate = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

// ---- suppliers -------------------------------------------------------------------------------

export async function saveSupplier(staff: Staff, input: { id?: string | null; name: string; phone?: string; gstin?: string; note?: string }) {
  await guard(staff);
  await requireFeature(staff.tenantId, "purchasing", staff.outletId);
  const name = clean(input.name, 80);
  if (!name || name.length < 2) throw bad("Enter the supplier's name.");
  const phone = clean(String(input.phone ?? "").replace(/[^\d+]/g, ""), 16);
  const gstin = clean(String(input.gstin ?? "").toUpperCase(), 15);
  if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) throw bad("A GSTIN has 15 letters and numbers. Check it, or leave it empty.");
  const values = { name, phone, gstin, note: clean(input.note, 140) };
  try {
    if (input.id) {
      const res = await db.update(s.suppliers).set(values).where(and(eq(s.suppliers.tenantId, staff.tenantId), eq(s.suppliers.outletId, staff.outletId), eq(s.suppliers.id, String(input.id))));
      if (!res[0].affectedRows) throw bad("This supplier was not found.");
      return { id: String(input.id) };
    }
    const id = uuidv7();
    await db.insert(s.suppliers).values({ id, tenantId: staff.tenantId, outletId: staff.outletId, ...values });
    return { id };
  } catch (err) {
    if (err instanceof Error && /Duplicate entry/.test(err.message + String((err as { cause?: unknown }).cause ?? ""))) throw bad(`${name} is already in your suppliers.`);
    throw err;
  }
}

/** Take a supplier off the list; their bills and payments stay */
export async function removeSupplier(staff: Staff, id: string) {
  await guard(staff);
  await requireFeature(staff.tenantId, "purchasing", staff.outletId);
  await db.update(s.suppliers).set({ isActive: false }).where(and(eq(s.suppliers.tenantId, staff.tenantId), eq(s.suppliers.outletId, staff.outletId), eq(s.suppliers.id, String(id))));
}

// ---- purchase bills and returns ----------------------------------------------------------------

type BillLine = { stockItemId: string; qty: string; byPack?: boolean; amount: string };
export type PurchaseInput = { supplierId?: string | null; billNo?: string; billDate?: string; note?: string; lines: BillLine[]; paid?: string; method?: string };

async function supplierOf(tx: Tx, staff: Staff, id: string | null | undefined) {
  if (!id) return null;
  const [row] = await tx.select({ id: s.suppliers.id }).from(s.suppliers).where(and(eq(s.suppliers.tenantId, staff.tenantId), eq(s.suppliers.outletId, staff.outletId), eq(s.suppliers.id, String(id))));
  if (!row) throw bad("This supplier was not found.");
  return row.id;
}

/**
 * A supplier's bill: every line goes into stock at once, each item's price becomes what this bill
 * paid for one unit, and what was paid on the spot is recorded against the bill.
 */
export async function recordPurchase(staff: Staff, input: PurchaseInput, kind: "purchase" | "return" = "purchase", now = new Date()) {
  await guard(staff);
  await requireFeature(staff.tenantId, "purchasing", staff.outletId);
  const lines = (input.lines ?? []).filter((l) => l && l.stockItemId && String(l.qty ?? "").trim() !== "");
  if (!lines.length) throw bad(kind === "purchase" ? "Add at least one item to the bill." : "Add at least one item being sent back.");
  if (lines.length > 100) throw bad("A bill can have at most 100 lines.");
  if (new Set(lines.map((l) => l.stockItemId)).size !== lines.length) throw bad("Each item can be on the bill once. Add the quantities together.");
  const cutoff = await outletDayCutoff(staff.tenantId, staff.outletId);
  const billDate = isDate(input.billDate) ? input.billDate : istToday(now, cutoff);
  if (Date.parse(`${billDate}T00:00:00Z`) > Date.parse(`${istToday(now, cutoff)}T00:00:00Z`)) throw bad("The bill date cannot be in the future.");
  const paid = kind === "purchase" ? rupees(input.paid, "what was paid") : 0;
  const method = (METHODS as readonly string[]).includes(String(input.method)) ? (input.method as Method) : "cash";

  const result = await db.transaction(async (tx) => {
    const supplierId = await supplierOf(tx, staff, input.supplierId);
    if (kind === "return" && !supplierId) throw bad("Choose the supplier the stock goes back to.");
    const items = await tx.select().from(s.stockItems)
      .where(and(eq(s.stockItems.tenantId, staff.tenantId), eq(s.stockItems.outletId, staff.outletId), eq(s.stockItems.isActive, true), inArray(s.stockItems.id, lines.map((l) => String(l.stockItemId)))))
      .for("update");
    const byId = new Map(items.map((i) => [i.id, i]));
    const priced = lines.map((l) => {
      const item = byId.get(String(l.stockItemId));
      if (!item) throw bad("One of the items is not in your stock list.");
      const entered = toMilli(l.qty);
      if (entered === null || entered <= 0) throw bad(`Enter how much ${item.name}, as a number above zero.`);
      if (l.byPack && !item.packMilli) throw bad(`${item.name} has no pack size set.`);
      const qtyMilli = l.byPack && item.packMilli ? Math.round((entered * item.packMilli) / 1000) : entered;
      const amountPaise = rupees(l.amount, `the amount for ${item.name}`);
      if (kind === "return" && qtyMilli > Math.max(0, item.qtyMilli)) throw bad(`Only ${item.qtyMilli / 1000} ${item.unit} of ${item.name} is in stock to send back.`);
      return { item, qtyMilli, amountPaise };
    });
    const total = priced.reduce((n, p) => n + p.amountPaise, 0);
    if (paid > total) throw bad("What was paid is more than the bill.");
    const purchaseId = uuidv7();
    await tx.insert(s.purchases).values({ id: purchaseId, tenantId: staff.tenantId, outletId: staff.outletId, supplierId, kind, billNo: clean(input.billNo, 40), billDate, totalPaise: total, note: clean(input.note, 140), byUserId: staff.userId, createdAt: now });
    for (const p of priced) {
      const delta = kind === "purchase" ? p.qtyMilli : -p.qtyMilli;
      await tx.update(s.stockItems).set({
        qtyMilli: sql`${s.stockItems.qtyMilli} + ${delta}`,
        // The price of one unit on this bill becomes the item's price
        ...(kind === "purchase" && p.amountPaise > 0 ? { costPaise: Math.round((p.amountPaise * 1000) / p.qtyMilli) } : {}),
      }).where(and(eq(s.stockItems.tenantId, staff.tenantId), eq(s.stockItems.id, p.item.id)));
      await tx.insert(s.stockMoves).values({ tenantId: staff.tenantId, outletId: staff.outletId, stockItemId: p.item.id, kind, qtyMilli: delta, costPaise: p.amountPaise || null, note: clean(input.billNo ? `Bill ${input.billNo}` : input.note, 140), purchaseId, byUserId: staff.userId, createdAt: now });
    }
    // Bought for cash from a shop not on the list: nothing is owed, so there is no payment to record
    if (paid > 0 && supplierId) {
      await tx.insert(s.supplierPayments).values({ tenantId: staff.tenantId, outletId: staff.outletId, supplierId, purchaseId, amountPaise: paid, method, paidOn: billDate, note: null, byUserId: staff.userId, createdAt: now });
    }
    const changed = await syncStockSoldOut(tx, scopeOf(staff), priced.map((p) => p.item.id));
    return { id: purchaseId, totalPaise: total, changed };
  });
  await announceAvailability(scopeOf(staff), result.changed);
  return { id: result.id, totalPaise: result.totalPaise };
}

/** Money paid to a supplier, against a bill or towards what is owed */
export async function paySupplier(staff: Staff, input: { supplierId: string; amount: string; method?: string; note?: string; purchaseId?: string | null; paidOn?: string }, now = new Date()) {
  await guard(staff);
  await requireFeature(staff.tenantId, "purchasing", staff.outletId);
  const amountPaise = rupees(input.amount, "the amount");
  if (amountPaise <= 0) throw bad("Enter the amount paid.");
  const method = (METHODS as readonly string[]).includes(String(input.method)) ? (input.method as Method) : "cash";
  const cutoff = await outletDayCutoff(staff.tenantId, staff.outletId);
  const paidOn = isDate(input.paidOn) ? input.paidOn : istToday(now, cutoff);
  await db.transaction(async (tx) => {
    const supplierId = await supplierOf(tx, staff, input.supplierId);
    if (!supplierId) throw bad("Choose the supplier.");
    let purchaseId: string | null = null;
    if (input.purchaseId) {
      const [p] = await tx.select({ id: s.purchases.id }).from(s.purchases).where(and(eq(s.purchases.tenantId, staff.tenantId), eq(s.purchases.outletId, staff.outletId), eq(s.purchases.supplierId, supplierId), eq(s.purchases.id, String(input.purchaseId))));
      if (!p) throw bad("This bill was not found for that supplier.");
      purchaseId = p.id;
    }
    await tx.insert(s.supplierPayments).values({ tenantId: staff.tenantId, outletId: staff.outletId, supplierId, purchaseId, amountPaise, method, paidOn, note: clean(input.note, 140), byUserId: staff.userId, createdAt: now });
  });
}

// ---- the day-end count -----------------------------------------------------------------------

/**
 * Shelf count of many items at once. Each counted item is set to what is on the shelf; the
 * difference from what the system expected is the variance (theft, wastage nobody wrote down,
 * recipes that are off). Items left empty are not counted.
 */
export async function recordCount(staff: Staff, input: { counts: { stockItemId: string; qty: string }[]; note?: string }, now = new Date()) {
  await guard(staff);
  await requireFeature(staff.tenantId, "purchasing", staff.outletId);
  const counts = (input.counts ?? []).filter((c) => c && c.stockItemId && String(c.qty ?? "").trim() !== "");
  if (!counts.length) throw bad("Enter the count for at least one item.");
  const note = clean(input.note, 140) ?? "Stock count";
  const result = await db.transaction(async (tx) => {
    const items = await tx.select().from(s.stockItems)
      .where(and(eq(s.stockItems.tenantId, staff.tenantId), eq(s.stockItems.outletId, staff.outletId), eq(s.stockItems.isActive, true), inArray(s.stockItems.id, counts.map((c) => String(c.stockItemId)))))
      .for("update");
    const byId = new Map(items.map((i) => [i.id, i]));
    const variance: { stockItemId: string; name: string; unit: string; expectedMilli: number; countedMilli: number; diffMilli: number; valuePaise: number }[] = [];
    for (const c of counts) {
      const item = byId.get(String(c.stockItemId));
      if (!item) throw bad("One of the items is not in your stock list.");
      const counted = toMilli(c.qty);
      if (counted === null || counted < 0) throw bad(`Enter the count for ${item.name} as a number.`);
      const diff = counted - item.qtyMilli;
      variance.push({ stockItemId: item.id, name: item.name, unit: item.unit, expectedMilli: item.qtyMilli, countedMilli: counted, diffMilli: diff, valuePaise: item.costPaise ? Math.round((item.costPaise * diff) / 1000) : 0 });
      if (diff === 0) continue;
      await tx.update(s.stockItems).set({ qtyMilli: counted }).where(and(eq(s.stockItems.tenantId, staff.tenantId), eq(s.stockItems.id, item.id)));
      await tx.insert(s.stockMoves).values({ tenantId: staff.tenantId, outletId: staff.outletId, stockItemId: item.id, kind: "count", qtyMilli: diff, note, byUserId: staff.userId, createdAt: now });
    }
    const changed = await syncStockSoldOut(tx, scopeOf(staff), variance.map((v) => v.stockItemId));
    return { variance, changed };
  });
  await announceAvailability(scopeOf(staff), result.changed);
  return { variance: result.variance };
}

// ---- prep items ------------------------------------------------------------------------------

/** What one unit of a prep item takes; replaces its whole recipe */
export async function setPrepRecipe(staff: Staff, prepItemId: string, lines: { stockItemId: string; qty: string }[]) {
  await guard(staff);
  await requireFeature(staff.tenantId, "recipeCosting", staff.outletId);
  const parts = new Map<string, number>();
  for (const l of lines ?? []) {
    if (!l?.stockItemId || String(l.qty ?? "").trim() === "") continue;
    if (l.stockItemId === prepItemId) throw bad("A prep item cannot use itself.");
    const q = toMilli(l.qty);
    if (q === null || q <= 0) throw bad("Each ingredient needs an amount above zero.");
    parts.set(l.stockItemId, q);
  }
  const ids = [...parts.keys()];
  await db.transaction(async (tx) => {
    const [prep] = await tx.select({ id: s.stockItems.id, isPrep: s.stockItems.isPrep }).from(s.stockItems).where(and(eq(s.stockItems.tenantId, staff.tenantId), eq(s.stockItems.outletId, staff.outletId), eq(s.stockItems.id, String(prepItemId)), eq(s.stockItems.isActive, true)));
    if (!prep?.isPrep) throw bad("This is not a prep item.");
    if (ids.length) {
      const found = await tx.select({ id: s.stockItems.id, isPrep: s.stockItems.isPrep }).from(s.stockItems).where(and(eq(s.stockItems.tenantId, staff.tenantId), eq(s.stockItems.outletId, staff.outletId), eq(s.stockItems.isActive, true), inArray(s.stockItems.id, ids)));
      if (found.length !== ids.length) throw bad("One of the ingredients is not in your stock list.");
      if (found.some((f) => f.isPrep)) throw bad("A prep item is made from raw stock, not from another prep item.");
    }
    await tx.delete(s.prepLines).where(and(eq(s.prepLines.tenantId, staff.tenantId), eq(s.prepLines.outletId, staff.outletId), eq(s.prepLines.prepItemId, prep.id)));
    if (ids.length) await tx.insert(s.prepLines).values(ids.map((stockItemId) => ({ id: uuidv7(), tenantId: staff.tenantId, outletId: staff.outletId, prepItemId: prep.id, stockItemId, qtyMilli: parts.get(stockItemId)! })));
  });
}

/** A batch of a prep item was cooked: it goes into stock and its ingredients come out */
export async function makePrep(staff: Staff, input: { prepItemId: string; qty: string }, now = new Date()) {
  await guard(staff);
  await requireFeature(staff.tenantId, "recipeCosting", staff.outletId);
  const qty = toMilli(input.qty);
  if (qty === null || qty <= 0) throw bad("Enter how much was made, as a number above zero.");
  const result = await db.transaction(async (tx) => {
    const [prep] = await tx.select().from(s.stockItems).where(and(eq(s.stockItems.tenantId, staff.tenantId), eq(s.stockItems.outletId, staff.outletId), eq(s.stockItems.id, String(input.prepItemId)), eq(s.stockItems.isActive, true))).for("update");
    if (!prep?.isPrep) throw bad("This is not a prep item.");
    const parts = await tx.select().from(s.prepLines).where(and(eq(s.prepLines.tenantId, staff.tenantId), eq(s.prepLines.outletId, staff.outletId), eq(s.prepLines.prepItemId, prep.id)));
    if (!parts.length) throw bad(`Set what ${prep.name} is made from first.`);
    const ingredients = await tx.select().from(s.stockItems).where(and(eq(s.stockItems.tenantId, staff.tenantId), inArray(s.stockItems.id, parts.map((p) => p.stockItemId)))).for("update");
    let costPaise = 0;
    const note = `Made ${qty / 1000} ${prep.unit} ${prep.name}`.slice(0, 140);
    for (const p of parts) {
      const used = Math.round((p.qtyMilli * qty) / 1000);
      const ing = ingredients.find((i) => i.id === p.stockItemId);
      if (ing?.costPaise) costPaise += Math.round((ing.costPaise * used) / 1000);
      await tx.update(s.stockItems).set({ qtyMilli: sql`${s.stockItems.qtyMilli} - ${used}` }).where(and(eq(s.stockItems.tenantId, staff.tenantId), eq(s.stockItems.id, p.stockItemId)));
      await tx.insert(s.stockMoves).values({ tenantId: staff.tenantId, outletId: staff.outletId, stockItemId: p.stockItemId, kind: "prep", qtyMilli: -used, note, byUserId: staff.userId, createdAt: now });
    }
    // The batch is worth what went into it: that becomes the prep item's price per unit
    await tx.update(s.stockItems).set({ qtyMilli: sql`${s.stockItems.qtyMilli} + ${qty}`, ...(costPaise > 0 ? { costPaise: Math.round((costPaise * 1000) / qty) } : {}) })
      .where(and(eq(s.stockItems.tenantId, staff.tenantId), eq(s.stockItems.id, prep.id)));
    await tx.insert(s.stockMoves).values({ tenantId: staff.tenantId, outletId: staff.outletId, stockItemId: prep.id, kind: "prep", qtyMilli: qty, costPaise: costPaise || null, note, byUserId: staff.userId, createdAt: now });
    const changed = await syncStockSoldOut(tx, scopeOf(staff), [prep.id, ...parts.map((p) => p.stockItemId)]);
    return { changed };
  });
  await announceAvailability(scopeOf(staff), result.changed);
}

// ---- dishes sold out by stock ----------------------------------------------------------------

/** Switch dishes going sold out by themselves when an ingredient runs out on or off */
export async function setStockSoldOut(staff: Staff, on: boolean) {
  await guard(staff);
  await requireFeature(staff.tenantId, "recipeCosting", staff.outletId);
  await db.update(s.outlets).set({ stockSoldOut: !!on }).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId)));
  const changed = await db.transaction(async (tx) => {
    if (on) {
      const all = await tx.select({ id: s.stockItems.id }).from(s.stockItems).where(and(eq(s.stockItems.tenantId, staff.tenantId), eq(s.stockItems.outletId, staff.outletId)));
      return syncStockSoldOut(tx, scopeOf(staff), all.map((a) => a.id));
    }
    // Off: every dish inventory switched off comes back on
    const held = await tx.select({ itemId: s.outletItemOverrides.itemId }).from(s.outletItemOverrides)
      .where(and(eq(s.outletItemOverrides.tenantId, staff.tenantId), eq(s.outletItemOverrides.outletId, staff.outletId), eq(s.outletItemOverrides.soldOutByStock, true)));
    if (held.length) await tx.update(s.outletItemOverrides).set({ isAvailable: true, soldOutUntil: null, soldOutByStock: false })
      .where(and(eq(s.outletItemOverrides.tenantId, staff.tenantId), eq(s.outletItemOverrides.outletId, staff.outletId), eq(s.outletItemOverrides.soldOutByStock, true)));
    return held.map((h) => ({ itemId: h.itemId, available: true }));
  });
  await announceAvailability(scopeOf(staff), changed);
}

/**
 * After stock changed: when the outlet has it switched on, a dish whose recipe has an ingredient at
 * or below zero goes sold out, and a dish inventory switched off comes back once all its
 * ingredients are in stock again. A dish someone switched off by hand is never switched on here.
 * Runs inside the caller's transaction; returns the dishes that changed, to announce after commit.
 */
export async function syncStockSoldOut(tx: Tx, scope: { tenantId: string; outletId: string }, stockItemIds: string[]) {
  if (!stockItemIds.length) return [];
  const [outlet] = await tx.select({ on: s.outlets.stockSoldOut }).from(s.outlets).where(and(eq(s.outlets.tenantId, scope.tenantId), eq(s.outlets.id, scope.outletId)));
  if (!outlet?.on) return [];
  const touched = await tx.selectDistinct({ itemId: s.recipeLines.itemId }).from(s.recipeLines)
    .where(and(eq(s.recipeLines.tenantId, scope.tenantId), eq(s.recipeLines.outletId, scope.outletId), inArray(s.recipeLines.stockItemId, [...new Set(stockItemIds)])));
  if (!touched.length) return [];
  const dishIds = touched.map((t) => t.itemId);
  const [recipes, overrides] = await Promise.all([
    tx.select({ itemId: s.recipeLines.itemId, qtyMilli: s.stockItems.qtyMilli }).from(s.recipeLines)
      .innerJoin(s.stockItems, and(eq(s.stockItems.tenantId, s.recipeLines.tenantId), eq(s.stockItems.id, s.recipeLines.stockItemId)))
      .where(and(eq(s.recipeLines.tenantId, scope.tenantId), eq(s.recipeLines.outletId, scope.outletId), inArray(s.recipeLines.itemId, dishIds))),
    tx.select().from(s.outletItemOverrides).where(and(eq(s.outletItemOverrides.tenantId, scope.tenantId), eq(s.outletItemOverrides.outletId, scope.outletId), inArray(s.outletItemOverrides.itemId, dishIds))),
  ]);
  const changed: { itemId: string; available: boolean }[] = [];
  for (const itemId of dishIds) {
    const out = recipes.some((r) => r.itemId === itemId && r.qtyMilli <= 0);
    const o = overrides.find((x) => x.itemId === itemId);
    if (out && (!o || (o.isAvailable && !o.soldOutByStock))) {
      await tx.insert(s.outletItemOverrides).values({ tenantId: scope.tenantId, outletId: scope.outletId, itemId, isAvailable: false, soldOutUntil: null, soldOutByStock: true })
        .onDuplicateKeyUpdate({ set: { isAvailable: false, soldOutUntil: null, soldOutByStock: true } });
      changed.push({ itemId, available: false });
    } else if (!out && o?.soldOutByStock) {
      await tx.update(s.outletItemOverrides).set({ isAvailable: true, soldOutUntil: null, soldOutByStock: false })
        .where(and(eq(s.outletItemOverrides.tenantId, scope.tenantId), eq(s.outletItemOverrides.id, o.id)));
      changed.push({ itemId, available: true });
    }
  }
  return changed;
}

/** Tell every open menu which dishes changed; call after the transaction committed */
export async function announceAvailability(scope: { tenantId: string; outletId: string }, changed: { itemId: string; available: boolean }[]) {
  if (!changed.length) return;
  await publish(scope, changed.map((c) => ({ topic: topics.menu, type: "item.availability", data: c })));
}

// ---- reading it back -------------------------------------------------------------------------

/** Suppliers with what each is owed, and the recent bills and payments */
export async function getPurchasing(staff: Staff) {
  await guard(staff);
  const scope = and(eq(s.purchases.tenantId, staff.tenantId), eq(s.purchases.outletId, staff.outletId));
  const [suppliers, owed, paid, bills, payments] = await Promise.all([
    db.select().from(s.suppliers).where(and(eq(s.suppliers.tenantId, staff.tenantId), eq(s.suppliers.outletId, staff.outletId))).orderBy(asc(s.suppliers.name)),
    db.select({ supplierId: s.purchases.supplierId, kind: s.purchases.kind, paise: sql<string>`sum(${s.purchases.totalPaise})` }).from(s.purchases).where(scope).groupBy(s.purchases.supplierId, s.purchases.kind),
    db.select({ supplierId: s.supplierPayments.supplierId, paise: sql<string>`sum(${s.supplierPayments.amountPaise})` }).from(s.supplierPayments)
      .where(and(eq(s.supplierPayments.tenantId, staff.tenantId), eq(s.supplierPayments.outletId, staff.outletId))).groupBy(s.supplierPayments.supplierId),
    db.select({ p: s.purchases, supplier: s.suppliers.name, by: s.users.name }).from(s.purchases)
      .leftJoin(s.suppliers, and(eq(s.suppliers.tenantId, s.purchases.tenantId), eq(s.suppliers.id, s.purchases.supplierId)))
      .leftJoin(s.users, and(eq(s.users.tenantId, s.purchases.tenantId), eq(s.users.id, s.purchases.byUserId)))
      .where(scope).orderBy(desc(s.purchases.billDate), desc(s.purchases.createdAt)).limit(100),
    db.select({ p: s.supplierPayments, supplier: s.suppliers.name }).from(s.supplierPayments)
      .innerJoin(s.suppliers, and(eq(s.suppliers.tenantId, s.supplierPayments.tenantId), eq(s.suppliers.id, s.supplierPayments.supplierId)))
      .where(and(eq(s.supplierPayments.tenantId, staff.tenantId), eq(s.supplierPayments.outletId, staff.outletId))).orderBy(desc(s.supplierPayments.createdAt)).limit(100),
  ]);
  const billIds = bills.map((b) => b.p.id);
  const [lines, paidOnBill] = billIds.length
    ? await Promise.all([
        db.select({ purchaseId: s.stockMoves.purchaseId, stockItemId: s.stockMoves.stockItemId, name: s.stockItems.name, unit: s.stockItems.unit, qtyMilli: s.stockMoves.qtyMilli, costPaise: s.stockMoves.costPaise }).from(s.stockMoves)
          .innerJoin(s.stockItems, and(eq(s.stockItems.tenantId, s.stockMoves.tenantId), eq(s.stockItems.id, s.stockMoves.stockItemId)))
          .where(and(eq(s.stockMoves.tenantId, staff.tenantId), inArray(s.stockMoves.purchaseId, billIds))),
        db.select({ purchaseId: s.supplierPayments.purchaseId, paise: sql<string>`sum(${s.supplierPayments.amountPaise})` }).from(s.supplierPayments)
          .where(and(eq(s.supplierPayments.tenantId, staff.tenantId), inArray(s.supplierPayments.purchaseId, billIds))).groupBy(s.supplierPayments.purchaseId),
      ])
    : [[], []];
  const sumOf = (supplierId: string, kind: "purchase" | "return") => Number(owed.find((o) => o.supplierId === supplierId && o.kind === kind)?.paise ?? 0);
  return {
    suppliers: suppliers.filter((x) => x.isActive).map((x) => {
      const billed = sumOf(x.id, "purchase");
      const returned = sumOf(x.id, "return");
      const paidTotal = Number(paid.find((p) => p.supplierId === x.id)?.paise ?? 0);
      return { id: x.id, name: x.name, phone: x.phone, gstin: x.gstin, note: x.note, billedPaise: billed, returnedPaise: returned, paidPaise: paidTotal, duePaise: billed - returned - paidTotal };
    }),
    bills: bills.map(({ p, supplier, by }) => ({
      id: p.id, kind: p.kind, supplierId: p.supplierId, supplier: supplier ?? null, billNo: p.billNo, billDate: p.billDate, totalPaise: p.totalPaise, note: p.note, by: by ?? null, createdAt: p.createdAt.getTime(),
      paidPaise: Number(paidOnBill.find((x) => x.purchaseId === p.id)?.paise ?? 0),
      lines: lines.filter((l) => l.purchaseId === p.id).map((l) => ({ stockItemId: l.stockItemId, name: l.name, unit: l.unit, qtyMilli: Math.abs(l.qtyMilli), amountPaise: l.costPaise ?? 0 })),
    })),
    payments: payments.map(({ p, supplier }) => ({ id: p.id, supplierId: p.supplierId, supplier, purchaseId: p.purchaseId, amountPaise: p.amountPaise, method: p.method, note: p.note, paidOn: p.paidOn, createdAt: p.createdAt.getTime() })),
  };
}
export type Purchasing = Awaited<ReturnType<typeof getPurchasing>>;

/**
 * The stock report for a range of business days: for every item, what it opened with, what came
 * in and went out by kind, the variance found by counts, and what it closed with; with the cost of
 * what the dishes used against the food sales, which is the food cost.
 */
export async function getStockReport(staff: Staff, input: { from?: string; to?: string }, now = new Date()) {
  await guard(staff);
  await requireFeature(staff.tenantId, "recipeCosting", staff.outletId);
  const cutoff = await outletDayCutoff(staff.tenantId, staff.outletId);
  const today = istToday(now, cutoff);
  let from = isDate(input.from) ? input.from : today;
  let to = isDate(input.to) ? input.to : today;
  if (from > to) [from, to] = [to, from];
  const start = istDayStart(from, cutoff);
  const end = new Date(istDayStart(to, cutoff).getTime() + DAY);
  if (end.getTime() - start.getTime() > 92 * DAY) throw bad("Choose at most three months at a time.");
  const moveScope = and(eq(s.stockMoves.tenantId, staff.tenantId), eq(s.stockMoves.outletId, staff.outletId));
  const [items, inRange, after, [sales]] = await Promise.all([
    db.select().from(s.stockItems).where(and(eq(s.stockItems.tenantId, staff.tenantId), eq(s.stockItems.outletId, staff.outletId))).orderBy(asc(s.stockItems.name)),
    db.select({ stockItemId: s.stockMoves.stockItemId, kind: s.stockMoves.kind, qty: sql<string>`sum(${s.stockMoves.qtyMilli})`, plus: sql<string>`sum(greatest(${s.stockMoves.qtyMilli}, 0))`, minus: sql<string>`sum(least(${s.stockMoves.qtyMilli}, 0))`, cost: sql<string>`sum(coalesce(${s.stockMoves.costPaise}, 0))` })
      .from(s.stockMoves).where(and(moveScope, gte(s.stockMoves.createdAt, start), lt(s.stockMoves.createdAt, end))).groupBy(s.stockMoves.stockItemId, s.stockMoves.kind),
    db.select({ stockItemId: s.stockMoves.stockItemId, qty: sql<string>`sum(${s.stockMoves.qtyMilli})` })
      .from(s.stockMoves).where(and(moveScope, gte(s.stockMoves.createdAt, end))).groupBy(s.stockMoves.stockItemId),
    db.select({ paise: sql<string>`coalesce(sum(${s.bills.subtotalPaise} - ${s.bills.discountPaise}), 0)` }).from(s.bills)
      .where(and(eq(s.bills.tenantId, staff.tenantId), eq(s.bills.outletId, staff.outletId), eq(s.bills.status, "paid"), gte(s.bills.closedAt, start), lt(s.bills.closedAt, end))),
  ]);
  const n = (v: string | null | undefined) => Number(v ?? 0);
  const rows = items
    .map((i) => {
      const mine = inRange.filter((m) => m.stockItemId === i.id);
      const k = (kind: string) => mine.filter((m) => m.kind === kind);
      const sum = (kind: string) => k(kind).reduce((t, m) => t + n(m.qty), 0);
      const closing = i.qtyMilli - n(after.find((a) => a.stockItemId === i.id)?.qty);
      const change = mine.reduce((t, m) => t + n(m.qty), 0);
      const used = -sum("sale");
      const price = i.costPaise ?? 0;
      return {
        id: i.id, name: i.name, unit: i.unit, category: i.category, isPrep: i.isPrep, active: i.isActive,
        openingMilli: closing - change,
        purchasedMilli: sum("purchase"),
        purchasedPaise: k("purchase").reduce((t, m) => t + n(m.cost), 0),
        returnedMilli: -sum("return"),
        madeMilli: k("prep").reduce((t, m) => t + n(m.plus), 0),
        prepUsedMilli: -k("prep").reduce((t, m) => t + n(m.minus), 0),
        usedMilli: used,
        wastedMilli: -sum("wastage"),
        varianceMilli: sum("count"),
        closingMilli: closing,
        usedPaise: Math.round((price * used) / 1000),
        wastedPaise: Math.round((price * -sum("wastage")) / 1000),
        variancePaise: Math.round((price * sum("count")) / 1000),
        closingPaise: closing > 0 ? Math.round((price * closing) / 1000) : 0,
      };
    })
    .filter((r) => r.active || r.openingMilli !== 0 || r.closingMilli !== 0 || r.usedMilli !== 0 || r.purchasedMilli !== 0);
  const total = (k: "usedPaise" | "wastedPaise" | "variancePaise" | "purchasedPaise" | "closingPaise") => rows.reduce((t, r) => t + r[k], 0);
  const salesPaise = n(sales?.paise);
  const usedPaise = total("usedPaise");
  return {
    from, to, today, rows,
    totals: { purchasedPaise: total("purchasedPaise"), usedPaise, wastedPaise: total("wastedPaise"), variancePaise: total("variancePaise"), closingPaise: total("closingPaise"), salesPaise, foodCostPct: salesPaise ? Math.round((usedPaise / salesPaise) * 1000) / 10 : null },
  };
}
export type StockReport = Awaited<ReturnType<typeof getStockReport>>;
