import { boolean, index, int, mysqlEnum, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { createdAt, id, ref, sameTenant, tenantId, tenantKey, updatedAt } from "./_columns";
import { bills } from "./billing";
import { menuItems } from "./menu";
import { outlets, users } from "./tenancy";

// Inventory: what an outlet keeps in stock, what each dish uses, and every change to the stock.
// Quantities are whole thousandths of the unit (1 kg = 1000, 250 ml = 250 of "l" x 1000 = 250),
// so nothing is lost to rounding.

export const stockUnits = ["kg", "g", "l", "ml", "pcs"] as const;

export const stockItems = mysqlTable(
  "stock_items",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    unit: mysqlEnum("unit", stockUnits).notNull(),
    /** On hand, in thousandths of the unit; can go below zero when sales outrun the count */
    qtyMilli: int("qty_milli").notNull().default(0),
    /** Alert when on hand falls to this or below; null means no alert */
    lowMilli: int("low_milli"),
    /** Last price paid per one unit, for the stock value */
    costPaise: int("cost_paise"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("stock_items_outlet_name_uq").on(t.outletId, t.name),
    tenantKey("stock_items", t),
    sameTenant("fk_stock_items_outlet", t, t.outletId, outlets),
  ],
);

/** What one plate of a dish uses at an outlet */
export const recipeLines = mysqlTable(
  "recipe_lines",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    itemId: ref("item_id").notNull(),
    stockItemId: ref("stock_item_id").notNull(),
    /** Per plate, in thousandths of the stock item's unit */
    qtyMilli: int("qty_milli").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("recipe_lines_item_stock_uq").on(t.outletId, t.itemId, t.stockItemId),
    sameTenant("fk_recipe_lines_outlet", t, t.outletId, outlets),
    sameTenant("fk_recipe_lines_item", t, t.itemId, menuItems),
    sameTenant("fk_recipe_lines_stock", t, t.stockItemId, stockItems),
  ],
);

/** Every change to stock: bought, used by a paid bill, wasted, or set by a count */
export const stockMoves = mysqlTable(
  "stock_moves",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    stockItemId: ref("stock_item_id").notNull(),
    kind: mysqlEnum("kind", ["purchase", "sale", "wastage", "count"]).notNull(),
    /** Change in thousandths of the unit: positive in, negative out */
    qtyMilli: int("qty_milli").notNull(),
    /** What a purchase cost in total */
    costPaise: int("cost_paise"),
    note: varchar("note", { length: 140 }),
    billId: ref("bill_id"),
    byUserId: ref("by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("stock_moves_item_created_idx").on(t.stockItemId, t.createdAt),
    index("stock_moves_outlet_created_idx").on(t.outletId, t.createdAt),
    sameTenant("fk_stock_moves_outlet", t, t.outletId, outlets),
    sameTenant("fk_stock_moves_item", t, t.stockItemId, stockItems),
    sameTenant("fk_stock_moves_bill", t, t.billId, bills),
    sameTenant("fk_stock_moves_by", t, t.byUserId, users),
  ],
);
