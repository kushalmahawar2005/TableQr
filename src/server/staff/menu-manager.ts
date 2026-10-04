import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { adjustPrice, isValidNewPrice, isWholeRupee, validAdjustment } from "@/domain/price-adjust";
import { AppError } from "../errors";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import type { StaffSession } from "./auth";

export const menuManagerRoles = ["manager", "owner"] as const;
const ownerOnly = (staff: StaffSession) => staff.roles.includes("owner");
const guard = (staff: StaffSession) => {
  if (!staff.roles.some((r) => menuManagerRoles.includes(r as (typeof menuManagerRoles)[number]))) throw new AppError("forbidden", "Your role can't manage the menu. Ask an owner.");
};
type MenuTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const audit = async (tx: MenuTx, staff: StaffSession, action: string, entity: string, entityId: string | null, before: unknown, after: unknown) => {
  await tx.insert(s.auditLog).values({ tenantId: staff.tenantId, outletId: staff.outletId, actorUserId: staff.userId, actorLabel: `staff:${staff.name}`, action, entity, entityId, before, after, createdAt: new Date() });
};
const menuChanged = (staff: StaffSession, entity: string, entityId: string | null, change: string) =>
  publish({ tenantId: staff.tenantId, outletId: staff.outletId }, [{ topic: topics.menu, type: "menu.changed", data: { entity, entityId, change } }]);
const cleanAliases = (value: string | null | undefined) => [...new Set(String(value ?? "").split(",").map((x) => x.trim()).filter(Boolean))].slice(0, 30).join(", ").slice(0, 300) || null;
const checkText = (value: unknown, max: number, required = false) => { const x = String(value ?? "").trim(); if (required && !x) throw new AppError("invalid_state", "Complete the required menu fields."); if (x.length > max) throw new AppError("invalid_state", "One menu field is too long."); return x || null; };
const checkSpice = (value: unknown) => value === null || value === undefined || value === "" ? null : Math.max(0, Math.min(3, Number(value)));
const checkAllergens = (value: unknown) => value === null || value === undefined ? null : Array.isArray(value) ? [...new Set(value.filter((x): x is string => typeof x === "string"))] : [];

export async function menuManagerData(staff: StaffSession) {
  guard(staff);
  const [categories, items, overrides, groups, modifiers, pairings, outlets] = await Promise.all([
    db.select().from(s.menuCategories).where(and(eq(s.menuCategories.tenantId, staff.tenantId), eq(s.menuCategories.brandId, (await db.select({ brandId: s.outlets.brandId }).from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId))))[0]?.brandId ?? "-"))).orderBy(asc(s.menuCategories.sortOrder), asc(s.menuCategories.nameEn)),
    db.select().from(s.menuItems).where(and(eq(s.menuItems.tenantId, staff.tenantId), eq(s.menuItems.brandId, (await db.select({ brandId: s.outlets.brandId }).from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId))))[0]?.brandId ?? "-"))).orderBy(asc(s.menuItems.sortOrder), asc(s.menuItems.nameEn)),
    db.select().from(s.outletItemOverrides).where(and(eq(s.outletItemOverrides.tenantId, staff.tenantId), eq(s.outletItemOverrides.outletId, staff.outletId))),
    db.select().from(s.modifierGroups).where(eq(s.modifierGroups.tenantId, staff.tenantId)).orderBy(asc(s.modifierGroups.sortOrder)),
    db.select().from(s.modifiers).where(eq(s.modifiers.tenantId, staff.tenantId)).orderBy(asc(s.modifiers.sortOrder)),
    db.select().from(s.menuItemPairings).where(eq(s.menuItemPairings.tenantId, staff.tenantId)).orderBy(asc(s.menuItemPairings.sortOrder)),
    db.select({ id: s.outlets.id, name: s.outlets.name }).from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.brandId, (await db.select({ brandId: s.outlets.brandId }).from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId))))[0]?.brandId ?? "-"))),
  ]);
  return { categories, items, overrides, groups, modifiers, pairings, outlets, currentOutlet: staff.outlet.name, canEditPrice: ownerOnly(staff) };
}

type ItemInput = { id?: string; categoryId: string; nameEn: string; nameHi?: string | null; descriptionEn?: string | null; descriptionHi?: string | null; pricePaise: number; isVeg: boolean; isJain?: boolean; spiceLevel?: number | null; allergens?: string[] | null; searchTerms?: string | null; prepMinutes: number; station: string; bestseller?: boolean; imageUrl?: string | null };
export async function saveMenuItem(staff: StaffSession, input: ItemInput) {
  guard(staff);
  const outlet = (await db.select({ brandId: s.outlets.brandId }).from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId))))[0];
  if (!outlet) throw new AppError("not_found", "Outlet not found.");
  const category = (await db.select({ id: s.menuCategories.id }).from(s.menuCategories).where(and(eq(s.menuCategories.tenantId, staff.tenantId), eq(s.menuCategories.brandId, outlet.brandId), eq(s.menuCategories.id, input.categoryId))))[0];
  if (!category) throw new AppError("invalid_state", "Choose a category from this menu.");
  const nameEn = checkText(input.nameEn, 100, true)!;
  const station = checkText(input.station, 30, true)!;
  const prepMinutes = Number.isFinite(Number(input.prepMinutes)) ? Math.max(0, Math.min(1440, Math.round(Number(input.prepMinutes)))) : 15;
  const pricePaise = Math.max(0, Math.round(Number(input.pricePaise)));
  if (!ownerOnly(staff) && input.id === undefined) throw new AppError("forbidden", "Only an owner can create menu items.");
  const tags = input.bestseller ? ["bestseller" as const] : [];
  const values = { tenantId: staff.tenantId, brandId: outlet.brandId, categoryId: input.categoryId, nameEn, nameHi: checkText(input.nameHi, 100), descriptionEn: checkText(input.descriptionEn, 300), descriptionHi: checkText(input.descriptionHi, 300), pricePaise, isVeg: !!input.isVeg, isJain: !!input.isJain, spiceLevel: checkSpice(input.spiceLevel), allergens: checkAllergens(input.allergens), searchTerms: cleanAliases(input.searchTerms), prepMinutes, station, tags, imageUrl: checkText(input.imageUrl, 500), isActive: true };
  if (input.id) {
    const [old] = await db.select().from(s.menuItems).where(and(eq(s.menuItems.tenantId, staff.tenantId), eq(s.menuItems.id, input.id), eq(s.menuItems.brandId, outlet.brandId)));
    if (!old) throw new AppError("not_found", "Menu item not found.");
    if (!ownerOnly(staff) && old.pricePaise !== pricePaise) throw new AppError("forbidden", "Managers cannot edit prices.");
    // New prices are whole rupees; an older price with paise can be saved unchanged
    if (old.pricePaise !== pricePaise && !isValidNewPrice(pricePaise)) throw new AppError("invalid_state", "Enter a whole-rupee price.", { reason: "price" });
    await db.transaction(async (tx) => { await tx.update(s.menuItems).set(values).where(and(eq(s.menuItems.tenantId, staff.tenantId), eq(s.menuItems.id, input.id!))); await audit(tx, staff, "menu.item_updated", "menu_item", input.id!, old, values); });
    await publish({ tenantId: staff.tenantId, outletId: staff.outletId }, [{ topic: topics.menu, type: "menu.changed", data: { entity: "item", entityId: input.id, change: "updated" } }]);
    return input.id;
  }
  if (!isValidNewPrice(pricePaise)) throw new AppError("invalid_state", "Enter a whole-rupee price.", { reason: "price" });
  const [row] = await db.insert(s.menuItems).values(values /* tenantId */).$returningId();
  const id = row.id;
  await db.insert(s.auditLog).values({ tenantId: staff.tenantId, outletId: staff.outletId, actorUserId: staff.userId, actorLabel: `staff:${staff.name}`, action: "menu.item_created", entity: "menu_item", entityId: id, after: values, createdAt: new Date() });
  return id;
}

export async function archiveMenuItem(staff: StaffSession, itemId: string, restore = false) {
  guard(staff); const [old] = await db.select().from(s.menuItems).where(and(eq(s.menuItems.tenantId, staff.tenantId), eq(s.menuItems.id, itemId))); if (!old) throw new AppError("not_found", "Menu item not found.");
  const next = restore; await db.update(s.menuItems).set({ isActive: next }).where(and(eq(s.menuItems.tenantId, staff.tenantId), eq(s.menuItems.id, itemId))); await db.insert(s.auditLog).values({ tenantId: staff.tenantId, outletId: staff.outletId, actorUserId: staff.userId, actorLabel: `staff:${staff.name}`, action: next ? "menu.item_restored" : "menu.item_archived", entity: "menu_item", entityId: itemId, before: { isActive: old.isActive }, after: { isActive: next }, createdAt: new Date() });
  await publish({ tenantId: staff.tenantId, outletId: staff.outletId }, [{ topic: topics.menu, type: "menu.changed", data: { entity: "item", entityId: itemId, change: next ? "restored" : "archived" } }]);
}

export async function setMenuAvailability(staff: StaffSession, itemId: string, mode: "available" | "today" | "off", portionsLeft?: number | null) {
  guard(staff); const [item] = await db.select({ id: s.menuItems.id }).from(s.menuItems).where(and(eq(s.menuItems.tenantId, staff.tenantId), eq(s.menuItems.id, itemId))); if (!item) throw new AppError("not_found", "Menu item not found.");
  const until = mode === "today" ? new Date(new Date().setHours(23, 59, 59, 999)) : null; const available = mode === "available";
  await db.insert(s.outletItemOverrides).values({ tenantId: staff.tenantId, outletId: staff.outletId, itemId, isAvailable: available, soldOutUntil: until, portionsLeft: portionsLeft == null ? null : Math.max(0, Math.round(portionsLeft)) }).onDuplicateKeyUpdate({ set: { isAvailable: available, soldOutUntil: until, ...(portionsLeft == null ? {} : { portionsLeft: Math.max(0, Math.round(portionsLeft)) }) } });
  await db.insert(s.auditLog).values({ tenantId: staff.tenantId, outletId: staff.outletId, actorUserId: staff.userId, actorLabel: `staff:${staff.name}`, action: "menu.availability_changed", entity: "menu_item", entityId: itemId, after: { mode, portionsLeft: portionsLeft ?? null }, createdAt: new Date() });
  await publish({ tenantId: staff.tenantId, outletId: staff.outletId }, [{ topic: topics.menu, type: "item.availability", data: { itemId, available } }, { topic: topics.menu, type: "menu.changed", data: { entity: "item", entityId: itemId, change: "availability" } }]);
}

export async function adjustMenuPortions(staff: StaffSession, itemId: string, portionsLeft: number | null) { guard(staff); await setMenuAvailability(staff, itemId, portionsLeft === 0 ? "off" : "available", portionsLeft ?? undefined); }

export async function saveMenuCategory(staff: StaffSession, input: { id?: string; nameEn: string; nameHi?: string | null; availableFrom?: string | null; availableTo?: string | null; sortOrder?: number }) {
  guard(staff); const brand = (await db.select({ brandId: s.outlets.brandId }).from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId))))[0]?.brandId; if (!brand) throw new AppError("not_found", "Outlet not found.");
  const values = { tenantId: staff.tenantId, brandId: brand, nameEn: checkText(input.nameEn, 80, true)!, nameHi: checkText(input.nameHi, 80), availableFrom: input.availableFrom || null, availableTo: input.availableTo || null, sortOrder: Math.max(0, Math.round(input.sortOrder ?? 0)) };
  if (input.id) await db.update(s.menuCategories).set(values).where(and(eq(s.menuCategories.tenantId, staff.tenantId), eq(s.menuCategories.id, input.id))); else { const [row] = await db.insert(s.menuCategories).values(values /* tenantId */).$returningId(); // tenantId is included in values
    input.id = row.id; }
  await db.insert(s.auditLog).values({ tenantId: staff.tenantId, outletId: staff.outletId, actorUserId: staff.userId, actorLabel: `staff:${staff.name}`, action: input.id ? "menu.category_updated" : "menu.category_created", entity: "menu_category", entityId: input.id!, after: values, createdAt: new Date() }); return input.id;
}

export async function reorderCategories(staff: StaffSession, ids: string[]) { guard(staff); await db.transaction(async (tx) => { for (const [sortOrder, id] of ids.entries()) await tx.update(s.menuCategories).set({ sortOrder }).where(and(eq(s.menuCategories.tenantId, staff.tenantId), eq(s.menuCategories.id, id))); }); await db.insert(s.auditLog).values({ tenantId: staff.tenantId, outletId: staff.outletId, actorUserId: staff.userId, actorLabel: `staff:${staff.name}`, action: "menu.category_reordered", entity: "menu_category", after: { ids }, createdAt: new Date() }); }

export async function archiveCategory(staff: StaffSession, categoryId: string, restore = false) { guard(staff); const [active] = await db.select({ n: sql<number>`count(*)` }).from(s.menuItems).where(and(eq(s.menuItems.tenantId, staff.tenantId), eq(s.menuItems.categoryId, categoryId), eq(s.menuItems.isActive, true))); if (!restore && Number(active?.n ?? 0) > 0) throw new AppError("conflict", `Move or archive ${active.n} active item(s) first.`); await db.update(s.menuCategories).set({ isActive: restore }).where(and(eq(s.menuCategories.tenantId, staff.tenantId), eq(s.menuCategories.id, categoryId))); await db.insert(s.auditLog).values({ tenantId: staff.tenantId, outletId: staff.outletId, actorUserId: staff.userId, actorLabel: `staff:${staff.name}`, action: restore ? "menu.category_updated" : "menu.category_archived", entity: "menu_category", entityId: categoryId, after: { isActive: restore }, createdAt: new Date() }); }

/** Brand prices for this outlet's brand only; results are whole rupees, rounded half up */
export async function bulkPrice(staff: StaffSession, itemIds: string[], mode: "percent" | "fixed", amount: number) {
  guard(staff);
  if (!ownerOnly(staff)) throw new AppError("forbidden", "Only an owner can change prices.");
  if (mode !== "percent" && mode !== "fixed") throw new AppError("invalid_state", "Choose a percentage or a fixed amount.");
  if (!validAdjustment(mode, Number(amount))) throw new AppError("invalid_state", mode === "percent" ? "Enter a percentage between -100 and 500." : "Enter a whole-rupee amount.", { reason: "amount" });
  const ids = [...new Set(itemIds.map(String))];
  if (ids.length === 0) throw new AppError("invalid_state", "Select at least one item.");
  const brandId = (await db.select({ brandId: s.outlets.brandId }).from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId))))[0]?.brandId;
  if (!brandId) throw new AppError("not_found", "Outlet not found.");
  const changes = await db.transaction(async (tx) => {
    const rows = await tx.select({ id: s.menuItems.id, pricePaise: s.menuItems.pricePaise }).from(s.menuItems).where(and(eq(s.menuItems.tenantId, staff.tenantId), eq(s.menuItems.brandId, brandId), inArray(s.menuItems.id, ids))).for("update");
    // Another brand's item (or a stale id) fails the whole change; nothing outside this brand is written
    if (rows.length !== ids.length) throw new AppError("not_found", "Choose items from this menu.");
    const out = rows.map((r) => ({ id: r.id, before: r.pricePaise, after: adjustPrice(r.pricePaise, mode, Number(amount)) }));
    if (out.some((c) => !isValidNewPrice(c.after))) throw new AppError("invalid_state", "One of the new prices is above the highest allowed price.", { reason: "price" });
    for (const c of out) await tx.update(s.menuItems).set({ pricePaise: c.after }).where(and(eq(s.menuItems.tenantId, staff.tenantId), eq(s.menuItems.brandId, brandId), eq(s.menuItems.id, c.id)));
    await audit(tx, staff, "menu.bulk_price_changed", "menu", null, null, { mode, amount, changes: out });
    return out;
  });
  await menuChanged(staff, "menu", null, "price");
  return changes;
}

export async function savePairings(staff: StaffSession, sourceItemId: string, pairedItemIds: string[]) { guard(staff); if (pairedItemIds.includes(sourceItemId)) throw new AppError("invalid_state", "An item cannot pair with itself."); const items = await db.select({ id: s.menuItems.id }).from(s.menuItems).where(and(eq(s.menuItems.tenantId, staff.tenantId), inArray(s.menuItems.id, [sourceItemId, ...pairedItemIds]), eq(s.menuItems.isActive, true))); if (items.length !== new Set([sourceItemId, ...pairedItemIds]).size) throw new AppError("not_found", "Choose active items from this menu."); await db.delete(s.menuItemPairings).where(and(eq(s.menuItemPairings.tenantId, staff.tenantId), eq(s.menuItemPairings.sourceItemId, sourceItemId))); if (pairedItemIds.length) await db.insert(s.menuItemPairings).values(pairedItemIds.map((pairedItemId, sortOrder) => ({ tenantId: staff.tenantId, sourceItemId, pairedItemId, sortOrder }))); await db.insert(s.auditLog).values({ tenantId: staff.tenantId, outletId: staff.outletId, actorUserId: staff.userId, actorLabel: `staff:${staff.name}`, action: "menu.pairings_updated", entity: "menu_item", entityId: sourceItemId, after: { pairedItemIds }, createdAt: new Date() }); }

export async function saveModifierGroup(staff: StaffSession, input: { id?: string; itemId: string; nameEn: string; nameHi?: string | null; minSelect: number; maxSelect: number; options: { id?: string; nameEn: string; nameHi?: string | null; priceDeltaPaise: number; isAvailable: boolean }[] }) {
  guard(staff); if (input.maxSelect < input.minSelect || input.minSelect < 0) throw new AppError("invalid_state", "Modifier selection limits are invalid.");
  const [item] = await db.select({ id: s.menuItems.id, pricePaise: s.menuItems.pricePaise }).from(s.menuItems).where(and(eq(s.menuItems.tenantId, staff.tenantId), eq(s.menuItems.id, input.itemId))); if (!item) throw new AppError("not_found", "Menu item not found.");
  // Option prices are prices: a manager may edit names, limits and availability but never a delta
  const existing = input.id ? await db.select({ id: s.modifiers.id, priceDeltaPaise: s.modifiers.priceDeltaPaise }).from(s.modifiers).where(and(eq(s.modifiers.tenantId, staff.tenantId), eq(s.modifiers.groupId, input.id))) : [];
  const oldDelta = new Map(existing.map((m) => [m.id, m.priceDeltaPaise]));
  for (const option of input.options) {
    const delta = Math.round(Number(option.priceDeltaPaise));
    const before = option.id ? oldDelta.get(option.id) : undefined;
    // Unchanged, or a new option at no extra cost: not a price change
    if (before !== undefined ? before === delta : delta === 0) continue;
    if (!ownerOnly(staff)) throw new AppError("forbidden", "Managers cannot change option prices.", { reason: "price" });
    if (!Number.isFinite(delta) || !isWholeRupee(Math.abs(delta))) throw new AppError("invalid_state", "Enter option prices in whole rupees.", { reason: "price" });
    if (item.pricePaise + delta < 0) throw new AppError("invalid_state", "An option can't make the dish cost less than ₹0.", { reason: "negative_price" });
  }
  const groupId = input.id ?? (await db.insert(s.modifierGroups).values({ tenantId: staff.tenantId, itemId: input.itemId, nameEn: checkText(input.nameEn, 80, true)!, nameHi: checkText(input.nameHi, 80), minSelect: input.minSelect, maxSelect: input.maxSelect }).$returningId())[0].id; // tenantId scoped
  if (input.id) await db.update(s.modifierGroups).set({ nameEn: checkText(input.nameEn, 80, true)!, nameHi: checkText(input.nameHi, 80), minSelect: input.minSelect, maxSelect: input.maxSelect }).where(and(eq(s.modifierGroups.tenantId, staff.tenantId), eq(s.modifierGroups.id, input.id)));
  for (const [sortOrder, option] of input.options.entries()) { const values = { tenantId: staff.tenantId, groupId, nameEn: checkText(option.nameEn, 80, true)!, nameHi: checkText(option.nameHi, 80), priceDeltaPaise: Math.round(option.priceDeltaPaise), isAvailable: option.isAvailable, sortOrder }; if (option.id) await db.update(s.modifiers).set(values).where(and(eq(s.modifiers.tenantId, staff.tenantId), eq(s.modifiers.id, option.id), eq(s.modifiers.groupId, groupId))); else await db.insert(s.modifiers).values(values /* tenantId */);
  }
  await db.insert(s.auditLog).values({ tenantId: staff.tenantId, outletId: staff.outletId, actorUserId: staff.userId, actorLabel: `staff:${staff.name}`, action: "menu.modifier_updated", entity: "modifier_group", entityId: groupId, after: input, createdAt: new Date() });
  await menuChanged(staff, "modifier_group", groupId, "updated");
  return groupId;
}

export async function setModifierGroupActive(staff: StaffSession, groupId: string, active: boolean) {
  guard(staff);
  const [group] = await db.select().from(s.modifierGroups).where(and(eq(s.modifierGroups.tenantId, staff.tenantId), eq(s.modifierGroups.id, groupId)));
  if (!group) throw new AppError("not_found", "Modifier group not found.");
  await db.update(s.modifierGroups).set({ isActive: active }).where(and(eq(s.modifierGroups.tenantId, staff.tenantId), eq(s.modifierGroups.id, groupId)));
  await db.insert(s.auditLog).values({ tenantId: staff.tenantId, outletId: staff.outletId, actorUserId: staff.userId, actorLabel: `staff:${staff.name}`, action: active ? "menu.modifier_restored" : "menu.modifier_archived", entity: "modifier_group", entityId: groupId, before: { isActive: group.isActive }, after: { isActive: active }, createdAt: new Date() });
}

export async function reorderModifierGroups(staff: StaffSession, itemId: string, ids: string[]) {
  guard(staff);
  await db.transaction(async (tx) => {
    for (const [sortOrder, id] of ids.entries()) {
      await tx.update(s.modifierGroups).set({ sortOrder }).where(and(eq(s.modifierGroups.tenantId, staff.tenantId), eq(s.modifierGroups.itemId, itemId), eq(s.modifierGroups.id, id)));
    }
  });
  await db.insert(s.auditLog).values({ tenantId: staff.tenantId, outletId: staff.outletId, actorUserId: staff.userId, actorLabel: `staff:${staff.name}`, action: "menu.modifier_reordered", entity: "menu_item", entityId: itemId, after: { ids }, createdAt: new Date() });
}
