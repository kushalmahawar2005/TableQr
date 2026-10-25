import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { closeVisit } from "@/server/floor/table-actions";
import { confirmPayment, requestBill, settleAtCounter, startPayment } from "@/server/billing/payments";
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

  it("tells whoever clears the table where the way out is, once nobody can still be paying", async () => {
    const qr = env.demo.tableQr.T4;
    const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: "stuck-c", displayName: "Pia" });
    const h = await attachVerifiedTestGuest(appDb, await getGuestContext("SRJ01", qr, participantId, "stuck-c"), "Pia");
    await addCartLine(h, { itemId: env.demo.itemIds["Dal Makhani"], qty: 1 });
    await placeOrder(h);
    await requestBill({ tenantId: h.tenantId, outletId: h.outletId, sessionId: h.sessionId });
    await startPayment(h, { method: "upi", requestId: "stuck-req-3" });
    const input = { tableId: env.demo.tableIds.T4, reason: "Left without paying" };
    const soon = await closeVisit(manager, input).catch((e: unknown) => e);
    expect((soon as AppError).details).toMatchObject({ reason: "payment_in_flight", stuck: false });
    const later = await closeVisit(manager, input, new Date(Date.now() + 22 * 60 * MIN)).catch((e: unknown) => e);
    expect((later as AppError).details).toMatchObject({ reason: "payment_in_flight", stuck: true });
    expect((later as AppError).message).toMatch(/Billing/);
    // A manager releases it, and the table can then be cleared
    await releaseStuckPayment(manager, h.sessionId, new Date(Date.now() + 22 * 60 * MIN));
    await closeVisit(manager, input, new Date(Date.now() + 22 * 60 * MIN));
  });
});

describe("releasing a stuck payment never loses or doubles money", () => {
  const later = () => new Date(Date.now() + 11 * MIN);

  async function stuckAt(table: string, device: string) {
    const qr = env.demo.tableQr[table];
    const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: device, displayName: "Rae" });
    const h = await attachVerifiedTestGuest(appDb, await getGuestContext("SRJ01", qr, participantId, device), "Rae");
    await addCartLine(h, { itemId: env.demo.itemIds["Dal Makhani"], qty: 1 });
    await placeOrder(h);
    await requestBill({ tenantId: h.tenantId, outletId: h.outletId, sessionId: h.sessionId });
    const start = await startPayment(h, { method: "upi", requestId: `rel-${device}` });
    const [bill] = await env.db.select().from(s.bills).where(eq(s.bills.sessionId, h.sessionId));
    return { h, start, bill };
  }
  const lateSuccess = (start: Awaited<ReturnType<typeof startPayment>>) => confirmPayment(start.paymentId, { gatewayRef: start.gatewayRef!, status: "success", amountPaise: start.totalPaise, gatewayPaymentId: `late-${start.paymentId}` });
  const shares = (billId: string) => env.db.select().from(s.billShares).where(eq(s.billShares.billId, billId));

  it("pays the bill, once, when the gateway's late success arrives after a release and nobody took cash", async () => {
    const { h, start, bill } = await stuckAt("T5", "rel-a");
    expect(await releaseStuckPayment(manager, h.sessionId, later())).toEqual({ released: true, view: "failed" });
    expect((await env.db.select().from(s.payments).where(eq(s.payments.id, start.paymentId)))[0].status).toBe("failed");
    expect(await lateSuccess(start)).toMatchObject({ status: "success", alreadyFinal: false });
    expect((await env.db.select().from(s.bills).where(eq(s.bills.id, bill.id)))[0].status).toBe("paid");
    expect((await shares(bill.id)).reduce((n, x) => n + x.paidPaise, 0)).toBe(bill.totalPaise);
    expect(await env.db.select().from(s.refunds).where(eq(s.refunds.paymentId, start.paymentId))).toHaveLength(0);
  });

  it("refunds the late online payment in full when cash already settled the bill after a release, and never credits it twice", async () => {
    const { h, start, bill } = await stuckAt("T6", "rel-b");
    await releaseStuckPayment(manager, h.sessionId, later());
    await settleAtCounter(manager, { sessionId: h.sessionId, method: "cash", receivedPaise: bill.totalPaise });
    expect((await env.db.select().from(s.bills).where(eq(s.bills.id, bill.id)))[0].status).toBe("paid");
    await lateSuccess(start);
    expect((await shares(bill.id)).reduce((n, x) => n + x.paidPaise, 0)).toBe(bill.totalPaise);
    const refunds = await env.db.select().from(s.refunds).where(eq(s.refunds.paymentId, start.paymentId));
    expect(refunds.map((r) => r.amountPaise)).toEqual([start.totalPaise]);
    expect((await env.db.select().from(s.payments).where(eq(s.payments.id, start.paymentId)))[0].status).toBe("success");
    // The same gateway message arriving again changes nothing
    await lateSuccess(start);
    expect(await env.db.select().from(s.refunds).where(eq(s.refunds.paymentId, start.paymentId))).toHaveLength(1);
  });

  it("keeps a payment that succeeds at the very moment of the release: it ends as paid, never as released", async () => {
    const { h, start, bill } = await stuckAt("T7", "rel-c");
    const [released] = await Promise.all([releaseStuckPayment(manager, h.sessionId, later()), lateSuccess(start)]);
    expect([true, false]).toContain(released.released);
    expect((await env.db.select().from(s.payments).where(eq(s.payments.id, start.paymentId)))[0].status).toBe("success");
    expect((await shares(bill.id)).reduce((n, x) => n + x.paidPaise, 0)).toBe(bill.totalPaise);
    expect(await env.db.select().from(s.refunds).where(eq(s.refunds.paymentId, start.paymentId))).toHaveLength(0);
  });

  it("is refused to anyone below manager, and too early", async () => {
    const { h } = await stuckAt("T8", "rel-d");
    const cashier = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000003", pin: "3333" })).token))!;
    const denied = await releaseStuckPayment(cashier, h.sessionId, later()).catch((e: unknown) => e);
    expect(denied).toBeInstanceOf(AppError);
    const early = await releaseStuckPayment(manager, h.sessionId).catch((e: unknown) => e);
    expect((early as AppError).details?.reason).toBe("too_soon");
    expect((await env.db.select().from(s.payments).where(eq(s.payments.billId, (await env.db.select().from(s.bills).where(eq(s.bills.sessionId, h.sessionId)))[0].id)))[0].status).toBe("pending");
  });
});

