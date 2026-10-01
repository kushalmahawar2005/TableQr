import {
  boolean,
  index,
  int,
  json,
  mysqlTable,
  time,
  tinyint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { at, createdAt, id, ref, sameTenant, tenantId, tenantKey, updatedAt } from "./_columns";
import { brands, outlets } from "./tenancy";

// Central menu per brand, with per-outlet overrides (PS 3.5, 7.3).

export const menuCategories = mysqlTable(
  "menu_categories",
  {
    id: id(),
    tenantId: tenantId(),
    brandId: ref("brand_id").notNull(),
    nameEn: varchar("name_en", { length: 80 }).notNull(),
    nameHi: varchar("name_hi", { length: 80 }),
    /** Time window in outlet local time; null means all day */
    availableFrom: time("available_from"),
    availableTo: time("available_to"),
    imageUrl: varchar("image_url", { length: 500 }),
    sortOrder: int("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [tenantKey("menu_categories", t), sameTenant("fk_menu_categories_brand", t, t.brandId, brands)],
);

export const menuItems = mysqlTable(
  "menu_items",
  {
    id: id(),
    tenantId: tenantId(),
    brandId: ref("brand_id").notNull(),
    categoryId: ref("category_id").notNull(),
    nameEn: varchar("name_en", { length: 100 }).notNull(),
    nameHi: varchar("name_hi", { length: 100 }),
    descriptionEn: varchar("description_en", { length: 300 }),
    descriptionHi: varchar("description_hi", { length: 300 }),
    pricePaise: int("price_paise").notNull(),
    /** GST rate in basis points: 500 = 5% */
    taxRateBp: int("tax_rate_bp").notNull().default(500),
    isVeg: boolean("is_veg").notNull(),
    isJain: boolean("is_jain").notNull().default(false),
    /** 0 not spicy, 1 mild, 2 medium, 3 hot; null = not stated */
    spiceLevel: tinyint("spice_level"),
    /** Allergen codes from src/domain/allergens.ts; null = not stated, [] = declared none */
    allergens: json("allergens").$type<string[]>(),
    /** Comma-separated search aliases such as "panir, paner" */
    searchTerms: varchar("search_terms", { length: 300 }),
    prepMinutes: int("prep_minutes").notNull().default(15),
    station: varchar("station", { length: 30 }).notNull(),
    tags: json("tags").$type<("chefs_pick" | "new" | "bestseller")[]>(),
    imageUrl: varchar("image_url", { length: 500 }),
    sortOrder: int("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("menu_items_brand_idx").on(t.tenantId, t.brandId),
    tenantKey("menu_items", t),
    sameTenant("fk_menu_items_brand", t, t.brandId, brands),
    sameTenant("fk_menu_items_category", t, t.categoryId, menuCategories),
  ],
);

/** Per-outlet price, availability and portion counter on top of the central menu */
export const outletItemOverrides = mysqlTable(
  "outlet_item_overrides",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    itemId: ref("item_id").notNull(),
    pricePaise: int("price_paise"),
    isAvailable: boolean("is_available").notNull().default(true),
    /** Sold out until this time; null with isAvailable=false means until switched on */
    soldOutUntil: at("sold_out_until"),
    /** "Only 12 left": switches the item off at zero */
    portionsLeft: int("portions_left"),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("outlet_item_overrides_uq").on(t.outletId, t.itemId),
    sameTenant("fk_overrides_outlet", t, t.outletId, outlets),
    sameTenant("fk_overrides_item", t, t.itemId, menuItems),
  ],
);

export const modifierGroups = mysqlTable(
  "modifier_groups",
  {
    id: id(),
    tenantId: tenantId(),
    itemId: ref("item_id").notNull(),
    nameEn: varchar("name_en", { length: 80 }).notNull(),
    nameHi: varchar("name_hi", { length: 80 }),
    /** minSelect > 0 makes the group required */
    minSelect: int("min_select").notNull().default(0),
    maxSelect: int("max_select").notNull().default(1),
    sortOrder: int("sort_order").notNull().default(0),
  },
  (t) => [tenantKey("modifier_groups", t), sameTenant("fk_modifier_groups_item", t, t.itemId, menuItems)],
);

export const modifiers = mysqlTable(
  "modifiers",
  {
    id: id(),
    tenantId: tenantId(),
    groupId: ref("group_id").notNull(),
    nameEn: varchar("name_en", { length: 80 }).notNull(),
    nameHi: varchar("name_hi", { length: 80 }),
    priceDeltaPaise: int("price_delta_paise").notNull().default(0),
    isAvailable: boolean("is_available").notNull().default(true),
    sortOrder: int("sort_order").notNull().default(0),
  },
  (t) => [sameTenant("fk_modifiers_group", t, t.groupId, modifierGroups)],
);
