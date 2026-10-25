import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { addCartLine, getCart } from "@/server/guest/cart";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { placeOrder, placeOrderInTransaction } from "@/server/guest/order";
import { LOCK_THEN_READ } from "@/server/db-types";
import { startOrJoinTable } from "@/server/guest/session";
import { onPublish } from "@/server/realtime/publish";
import { attachVerifiedTestGuest, resetTestDb } from "./setup-db";

// Phase 3A: once an order is confirmed to the guest it is saved and recoverable, a retry never
// makes a second one, and a failure part-way leaves nothing behind.

let env: Awaited<ReturnType<typeof resetTestDb>>;

beforeAll(async () => {
  env = await resetTestDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

async function seat(outletCode: string, shortCode: string, deviceId: string, name = "Guest"): Promise<GuestContext> {
  const { participantId } = await startOrJoinTable({ outletCode, shortCode, deviceId, displayName: name });
  const ctx = await getGuestContext(outletCode, shortCode, participantId, deviceId);
  return attachVerifiedTestGuest(appDb, ctx, name);
}
const seatDemo = (table: string, deviceId: string) => seat("SRJ01", env.demo.tableQr[table], deviceId);
const cola = () => ({ itemId: env.demo.itemIds["Cola"], qty: 1 });
const rid = () => `req-${Math.random().toString(36).slice(2, 12)}`;
const ordersOf = (sessionId: string) => env.db.select().from(s.orders).where(eq(s.orders.sessionId, sessionId));
const rejects = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

describe("the same Place-order tap arriving many times", () => {
  it("makes exactly one order out of 20 simultaneous requests with one request id", async () => {
    const g = await seatDemo("T1", "p3-dup");
    await addCartLine(g, cola());
    await addCartLine(g, { itemId: env.demo.itemIds["Masala Lassi"], qty: 2 });
    const requestId = rid();
    const results = await Promise.all(Array.from({ length: 20 }, () => placeOrder(g, { requestId })));

    expect(new Set(results.map((r) => r.orderId)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    const orders = await ordersOf(g.sessionId);
    expect(orders).toHaveLength(1);
    const lines = await env.db.select().from(s.orderLines).where(eq(s.orderLines.orderId, orders[0].id));
    expect(lines.map((l) => l.qty).sort()).toEqual([1, 2]);
    const tickets = await env.db.select().from(s.tickets).where(eq(s.tickets.orderId, orders[0].id));
    expect(new Set(tickets.map((t) => t.station)).size).toBe(tickets.length);
    expect((await getCart(g)).mine).toHaveLength(0);
  });

  it("answers a retry after a timeout with the saved order and does not tell the kitchen twice", async () => {
    const g = await seatDemo("T2", "p3-retry");
    await addCartLine(g, cola());
    const requestId = rid();
    const sent: string[] = [];
    const off = onPublish((_, events) => events.forEach((e) => sent.push(e.type)));
    const first = await placeOrder(g, { requestId });
    const afterFirst = sent.filter((t) => t === "ticket.created").length;
    // The phone never saw the answer, so it asks again with the same id
    const again = await placeOrder(g, { requestId });
    off();
    expect(again).toMatchObject({ orderId: first.orderId, replayed: true });
    expect(afterFirst).toBe(1);
    expect(sent.filter((t) => t === "ticket.created")).toHaveLength(1);
    expect(await ordersOf(g.sessionId)).toHaveLength(1);
  });

  it("gives different request ids different rounds, never a duplicate round", async () => {
    const g = await seatDemo("T3", "p3-rounds");
    const placed = [];
    for (let i = 0; i < 3; i++) {
      await addCartLine(g, cola());
      placed.push(await placeOrder(g, { requestId: rid() }));
    }
    expect(placed.map((p) => p.roundNo)).toEqual([1, 2, 3]);
  });
});

describe("a failure while the order is being saved", () => {
  it("leaves no order, no lines, no ticket and an untouched cart and portion counter, and the retry works", async () => {
    await env.db.update(s.outletItemOverrides).set({ portionsLeft: 5 }).where(and(eq(s.outletItemOverrides.outletId, env.demo.outletId), eq(s.outletItemOverrides.itemId, env.demo.itemIds["Butter Chicken"])));
    const g = await seatDemo("T4", "p3-fail");
    await addCartLine(g, { itemId: env.demo.itemIds["Butter Chicken"], qty: 2, modifierIds: [env.demo.modifierIds.noBread] });
    const requestId = rid();

    // The database connection dies after every write of the order but before the commit, as when
    // MySQL restarts or the server process is killed mid-request: nothing may be left behind
    const crashed = await rejects(appDb.transaction(async (tx) => {
      const placed = await placeOrderInTransaction(tx, g, { requestId }, new Date());
      expect(placed.orderId).toBeTruthy();
      await tx.execute(sql`KILL CONNECTION_ID()`);
    }, LOCK_THEN_READ));
    expect(crashed).toBeTruthy();
    expect(await ordersOf(g.sessionId)).toHaveLength(0);
    expect(await env.db.select().from(s.orderLines).where(eq(s.orderLines.sessionId, g.sessionId))).toHaveLength(0);
    expect((await getCart(g)).mine).toHaveLength(1);
    const [portions] = await env.db.select({ left: s.outletItemOverrides.portionsLeft }).from(s.outletItemOverrides).where(and(eq(s.outletItemOverrides.outletId, env.demo.outletId), eq(s.outletItemOverrides.itemId, env.demo.itemIds["Butter Chicken"])));
    expect(portions.left).toBe(5);

    const retried = await placeOrder(g, { requestId });
    expect(retried).toMatchObject({ roundNo: 1 });
    expect((retried as { replayed?: boolean }).replayed).toBeFalsy();
    expect(await ordersOf(g.sessionId)).toHaveLength(1);
    const [after] = await env.db.select({ left: s.outletItemOverrides.portionsLeft }).from(s.outletItemOverrides).where(and(eq(s.outletItemOverrides.outletId, env.demo.outletId), eq(s.outletItemOverrides.itemId, env.demo.itemIds["Butter Chicken"])));
    expect(after.left).toBe(3);
    await env.db.update(s.outletItemOverrides).set({ portionsLeft: 12 }).where(and(eq(s.outletItemOverrides.outletId, env.demo.outletId), eq(s.outletItemOverrides.itemId, env.demo.itemIds["Butter Chicken"])));
  });
});

describe("the kitchen not hearing about an order", () => {
  it("never loses the order: realtime down or refusing still leaves it saved with its ticket", async () => {
    vi.stubEnv("REALTIME_URL", "https://realtime.invalid");
    vi.stubEnv("REALTIME_PUBLISH_SECRET", "x".repeat(32));
    const g = await seatDemo("T5", "p3-rt-down");
    await addCartLine(g, cola());
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));
    const placed = await placeOrder(g, { requestId: rid() });
    expect(placed.status).toMatch(/placed|accepted/);

    const h = await seatDemo("T6", "p3-rt-500");
    await addCartLine(h, cola());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 503 })));
    const placed2 = await placeOrder(h, { requestId: rid() });

    for (const [sessionId, orderId] of [[g.sessionId, placed.orderId], [h.sessionId, placed2.orderId]] as const) {
      expect(await ordersOf(sessionId)).toHaveLength(1);
      expect(await env.db.select().from(s.tickets).where(eq(s.tickets.orderId, orderId))).not.toHaveLength(0);
    }
  });
});

describe("many tables and restaurants ordering at once", () => {
  it("saves every table's order once, with its own round and ticket", async () => {
    const tables = ["T7", "T8", "T9", "T10", "T11", "T12"];
    const guests = await Promise.all(tables.map((t, i) => seatDemo(t, `p3-multi-${i}`)));
    await Promise.all(guests.map((g) => addCartLine(g, cola())));
    const results = await Promise.all(guests.map((g) => placeOrder(g, { requestId: rid() })));
    expect(new Set(results.map((r) => r.orderId)).size).toBe(tables.length);
    for (const g of guests) {
      const orders = await ordersOf(g.sessionId);
      expect(orders).toHaveLength(1);
      expect(orders[0]).toMatchObject({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, roundNo: 1 });
    }
  });

  it("keeps two restaurants' orders apart when they order in the same instant", async () => {
    const mine = await Promise.all(["T13", "T14"].map((t, i) => (env.demo.tableQr[t] ? seatDemo(t, `p3-mix-${i}`) : seatDemo("T1", `p3-mix-x${i}`))));
    const other = await seat("CNJ01", env.other.tableQr, "p3-other");
    await Promise.all([...mine.map((g) => addCartLine(g, cola())), addCartLine(other, { itemId: env.other.itemId, qty: 1 })]);
    const results = await Promise.all([...mine.map((g) => placeOrder(g, { requestId: rid() })), placeOrder(other, { requestId: rid() })]);
    const otherOrder = await ordersOf(other.sessionId);
    expect(otherOrder).toHaveLength(1);
    expect(otherOrder[0]).toMatchObject({ tenantId: env.other.tenantId, outletId: env.other.outletId });
    const lines = await env.db.select().from(s.orderLines).where(eq(s.orderLines.orderId, otherOrder[0].id));
    expect(lines.every((l) => l.tenantId === env.other.tenantId && l.itemId === env.other.itemId)).toBe(true);
    expect(results.map((r) => r.orderId).sort()).toEqual([...new Set(results.map((r) => r.orderId))].sort());
  });

  it("refuses a restaurant's guest an order from another restaurant's cart item", async () => {
    const g = await seatDemo("T1", "p3-cross-item");
    const before = (await ordersOf(g.sessionId)).length;
    await env.db.insert(s.cartLines).values({
      tenantId: g.tenantId, sessionId: g.sessionId, participantId: g.participantId, itemId: env.other.itemId, qty: 1,
    }).catch(() => undefined);
    const err = await rejects(placeOrder(g, { requestId: rid() }));
    expect(err).toBeTruthy();
    expect(await ordersOf(g.sessionId)).toHaveLength(before);
    expect(await env.db.select().from(s.orderLines).where(and(eq(s.orderLines.sessionId, g.sessionId), eq(s.orderLines.itemId, env.other.itemId)))).toHaveLength(0);
  });
});
