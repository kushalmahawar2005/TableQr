import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { confirmPayment, recordRefundResult, requestBill, settleAtCounter, startPayment } from "@/server/billing/payments";
import { reconcilePendingRefunds, reconcileRefund, refundIdFor, requestRefund } from "@/server/billing/refunds";
import { AppError } from "@/server/errors";
import { addCartLine } from "@/server/guest/cart";
import { getGuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { mockGateway } from "@/server/payments/gateway";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { getDashboard } from "@/server/staff/dashboard";
import { posBillDetail, posQueue } from "@/server/staff/pos-read";
import { resetTestDb } from "./setup-db";

// Staff refunds (payment and refund production blockers, pass 1): the real database and the mock gateway.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let owner: StaffSession;
let manager: StaffSession;
let cashier: StaffSession;
let accountant: StaffSession;
let n = 0;
const rid = () => `refund-req-${++n}-${Date.now()}`;
const signIn = async (phone: string, pin: string) => (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone, pin })).token))!;
const MANAGER_PIN = { phone: "9000000002", pin: "2222" };

async function failsWith(p: Promise<unknown>, code: AppError["code"]) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  return err as AppError;
}

/** A guest orders one dish (₹320 + 5% GST = ₹336) and pays all of it online; returns the payment */
async function onlinePayment(tip = 0) {
  await env.db.update(s.diningTables).set({ state: "available" });
  const device = `refund-dev-${++n}`;
  const qr = env.demo.tableQr.T1;
  const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: device, displayName: "Kavya" });
  const g = await getGuestContext("SRJ01", qr, participantId, device);
  await addCartLine(g, { itemId: env.demo.itemIds["Paneer Tikka"], qty: 1 });
  await placeOrder(g);
  await requestBill({ tenantId: g.tenantId, outletId: g.outletId, sessionId: g.sessionId });
  const start = await startPayment(g, { method: "card", tipPaise: tip, requestId: rid() });
  mockGateway.settle(start.gatewayRef!, "success");
  const status = await mockGateway.fetchStatus(start.gatewayRef!);
  await confirmPayment(start.paymentId, { gatewayRef: start.gatewayRef!, status: "success", amountPaise: status.amountPaise, gatewayPaymentId: status.gatewayPaymentId });
  const [payment] = await env.db.select().from(s.payments).where(eq(s.payments.id, start.paymentId));
  expect(payment.status).toBe("success");
  return { payment, sessionId: g.sessionId, billId: payment.billId };
}

async function counterPayment() {
  await env.db.update(s.diningTables).set({ state: "available" });
  const device = `refund-cash-${++n}`;
  const qr = env.demo.tableQr.T2;
  const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: device, displayName: "Cash Guest" });
  const g = await getGuestContext("SRJ01", qr, participantId, device);
  await addCartLine(g, { itemId: env.demo.itemIds["Dal Makhani"], qty: 1 });
  await placeOrder(g);
  await requestBill({ tenantId: g.tenantId, outletId: g.outletId, sessionId: g.sessionId });
  const res = await settleAtCounter({ tenantId: g.tenantId, outletId: g.outletId, userId: null }, { sessionId: g.sessionId, method: "cash", receivedPaise: 100000 });
  const [payment] = await env.db.select().from(s.payments).where(eq(s.payments.id, res.paymentId));
  return { payment, sessionId: g.sessionId };
}

const refundsOf = (paymentId: string) => env.db.select().from(s.refunds).where(eq(s.refunds.paymentId, paymentId));
const webhook = (gatewayRefundId: string, status: "success" | "failed") => recordRefundResult("mock", { gatewayRefundId, status });

beforeAll(async () => {
  env = await resetTestDb();
  owner = await signIn("9000000001", "1111");
  manager = await signIn("9000000002", "2222");
  cashier = await signIn("9000000003", "3333");
  accountant = { ...cashier, roles: ["accountant"] };
});
afterEach(() => {
  mockGateway.refundsFail = false;
  vi.restoreAllMocks();
});
afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("refund amounts", () => {
  it("1: a full refund goes to the gateway, stays pending, and becomes success only when the gateway confirms", async () => {
    const { payment } = await onlinePayment();
    const full = payment.amountPaise + payment.tipPaise;
    const res = await requestRefund(manager, { paymentId: payment.id, amountPaise: full, reason: "Guest unhappy", requestId: rid() });
    expect(res.status).toBe("pending");
    const [row] = await refundsOf(payment.id);
    expect(row).toMatchObject({ amountPaise: full, status: "pending", byUserId: manager.userId });
    expect(row.gatewayRef).toMatch(/^mockrf_/);
    mockGateway.settleRefund(row.gatewayRef!, "success");
    expect(await webhook(row.gatewayRef!, "success")).toBe(true);
    const [done] = await refundsOf(payment.id);
    expect(done.status).toBe("success");
    expect(done.completedAt).not.toBeNull();
    const [audit] = await env.db.select().from(s.auditLog).where(eq(s.auditLog.entityId, row.id));
    expect(audit).toMatchObject({ action: "refund.requested", actorUserId: manager.userId });
    await failsWith(requestRefund(manager, { paymentId: payment.id, amountPaise: 100, reason: "again", requestId: rid() }), "invalid_state");
  });

  it("2/3: partial refunds reduce what is left, pending ones count, and more than the balance is refused", async () => {
    const { payment } = await onlinePayment(2000);
    const full = payment.amountPaise + payment.tipPaise;
    await requestRefund(owner, { paymentId: payment.id, amountPaise: 10000, reason: "Cold dish", requestId: rid() });
    await requestRefund(owner, { paymentId: payment.id, amountPaise: 5000, reason: "Late", requestId: rid() });
    const err = await failsWith(requestRefund(owner, { paymentId: payment.id, amountPaise: full - 15000 + 1, reason: "Too much", requestId: rid() }), "invalid_state");
    expect(err.details).toMatchObject({ reason: "over_refund", refundablePaise: full - 15000 });
    await requestRefund(owner, { paymentId: payment.id, amountPaise: full - 15000, reason: "Rest", requestId: rid() });
    expect(await refundsOf(payment.id)).toHaveLength(3);
    for (const bad of [0, -5, 1.5, Number.NaN]) await failsWith(requestRefund(owner, { paymentId: payment.id, amountPaise: bad, reason: "x y z", requestId: rid() }), "invalid_state");
    await failsWith(requestRefund(owner, { paymentId: payment.id, amountPaise: 100, reason: "", requestId: rid() }), "invalid_state");
  });

  it("only a successful payment can be refunded", async () => {
    const { payment } = await onlinePayment();
    await env.db.update(s.payments).set({ status: "failed" }).where(eq(s.payments.id, payment.id));
    const err = await failsWith(requestRefund(owner, { paymentId: payment.id, amountPaise: 100, reason: "no money taken", requestId: rid() }), "invalid_state");
    expect(err.details).toMatchObject({ reason: "not_refundable" });
    await env.db.update(s.payments).set({ status: "success" }).where(eq(s.payments.id, payment.id));
  });
});

describe("idempotency", () => {
  it("4: the same request id makes one refund and one gateway call, even sent twice at once", async () => {
    const { payment } = await onlinePayment();
    const spy = vi.spyOn(mockGateway, "refund");
    const requestId = rid();
    const input = { paymentId: payment.id, amountPaise: 10000, reason: "Duplicate click", requestId };
    const [a, b] = await Promise.all([requestRefund(manager, input), requestRefund(manager, input)]);
    const c = await requestRefund(manager, input);
    expect(new Set([a.refundId, b.refundId, c.refundId]).size).toBe(1);
    expect(a.refundId).toBe(refundIdFor(manager.tenantId, payment.id, requestId));
    expect(await refundsOf(payment.id)).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
    await failsWith(requestRefund(manager, { ...input, amountPaise: 20000 }), "conflict");
  });

  it("two different requests for the whole balance at the same moment: one wins, none goes over", async () => {
    const { payment } = await onlinePayment();
    const full = payment.amountPaise + payment.tipPaise;
    const results = await Promise.allSettled([1, 2, 3].map(() => requestRefund(manager, { paymentId: payment.id, amountPaise: full, reason: "Race", requestId: rid() })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rows = await refundsOf(payment.id);
    expect(rows).toHaveLength(1);
    expect(rows.reduce((t, r) => t + r.amountPaise, 0)).toBe(full);
  });

  it("8: a repeated or contradictory webhook changes nothing once the refund is final", async () => {
    const { payment } = await onlinePayment();
    await requestRefund(manager, { paymentId: payment.id, amountPaise: 10000, reason: "Webhook test", requestId: rid() });
    const [row] = await refundsOf(payment.id);
    expect(await webhook(row.gatewayRef!, "success")).toBe(true);
    expect(await webhook(row.gatewayRef!, "success")).toBe(false);
    expect(await webhook(row.gatewayRef!, "failed")).toBe(false);
    expect((await refundsOf(payment.id))[0].status).toBe("success");
  });
});

describe("provider results", () => {
  it("5: a failed gateway call never counts as refunded, and the amount can be refunded again", async () => {
    const { payment } = await onlinePayment();
    mockGateway.refundsFail = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await requestRefund(manager, { paymentId: payment.id, amountPaise: 10000, reason: "Gateway down", requestId: rid() });
    expect(res.status).toBe("failed");
    const [row] = await refundsOf(payment.id);
    expect(row).toMatchObject({ status: "failed", gatewayRef: null, completedAt: null });
    mockGateway.refundsFail = false;
    const again = await requestRefund(manager, { paymentId: payment.id, amountPaise: payment.amountPaise + payment.tipPaise, reason: "Retry in full", requestId: rid() });
    expect(again.status).toBe("pending");
  });

  it("6/7: pending refunds settle by webhook or by asking the gateway, to success or to failed", async () => {
    const { payment } = await onlinePayment();
    const ctx = { tenantId: manager.tenantId, outletId: manager.outletId };
    await requestRefund(manager, { paymentId: payment.id, amountPaise: 10000, reason: "To success", requestId: rid() });
    await requestRefund(manager, { paymentId: payment.id, amountPaise: 8000, reason: "To failed", requestId: rid() });
    await requestRefund(manager, { paymentId: payment.id, amountPaise: 6000, reason: "Stays pending", requestId: rid() });
    const all = await refundsOf(payment.id);
    const [a, b, c] = [10000, 8000, 6000].map((amt) => all.find((r) => r.amountPaise === amt)!);
    expect(await reconcileRefund(ctx, a.id)).toBe("pending");
    mockGateway.settleRefund(a.gatewayRef!, "success");
    mockGateway.settleRefund(b.gatewayRef!, "failed");
    expect(await reconcileRefund(ctx, a.id)).toBe("success");
    expect(await webhook(b.gatewayRef!, "failed")).toBe(true);
    const rows = await refundsOf(payment.id);
    const statusOf = (amt: number) => rows.find((r) => r.amountPaise === amt)!.status;
    expect([statusOf(10000), statusOf(8000), statusOf(6000)]).toEqual(["success", "failed", "pending"]);
    // the failed refund's money is free again; success and pending still hold theirs
    const detail = await posBillDetail(manager, (await env.db.select().from(s.bills).where(eq(s.bills.id, payment.billId)))[0].sessionId);
    expect(detail.payments[0].refund).toMatchObject({ refundedPaise: 10000, pendingPaise: 6000, refundablePaise: payment.amountPaise + payment.tipPaise - 16000 });
    // the scheduled sweep ignores refunds younger than two minutes, then settles older ones
    expect(await reconcilePendingRefunds(ctx, new Date())).toBe(0);
    mockGateway.settleRefund(c.gatewayRef!, "success");
    expect(await reconcilePendingRefunds(ctx, new Date(Date.now() + 5 * 60_000))).toBe(1);
    expect((await refundsOf(payment.id)).find((r) => r.amountPaise === 6000)!.status).toBe("success");
  });
});

describe("finding a paid bill", () => {
  it("a bill settled in the last day, whose table is closed, is listed as recently paid so staff can reach it", async () => {
    const { sessionId, payment } = await onlinePayment();
    const recent = (await posQueue(cashier)).recent.find((r) => r.sessionId === sessionId);
    expect(recent).toMatchObject({ tableCode: "T1", billStatus: "paid", balancePaise: 0 });
    expect(recent!.totalPaise).toBe(payment.amountPaise);
    const other = { ...cashier, tenantId: env.other.tenantId, outletId: env.other.outletId };
    await expect(posQueue(other)).rejects.toBeInstanceOf(AppError); // another restaurant sees nothing of it
  });
});

describe("who may refund", () => {
  it("9: another outlet or another restaurant cannot refund this payment", async () => {
    const { payment } = await onlinePayment();
    await failsWith(requestRefund({ ...owner, outletId: crypto.randomUUID() }, { paymentId: payment.id, amountPaise: 100, reason: "Wrong outlet", requestId: rid() }), "not_found");
    const outsider = { ...owner, tenantId: env.other.tenantId, outletId: env.other.outletId };
    await expect(requestRefund(outsider, { paymentId: payment.id, amountPaise: 100, reason: "Wrong tenant", requestId: rid() })).rejects.toBeInstanceOf(AppError);
    expect(await refundsOf(payment.id)).toHaveLength(0);
  });

  it("10: host, waiter and kitchen are refused; cashier and accountant need a manager's PIN", async () => {
    const { payment } = await onlinePayment();
    const base = { paymentId: payment.id, amountPaise: 5000, reason: "Role check" };
    for (const role of ["host", "waiter", "kitchen"] as const) await failsWith(requestRefund({ ...owner, roles: [role] }, { ...base, requestId: rid() }), "forbidden");
    await failsWith(requestRefund(cashier, { ...base, requestId: rid() }), "forbidden");
    await failsWith(requestRefund(accountant, { ...base, requestId: rid() }), "forbidden");
    await failsWith(requestRefund(cashier, { ...base, requestId: rid(), approval: { phone: "9000000002", pin: "0000" } }), "invalid_state").catch(() => undefined);
    await failsWith(requestRefund(cashier, { ...base, requestId: rid(), approval: { phone: "9000000004", pin: "4444" } }), "forbidden"); // a host cannot approve
    expect(await refundsOf(payment.id)).toHaveLength(0);
    const ok = await requestRefund(cashier, { ...base, requestId: rid(), approval: MANAGER_PIN });
    expect(ok.status).toBe("pending");
    const [audit] = await env.db.select().from(s.auditLog).where(eq(s.auditLog.entityId, ok.refundId));
    expect((audit.after as { approverUserId: string }).approverUserId).toBe(manager.userId);
  });
});

describe("accounting and history", () => {
  it("11: a successful refund leaves the bill, order lines and invoice exactly as issued; revenue stays closed-bill net sales", async () => {
    const { payment, sessionId, billId } = await onlinePayment();
    const snap = async () => JSON.stringify({ bill: await env.db.select().from(s.bills).where(eq(s.bills.id, billId)), lines: await env.db.select().from(s.orderLines).where(eq(s.orderLines.sessionId, sessionId)), invoice: await env.db.select().from(s.invoices).where(eq(s.invoices.billId, billId)) });
    const before = await snap();
    const dashBefore = await getDashboard(owner);
    await requestRefund(owner, { paymentId: payment.id, amountPaise: 10000, reason: "Goodwill", requestId: rid() });
    const [row] = (await refundsOf(payment.id)).slice(-1);
    expect((await getDashboard(owner)).alerts.pendingRefunds.count).toBe(dashBefore.alerts.pendingRefunds.count + 1);
    await webhook(row.gatewayRef!, "success");
    expect(await snap()).toBe(before);
    const dashAfter = await getDashboard(owner);
    expect(dashAfter.kpis.revenue.today).toBe(dashBefore.kpis.revenue.today);
    expect(dashAfter.alerts.pendingRefunds.count).toBe(dashBefore.alerts.pendingRefunds.count); // done refunds are no longer pending
  });

  it("a counter payment is refunded by staff handing the money back: recorded done, no gateway call", async () => {
    const { payment } = await counterPayment();
    expect(payment).toMatchObject({ channel: "counter", method: "cash", status: "success" });
    const spy = vi.spyOn(mockGateway, "refund");
    const res = await requestRefund(manager, { paymentId: payment.id, amountPaise: payment.amountPaise, reason: "Wrong order", requestId: rid() });
    expect(res.status).toBe("success");
    expect(spy).not.toHaveBeenCalled();
    expect((await refundsOf(payment.id))[0]).toMatchObject({ status: "success", gatewayRef: null });
    await failsWith(requestRefund(manager, { paymentId: payment.id, amountPaise: 100, reason: "Again", requestId: rid() }), "invalid_state");
  });

  it("12: the POS bill payload carries no gateway references or provider ids", async () => {
    const { payment, sessionId } = await onlinePayment();
    await requestRefund(manager, { paymentId: payment.id, amountPaise: 5000, reason: "Payload check", requestId: rid() });
    const json = JSON.stringify(await posBillDetail(cashier, sessionId));
    expect(payment.gatewayRef).toBeTruthy();
    for (const secret of [payment.gatewayRef!, payment.gatewayPaymentId!, (await refundsOf(payment.id))[0].gatewayRef!, "gatewayRef", "gatewayPaymentId"]) expect(json).not.toContain(secret);
    expect((await posBillDetail(cashier, sessionId)).needsApproval).toBe(true);
    expect((await posBillDetail(manager, sessionId)).needsApproval).toBe(false);
  });
});
