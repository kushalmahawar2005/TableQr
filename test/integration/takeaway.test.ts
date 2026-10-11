import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { settleAtCounter } from "@/server/billing/payments";
import { getFloor } from "@/server/floor/read";
import { cancelTakeaway, startTakeaway } from "@/server/floor/takeaway";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { getRecentOrders } from "@/server/staff/orders-read";
import { posQueue } from "@/server/staff/pos-read";
import { addPhonelessDiner, staffPlaceOrder, waiterRequestBill } from "@/server/staff/waiter-mutations";
import { resetTestDb } from "./setup-db";

// Takeaway (parcel) orders at the counter run on hidden counters TA-1, TA-2 …: never on the floor,
// reused once paid, and the kitchen and the bill work as for a table.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let owner: StaffSession;
const signIn = async (phone: string, pin: string) => (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone, pin })).token))!;

async function order(sessionId: string, tableId: string) {
  const diner = await addPhonelessDiner(owner, sessionId, "Counter guest");
  await staffPlaceOrder(owner, { sessionId, tableId, participantId: diner.id, clientRequestId: `ta-${sessionId.slice(-12)}`, lines: [{ itemId: env.demo.itemIds["Dal Makhani"], qty: 1, modifierIds: [], note: "PARCEL" }] });
}

beforeAll(async () => {
  env = await resetTestDb();
  owner = await signIn("9000000001", "1111");
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("takeaway orders", () => {
  it("opens on a hidden counter that is not on the floor and not a table", async () => {
    const before = (await getFloor(owner)).tables.length;
    const a = await startTakeaway(owner, { name: "Ravi" });
    expect(a.code).toBe("TA-1");
    const b = await startTakeaway(owner);
    expect(b.code).toBe("TA-2");
    expect((await getFloor(owner)).tables.length).toBe(before);
    const queue = await posQueue(owner);
    expect(queue.queue.filter((c) => c.takeaway).map((c) => c.tableCode).sort()).toEqual(["TA-1", "TA-2"]);
    expect(queue.queue.find((c) => c.tableCode === "TA-1")?.guestName).toBe("Ravi");
    // Opened by mistake: drops while empty, and the counter is free again
    await cancelTakeaway(owner, b.sessionId);
    expect((await startTakeaway(owner)).code).toBe("TA-2");
  });

  it("goes through the kitchen and the bill, and the counter frees once paid", async () => {
    const [ta1] = await env.db.select().from(s.diningTables).where(and(eq(s.diningTables.outletId, env.demo.outletId), eq(s.diningTables.code, "TA-1")));
    const [visit] = await env.db.select().from(s.tableSessions).where(and(eq(s.tableSessions.tableId, ta1.id), eq(s.tableSessions.status, "open")));
    await order(visit.id, ta1.id);
    const err = await cancelTakeaway(owner, visit.id).catch((e: unknown) => e);
    expect((err as AppError).details?.reason).toBe("has_items");
    await waiterRequestBill(owner, visit.id);
    const [bill] = await env.db.select().from(s.bills).where(eq(s.bills.sessionId, visit.id));
    await settleAtCounter(owner, { sessionId: visit.id, method: "cash", receivedPaise: bill.totalPaise });
    const [after] = await env.db.select().from(s.diningTables).where(eq(s.diningTables.id, ta1.id));
    expect(after.state).toBe("available");
    // Paid but still cooking: the order stays on the Orders board as a takeaway
    const row = (await getRecentOrders(owner, new Date())).find((o) => o.table === "TA-1");
    expect(row).toMatchObject({ takeaway: true, status: "placed" });
    expect((await startTakeaway(owner)).code).toBe("TA-1");
  });
});
