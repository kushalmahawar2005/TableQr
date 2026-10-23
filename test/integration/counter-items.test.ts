import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { addItemsAtBilling } from "@/server/billing/counter-items";
import { requestBill, settleAtCounter } from "@/server/billing/payments";
import { addCartLine } from "@/server/guest/cart";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { attachVerifiedTestGuest, resetTestDb } from "./setup-db";

// A guest at the counter adds a chocolate after asking for the bill: it lands on the bill in one
// step, is marked handed over (no kitchen), and the bill is ready to pay again.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let owner: StaffSession;
let g: GuestContext;
let n = 0;
const line = () => [{ itemId: env.demo.itemIds["Dal Makhani"], qty: 1, modifierIds: [] }];
const add = (tableId: string) => addItemsAtBilling(owner, { sessionId: g.sessionId, tableId, participantId: g.participantId, clientRequestId: `counter-${++n}-${Date.now()}`, lines: line() });

beforeAll(async () => {
  env = await resetTestDb();
  owner = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000001", pin: "1111" })).token))!;
  const qr = env.demo.tableQr.T5;
  const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: "counter-a", displayName: "Neha" });
  g = await attachVerifiedTestGuest(appDb, await getGuestContext("SRJ01", qr, participantId, "counter-a"), "Neha");
  await addCartLine(g, { itemId: env.demo.itemIds["Dal Makhani"], qty: 1 });
  await placeOrder(g);
  await requestBill({ tenantId: g.tenantId, outletId: g.outletId, sessionId: g.sessionId });
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("items added at the counter", () => {
  it("joins the asked-for bill in one step, served, with the bill still asked for", async () => {
    const [before] = await env.db.select().from(s.bills).where(eq(s.bills.sessionId, g.sessionId));
    const res = await add(env.demo.tableIds.T5);
    expect(res.atCounter).toBe(true);
    const [session] = await env.db.select().from(s.tableSessions).where(eq(s.tableSessions.id, g.sessionId));
    expect(session.status).toBe("bill_requested");
    const [after] = await env.db.select().from(s.bills).where(eq(s.bills.sessionId, g.sessionId));
    expect(after.totalPaise).toBeGreaterThan(before.totalPaise);
    const lines = await env.db.select({ status: s.orderLines.status }).from(s.orderLines).where(and(eq(s.orderLines.orderId, res.orderId)));
    expect(lines.every((l) => l.status === "served")).toBe(true);
  });

  it("refuses once the bill is paid", async () => {
    const [bill] = await env.db.select().from(s.bills).where(eq(s.bills.sessionId, g.sessionId));
    await settleAtCounter(owner, { sessionId: g.sessionId, method: "cash", receivedPaise: bill.totalPaise });
    const err = await add(env.demo.tableIds.T5).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).details?.reason).toBe("closed");
  });
});
