import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  libraryCategories,
  libraryCategory,
  libraryItem,
  libraryItemsIn,
  searchLibraryCategories,
  searchLibraryItems,
  type LibraryCategory,
  type LibraryItem,
} from "@/domain/menu-library";
import { libraryPhotoKey } from "@/domain/menu-library/photos";
import { AppError } from "../errors";
import { photoBucket } from "../menu-storage";
import { audit } from "./audit";
import type { StaffSession } from "./auth";
import { saveMenuCategory, saveMenuItem, saveModifierGroup } from "./menu-manager";

// The menu library inside the console: what the restaurant already has is marked, picked dishes
// land in their own category (created when missing), and every add goes through the normal menu
// rules (owner only for new dishes, whole-rupee prices, audit log).

type Staff = StaffSession;
const key = (name: string) => name.trim().toLowerCase();

/** This outlet's brand, with its categories and dish names, to mark what is already on the menu */
async function menuNow(staff: Staff) {
  const [outlet] = await db.select({ brandId: s.outlets.brandId }).from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId)));
  if (!outlet) throw new AppError("not_found", "Outlet not found.");
  const [categories, items] = await Promise.all([
    db.select({ id: s.menuCategories.id, nameEn: s.menuCategories.nameEn, isActive: s.menuCategories.isActive }).from(s.menuCategories).where(and(eq(s.menuCategories.tenantId, staff.tenantId), eq(s.menuCategories.brandId, outlet.brandId))),
    db.select({ nameEn: s.menuItems.nameEn, isActive: s.menuItems.isActive }).from(s.menuItems).where(and(eq(s.menuItems.tenantId, staff.tenantId), eq(s.menuItems.brandId, outlet.brandId))),
  ]);
  return {
    categoryByName: new Map(categories.map((c) => [key(c.nameEn), c])),
    dishNames: new Set(items.filter((i) => i.isActive).map((i) => key(i.nameEn))),
  };
}

export type LibraryCategoryView = LibraryCategory & { onMenu: boolean };
export type LibraryItemView = LibraryItem & { onMenu: boolean; categoryName: string; imageUrl: string | null };

/** The library photo's public address, when the dish has one and photos live in a bucket */
function libraryPhotoUrl(nameEn: string) {
  const key = libraryPhotoKey(nameEn);
  const bucket = key ? photoBucket() : null;
  return key && bucket ? `${bucket.publicBase}/${key}` : null;
}

const viewCategory = (c: LibraryCategory, menu: Awaited<ReturnType<typeof menuNow>>): LibraryCategoryView => ({ ...c, onMenu: menu.categoryByName.has(key(c.nameEn)) });
const viewItem = (i: LibraryItem, menu: Awaited<ReturnType<typeof menuNow>>): LibraryItemView => ({
  ...i,
  onMenu: menu.dishNames.has(key(i.nameEn)),
  categoryName: libraryCategory(i.categoryKey)?.nameEn ?? "",
  imageUrl: libraryPhotoUrl(i.nameEn),
});

/** Every library category, marked when the restaurant already has it */
export async function browseLibrary(staff: Staff) {
  const menu = await menuNow(staff);
  return libraryCategories().map((c) => viewCategory(c, menu));
}

/** Categories and dishes for what the owner typed */
export async function searchLibrary(staff: Staff, query: string) {
  const q = String(query ?? "").slice(0, 60);
  const menu = await menuNow(staff);
  return {
    categories: searchLibraryCategories(q, 6).map((c) => viewCategory(c, menu)),
    items: searchLibraryItems(q, { limit: 15 }).map((i) => viewItem(i, menu)),
  };
}

/** One category and all its dishes */
export async function libraryCategoryDetail(staff: Staff, categoryKey: string) {
  const c = libraryCategory(String(categoryKey));
  if (!c) throw new AppError("not_found", "That category is not in the library.");
  const menu = await menuNow(staff);
  return { category: viewCategory(c, menu), items: libraryItemsIn(c.key).map((i) => viewItem(i, menu)) };
}

/** The restaurant's category for a library category: the existing one (shown again if hidden), or a new one */
export async function ensureLibraryCategory(staff: Staff, categoryKey: string): Promise<string> {
  const c = libraryCategory(String(categoryKey));
  if (!c) throw new AppError("not_found", "That category is not in the library.");
  const existing = (await menuNow(staff)).categoryByName.get(key(c.nameEn));
  if (existing) {
    if (!existing.isActive) await db.update(s.menuCategories).set({ isActive: true }).where(and(eq(s.menuCategories.tenantId, staff.tenantId), eq(s.menuCategories.id, existing.id)));
    return existing.id;
  }
  return (await saveMenuCategory(staff, { nameEn: c.nameEn, nameHi: c.nameHi }))!;
}

export type LibraryPick = { id: string; pricePaise: number; sizes?: { name: string; pricePaise: number }[] };

/**
 * Adds library dishes with the owner's prices. Each goes into its own category (made if missing);
 * two or more sizes become a "Size" choice priced from the smallest. Dishes already on the menu
 * are skipped, never duplicated.
 */
export async function addLibraryDishes(staff: Staff, picks: LibraryPick[]) {
  if (!staff.roles.includes("owner")) throw new AppError("forbidden", "Only the owner can add dishes.");
  if (!Array.isArray(picks) || picks.length === 0) throw new AppError("invalid_state", "Pick at least one dish.");
  if (picks.length > 200) throw new AppError("invalid_state", "Add at most 200 dishes at a time.");
  const menu = await menuNow(staff);
  const categoryIds = new Map<string, string>();
  let added = 0;
  const skipped: string[] = [];
  for (const pick of picks) {
    const item = libraryItem(String(pick.id));
    if (!item) continue;
    if (menu.dishNames.has(key(item.nameEn))) {
      skipped.push(item.nameEn);
      continue;
    }
    const sizes = (pick.sizes ?? []).filter((x) => String(x.name ?? "").trim() && Number(x.pricePaise) > 0);
    const useSizes = sizes.length >= 2;
    const sorted = [...sizes].sort((a, b) => a.pricePaise - b.pricePaise);
    const base = useSizes ? Math.round(sorted[0].pricePaise) : Math.round(Number(pick.pricePaise));
    if (!(base > 0)) throw new AppError("invalid_state", `Enter a price for ${item.nameEn}.`, { reason: "price" });
    let categoryId = categoryIds.get(item.categoryKey);
    if (!categoryId) {
      categoryId = await ensureLibraryCategory(staff, item.categoryKey);
      categoryIds.set(item.categoryKey, categoryId);
    }
    const id = await saveMenuItem(staff, {
      categoryId,
      nameEn: item.nameEn,
      nameHi: item.nameHi,
      pricePaise: base,
      isVeg: item.isVeg,
      spiceLevel: item.spice,
      searchTerms: item.searchTerms,
      prepMinutes: item.prepMinutes,
      station: item.station,
      // The library photo comes along; the owner can replace it with their own any time
      imageUrl: libraryPhotoUrl(item.nameEn),
    });
    if (useSizes) {
      await saveModifierGroup(staff, {
        itemId: id,
        nameEn: "Size",
        nameHi: "साइज़",
        minSelect: 1,
        maxSelect: 1,
        options: sorted.map((x) => ({ nameEn: x.name.trim().slice(0, 40), nameHi: null, priceDeltaPaise: Math.round(x.pricePaise) - base, isAvailable: true })),
      });
    }
    menu.dishNames.add(key(item.nameEn));
    added++;
  }
  return { added, skipped };
}

/**
 * Gives every dish on this brand's menu that has no photo the library photo of the same name.
 * Owner only; a dish with its own photo is never touched.
 */
export async function fillLibraryPhotos(staff: Staff) {
  if (!staff.roles.includes("owner")) throw new AppError("forbidden", "Only the owner can change dish photos.");
  const [outlet] = await db.select({ brandId: s.outlets.brandId }).from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId)));
  if (!outlet) throw new AppError("not_found", "Outlet not found.");
  const items = await db.select({ id: s.menuItems.id, nameEn: s.menuItems.nameEn }).from(s.menuItems)
    .where(and(eq(s.menuItems.tenantId, staff.tenantId), eq(s.menuItems.brandId, outlet.brandId), isNull(s.menuItems.imageUrl)));
  let filled = 0;
  for (const item of items) {
    const url = libraryPhotoUrl(item.nameEn);
    if (!url) continue;
    await db.update(s.menuItems).set({ imageUrl: url })
      .where(and(eq(s.menuItems.tenantId, staff.tenantId), eq(s.menuItems.id, item.id), isNull(s.menuItems.imageUrl)));
    filled++;
  }
  if (filled) await audit(db, staff, { action: "menu.library_photos_filled", entity: "menu", entityId: null, after: { filled }, now: new Date() });
  return { filled, withoutPhoto: items.length - filled };
}
