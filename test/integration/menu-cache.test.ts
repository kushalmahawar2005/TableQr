import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { clearMenuCache, getGuestMenu, loadItems } from "@/server/guest/menu";
import { resetTestDb } from "./setup-db";

// Guests browsing the menu share a few seconds of cached rows; anything that orders reads fresh.

let env: Awaited<ReturnType<typeof resetTestDb>>;
const EVENING = new Date("2026-10-01T14:30:00Z");
const ctx = () => ({ tenantId: env.demo.tenantId, brandId: env.demo.brandId, outletId: env.demo.outletId, timezone: "Asia/Kolkata", soldOutDisplay: "grey" as const });
const note = async () => (await getGuestMenu(ctx(), EVENING)).flatMap((c) => c.items).find((i) => i.nameEn === "Butter Chicken")!;

beforeAll(async () => { env = await resetTestDb(); });
afterAll(async () => { await env.conn.end(); await appDb.$client.end(); });

describe("menu browsing cache", () => {
  it("serves a menu change after the cache is cleared, and never to anything that orders", async () => {
    const before = await note();
    const set = (text: string) => env.db.update(s.menuItems).set({ descriptionEn: text }).where(eq(s.menuItems.id, before.id));

    await set("Changed once");
    // The same restaurant's menu again, moments later: shared rows, so still the old text
    expect((await note()).descriptionEn).toBe(before.descriptionEn);
    // The owner saving a change clears it
    clearMenuCache(env.demo.tenantId);
    expect((await note()).descriptionEn).toBe("Changed once");

    await set("Changed twice");
    // Adding to a cart or ordering loads the dish itself, fresh, with no waiting
    const [fresh] = await loadItems(appDb, ctx(), EVENING, [before.id]);
    expect(fresh.item.descriptionEn).toBe("Changed twice");
    expect((await note()).descriptionEn).toBe("Changed once");
  });

  it("applies the clock to cached rows, so a time-window category still hides outside its hours", async () => {
    clearMenuCache(env.demo.tenantId);
    const evening = (await getGuestMenu(ctx(), EVENING)).map((c) => c.nameEn);
    const morning = (await getGuestMenu(ctx(), new Date("2026-10-01T04:00:00Z"))).map((c) => c.nameEn); // 09:30 in Jaipur
    expect(evening).not.toContain("Breakfast");
    expect(morning).toContain("Breakfast");
  });

  it("keeps one restaurant's cache apart from another's", async () => {
    clearMenuCache("another-tenant");
    const mine = await getGuestMenu(ctx(), EVENING);
    expect(mine.length).toBeGreaterThan(0);
    const [theirs] = await env.db.select({ brandId: s.outlets.brandId }).from(s.outlets).where(eq(s.outlets.id, env.other.outletId));
    const other = await getGuestMenu({ ...ctx(), tenantId: env.other.tenantId, brandId: theirs.brandId, outletId: env.other.outletId }, EVENING);
    expect(other).not.toEqual(mine);
    // And mine is still mine, not theirs
    expect(await getGuestMenu(ctx(), EVENING)).toEqual(mine);
  });
});
