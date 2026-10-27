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
    /** A shelf group for lists and counts: Dairy, Vegetables, Spices */
    category: varchar("category", { length: 40 }),
    /** How it is bought, when not by the unit: 1 crate (packName) = 30 pcs (packMilli 30000) */
    packName: varchar("pack_name", { length: 20 }),
    packMilli: int("pack_milli"),
    /** Made in the kitchen from other stock (gravy, dough): has its own recipe in prep_lines */
    isPrep: boolean("is_prep").notNull().default(false),
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
    // return: sent back to the supplier; prep: used up or made when a prep item is cooked
    kind: mysqlEnum("kind", ["purchase", "sale", "wastage", "count", "return", "prep"]).notNull(),
    /** Change in thousandths of the unit: positive in, negative out */
    qtyMilli: int("qty_milli").notNull(),
    /** What a purchase cost in total */
    costPaise: int("cost_paise"),
    note: varchar("note", { length: 140 }),
    billId: ref("bill_id"),
    /** The purchase bill or return this line belongs to */
    purchaseId: ref("purchase_id"),
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

/** Who the outlet buys stock from */
export const suppliers = mysqlTable(
  "suppliers",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    phone: varchar("phone", { length: 16 }),
    gstin: varchar("gstin", { length: 15 }),
    note: varchar("note", { length: 140 }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("suppliers_outlet_name_uq").on(t.outletId, t.name),
    tenantKey("suppliers", t),
    sameTenant("fk_suppliers_outlet", t, t.outletId, outlets),
  ],
);

/** A supplier's bill for stock bought (kind purchase), or stock sent back to them (kind return) */
export const purchases = mysqlTable(
  "purchases",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    supplierId: ref("supplier_id"),
    kind: mysqlEnum("kind", ["purchase", "return"]).notNull().default("purchase"),
    /** The number printed on the supplier's bill */
    billNo: varchar("bill_no", { length: 40 }),
    /** The date on the bill, YYYY-MM-DD in the outlet's time zone */
    billDate: varchar("bill_date", { length: 10 }).notNull(),
    /** What the bill comes to; a return's is what the supplier owes back */
    totalPaise: int("total_paise").notNull(),
    note: varchar("note", { length: 140 }),
    byUserId: ref("by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("purchases_outlet_date_idx").on(t.outletId, t.billDate),
    index("purchases_supplier_idx").on(t.supplierId),
    tenantKey("purchases", t),
    sameTenant("fk_purchases_outlet", t, t.outletId, outlets),
    sameTenant("fk_purchases_supplier", t, t.supplierId, suppliers),
    sameTenant("fk_purchases_by", t, t.byUserId, users),
  ],
);

/** Money paid to a supplier, against a bill or towards what is owed */
export const supplierPayments = mysqlTable(
  "supplier_payments",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    supplierId: ref("supplier_id").notNull(),
    purchaseId: ref("purchase_id"),
    amountPaise: int("amount_paise").notNull(),
    method: mysqlEnum("method", ["cash", "upi", "bank", "card", "cheque"]).notNull(),
    note: varchar("note", { length: 140 }),
    paidOn: varchar("paid_on", { length: 10 }).notNull(),
    byUserId: ref("by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("supplier_payments_supplier_idx").on(t.supplierId, t.createdAt),
    sameTenant("fk_supplier_payments_outlet", t, t.outletId, outlets),
    sameTenant("fk_supplier_payments_supplier", t, t.supplierId, suppliers),
    sameTenant("fk_supplier_payments_purchase", t, t.purchaseId, purchases),
    sameTenant("fk_supplier_payments_by", t, t.byUserId, users),
  ],
);

/** What one unit of a prep item (1 kg of gravy) takes from other stock */
export const prepLines = mysqlTable(
  "prep_lines",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    prepItemId: ref("prep_item_id").notNull(),
    stockItemId: ref("stock_item_id").notNull(),
    /** Per one unit of the prep item, in thousandths of the ingredient's unit */
    qtyMilli: int("qty_milli").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("prep_lines_item_stock_uq").on(t.outletId, t.prepItemId, t.stockItemId),
    sameTenant("fk_prep_lines_outlet", t, t.outletId, outlets),
    sameTenant("fk_prep_lines_prep", t, t.prepItemId, stockItems),
    sameTenant("fk_prep_lines_stock", t, t.stockItemId, stockItems),
  ],
);
