import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { getGuestMenu } from "@/server/guest/menu";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { archiveCategory, archiveMenuItem, menuManagerData, reorderCategories, reorderModifierGroups, saveMenuCategory, saveMenuItem, saveModifierGroup, savePairings, setMenuAvailability, setModifierGroupActive } from "@/server/staff/menu-manager";
import { resetTestDb } from "./setup-db";

// Branches under the same brand share the menu; a separate brand in the tenant stays isolated.
let env: Awaited<ReturnType<typeof resetTestDb>>;
let sisterId: string;
let secondBrandId: string;
let secondBrandOutletId: string;
let secondBrandOwner: StaffSession;

const signIn = async (outletCode: string) => (await resolveStaff((await signInStaff({ outletCode, phone: "9000000001", pin: "1111" })).token))!;
const failsWithNotFound = async (p: Promise<unknown>) => {
  const error = await p.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe("not_found");
};

beforeAll(async () => {
  env = await resetTestDb();
  sisterId = uuidv7();
  secondBrandId = uuidv7();
  secondBrandOutletId = uuidv7();
  await env.db.insert(s.outlets).values({ id: sisterId, tenantId: env.demo.tenantId, brandId: env.demo.brandId, code: "BRN02", name: "BMW Branch Two", city: "Jaipur", address: "MI Road" });
  await env.db.insert(s.brands).values({ id: secondBrandId, tenantId: env.demo.tenantId, name: "Separate Concept" });
  await env.db.insert(s.outlets).values({ id: secondBrandOutletId, tenantId: env.demo.tenantId, brandId: secondBrandId, code: "BRN03", name: "Separate Concept", city: "Jaipur", address: "Tonk Road" });
  for (const outletId of [sisterId, secondBrandOutletId]) await env.db.insert(s.staffRoles).values({ id: uuidv7(), tenantId: env.demo.tenantId, userId: env.demo.staffIds.owner, outletId, role: "owner" });
  secondBrandOwner = await signIn("BRN03");
});

afterAll(async () => { if (env?.conn) await env.conn.end(); await appDb.$client.end(); });

describe("menu brand and outlet isolation", () => {
  it("shares menu content across same-brand outlets, but isolates availability and the other brand menu", async () => {
    const primaryOwner = await signIn(env.demo.outletCode);
    const itemId = env.demo.itemIds["Paneer Tikka"];
    await setMenuAvailability(await signIn("BRN02"), itemId, "off");

    const [primary, sister, separate] = await Promise.all([
      menuManagerData(primaryOwner), menuManagerData(await signIn("BRN02")), menuManagerData(secondBrandOwner),
    ]);
    expect(primary.items.map((item) => item.id)).toContain(itemId);
    expect(sister.items.map((item) => item.id)).toContain(itemId);
    expect(separate.items.map((item) => item.id)).not.toContain(itemId);
    expect(separate.outlets.map((outlet) => outlet.id)).toEqual([secondBrandOutletId]);

    const menu = (outletId: string) => getGuestMenu({ tenantId: env.demo.tenantId, brandId: env.demo.brandId, outletId, timezone: "Asia/Kolkata", soldOutDisplay: "grey" }, new Date("2026-10-24T12:00:00Z"));
    const [firstGuestMenu, sisterGuestMenu] = await Promise.all([menu(env.demo.outletId), menu(sisterId)]);
    const firstDish = firstGuestMenu.flatMap((category) => category.items).find((dish) => dish.id === itemId)!;
    const sisterDish = sisterGuestMenu.flatMap((category) => category.items).find((dish) => dish.id === itemId)!;
    expect(firstDish.isAvailable).toBe(true);
    expect(sisterDish.isAvailable).toBe(false);
  });

  it("rejects a same-tenant owner trying to mutate dishes or categories from another brand", async () => {
    const primaryOwner = await signIn(env.demo.outletCode);
    const itemId = env.demo.itemIds["Paneer Tikka"];
    const categoryId = (await env.db.select({ id: s.menuItems.categoryId }).from(s.menuItems).where(and(eq(s.menuItems.tenantId, env.demo.tenantId), eq(s.menuItems.id, itemId))))[0].id;
    const groupId = await saveModifierGroup(primaryOwner, { itemId, nameEn: "Choose a size", minSelect: 0, maxSelect: 1, options: [] });

    await failsWithNotFound(archiveMenuItem(secondBrandOwner, itemId));
    await failsWithNotFound(setMenuAvailability(secondBrandOwner, itemId, "off"));
    await failsWithNotFound(saveMenuCategory(secondBrandOwner, { id: categoryId, nameEn: "Wrong brand edit" }));
    await failsWithNotFound(archiveCategory(secondBrandOwner, categoryId, false, true));
    await failsWithNotFound(reorderCategories(secondBrandOwner, [categoryId]));
    await failsWithNotFound(savePairings(secondBrandOwner, itemId, []));
    await failsWithNotFound(setModifierGroupActive(secondBrandOwner, groupId, false));
    await failsWithNotFound(saveModifierGroup(secondBrandOwner, { id: groupId, itemId, nameEn: "Changed size", minSelect: 0, maxSelect: 1, options: [] }));
    await failsWithNotFound(reorderModifierGroups(secondBrandOwner, itemId, [groupId]));

    const [category] = await env.db.select().from(s.menuCategories).where(eq(s.menuCategories.id, categoryId));
    expect(category.nameEn).not.toBe("Wrong brand edit");

    const ownCategory = (await saveMenuCategory(secondBrandOwner, { nameEn: "Separate Mains" }))!;
    await failsWithNotFound(saveMenuItem(secondBrandOwner, { id: itemId, categoryId: ownCategory, nameEn: "Cross-brand edit", pricePaise: 32000, isVeg: true, prepMinutes: 10, station: "Main" }));
    const ownDish = await saveMenuItem(secondBrandOwner, { categoryId: ownCategory, nameEn: "Separate Dish", pricePaise: 12500, isVeg: true, prepMinutes: 10, station: "Main" });
    const data = await menuManagerData(secondBrandOwner);
    expect(data.items.map((item) => item.id)).toEqual([ownDish]);
    expect(data.categories.map((category) => category.id)).toContain(ownCategory);

    // The primary brand remains usable after all rejected attempts.
    expect((await menuManagerData(primaryOwner)).items.map((item) => item.id)).toContain(itemId);
  });

});
