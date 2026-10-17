import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/server/errors";
import { db as appDb } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { getSalesDetail } from "@/server/staff/sales-detail";
import { resetTestDb } from "./setup-db";

// Items & staff report: every dish sold in the range, the ones that did not sell, and each
// person's sales, discounts and cancelled items, from this outlet only.

let env: Awaited<ReturnType<typeof resetTestDb>>;
const owner = () => ({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, roles: ["owner" as const] });
const at = new Date("2026-10-10T08:00:00Z");

beforeAll(async () => {
  env = await resetTestDb();
  const { tenantId, outletId, tableIds, itemIds, staffIds } = env.demo;
  const sessionId = uuidv7();
  const tableId = Object.values(tableIds)[0];
  await env.db.insert(s.tableSessions).values({ id: sessionId, tenantId, outletId, tableId, status: "closed", closedAt: at } as typeof s.tableSessions.$inferInsert);
  const line = (orderId: string, name: string, qty: number, price: number, extra: Partial<typeof s.orderLines.$inferInsert> = {}) => ({
    tenantId, orderId, sessionId, itemId: itemIds[name], nameEn: name, unitPricePaise: price, qty, taxRateBp: 500, station: "Main", status: "served" as const, ...extra,
  });
  const byWaiter = uuidv7();
  const byGuest = uuidv7();
  await env.db.insert(s.orders).values([
    { id: byWaiter, tenantId, outletId, sessionId, roundNo: 1, placedByUserId: staffIds.waiter, status: "served", placedAt: at },
    { id: byGuest, tenantId, outletId, sessionId, roundNo: 2, status: "served", placedAt: at },
  ]);
  await env.db.insert(s.orderLines).values([
    line(byWaiter, "Butter Chicken", 2, 40000),
    line(byWaiter, "Butter Chicken", 1, 40000, { status: "voided", voidedByUserId: staffIds.manager, voidReason: "Wrong order" }),
    line(byGuest, "Butter Chicken", 1, 40000),
  ]);
  const billId = uuidv7();
  await env.db.insert(s.bills).values({ id: billId, tenantId, outletId, sessionId, status: "paid", subtotalPaise: 120000, closedAt: at });
  await env.db.insert(s.discounts).values({ tenantId, billId, kind: "flat", value: 5000, amountPaise: 5000, reason: "Regular guest", appliedByUserId: staffIds.manager, createdAt: at });
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("items and staff report", () => {
  it("counts every dish, sales by who ordered, discounts and cancelled items", async () => {
    const r = await getSalesDetail(owner(), { from: "2026-10-10", to: "2026-10-10" }, new Date("2026-10-12T00:00:00Z"));
    expect(r.items.map((i) => [i.name, i.qty, i.grossPaise])).toEqual([["Butter Chicken", 3, 120000]]);
    expect(r.totals).toMatchObject({ qty: 3, dishes: 1 });
    expect(r.notSold.length).toBeGreaterThan(0);
    expect(r.notSold.some((n) => n.name === "Butter Chicken")).toBe(false);
    expect(r.staff.map((p) => [p.name, p.guests, p.qty])).toEqual([["Rahul Verma", false, 2], ["Guests (QR orders)", true, 1]]);
    expect(r.voids).toEqual([{ name: "Meera Joshi", lines: 1, qty: 1, grossPaise: 40000 }]);
    expect(r.discounts).toEqual([{ name: "Meera Joshi", count: 1, paise: 5000, reasons: "Regular guest" }]);
  });

  it("keeps the range sensible and shows nothing on other days or of another restaurant", async () => {
    const empty = await getSalesDetail(owner(), { from: "2026-10-11", to: "2026-10-11" }, new Date("2026-10-12T00:00:00Z"));
    expect(empty.items).toEqual([]);
    const flipped = await getSalesDetail(owner(), { from: "2026-10-30", to: "2026-10-10" }, new Date("2026-10-12T00:00:00Z"));
    expect([flipped.from, flipped.to]).toEqual(["2026-10-10", "2026-10-10"]);
    const otherOwner = { tenantId: env.other.tenantId, outletId: env.other.outletId, roles: ["owner" as const] };
    const range = { from: "2026-10-10", to: "2026-10-10" };
    // Lite has no full reports
    const locked = await getSalesDetail(otherOwner, range).then(() => null, (e: unknown) => e);
    expect((locked as AppError).code).toBe("forbidden");
    await env.db.update(s.tenants).set({ planCode: "pro" }).where(eq(s.tenants.id, env.other.tenantId));
    expect((await getSalesDetail(otherOwner, range, new Date("2026-10-12T00:00:00Z"))).items).toEqual([]);
  });
});
