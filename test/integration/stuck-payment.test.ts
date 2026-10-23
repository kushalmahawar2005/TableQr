import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { requestBill, settleAtCounter, startPayment } from "@/server/billing/payments";
import { recheckOnlinePayment, releaseStuckPayment } from "@/server/billing/stuck-payment";
import { addCartLine } from "@/server/guest/cart";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { mockGateway } from "@/server/payments/gateway";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { attachVerifiedTestGuest, resetTestDb } from "./setup-db";

// An online payment the gateway never answers for blocks cash at the counter. The cashier can ask
// again; after 10 minutes a manager can release it, and then take the money at the counter.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let manager: StaffSession;
let g: GuestContext;
const MIN = 60_000;

beforeAll(async () => {
  env = await resetTestDb();
  manager = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000002", pin: "2222" })).token))!;
  const qr = env.demo.tableQr.T2;
  const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: "stuck-a", displayName: "Isha" });
  g = await attachVerifiedTestGuest(appDb, await getGuestContext("SRJ01", qr, participantId, "stuck-a"), "Isha");
  await addCartLine(g, { itemId: env.demo.itemIds["Dal Makhani"], qty: 1 });
  await placeOrder(g);
  await requestBill({ tenantId: g.tenantId, outletId: g.outletId, sessionId: g.sessionId });
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("stuck online payment", () => {
  it("can be checked again, released by a manager after 10 minutes, and then paid in cash", async () => {
    const start = await startPayment(g, { method: "upi", requestId: "stuck-req-1" });
    expect(await recheckOnlinePayment(manager, g.sessionId)).toBe("pending");
    const early = await releaseStuckPayment(manager, g.sessionId).catch((e: unknown) => e);
    expect((early as AppError).details?.reason).toBe("too_soon");

    const later = new Date(Date.now() + 11 * MIN);
    expect(await releaseStuckPayment(manager, g.sessionId, later)).toEqual({ released: true, view: "failed" });
    const [p] = await env.db.select().from(s.payments).where(eq(s.payments.id, start.paymentId));
    expect(p.status).toBe("failed");

    const [bill] = await env.db.select().from(s.bills).where(eq(s.bills.sessionId, g.sessionId));
    await settleAtCounter(manager, { sessionId: g.sessionId, method: "cash", receivedPaise: bill.totalPaise });
    expect((await env.db.select().from(s.bills).where(eq(s.bills.id, bill.id)))[0].status).toBe("paid");
  });

  it("takes the gateway's answer when there is one", async () => {
    const qr = env.demo.tableQr.T3;
    const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: "stuck-b", displayName: "Om" });
    const h = await attachVerifiedTestGuest(appDb, await getGuestContext("SRJ01", qr, participantId, "stuck-b"), "Om");
    await addCartLine(h, { itemId: env.demo.itemIds["Dal Makhani"], qty: 1 });
    await placeOrder(h);
    await requestBill({ tenantId: h.tenantId, outletId: h.outletId, sessionId: h.sessionId });
    const start = await startPayment(h, { method: "upi", requestId: "stuck-req-2" });
    mockGateway.settle(start.gatewayRef!, "success");
    expect(await releaseStuckPayment(manager, h.sessionId, new Date(Date.now() + 11 * MIN))).toEqual({ released: false, view: "success" });
  });
});
