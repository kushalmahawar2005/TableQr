import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { requestBill, settleAtCounter } from "@/server/billing/payments";
import { addCartLine } from "@/server/guest/cart";
import { getGuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { closeVisit, markReady } from "@/server/floor/table-actions";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { getRecentOrders } from "@/server/staff/orders-read";
import { billIdFromToken, billToken, sharedBill } from "@/server/billing/bill-link";
import { resetTestDb } from "./setup-db";

// Clearing a table from the floor: a paid table frees in one tap; a party still seated is closed
// out, and one that still owes money needs a manager and a written reason.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let host: StaffSession;
let manager: StaffSession;
const signIn = async (phone: string, pin: string) => (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone, pin })).token))!;
const stateOf = async (code: string) => (await env.db.select({ state: s.diningTables.state }).from(s.diningTables).where(eq(s.diningTables.id, env.demo.tableIds[code])))[0].state;

async function seatAndOrder(code: string, device: string) {
  const qr = env.demo.tableQr[code];
  const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: device, displayName: "Riya" });
  const g = await getGuestContext("SRJ01", qr, participantId, device);
  await addCartLine(g, { itemId: env.demo.itemIds["Dal Makhani"], qty: 1 });
  await placeOrder(g);
  return g;
}

async function failsWith(p: Promise<unknown>, code: AppError["code"], reason?: string) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  if (reason) expect((err as AppError).details?.reason).toBe(reason);
  return err as AppError;
}

beforeAll(async () => {
  env = await resetTestDb();
  host = await signIn("9000000004", "4444");
  manager = await signIn("9000000002", "2222");
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("clear table", () => {
  it("frees a paid table straight away, without a cleaning step", async () => {
    const g = await seatAndOrder("T1", "cv-a");
    await requestBill({ tenantId: g.tenantId, outletId: g.outletId, sessionId: g.sessionId });
    const [bill] = await env.db.select().from(s.bills).where(eq(s.bills.sessionId, g.sessionId));
    await settleAtCounter(manager, { sessionId: g.sessionId, method: "cash", receivedPaise: bill.totalPaise });
    expect(await stateOf("T1")).toBe("paid");
    await markReady(host, env.demo.tableIds.T1);
    expect(await stateOf("T1")).toBe("available");
  });

  it("closes an unpaid party only with a reason, by a manager; the bill is cancelled and orders are done", async () => {
    const g = await seatAndOrder("T2", "cv-b");
    const id = env.demo.tableIds.T2;
    const err = await failsWith(closeVisit(host, { tableId: id }), "invalid_state", "unpaid");
    expect(Number(err.details?.duePaise)).toBeGreaterThan(0);
    await failsWith(closeVisit(host, { tableId: id, reason: "Left without paying" }), "forbidden");
    expect(await stateOf("T2")).toBe("seated");

    await closeVisit(manager, { tableId: id, reason: "Left without paying" });
    expect(await stateOf("T2")).toBe("available");
    const [session] = await env.db.select().from(s.tableSessions).where(eq(s.tableSessions.id, g.sessionId));
    expect(session.status).toBe("closed");
    const [bill] = await env.db.select().from(s.bills).where(eq(s.bills.sessionId, g.sessionId));
    expect(bill.status).toBe("cancelled");
    const orders = await env.db.select({ status: s.orders.status }).from(s.orders).where(eq(s.orders.sessionId, g.sessionId));
    expect(orders.every((o) => o.status === "served")).toBe(true);
    const audit = await env.db.select().from(s.auditLog).where(eq(s.auditLog.action, "table.closed_unpaid"));
    expect(audit).toHaveLength(1);

    // The table seats the next party at once
    await seatAndOrder("T2", "cv-c");
    expect(await stateOf("T2")).toBe("seated");
  });

  it("lists orders of a finished visit as served on the Orders board", async () => {
    const orders = await getRecentOrders(manager, new Date());
    const t1 = orders.filter((o) => o.table === "T1");
    expect(t1.length).toBeGreaterThan(0);
    expect(t1.every((o) => o.status === "served" && o.readyLineIds.length === 0)).toBe(true);
    // The new party at T2 is still in progress
    expect(orders.find((o) => o.table === "T2" && o.status === "placed")).toBeTruthy();
  });

  it("opens a paid bill from its WhatsApp link, and nothing from a changed link", async () => {
    const [bill] = await env.db.select().from(s.bills).where(eq(s.bills.status, "paid"));
    const token = billToken(bill.id);
    expect(billIdFromToken(token)).toBe(bill.id);
    const shared = await sharedBill(token);
    expect(shared).toMatchObject({ table: "T1", paid: true, outlet: { name: expect.any(String) } });
    expect(shared!.snap.totalPaise).toBe(bill.totalPaise);
    expect(shared!.snap.lines[0]).toMatchObject({ nameEn: "Dal Makhani", qty: 1 });
    expect(await sharedBill(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(await sharedBill(`${bill.id}x.${token.split(".")[1]}`)).toBeNull();
    expect(await sharedBill("nonsense")).toBeNull();
  });
});
