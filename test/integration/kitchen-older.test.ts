import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { addCartLine } from "@/server/guest/cart";
import { getGuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { cancelOrderLine } from "@/server/guest/tracker";
import { acceptOrder, bumpTicket } from "@/server/kitchen/actions";
import { getKitchenDisplay, getOlderPendingTickets } from "@/server/kitchen/display";
import type { StaffContext } from "@/server/staff/context";
import { attachVerifiedTestGuest, resetTestDb } from "./setup-db";

// Open tickets older than the board's 24 hours stay reachable: listed page by page, only while still
// being cooked, never completed or removed because of their age.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let kitchen: StaffContext;
const ids: { done: string; cancelled: string; open: string[]; tandoor: string[] } = { done: "", cancelled: "", open: [], tandoor: [] };

async function visit(table: "T1" | "T2" | "T3", device: string) {
  const qr = env.demo.tableQr[table];
  const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: device, displayName: "Aarav" });
  return attachVerifiedTestGuest(appDb, await getGuestContext("SRJ01", qr, participantId, device), "Aarav");
}
const ticketsOf = async (orderId: string) => env.db.select().from(s.tickets).where(eq(s.tickets.orderId, orderId));

beforeAll(async () => {
  env = await resetTestDb();
  kitchen = { tenantId: env.demo.tenantId, outletId: env.demo.outletId, userId: null };

  // Table 1: 7 rounds, each a Main dish and a Tandoor dish, all left open
  const g1 = await visit("T1", "old-1");
  for (let i = 0; i < 7; i++) {
    await addCartLine(g1, { itemId: env.demo.itemIds["Dal Makhani"], qty: 1 });
    await addCartLine(g1, { itemId: env.demo.itemIds["Paneer Tikka"], qty: 1 });
    const { orderId } = await placeOrder(g1, {});
    for (const t of await ticketsOf(orderId)) { ids.open.push(t.id); if (t.station === "Tandoor") ids.tandoor.push(t.id); }
  }
  // Table 2: cooked and bumped, so its ticket is done
  const g2 = await visit("T2", "old-2");
  await addCartLine(g2, { itemId: env.demo.itemIds["Dal Makhani"], qty: 1 });
  const done = await placeOrder(g2, {});
  await acceptOrder(kitchen, done.orderId);
  const doneTicket = (await ticketsOf(done.orderId))[0];
  await bumpTicket(kitchen, doneTicket.id);
  ids.done = doneTicket.id;
  // Table 3: the guest cancels the only item before the kitchen accepts, which closes its ticket
  const g3 = await visit("T3", "old-3");
  await addCartLine(g3, { itemId: env.demo.itemIds["Dal Makhani"], qty: 1 });
  const cancelled = await placeOrder(g3, {});
  const [line] = await env.db.select().from(s.orderLines).where(eq(s.orderLines.orderId, cancelled.orderId));
  await cancelOrderLine(g3, line.id);
  ids.cancelled = (await ticketsOf(cancelled.orderId))[0].id;

  // Everything is now 30 hours old, each ticket a minute apart
  const all = await env.db.select().from(s.tickets).where(eq(s.tickets.tenantId, env.demo.tenantId));
  for (const [i, t] of all.entries()) {
    const at = new Date(Date.now() - 30 * 3_600_000 - i * 60_000);
    await env.db.update(s.tickets).set({ createdAt: at }).where(eq(s.tickets.id, t.id));
    await env.db.update(s.orders).set({ placedAt: at }).where(eq(s.orders.id, t.orderId));
  }
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("older pending tickets", () => {
  it("keeps the main board to the last day and counts only tickets still being cooked", async () => {
    const board = await getKitchenDisplay(kitchen, {}, new Date());
    expect(board.cards).toHaveLength(0);
    expect(board.counts).toEqual({ All: 0 });
    expect(board.staleOpen).toBe(14);
  });

  it("lists them page by page, newest first, with status, age, table and lines", async () => {
    const first = await getOlderPendingTickets(kitchen, { limit: 5 }, new Date());
    expect(first.cards).toHaveLength(5);
    expect(first.hasMore).toBe(true);
    expect(first.nextOffset).toBe(5);
    const card = first.cards[0];
    expect(card).toMatchObject({ tableCodes: ["T1"], stage: "placed", roundNo: expect.any(Number) });
    expect(card.elapsedMs).toBeGreaterThan(29 * 3_600_000);
    expect(card.lines.length).toBeGreaterThan(0);
    const placed = first.cards.map((c) => c.placedAt);
    expect(placed).toEqual([...placed].sort((a, b) => b - a));

    const second = await getOlderPendingTickets(kitchen, { limit: 5, offset: first.nextOffset }, new Date());
    const third = await getOlderPendingTickets(kitchen, { limit: 5, offset: second.nextOffset }, new Date());
    expect(second.hasMore).toBe(true);
    expect(third.hasMore).toBe(false);
    const seen = [...first.cards, ...second.cards, ...third.cards].map((c) => c.ticketId);
    expect(new Set(seen).size).toBe(14);
    expect([...seen].sort()).toEqual([...ids.open].sort());
  });

  it("leaves out completed and cancelled tickets", async () => {
    const all = (await getOlderPendingTickets(kitchen, { limit: 60 }, new Date())).cards.map((c) => c.ticketId);
    expect(all).not.toContain(ids.done);
    expect(all).not.toContain(ids.cancelled);
    const [done, cancelled] = await Promise.all([ids.done, ids.cancelled].map(async (id) => (await env.db.select().from(s.tickets).where(eq(s.tickets.id, id)))[0]));
    expect(done.status).toBe("done");
    expect(cancelled.status).toBe("done");
  });

  it("filters by station, and caps a page at 60", async () => {
    const tandoor = await getOlderPendingTickets(kitchen, { station: "Tandoor", limit: 60 }, new Date());
    expect(tandoor.cards.map((c) => c.ticketId).sort()).toEqual([...ids.tandoor].sort());
    expect(tandoor.cards.every((c) => c.station === "Tandoor")).toBe(true);
    expect((await getOlderPendingTickets(kitchen, { limit: 5000 }, new Date())).cards.length).toBeLessThanOrEqual(60);
  });

  it("never completes or removes anything because of age; only a kitchen action does", async () => {
    const before = await env.db.select({ id: s.tickets.id, status: s.tickets.status }).from(s.tickets).where(inArray(s.tickets.id, ids.open));
    await getKitchenDisplay(kitchen, {}, new Date());
    await getOlderPendingTickets(kitchen, {}, new Date());
    const after = await env.db.select({ id: s.tickets.id, status: s.tickets.status }).from(s.tickets).where(inArray(s.tickets.id, ids.open));
    expect(after).toEqual(before);
    expect(after.every((t) => t.status === "new")).toBe(true);

    // The board's own actions work on an old ticket, and it then leaves the older list
    const target = ids.tandoor[0];
    const orderId = (await env.db.select().from(s.tickets).where(eq(s.tickets.id, target)))[0].orderId;
    await acceptOrder(kitchen, orderId);
    expect(await bumpTicket(kitchen, target)).toBeTruthy();
    const list = (await getOlderPendingTickets(kitchen, { limit: 60 }, new Date())).cards.map((c) => c.ticketId);
    expect(list).not.toContain(target);
    expect((await getKitchenDisplay(kitchen, {}, new Date())).staleOpen).toBe(13);
  });
});
