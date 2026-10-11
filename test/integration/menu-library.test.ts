import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { searchLibraryItems } from "@/domain/menu-library";
import { AppError } from "@/server/errors";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { addLibraryDishes, browseLibrary, ensureLibraryCategory, libraryCategoryDetail, searchLibrary } from "@/server/staff/menu-library";
import { archiveCategory, deleteCategory, saveMenuCategory } from "@/server/staff/menu-manager";
import { resetTestDb } from "./setup-db";

// Menu library in the console: picked dishes land in their own category with the owner's prices.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let owner: StaffSession;
let manager: StaffSession;
const id = (name: string) => searchLibraryItems(name)[0].id;

beforeAll(async () => {
  env = await resetTestDb();
  owner = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000001", pin: "1111" })).token))!;
  manager = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000002", pin: "2222" })).token))!;
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("menu library", () => {
  it("marks what the restaurant already serves", async () => {
    const res = await searchLibrary(owner, "paneer tikka");
    expect(res.items[0]).toMatchObject({ nameEn: "Paneer Tikka", onMenu: true });
    expect((await browseLibrary(owner)).find((c) => c.key === "pizza")?.onMenu).toBe(false);
  });

  it("adds dishes into their own category, creating it once, with sizes from the smallest price", async () => {
    const res = await addLibraryDishes(owner, [
      { id: id("margherita"), pricePaise: 0, sizes: [{ name: "Regular", pricePaise: 19900 }, { name: "Medium", pricePaise: 29900 }, { name: "Large", pricePaise: 39900 }] },
      { id: id("farmhouse pizza"), pricePaise: 24900 },
      { id: id("masala dosa"), pricePaise: 12000 },
    ]);
    expect(res).toEqual({ added: 3, skipped: [] });

    const cats = await env.db.select().from(s.menuCategories).where(and(eq(s.menuCategories.tenantId, owner.tenantId), eq(s.menuCategories.nameEn, "Pizza")));
    expect(cats).toHaveLength(1);
    const [pizza] = await env.db.select().from(s.menuItems).where(and(eq(s.menuItems.tenantId, owner.tenantId), eq(s.menuItems.nameEn, "Margherita Pizza")));
    expect(pizza).toMatchObject({ categoryId: cats[0].id, pricePaise: 19900, isVeg: true, station: "Pizza", nameHi: "मार्गरीटा पिज़्ज़ा" });
    const [group] = await env.db.select().from(s.modifierGroups).where(eq(s.modifierGroups.itemId, pizza.id));
    expect(group).toMatchObject({ nameEn: "Size", minSelect: 1, maxSelect: 1 });
    const sizes = await env.db.select().from(s.modifiers).where(eq(s.modifiers.groupId, group.id));
    expect(sizes.map((m) => [m.nameEn, m.priceDeltaPaise]).sort()).toEqual([["Large", 20000], ["Medium", 10000], ["Regular", 0]]);
    const [farm] = await env.db.select().from(s.menuItems).where(and(eq(s.menuItems.tenantId, owner.tenantId), eq(s.menuItems.nameEn, "Farmhouse Pizza")));
    expect(farm.categoryId).toBe(cats[0].id);
  });

  it("never adds a dish twice, reuses an existing category, and needs the owner and a price", async () => {
    expect(await addLibraryDishes(owner, [{ id: id("margherita"), pricePaise: 25000 }])).toEqual({ added: 0, skipped: ["Margherita Pizza"] });
    const first = await ensureLibraryCategory(owner, "pizza");
    expect(await ensureLibraryCategory(owner, "pizza")).toBe(first);
    expect((await libraryCategoryDetail(owner, "pizza")).items.find((i) => i.nameEn === "Margherita Pizza")?.onMenu).toBe(true);

    const managerTry = await addLibraryDishes(manager, [{ id: id("garlic bread"), pricePaise: 9900 }]).then(() => null, (e: unknown) => e);
    expect((managerTry as AppError).code).toBe("forbidden");
    const noPrice = await addLibraryDishes(owner, [{ id: id("garlic bread"), pricePaise: 0 }]).then(() => null, (e: unknown) => e);
    expect((noPrice as AppError).details?.reason).toBe("price");
  });

  it("hides a category with its dishes, and deletes only an empty one", async () => {
    const pizzaId = await ensureLibraryCategory(owner, "pizza");
    const blocked = await archiveCategory(owner, pizzaId).then(() => null, (e: unknown) => e);
    expect((blocked as AppError).details?.reason).toBe("has_dishes");
    await archiveCategory(owner, pizzaId, false, true);
    const pizzas = await env.db.select().from(s.menuItems).where(and(eq(s.menuItems.tenantId, owner.tenantId), eq(s.menuItems.categoryId, pizzaId)));
    expect(pizzas.length).toBeGreaterThan(0);
    expect(pizzas.every((p) => !p.isActive)).toBe(true);
    // Hidden dishes still belong to it, so it cannot be deleted
    expect(((await deleteCategory(owner, pizzaId).then(() => null, (e: unknown) => e)) as AppError).details?.reason).toBe("has_dishes");

    const emptyId = (await saveMenuCategory(owner, { nameEn: "Empty Test Category" }))!;
    await deleteCategory(owner, emptyId);
    expect(await env.db.select().from(s.menuCategories).where(eq(s.menuCategories.id, emptyId))).toEqual([]);
  });
});
