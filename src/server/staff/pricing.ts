import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { adjustPrice, isValidNewPrice, validAdjustment, type AdjustMode } from "@/domain/price-adjust";
import { resolveItemPrice, type PriceSource } from "@/domain/pricing";
import { canPrice, type PricingPermission } from "@/lib/staff-permissions";
import { LOCK_THEN_READ, type Runner } from "../db-types";
import { AppError } from "../errors";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import { audit } from "./audit";
import type { StaffSession } from "./auth";
import { requireFeature } from "../plan";

// O4 Pricing: per-outlet absolute price overrides on top of the brand menu. O3 owns the brand price
// (menu_items.price_paise); O4 owns outlet_item_overrides.price_paise only. Availability, sold-out
// and portion fields on the same row belong to O3 and are never touched here.

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "userId" | "name" | "roles" | "outlet">;

export const MAX_BULK_ITEMS = 500;

function assertPricing(staff: Staff, permission: PricingPermission) {
  if (!canPrice(staff.roles, permission)) {
    throw new AppError("forbidden", permission === "pricing.edit" ? "Only an owner can change outlet prices." : "Your role can't open pricing.", { permission });
  }
}

async function brandOf(run: Runner, staff: Staff) {
  const [outlet] = await run.select({ brandId: s.outlets.brandId }).from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId)));
  if (!outlet) throw new AppError("not_found", "Outlet not found.");
  return outlet.brandId;
}

export type PricingRow = {
  id: string;
  nameEn: string;
  nameHi: string | null;
  categoryId: string;
  categoryName: string;
  brandPricePaise: number;
  /** This outlet's override; null means the brand price applies */
  outletPricePaise: number | null;
  /** What guests at this outlet pay before options */
  pricePaise: number;
  source: PriceSource;
};

/** Everything /console/pricing shows: active items of this outlet's brand with brand, outlet and effective prices */
export async function getPricingData(staff: Staff) {
  assertPricing(staff, "pricing.view");
  await requireFeature(staff.tenantId, "pricingRules");
  const brandId = await brandOf(db, staff);
  const [categories, items] = await Promise.all([
    db
      .select({ id: s.menuCategories.id, nameEn: s.menuCategories.nameEn, sortOrder: s.menuCategories.sortOrder })
      .from(s.menuCategories)
      .where(and(eq(s.menuCategories.tenantId, staff.tenantId), eq(s.menuCategories.brandId, brandId), eq(s.menuCategories.isActive, true)))
      .orderBy(asc(s.menuCategories.sortOrder), asc(s.menuCategories.nameEn)),
    db
      .select({ id: s.menuItems.id, nameEn: s.menuItems.nameEn, nameHi: s.menuItems.nameHi, categoryId: s.menuItems.categoryId, pricePaise: s.menuItems.pricePaise })
      .from(s.menuItems)
      .where(and(eq(s.menuItems.tenantId, staff.tenantId), eq(s.menuItems.brandId, brandId), eq(s.menuItems.isActive, true)))
      .orderBy(asc(s.menuItems.sortOrder), asc(s.menuItems.nameEn)),
  ]);
  const overrides = items.length
    ? await db
        .select({ itemId: s.outletItemOverrides.itemId, pricePaise: s.outletItemOverrides.pricePaise })
        .from(s.outletItemOverrides)
        .where(and(eq(s.outletItemOverrides.tenantId, staff.tenantId), eq(s.outletItemOverrides.outletId, staff.outletId), inArray(s.outletItemOverrides.itemId, items.map((i) => i.id))))
    : [];
  const overrideOf = new Map(overrides.map((o) => [o.itemId, o.pricePaise]));
  const categoryName = new Map(categories.map((c) => [c.id, c.nameEn]));
  const order = new Map(categories.map((c, i) => [c.id, i]));
  const rows: PricingRow[] = items
    .map((item) => {
      const outletPricePaise = overrideOf.get(item.id) ?? null;
      const price = resolveItemPrice({ brandPricePaise: item.pricePaise, outletOverridePricePaise: outletPricePaise });
      return {
        id: item.id,
        nameEn: item.nameEn,
        nameHi: item.nameHi,
        categoryId: item.categoryId,
        categoryName: categoryName.get(item.categoryId) ?? "Uncategorised",
        brandPricePaise: item.pricePaise,
        outletPricePaise,
        pricePaise: price.pricePaise,
        source: price.source,
      };
    })
    // Category order first, then the menu's own order within it
    .sort((a, b) => (order.get(a.categoryId) ?? 1e9) - (order.get(b.categoryId) ?? 1e9));
  return {
    outlet: staff.outlet.name,
    categories: categories.map((c) => ({ id: c.id, nameEn: c.nameEn })),
    rows,
    canEdit: canPrice(staff.roles, "pricing.edit"),
  };
}

export type PricingData = Awaited<ReturnType<typeof getPricingData>>;

/** Active items of this outlet's brand, with their outlet rows locked; any id outside the brand fails the whole call */
async function lockItems(tx: Runner, staff: Staff, itemIds: string[]) {
  const brandId = await brandOf(tx, staff);
  const items = await tx
    .select({ id: s.menuItems.id, nameEn: s.menuItems.nameEn, pricePaise: s.menuItems.pricePaise })
    .from(s.menuItems)
    .where(and(eq(s.menuItems.tenantId, staff.tenantId), eq(s.menuItems.brandId, brandId), eq(s.menuItems.isActive, true), inArray(s.menuItems.id, itemIds)));
  if (items.length !== itemIds.length) throw new AppError("not_found", "Some items are not on this outlet's menu. Refresh and try again.", { reason: "item" });
  const overrides = await tx
    .select({ itemId: s.outletItemOverrides.itemId, pricePaise: s.outletItemOverrides.pricePaise })
    .from(s.outletItemOverrides)
    .where(and(eq(s.outletItemOverrides.tenantId, staff.tenantId), eq(s.outletItemOverrides.outletId, staff.outletId), inArray(s.outletItemOverrides.itemId, itemIds)))
    .for("update");
  const overrideOf = new Map(overrides.map((o) => [o.itemId, o.pricePaise]));
  return items.map((item) => {
    const outletPricePaise = overrideOf.get(item.id) ?? null;
    return { ...item, outletPricePaise, effective: resolveItemPrice({ brandPricePaise: item.pricePaise, outletOverridePricePaise: outletPricePaise }) };
  });
}

/** Sets only price_paise; a new row gets the column defaults, an existing row keeps its availability */
async function writeOutletPrice(tx: Runner, staff: Staff, itemId: string, pricePaise: number | null) {
  if (pricePaise === null) {
    await tx
      .update(s.outletItemOverrides)
      .set({ pricePaise: null })
      .where(and(eq(s.outletItemOverrides.tenantId, staff.tenantId), eq(s.outletItemOverrides.outletId, staff.outletId), eq(s.outletItemOverrides.itemId, itemId)));
    return;
  }
  await tx
    .insert(s.outletItemOverrides)
    .values({ tenantId: staff.tenantId, outletId: staff.outletId, itemId, pricePaise })
    .onDuplicateKeyUpdate({ set: { pricePaise } });
}

const priceChanged = (staff: Staff, entityId: string | null) =>
  publish({ tenantId: staff.tenantId, outletId: staff.outletId }, [{ topic: topics.menu, type: "menu.changed", data: { entity: entityId ? "item" : "menu", entityId, change: "price" } }]);

function stale(): never {
  throw new AppError("conflict", "This price changed while you were editing. Review the latest price and try again.", { reason: "stale" });
}

const snapshot = (x: { outletPricePaise: number | null; effective: { pricePaise: number; source: PriceSource } }) => ({ outletPricePaise: x.outletPricePaise, pricePaise: x.effective.pricePaise, source: x.effective.source });

/**
 * Sets this outlet's price for one item. `expectedOutletPricePaise` is the override the editor showed
 * (null for none); if it no longer matches, nothing is written.
 */
export async function setOutletPrice(staff: Staff, itemId: string, pricePaise: number, opts: { expectedOutletPricePaise?: number | null } = {}, now = new Date()) {
  assertPricing(staff, "pricing.edit");
  await requireFeature(staff.tenantId, "pricingRules");
  const price = Number(pricePaise);
  if (!isValidNewPrice(price)) throw new AppError("invalid_state", "Enter a whole-rupee price of ₹0 or more.", { reason: "price" });
  const result = await db.transaction(async (tx) => {
    const [item] = await lockItems(tx, staff, [String(itemId)]);
    if (opts.expectedOutletPricePaise !== undefined && item.outletPricePaise !== opts.expectedOutletPricePaise) stale();
    await writeOutletPrice(tx, staff, item.id, price);
    const after = { outletPricePaise: price, pricePaise: price, source: "outlet_override" as const };
    await audit(tx, staff, { action: "pricing.outlet_price_set", entity: "menu_item", entityId: item.id, before: { itemId: item.id, brandPricePaise: item.pricePaise, ...snapshot(item) }, after: { itemId: item.id, brandPricePaise: item.pricePaise, ...after }, now });
    return { itemId: item.id, ...after };
  }, LOCK_THEN_READ);
  await priceChanged(staff, result.itemId);
  return result;
}

/** Back to the brand price for one item. Clears price_paise only; the row and its availability stay. */
export async function clearOutletPrice(staff: Staff, itemId: string, opts: { expectedOutletPricePaise?: number | null } = {}, now = new Date()) {
  assertPricing(staff, "pricing.edit");
  await requireFeature(staff.tenantId, "pricingRules");
  const result = await db.transaction(async (tx) => {
    const [item] = await lockItems(tx, staff, [String(itemId)]);
    if (opts.expectedOutletPricePaise !== undefined && item.outletPricePaise !== opts.expectedOutletPricePaise) stale();
    if (item.outletPricePaise === null) return { itemId: item.id, changed: false, pricePaise: item.pricePaise };
    await writeOutletPrice(tx, staff, item.id, null);
    await audit(tx, staff, { action: "pricing.outlet_price_cleared", entity: "menu_item", entityId: item.id, before: { itemId: item.id, brandPricePaise: item.pricePaise, ...snapshot(item) }, after: { itemId: item.id, brandPricePaise: item.pricePaise, outletPricePaise: null, pricePaise: item.pricePaise, source: "brand_base" }, now });
    return { itemId: item.id, changed: true, pricePaise: item.pricePaise };
  }, LOCK_THEN_READ);
  if (result.changed) await priceChanged(staff, result.itemId);
  return result;
}

export type BulkInput =
  | { action: "adjust"; itemIds: string[]; mode: AdjustMode; amount: number; expected?: Record<string, number> }
  | { action: "reset"; itemIds: string[]; expected?: Record<string, number> };

export type BulkChange = { itemId: string; nameEn: string; brandPricePaise: number; before: { outletPricePaise: number | null; pricePaise: number }; after: { outletPricePaise: number | null; pricePaise: number } };

/**
 * Adjusts or resets many outlet prices in one transaction: all of them or none. Adjustments start from
 * each item's current effective price and store the result as an absolute whole-rupee override.
 * `expected` is the effective price per item the preview showed; any difference cancels the change.
 */
export async function bulkOutletPrice(staff: Staff, input: BulkInput, now = new Date()) {
  assertPricing(staff, "pricing.edit");
  await requireFeature(staff.tenantId, "pricingRules");
  const itemIds = [...new Set((input.itemIds ?? []).map(String))];
  if (itemIds.length === 0) throw new AppError("invalid_state", "Select at least one item.", { reason: "selection" });
  if (itemIds.length > MAX_BULK_ITEMS) throw new AppError("invalid_state", `Select at most ${MAX_BULK_ITEMS} items at a time.`, { reason: "selection" });
  if (input.action === "adjust" && !validAdjustment(input.mode, Number(input.amount))) {
    throw new AppError("invalid_state", input.mode === "percent" ? "Enter a percentage between -100 and 500." : "Enter a whole-rupee amount.", { reason: "amount" });
  }
  const changes = await db.transaction(async (tx) => {
    const items = await lockItems(tx, staff, itemIds);
    if (input.expected) for (const item of items) if (input.expected[item.id] !== undefined && input.expected[item.id] !== item.effective.pricePaise) stale();
    const out: BulkChange[] = items.map((item) => {
      const next = input.action === "reset" ? null : adjustPrice(item.effective.pricePaise, input.mode, Number(input.amount));
      if (next !== null && !isValidNewPrice(next)) throw new AppError("invalid_state", `${item.nameEn} would go above the highest allowed price.`, { reason: "price", itemId: item.id });
      return {
        itemId: item.id,
        nameEn: item.nameEn,
        brandPricePaise: item.pricePaise,
        before: { outletPricePaise: item.outletPricePaise, pricePaise: item.effective.pricePaise },
        after: { outletPricePaise: next, pricePaise: next ?? item.pricePaise },
      };
    });
    const changed = out.filter((c) => c.before.outletPricePaise !== c.after.outletPricePaise);
    for (const c of changed) await writeOutletPrice(tx, staff, c.itemId, c.after.outletPricePaise);
    if (changed.length) {
      await audit(tx, staff, {
        action: "pricing.outlet_price_bulk",
        entity: "menu",
        entityId: null,
        after: { action: input.action, ...(input.action === "adjust" ? { mode: input.mode, amount: Number(input.amount) } : {}), changes: changed.map(({ itemId, brandPricePaise, before, after }) => ({ itemId, brandPricePaise, before, after })) },
        now,
      });
    }
    return { all: out, changed: changed.length };
  }, LOCK_THEN_READ);
  if (changes.changed) await priceChanged(staff, null);
  return changes.all;
}
