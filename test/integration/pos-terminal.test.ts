import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { settleAtCounter } from "@/server/billing/payments";
import { startTakeaway } from "@/server/floor/takeaway";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { getSalesDetail } from "@/server/staff/sales-detail";
import { posOpenTable, posSendOrder, posTerminal, posTerminalRoles } from "@/server/staff/pos-terminal";
import { quoteKey } from "@/domain/pricing";
import { waiterRequestBill } from "@/server/staff/waiter-mutations";
import { resetTestDb } from "./setup-db";

// The POS terminal: a cashier opens a table or a takeaway, sends dishes and open items (typed in,
// not on the menu) to the kitchen, and the bill is paid as usual.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let cashier: StaffSession;
let accountant: StaffSession | null = null;
const signIn = async (phone: string, pin: string) => (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone, pin })).token))!;

beforeAll(async () => {
  env = await resetTestDb();
  cashier = await signIn("9000000003", "3333");
  const [acc] = await env.db.select({ userId: s.staffRoles.userId }).from(s.staffRoles).where(and(eq(s.staffRoles.tenantId, env.demo.tenantId), eq(s.staffRoles.role, "accountant")));
  if (acc) accountant = { ...cashier, userId: acc.userId, roles: ["accountant"] };
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("POS terminal", () => {
  it("shows the floor tables and the menu by category, and no takeaway counters or rooms as tables", async () => {
    const t = await posTerminal(cashier);
    expect(t.tables.map((x) => x.code)).toContain("T1");
    expect(t.tables.every((x) => !x.code.startsWith("TA-"))).toBe(true);
    expect(t.menu.length).toBeGreaterThan(0);
    expect(t.categories.length).toBeGreaterThan(0);
    expect(t.menu.every((m) => t.categories.some((c) => c.id === m.categoryId))).toBe(true);
    expect(t.openItem.stations.length).toBeGreaterThan(0);
  });

  it("lets a cashier open a table and send a dish and an open item; the bill carries both", async () => {
    const tableId = env.demo.tableIds["T3"];
    const { sessionId } = await posOpenTable(cashier, { tableId, partySize: 3 });
    const sent = await posSendOrder(cashier, {
      sessionId,
      clientRequestId: "pos-test-0001",
      lines: [
        { itemId: env.demo.itemIds["Dal Makhani"], qty: 2, modifierIds: [] },
        { open: { name: "Extra butter", pricePaise: 4000, station: (await posTerminal(cashier)).openItem.stations[0], taxRateBp: 0 }, qty: 1, note: "on the side" },
      ],
    });
    expect(sent.atCounter).toBe(false);
    const lines = await env.db.select().from(s.orderLines).where(eq(s.orderLines.sessionId, sessionId));
    const open = lines.find((l) => l.nameEn === "Extra butter")!;
    expect(open).toMatchObject({ itemId: null, unitPricePaise: 4000, qty: 1, note: "on the side" });
    // A diner called Guest was made for the table nobody scanned
    const people = await env.db.select().from(s.participants).where(and(eq(s.participants.sessionId, sessionId), isNull(s.participants.removedAt)));
    expect(people.map((p) => p.displayName)).toEqual(["Guest"]);
    // The same request again does not order twice
    await posSendOrder(cashier, { sessionId, clientRequestId: "pos-test-0001", lines: [{ itemId: env.demo.itemIds["Dal Makhani"], qty: 2, modifierIds: [] }] });
    expect((await env.db.select().from(s.orders).where(eq(s.orders.sessionId, sessionId))).length).toBe(1);

    const t = await posTerminal(cashier);
    const row = t.tables.find((x) => x.id === tableId)!;
    expect(row.visit?.id).toBe(sessionId);
    const dal = lines.find((l) => l.itemId === env.demo.itemIds["Dal Makhani"])!;
    expect(row.visit?.orderedPaise).toBe(dal.unitPricePaise * 2 + 4000);

    await waiterRequestBill(cashier, sessionId, new Date(), ["cashier"]);
    const [bill] = await env.db.select().from(s.bills).where(eq(s.bills.sessionId, sessionId));
    expect(bill.subtotalPaise).toBe(dal.unitPricePaise * 2 + 4000);
    await settleAtCounter(cashier, { sessionId, method: "cash", receivedPaise: bill.totalPaise }, new Date(), ["cashier"]);
    const [paid] = await env.db.select().from(s.bills).where(eq(s.bills.id, bill.id));
    expect(paid.status).toBe("paid");

    // Reports keep the open item as its own row
    const sales = await getSalesDetail({ ...cashier, roles: ["owner"] }, {});
    expect(sales.items.find((i) => i.name === "Extra butter")).toMatchObject({ category: "Open items", qty: 1, grossPaise: 4000 });
  });

  it("adds items to a takeaway at the counter", async () => {
    const ta = await startTakeaway(cashier, { name: "Meena" });
    await posSendOrder(cashier, { sessionId: ta.sessionId, clientRequestId: "pos-test-0002", guestName: "Meena", lines: [{ itemId: env.demo.itemIds["Dal Makhani"], qty: 1, modifierIds: [], personalForPickup: true }] });
    const people = await env.db.select().from(s.participants).where(eq(s.participants.sessionId, ta.sessionId));
    expect(people.map((p) => p.displayName)).toEqual(["Meena"]);
    expect((await posTerminal(cashier)).takeaways.map((x) => x.code)).toContain(ta.code);
  });

  it("refuses an open item without a price, and an accountant", async () => {
    const { sessionId } = await posOpenTable(cashier, { tableId: env.demo.tableIds["T1"] });
    await expect(posSendOrder(cashier, { sessionId, clientRequestId: "pos-test-0003", lines: [{ open: { name: "Tea", pricePaise: 0, station: "kitchen", taxRateBp: 0 }, qty: 1 }] })).rejects.toThrow(/open item/);
    await expect(posSendOrder(cashier, { sessionId, clientRequestId: "pos-test-0004", lines: [{ open: { name: "Tea", pricePaise: 2000, station: "kitchen", taxRateBp: 300 }, qty: 1 }] })).rejects.toThrow(/open item/);
    if (accountant) await expect(posTerminal(accountant)).rejects.toThrow();
  });

  it("deduplicates concurrent table opens and rejects changed details on the same request", async () => {
    const input = { tableId: env.demo.tableIds["T4"], partySize: 2, guestName: "Anita", clientRequestId: "offline-table-retry-1" };
    const [first, replay] = await Promise.all([posOpenTable(cashier, input), posOpenTable(cashier, input)]);
    expect(replay.sessionId).toBe(first.sessionId);
    expect(await env.db.select({ id: s.tableSessions.id }).from(s.tableSessions).where(eq(s.tableSessions.staffRequestId, input.clientRequestId))).toHaveLength(1);
    await expect(posOpenTable(cashier, { ...input, guestName: "Meena" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("deduplicates concurrent takeaway opens and preserves the original counter", async () => {
    const input = { name: "Anita", clientRequestId: "offline-takeaway-retry-1" };
    const [first, replay] = await Promise.all([startTakeaway(cashier, input), startTakeaway(cashier, input)]);
    expect(replay).toEqual(first);
    expect(await env.db.select({ id: s.tableSessions.id }).from(s.tableSessions).where(eq(s.tableSessions.staffRequestId, input.clientRequestId))).toHaveLength(1);
    await expect(startTakeaway(cashier, { ...input, name: "Meena" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("blocks a stale offline quote before writing a KOT and replays an accepted request after another price change", async () => {
    const itemId = env.demo.itemIds["Dal Makhani"];
    const [item] = await env.db.select({ pricePaise: s.menuItems.pricePaise }).from(s.menuItems).where(eq(s.menuItems.id, itemId));
    const takeaway = await startTakeaway(cashier, { name: "Anita", clientRequestId: "offline-price-session-1" });
    const input = {
      sessionId: takeaway.sessionId, clientRequestId: "offline-price-kot-1", guestName: "Anita",
      lines: [{ itemId, qty: 1, modifierIds: [] as string[] }],
      quote: { [quoteKey(itemId, [])]: item.pricePaise },
    };
    try {
      await env.db.update(s.menuItems).set({ pricePaise: item.pricePaise + 100 }).where(eq(s.menuItems.id, itemId));
      await expect(posSendOrder(cashier, input)).rejects.toMatchObject({ code: "price_changed" });
      expect(await env.db.select({ id: s.orders.id }).from(s.orders).where(eq(s.orders.sessionId, takeaway.sessionId))).toHaveLength(0);
      expect(await env.db.select({ id: s.orderLines.id }).from(s.orderLines).where(eq(s.orderLines.sessionId, takeaway.sessionId))).toHaveLength(0);

      const reviewed = { ...input, quote: { [quoteKey(itemId, [])]: item.pricePaise + 100 } };
      const placed = await posSendOrder(cashier, reviewed);
      await env.db.update(s.menuItems).set({ pricePaise: item.pricePaise + 200 }).where(eq(s.menuItems.id, itemId));
      const replay = await posSendOrder(cashier, reviewed);
      expect(replay.orderId).toBe(placed.orderId);
      expect(replay.replayed).toBe(true);
      const lines = await env.db.select().from(s.orderLines).where(eq(s.orderLines.sessionId, takeaway.sessionId));
      expect(lines).toHaveLength(1);
      expect(lines[0].unitPricePaise).toBe(item.pricePaise + 100);
    } finally {
      await env.db.update(s.menuItems).set({ pricePaise: item.pricePaise }).where(eq(s.menuItems.id, itemId));
    }
  });

  it("reconciles offline cash only when the live bill still has the recorded balance", async () => {
    const { sessionId } = await posOpenTable(cashier, { tableId: env.demo.tableIds["T5"] });
    await posSendOrder(cashier, { sessionId, clientRequestId: "offline-cash-kot-0001", lines: [{ itemId: env.demo.itemIds["Dal Makhani"], qty: 1, modifierIds: [] }] });
    await waiterRequestBill(cashier, sessionId, new Date(), ["cashier"]);
    const [bill] = await env.db.select().from(s.bills).where(eq(s.bills.sessionId, sessionId));
    const request = { sessionId, method: "cash" as const, receivedPaise: bill.totalPaise, expectedDuePaise: bill.totalPaise, clientRequestId: "offline-cash-settle-0001" };
    await expect(settleAtCounter(cashier, { ...request, expectedDuePaise: bill.totalPaise + 100 }, new Date(), posTerminalRoles)).rejects.toMatchObject({ code: "conflict" });
    expect(await env.db.select({ id: s.payments.id }).from(s.payments).where(eq(s.payments.clientRequestId, request.clientRequestId))).toHaveLength(0);

    const first = await settleAtCounter(cashier, request, new Date(), posTerminalRoles);
    const replay = await settleAtCounter(cashier, request, new Date(), posTerminalRoles);
    expect(replay).toEqual(first);
    expect(await env.db.select({ id: s.payments.id }).from(s.payments).where(eq(s.payments.clientRequestId, request.clientRequestId))).toHaveLength(1);
  });
});
