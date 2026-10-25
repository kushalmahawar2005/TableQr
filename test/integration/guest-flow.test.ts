import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { nextInvoiceNumber } from "@/server/billing/invoice-number";
import { AppError } from "@/server/errors";
import { addCartLine, getCart } from "@/server/guest/cart";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { getGuestMenu } from "@/server/guest/menu";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { getTableLanding } from "@/server/guest/table";
import { attachVerifiedTestGuest, resetTestDb } from "./setup-db";

let env: Awaited<ReturnType<typeof resetTestDb>>;

beforeAll(async () => {
  env = await resetTestDb();
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

/** Asserts that a promise fails with a specific AppError code and returns the error */
async function failsWith(p: Promise<unknown>, code: AppError["code"]) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  return err as AppError;
}

/** Seats a new device at a table and returns its guest context */
async function seat(tableCode: string, deviceId: string, displayName?: string): Promise<GuestContext> {
  const qr = env.demo.tableQr[tableCode];
  const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId, displayName });
  const ctx = await getGuestContext("SRJ01", qr, participantId, deviceId);
  return attachVerifiedTestGuest(appDb, ctx, displayName ?? "Guest");
}

const setOverride = (itemName: string, set: Partial<typeof s.outletItemOverrides.$inferInsert>) =>
  env.db
    .update(s.outletItemOverrides)
    .set(set)
    .where(and(eq(s.outletItemOverrides.outletId, env.demo.outletId), eq(s.outletItemOverrides.itemId, env.demo.itemIds[itemName])));

describe("table landing (G1)", () => {
  it("offers Start ordering on a free table, with what the page needs to show", async () => {
    const res = await getTableLanding("SRJ01", "k7Qm", null);
    expect(res.table).toMatchObject({ code: "T12", maxSeats: 4, zone: "Indoor", state: "available" });
    expect(res.outlet).toMatchObject({
      name: "Spice Route",
      city: "Jaipur",
      logoUrl: null,
      accentColor: "#E4572E",
      sessionMode: "open",
      isOpen: true,
      poweredBy: false, // Pro plan
    });
    expect(res.landing).toEqual({ kind: "start" });
  });

  it("shows the lower-plan powered-by line", async () => {
    expect((await getTableLanding("CNJ01", env.other.tableQr, null)).outlet.poweredBy).toBe(true);
  });

  it("rejects unknown codes but shows revoked codes with the restaurant's name", async () => {
    await failsWith(getTableLanding("SRJ01", "zzzz", null), "not_found");
    await failsWith(getTableLanding("NOPE1", "k7Qm", null), "not_found");
    await env.db.update(s.qrCodes).set({ revokedAt: new Date() }).where(eq(s.qrCodes.shortCode, env.demo.tableQr.T1));
    const revoked = await getTableLanding("SRJ01", env.demo.tableQr.T1, null);
    expect(revoked.landing).toEqual({ kind: "revoked" });
    expect(revoked.outlet.name).toBe("Spice Route");
    await failsWith(startOrJoinTable({ outletCode: "SRJ01", shortCode: env.demo.tableQr.T1, deviceId: "dev-x" }), "qr_revoked");
    await env.db.update(s.qrCodes).set({ revokedAt: null }).where(eq(s.qrCodes.shortCode, env.demo.tableQr.T1));
  });

  it("blocks guests of a suspended restaurant", async () => {
    await env.db.update(s.tenants).set({ status: "suspended" }).where(eq(s.tenants.id, env.other.tenantId));
    expect((await getTableLanding("CNJ01", env.other.tableQr, null)).landing).toEqual({ kind: "unavailable" });
    await failsWith(startOrJoinTable({ outletCode: "CNJ01", shortCode: env.other.tableQr, deviceId: "dev-x" }), "outlet_unavailable");
    await env.db.update(s.tenants).set({ status: "active" }).where(eq(s.tenants.id, env.other.tenantId));
  });

  it("shows a prepared-table message while the table needs cleaning", async () => {
    await env.db.update(s.diningTables).set({ state: "needs_cleaning" }).where(eq(s.diningTables.id, env.demo.tableIds.T7));
    expect((await getTableLanding("SRJ01", env.demo.tableQr.T7, null)).landing).toEqual({ kind: "preparing" });
    await failsWith(startOrJoinTable({ outletCode: "SRJ01", shortCode: env.demo.tableQr.T7, deviceId: "dev-x" }), "table_not_open");
    await env.db.update(s.diningTables).set({ state: "available" }).where(eq(s.diningTables.id, env.demo.tableIds.T7));
  });

  it("in Host-confirmed mode waits for staff, then asks for the table code", async () => {
    await env.db.update(s.outlets).set({ sessionMode: "host_confirmed" }).where(eq(s.outlets.id, env.demo.outletId));
    const qr = env.demo.tableQr.T7;
    expect((await getTableLanding("SRJ01", qr, null)).landing).toEqual({ kind: "awaiting_staff" });
    await env.db.update(s.diningTables).set({ state: "seated" }).where(eq(s.diningTables.id, env.demo.tableIds.T7));
    expect((await getTableLanding("SRJ01", qr, null)).landing).toEqual({ kind: "code_required" });
    await env.db.update(s.diningTables).set({ state: "available" }).where(eq(s.diningTables.id, env.demo.tableIds.T7));
    await env.db.update(s.outlets).set({ sessionMode: "open" }).where(eq(s.outlets.id, env.demo.outletId));
  });

  it("says when the outlet closes and next opens", async () => {
    const hours = { sat: [["12:00", "23:30"]], mon: [["12:00", "23:30"]] } as Record<string, [string, string][]>;
    const [before] = await env.db.select({ h: s.outlets.openingHours }).from(s.outlets).where(eq(s.outlets.id, env.demo.outletId));
    expect((await getTableLanding("SRJ01", "k7Qm", null)).outlet.closesAt).toBeNull(); // open all day
    await env.db.update(s.outlets).set({ openingHours: hours }).where(eq(s.outlets.id, env.demo.outletId));
    const open = await getTableLanding("SRJ01", "k7Qm", null, new Date("2026-10-03T14:30:00Z")); // Sat 20:00 IST
    expect(open.outlet).toMatchObject({ isOpen: true, closesAt: "23:30" });
    const closed = await getTableLanding("SRJ01", "k7Qm", null, new Date("2026-10-03T18:15:00Z")); // Sat 23:45 IST
    expect(closed.landing).toEqual({ kind: "closed" });
    expect(closed.outlet.nextOpen).toEqual({ day: "mon", time: "12:00", inDays: 2 });
    await env.db.update(s.outlets).set({ openingHours: before.h }).where(eq(s.outlets.id, env.demo.outletId));
  });
});

describe("table session", () => {
  it("first scan opens the session and becomes host; friends join the same session", async () => {
    const aarav = await startOrJoinTable({ outletCode: "SRJ01", shortCode: "k7Qm", deviceId: "dev-aarav", displayName: "Aarav" });
    expect(aarav).toMatchObject({ isHost: true, isNew: true });

    const again = await startOrJoinTable({ outletCode: "SRJ01", shortCode: "k7Qm", deviceId: "dev-aarav" });
    expect(again.participantId).toBe(aarav.participantId);

    const bhavna = await startOrJoinTable({ outletCode: "SRJ01", shortCode: "k7Qm", deviceId: "dev-bhavna", displayName: "Bhavna" });
    expect(bhavna).toMatchObject({ sessionId: aarav.sessionId, isHost: false, isNew: false });

    const [table] = await env.db.select().from(s.diningTables).where(eq(s.diningTables.id, env.demo.tableIds.T12));
    expect(table.state).toBe("seated");

    const landing = await getTableLanding("SRJ01", "k7Qm", "dev-chirag");
    expect(landing.landing).toEqual({ kind: "join", count: 2, names: ["Aarav", "Bhavna"], hostName: "Aarav" });
    expect((await getTableLanding("SRJ01", "k7Qm", "dev-bhavna")).landing).toEqual({ kind: "rejoin", participantId: bhavna.participantId });
  });

  it("shows only a head count until everyone at the table has given a real name", async () => {
    const qr = env.demo.tableQr.T5;
    // The host has a real name, a later guest does not: no names at all, not even the host's
    await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: "dev-n1", displayName: "Divya" });
    await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: "dev-n2" });
    expect((await getTableLanding("SRJ01", qr, "dev-n3")).landing).toEqual({ kind: "join", count: 2, names: null, hostName: null });
  });

  it("opens exactly one session when several phones scan a free table at once", async () => {
    const qr = env.demo.tableQr.T3;
    const results = await Promise.all(
      ["d1", "d2", "d3", "d4", "d5"].map((deviceId) => startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId })),
    );
    expect(new Set(results.map((r) => r.sessionId)).size).toBe(1);
    expect(results.filter((r) => r.isHost)).toHaveLength(1);
    const sessions = await env.db.select().from(s.tableSessions).where(eq(s.tableSessions.tableId, env.demo.tableIds.T3));
    expect(sessions).toHaveLength(1);
  });
});

/** 20:00 in Jaipur */
const EVENING = new Date("2026-10-01T14:30:00Z");

describe("menu (G3)", () => {
  it("shows outlet prices, sold-out items greyed, options and portion counters", async () => {
    const menu = await getGuestMenu({
      tenantId: env.demo.tenantId,
      brandId: env.demo.brandId,
      outletId: env.demo.outletId,
      timezone: "Asia/Kolkata",
      soldOutDisplay: "grey",
    }, EVENING);
    // Breakfast (08:00–11:30) is outside its hours in the evening
    expect(menu.map((c) => c.nameEn)).toEqual(["Starters", "Mains", "Breads", "Rice", "Desserts", "Drinks"]);
    const items = menu.flatMap((c) => c.items);
    expect(items).toHaveLength(25);
    expect(items.find((i) => i.nameEn === "Mutton Curry")?.isAvailable).toBe(false);
    const bc = items.find((i) => i.nameEn === "Butter Chicken")!;
    expect(bc).toMatchObject({ pricePaise: 38000, portionsLeft: 12, isVeg: false, nameHi: "बटर चिकन" });
    expect(bc.groups.map((g) => [g.nameEn, g.minSelect, g.modifiers.length])).toEqual([
      ["Choose bread", 1, 3],
      ["Add-ons", 0, 1],
    ]);
  });

  it("hides sold-out items when the outlet chooses to", async () => {
    const menu = await getGuestMenu({
      tenantId: env.demo.tenantId,
      brandId: env.demo.brandId,
      outletId: env.demo.outletId,
      timezone: "Asia/Kolkata",
      soldOutDisplay: "hide",
    });
    expect(menu.flatMap((c) => c.items).some((i) => i.nameEn === "Mutton Curry")).toBe(false);
  });
});

describe("cart and place order (G4, G5)", () => {
  let aarav: GuestContext;
  let bhavna: GuestContext;

  beforeAll(async () => {
    aarav = await seat("T4", "t4-aarav", "Aarav");
    bhavna = await seat("T4", "t4-bhavna", "Bhavna");
  });

  it("requires the bread choice and prices Butter Chicken with naan at INR 440", async () => {
    const err = await failsWith(addCartLine(aarav, { itemId: env.demo.itemIds["Butter Chicken"], qty: 1 }), "invalid_line");
    expect(err.message).toBe("Choose one option for Choose bread.");

    const line = await addCartLine(aarav, {
      itemId: env.demo.itemIds["Butter Chicken"],
      qty: 1,
      modifierIds: [env.demo.modifierIds.butterNaan],
      note: "  less spicy  ",
    });
    expect(line.unitPricePaise).toBe(44000);
  });

  it("shares an item only with people at the table", async () => {
    await addCartLine(aarav, { itemId: env.demo.itemIds["Paneer Tikka"], qty: 1, sharedWith: [aarav.participantId, bhavna.participantId] });
    await failsWith(
      addCartLine(aarav, { itemId: env.demo.itemIds["Paneer Tikka"], qty: 1, sharedWith: [aarav.participantId, "someone-else"] }),
      "invalid_line",
    );
    const cart = await getCart(aarav);
    expect(cart.mine.map((l) => l.nameEn)).toEqual(["Butter Chicken", "Paneer Tikka"]);
    expect(cart.mine[0]).toMatchObject({ note: "less spicy", modifiers: [{ nameEn: "Butter naan", nameHi: "बटर नान" }] });
    expect(cart.mySubtotalPaise).toBe(44000 + 32000);
  });

  it("refuses sold-out dishes", async () => {
    await failsWith(addCartLine(aarav, { itemId: env.demo.itemIds["Mutton Curry"], qty: 1 }), "items_unavailable");
  });

  it("places round 1: snapshots prices, one ticket per station, empties the cart, counts down portions", async () => {
    const res = await placeOrder(aarav, { note: "Birthday table" });
    expect(res).toMatchObject({ roundNo: 1, subtotalPaise: 76000, itemCount: 2 });
    expect(res.stations.sort()).toEqual(["Main", "Tandoor"]);
    // The whole-order note from the cart reaches the order, where the kitchen display reads it
    const [order] = await env.db.select({ note: s.orders.note }).from(s.orders).where(eq(s.orders.id, res.orderId));
    expect(order.note).toBe("Birthday table");

    const lines = await env.db.select().from(s.orderLines).where(eq(s.orderLines.orderId, res.orderId));
    const bc = lines.find((l) => l.nameEn === "Butter Chicken")!;
    expect(bc).toMatchObject({ unitPricePaise: 44000, taxRateBp: 500, station: "Main", status: "placed", participantId: aarav.participantId });
    expect(bc.modifiers).toEqual([{ nameEn: "Butter naan", nameHi: "बटर नान", priceDeltaPaise: 6000 }]);
    expect(lines.find((l) => l.nameEn === "Paneer Tikka")!.sharedWith).toEqual([aarav.participantId, bhavna.participantId]);

    const tickets = await env.db.select().from(s.tickets).where(eq(s.tickets.orderId, res.orderId));
    expect(tickets.map((t) => t.station).sort()).toEqual(["Main", "Tandoor"]);

    expect((await getCart(aarav)).mine).toHaveLength(0);
    const [bcOverride] = await env.db.select().from(s.outletItemOverrides).where(eq(s.outletItemOverrides.itemId, env.demo.itemIds["Butter Chicken"]));
    expect(bcOverride.portionsLeft).toBe(11);
  });

  it("numbers later rounds and never edits an old order when the menu price changes", async () => {
    await addCartLine(bhavna, { itemId: env.demo.itemIds["Dal Makhani"], qty: 2 });
    await env.db.update(s.menuItems).set({ pricePaise: 29000 }).where(eq(s.menuItems.id, env.demo.itemIds["Dal Makhani"]));
    const res = await placeOrder(bhavna);
    expect(res).toMatchObject({ roundNo: 2, subtotalPaise: 58000 });

    await env.db.update(s.menuItems).set({ pricePaise: 26000 }).where(eq(s.menuItems.id, env.demo.itemIds["Dal Makhani"]));
    const [line] = await env.db.select().from(s.orderLines).where(eq(s.orderLines.orderId, res.orderId));
    expect(line.unitPricePaise).toBe(29000);
  });

  it("refuses an empty cart", async () => {
    await failsWith(placeOrder(bhavna), "cart_empty");
  });

  it("stops orders that would take more portions than are left", async () => {
    await setOverride("Butter Chicken", { portionsLeft: 1 });
    await addCartLine(bhavna, { itemId: env.demo.itemIds["Butter Chicken"], qty: 2, modifierIds: [env.demo.modifierIds.noBread] });
    const err = await failsWith(placeOrder(bhavna), "items_unavailable");
    expect((err.details?.cartLineIds as string[]).length).toBe(1);
    await setOverride("Butter Chicken", { portionsLeft: 12 });
  });

  it("respects the host's ordering lock", async () => {
    await env.db.update(s.tableSessions).set({ orderingLocked: true }).where(eq(s.tableSessions.id, aarav.sessionId));
    const err = await failsWith(placeOrder(bhavna), "ordering_locked");
    expect(err.message).toBe("Ordering paused by Aarav.");
    await env.db.update(s.tableSessions).set({ orderingLocked: false }).where(eq(s.tableSessions.id, aarav.sessionId));
  });

  it("asks staff to confirm a large first order on a fresh table in Open mode", async () => {
    const guest = await seat("T5", "t5-guest", "Esha");
    await env.db.update(s.outlets).set({ newSessionCapPaise: 50000 }).where(eq(s.outlets.id, env.demo.outletId));
    await addCartLine(guest, { itemId: env.demo.itemIds["Chicken Chettinad"], qty: 2 });
    await failsWith(placeOrder(guest), "needs_staff_confirmation");
    await env.db.update(s.outlets).set({ newSessionCapPaise: 300000 }).where(eq(s.outlets.id, env.demo.outletId));
  });
});

describe("concurrent orders", () => {
  it("gives two phones at one table different round numbers", async () => {
    const a = await seat("T8", "t8-a", "Farah");
    const b = await seat("T8", "t8-b", "Gita");
    await addCartLine(a, { itemId: env.demo.itemIds["Cola"], qty: 1 });
    await addCartLine(b, { itemId: env.demo.itemIds["Masala Lassi"], qty: 1 });
    const results = await Promise.all([placeOrder(a), placeOrder(b)]);
    expect(results.map((r) => r.roundNo).sort()).toEqual([1, 2]);
  });

  it("sells the last plate to exactly one table", async () => {
    await setOverride("Butter Chicken", { portionsLeft: 1 });
    const x = await seat("T9", "t9-x", "Hari");
    const y = await seat("T10", "t10-y", "Ishaan");
    const bc = { itemId: env.demo.itemIds["Butter Chicken"], qty: 1, modifierIds: [env.demo.modifierIds.noBread] };
    await addCartLine(x, bc);
    await addCartLine(y, bc);
    const outcomes = await Promise.allSettled([placeOrder(x), placeOrder(y)]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as AppError).code).toBe("items_unavailable");
    const [o] = await env.db.select().from(s.outletItemOverrides).where(eq(s.outletItemOverrides.itemId, env.demo.itemIds["Butter Chicken"]));
    expect(o.portionsLeft).toBe(0);
    await setOverride("Butter Chicken", { portionsLeft: 12 });
  });
});

describe("tenant isolation", () => {
  it("never lets a participant from one restaurant act at another", async () => {
    const nukkadDevice = "nk-device";
    const nk = await startOrJoinTable({ outletCode: "CNJ01", shortCode: env.other.tableQr, deviceId: nukkadDevice });
    const sr = await seat("T6", "t6-guest");

    // Their own participant id and device, presented with the other restaurant's QR
    await failsWith(getGuestContext("SRJ01", env.demo.tableQr.T6, nk.participantId, nukkadDevice), "session_expired");
    await failsWith(getGuestContext("CNJ01", env.other.tableQr, sr.participantId, "t6-guest"), "session_expired");
    // Right table, wrong device
    await failsWith(getGuestContext("SRJ01", env.demo.tableQr.T6, sr.participantId, "stolen-cookie"), "session_expired");

    // Another restaurant's dish id cannot be ordered here
    const err = await failsWith(addCartLine(sr, { itemId: env.other.itemId, qty: 1 }), "invalid_line");
    expect(err.message).toBe("This dish is not on the menu.");
  });

  it("is enforced by the database even if application code gets it wrong", async () => {
    const sr = await seat("T2", "t2-guest");
    const fkError = async (p: Promise<unknown>) => {
      const e = await p.then(() => null, (x: { cause?: { code?: string } }) => x);
      expect(e?.cause?.code).toBe("ER_NO_REFERENCED_ROW_2");
    };

    // A Spice Route cart line pointing at Cafe Nukkad's dish
    await fkError(
      env.db.insert(s.cartLines).values({
        tenantId: sr.tenantId,
        sessionId: sr.sessionId,
        participantId: sr.participantId,
        itemId: env.other.itemId,
        qty: 1,
      }),
    );
    // The same row claiming to belong to Cafe Nukkad cannot point at Spice Route's session either
    await fkError(
      env.db.insert(s.cartLines).values({
        tenantId: env.other.tenantId,
        sessionId: sr.sessionId,
        participantId: sr.participantId,
        itemId: env.other.itemId,
        qty: 1,
      }),
    );
    // A Spice Route QR code that opens a Cafe Nukkad table
    await fkError(
      env.db.insert(s.qrCodes).values({ tenantId: sr.tenantId, outletId: sr.outletId, tableId: env.other.tableId, type: "table", shortCode: "evil" }),
    );
    // Moving an existing Spice Route session onto another restaurant's table
    await fkError(env.db.update(s.tableSessions).set({ tableId: env.other.tableId }).where(eq(s.tableSessions.id, sr.sessionId)));
  });
});

describe("invoice numbering", () => {
  const outlet = () => ({ tenantId: env.demo.tenantId, id: env.demo.outletId, code: "SRJ01", timezone: "Asia/Kolkata" });
  const oct = new Date("2026-10-01T10:00:00Z");

  it("counts up per outlet per financial year in the spec format", async () => {
    const a = await appDb.transaction((tx) => nextInvoiceNumber(tx, outlet(), oct));
    const b = await appDb.transaction((tx) => nextInvoiceNumber(tx, outlet(), oct));
    expect([a.number, b.number]).toEqual(["SRJ01/26/000001", "SRJ01/26/000002"]);
    const nextYear = await appDb.transaction((tx) => nextInvoiceNumber(tx, outlet(), new Date("2027-04-01T10:00:00Z")));
    expect(nextYear.number).toBe("SRJ01/27/000001");
  });

  it("gives the number back when the invoice transaction fails, so the series has no gaps", async () => {
    await appDb
      .transaction(async (tx) => {
        await nextInvoiceNumber(tx, outlet(), oct);
        throw new Error("payment write failed");
      })
      .catch(() => {});
    const next = await appDb.transaction((tx) => nextInvoiceNumber(tx, outlet(), oct));
    expect(next.seq).toBe(3);
  });

  it("hands out distinct consecutive numbers under concurrency", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => appDb.transaction((tx) => nextInvoiceNumber(tx, outlet(), oct))),
    );
    expect(results.map((r) => r.seq).sort((x, y) => x - y)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
  });
});
