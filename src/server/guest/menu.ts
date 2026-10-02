import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { parseAllergens, parseSpice } from "@/domain/allergens";
import { canSatisfy } from "@/domain/item-sheet";
import { inWindow, localClock } from "@/domain/hours";
import type { PricingItem } from "@/domain/pricing";
import type { Runner } from "../db-types";

// The menu as a guest sees it at one outlet: central menu plus outlet overrides (PS 3.5, 7.3).

type Override = typeof s.outletItemOverrides.$inferSelect;

export function isItemAvailable(o: Override | undefined, now: Date): boolean {
  if (!o) return true;
  if (o.portionsLeft !== null && o.portionsLeft <= 0) return false;
  if (!o.isAvailable) return o.soldOutUntil !== null && o.soldOutUntil <= now;
  return true;
}

export type MenuItem = Awaited<ReturnType<typeof loadItems>>[number];

/** Whether a category with these hours is open now in the outlet's time zone */
export function isWithinCategoryWindow(window: { from: string; to: string } | null, timezone: string, now: Date) {
  return !window || inWindow(localClock(now, timezone).minutes, window.from, window.to);
}

/** Items with their outlet price, availability and option groups. Pass itemIds to load only those. */
export async function loadItems(
  run: Runner,
  ctx: { tenantId: string; brandId: string; outletId: string },
  now: Date,
  itemIds?: string[],
) {
  if (itemIds && itemIds.length === 0) return [];
  const items = await run
    .select()
    .from(s.menuItems)
    .where(
      and(
        eq(s.menuItems.tenantId, ctx.tenantId),
        eq(s.menuItems.brandId, ctx.brandId),
        eq(s.menuItems.isActive, true),
        itemIds ? inArray(s.menuItems.id, itemIds) : undefined,
      ),
    )
    .orderBy(asc(s.menuItems.sortOrder));
  if (items.length === 0) return [];
  const ids = items.map((i) => i.id);

  const [overrides, groups, windows] = await Promise.all([
    run
      .select()
      .from(s.outletItemOverrides)
      .where(
        and(
          eq(s.outletItemOverrides.tenantId, ctx.tenantId),
          eq(s.outletItemOverrides.outletId, ctx.outletId),
          inArray(s.outletItemOverrides.itemId, ids),
        ),
      ),
    run
      .select()
      .from(s.modifierGroups)
      .where(and(eq(s.modifierGroups.tenantId, ctx.tenantId), inArray(s.modifierGroups.itemId, ids)))
      .orderBy(asc(s.modifierGroups.sortOrder)),
    run
      .select({ id: s.menuCategories.id, from: s.menuCategories.availableFrom, to: s.menuCategories.availableTo })
      .from(s.menuCategories)
      .where(
        and(
          eq(s.menuCategories.tenantId, ctx.tenantId),
          eq(s.menuCategories.isActive, true),
          inArray(s.menuCategories.id, [...new Set(items.map((i) => i.categoryId))]),
        ),
      ),
  ]);
  const mods = groups.length
    ? await run
        .select()
        .from(s.modifiers)
        .where(and(eq(s.modifiers.tenantId, ctx.tenantId), inArray(s.modifiers.groupId, groups.map((g) => g.id))))
        .orderBy(asc(s.modifiers.sortOrder))
    : [];

  const overrideByItem = new Map(overrides.map((o) => [o.itemId, o]));
  const windowByCategory = new Map(windows.map((w) => [w.id, w.from && w.to ? { from: w.from, to: w.to } : null]));
  return items.map((item) => {
    const override = overrideByItem.get(item.id);
    const itemGroups = groups
      .filter((g) => g.itemId === item.id)
      .map((g) => ({
        id: g.id,
        nameEn: g.nameEn,
        nameHi: g.nameHi,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        modifiers: mods
          .filter((m) => m.groupId === g.id)
          .map((m) => ({ id: m.id, nameEn: m.nameEn, nameHi: m.nameHi, priceDeltaPaise: m.priceDeltaPaise, isAvailable: m.isAvailable })),
      }));
    const pricing: PricingItem = {
      id: item.id,
      pricePaise: override?.pricePaise ?? item.pricePaise,
      // A required choice with nothing left to choose makes the dish unorderable
      isAvailable: isItemAvailable(override, now) && itemGroups.every(canSatisfy),
      groups: itemGroups,
    };
    return {
      item,
      override,
      pricing,
      portionsLeft: override?.portionsLeft ?? null,
      /** Category hours in outlet local time, e.g. breakfast; null = all day */
      categoryWindow: windowByCategory.get(item.categoryId) ?? null,
    };
  });
}

export async function getGuestMenu(
  ctx: { tenantId: string; brandId: string; outletId: string; timezone: string; soldOutDisplay: "hide" | "grey" },
  now = new Date(),
) {
  const [categories, items] = await Promise.all([
    db
      .select()
      .from(s.menuCategories)
      .where(and(eq(s.menuCategories.tenantId, ctx.tenantId), eq(s.menuCategories.brandId, ctx.brandId), eq(s.menuCategories.isActive, true)))
      .orderBy(asc(s.menuCategories.sortOrder)),
    loadItems(db, ctx, now),
  ]);

  const { minutes } = localClock(now, ctx.timezone);
  return categories
    // Time-window categories such as breakfast appear only in their hours
    .filter((c) => !c.availableFrom || !c.availableTo || inWindow(minutes, c.availableFrom, c.availableTo))
    .map((c) => ({
      id: c.id,
      nameEn: c.nameEn,
      nameHi: c.nameHi,
      items: items
        .filter((x) => x.item.categoryId === c.id)
        .filter((x) => x.pricing.isAvailable || ctx.soldOutDisplay === "grey")
        .map(({ item, pricing, portionsLeft }) => ({
          id: item.id,
          nameEn: item.nameEn,
          nameHi: item.nameHi,
          descriptionEn: item.descriptionEn,
          descriptionHi: item.descriptionHi,
          pricePaise: pricing.pricePaise,
          isAvailable: pricing.isAvailable,
          isVeg: item.isVeg,
          isJain: item.isJain,
          spice: parseSpice(item.spiceLevel),
          allergens: parseAllergens(item.allergens),
          searchTerms: item.searchTerms,
          tags: item.tags ?? [],
          imageUrl: item.imageUrl,
          portionsLeft,
          groups: pricing.groups,
        })),
    }))
    .filter((c) => c.items.length > 0);
}
