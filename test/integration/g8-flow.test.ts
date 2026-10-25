import { and, eq } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { POST as webhook } from "@/app/api/payments/[provider]/webhook/route";
import { GET as paymentReturn } from "@/app/api/payments/return/route";
import {
  confirmPayment,
  executeRefund,
  markPaidAndLeft,
  reconcilePendingPayments,
  reopenBill,
  requestBill,
  setServiceChargeWaived,
  setSplitMode,
  settleAtCounter,
  startPayment,
} from "@/server/billing/payments";
import { AppError } from "@/server/errors";
import { addCartLine } from "@/server/guest/cart";
import { getBillScreen } from "@/server/guest/bill-screen";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { removeParticipant } from "@/server/guest/host-controls";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { mockGateway, type WebhookEvent } from "@/server/payments/gateway";
import { encryptMerchantCredentials } from "@/server/payments/outlet-gateway";
import { requestRefund } from "@/server/billing/refunds";
import { resolveStaff, signInStaff } from "@/server/staff/auth";
import { onPublish, type RealtimeEvent } from "@/server/realtime/publish";
import type { StaffContext } from "@/server/staff/context";
import { attachVerifiedTestGuest, resetTestDb } from "./setup-db";

// G8 Bill, split and pay: removed people, paid and left, reopen, service charge, refunds,
// webhooks and the return from the gateway. The worked example from PS 3.6 is the table.

let env: Awaited<ReturnType<typeof resetTestDb>>;
const g: Record<"A" | "B" | "C" | "D", GuestContext> = {} as never;
let cashier: StaffContext;
let events: RealtimeEvent[] = [];
let stop: () => void;
let n = 0;
const rid = () => `g8-req-${++n}-${Date.now()}`;
const scope = () => ({ tenantId: g.A.tenantId, outletId: g.A.outletId, sessionId: g.A.sessionId });
const view = (who: keyof typeof g) => getBillScreen("SRJ01", "k7Qm", `g8-${who}`);
const amounts = async () => (await view("A")).people.map((p) => p.amountPaise / 100);
const item = (name: string) => env.demo.itemIds[name];

async function failsWith(p: Promise<unknown>, code: AppError["code"], reason?: string) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  if (reason) expect((err as AppError).details?.reason).toBe(reason);
  return err as AppError;
}

async function pay(who: keyof typeof g, opts: { forParticipantIds?: string[]; tipPaise?: number } = {}) {
  const start = await startPayment(g[who], { method: "upi", requestId: rid(), ...opts });
  mockGateway.settle(start.gatewayRef!, "success");
  const { gatewayPaymentId } = await mockGateway.fetchStatus(start.gatewayRef!);
  await confirmPayment(start.paymentId, { gatewayRef: start.gatewayRef!, status: "success", amountPaise: start.totalPaise, gatewayPaymentId });
  return start;
}

const hook = (event: WebhookEvent, tamper = false) => {
  const { body, signature } = mockGateway.signedWebhook(event);
  return webhook(new Request("http://x/api/payments/mock/webhook", { method: "POST", body, headers: { "x-mock-signature": tamper ? signature.split("").reverse().join("") : signature } }), {
    params: Promise.resolve({ provider: "mock" }),
  });
};

const cashfreeHook = (raw: string, secret: string) => {
  const timestamp = "1792588800";
  const signature = createHmac("sha256", secret).update(`${timestamp}${raw}`).digest("base64");
  return webhook(new Request("https://restaurant.example/api/payments/cashfree/webhook", {
    method: "POST",
    body: raw,
    headers: { "x-webhook-signature": signature, "x-webhook-timestamp": timestamp },
  }), { params: Promise.resolve({ provider: "cashfree" }) });
};

beforeAll(() => {
  stop = onPublish((_s, sent) => events.push(...sent));
});
beforeEach(async () => {
  if (env) await env.conn.end();
  env = await resetTestDb();
  cashier = { tenantId: env.demo.tenantId, outletId: env.demo.outletId, userId: null };
  for (const [key, name] of [["A", "Aarav"], ["B", "Bhavna"], ["C", "Chirag"], ["D", undefined]] as const) {
    const device = `g8-${key}`;
    const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: "k7Qm", deviceId: device, displayName: name });
    g[key] = await attachVerifiedTestGuest(env.db, await getGuestContext("SRJ01", "k7Qm", participantId, device), name ?? "Divya");
  }
  const all = [g.A, g.B, g.C, g.D].map((x) => x.participantId);
  await addCartLine(g.A, { itemId: item("Veg Biryani"), qty: 1 });
  await addCartLine(g.A, { itemId: item("Masala Lassi"), qty: 1 });
  await addCartLine(g.A, { itemId: item("Paneer Tikka"), qty: 1, sharedWith: all });
  await addCartLine(g.A, { itemId: item("Masala Papad"), qty: 1, sharedWith: [g.A.participantId, g.B.participantId] });
  await placeOrder(g.A);
  await addCartLine(g.B, { itemId: item("Dal Makhani"), qty: 1 });
  await addCartLine(g.B, { itemId: item("Butter Naan"), qty: 1 });
  await placeOrder(g.B);
  await addCartLine(g.C, { itemId: item("Butter Chicken"), qty: 1, modifierIds: [env.demo.modifierIds.noBread] });
  await addCartLine(g.C, { itemId: item("Butter Naan"), qty: 1 });
  await addCartLine(g.C, { itemId: item("Cola"), qty: 1 });
  await placeOrder(g.C);
  await addCartLine(g.D, { itemId: item("Paneer Butter Masala"), qty: 1 });
  await addCartLine(g.D, { itemId: item("Butter Naan"), qty: 1 });
  await placeOrder(g.D, { name: "Divya" });
  events = [];
});
afterAll(async () => {
  stop();
  if (env) await env.conn.end();
  await appDb.$client.end();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("people on the bill", () => {
  it("never shows a stand-in name", async () => {
    await env.db.update(s.participants).set({ displayName: "Guest 4" }).where(eq(s.participants.id, g.D.participantId));
    const bill = await view("A");
    expect(bill.people.find((p) => p.id === g.D.participantId)?.name).toBeNull();
    expect(JSON.stringify(bill)).not.toMatch(/Guest \d/);
  });

  it("keeps a removed person's items theirs; nothing moves to the host", async () => {
    await removeParticipant(g.A, g.C.participantId);
    await requestBill(scope());
    expect(await amounts()).toEqual([541, 467, 620, 462]);
    const chirag = (await view("A")).people.find((p) => p.id === g.C.participantId)!;
    expect(chirag).toMatchObject({ removed: true, status: "unpaid", amountPaise: 62000 });
    // Equal split: the removed person keeps what they ordered; the rest is shared by those still here
    await setSplitMode(g.A, "equal");
    expect(await amounts()).toEqual([490, 490, 620, 490]);
    // Someone pays it for them, and the table can then close
    await pay("A", { forParticipantIds: [g.A.participantId, g.C.participantId] });
    await pay("B");
    await settleAtCounter(cashier, { sessionId: g.A.sessionId, method: "cash" });
    const [session] = await env.db.select().from(s.tableSessions).where(eq(s.tableSessions.id, g.A.sessionId));
    expect(session.status).toBe("closed");
  });
});

describe("split lock", () => {
  it("locks split changes from the first payment in flight, not only after money lands", async () => {
    await requestBill(scope());
    await startPayment(g.B, { method: "upi", requestId: rid() }); // pending, nothing paid yet
    expect((await view("A")).bill).toMatchObject({ locked: true, canEdit: false });
    await failsWith(setSplitMode(g.A, "equal"), "invalid_state", "locked");
    expect((await view("A")).people.find((p) => p.id === g.B.participantId)?.status).toBe("paying");
  });
});

describe("service charge", () => {
  it("is a clear separate line, removable by the host before anyone pays, then locked", async () => {
    await env.db.update(s.outlets).set({ serviceChargeBp: 1000 }).where(eq(s.outlets.id, g.A.outletId));
    await requestBill(scope());
    const bill = await view("A");
    expect(bill.bill.totals).toMatchObject({ serviceChargeBp: 1000, serviceChargePaise: 19900, taxPaise: 9950, totalPaise: 228900 });
    expect(bill.mine?.detail?.serviceChargePaise).toBe(5150);
    expect(bill.people.reduce((n, p) => n + p.amountPaise, 0)).toBe(228900);
    await failsWith(setServiceChargeWaived(g.B, true), "invalid_state", "host_only");
    await setServiceChargeWaived(g.A, true);
    expect((await view("A")).bill.totals).toMatchObject({ serviceChargePaise: 0, serviceChargeWaived: true, totalPaise: 209000 });
    await setServiceChargeWaived(g.A, false);
    await startPayment(g.B, { method: "upi", requestId: rid() });
    await failsWith(setServiceChargeWaived(g.A, true), "invalid_state", "locked");
  });
});

describe("paid and left", () => {
  it("only for a fully settled share, by the host, and never the host", async () => {
    await requestBill(scope());
    await failsWith(markPaidAndLeft({ kind: "guest", ctx: g.A }, g.B.participantId), "invalid_state", "not_settled");
    await pay("B");
    await failsWith(markPaidAndLeft({ kind: "guest", ctx: g.C }, g.B.participantId), "invalid_state", "host_only");
    await pay("A");
    await failsWith(markPaidAndLeft({ kind: "guest", ctx: g.A }, g.A.participantId), "invalid_state", "is_host");
    await markPaidAndLeft({ kind: "guest", ctx: g.A }, g.B.participantId);
    expect(events).toContainEqual(expect.objectContaining({ type: "participant.paid_out" }));
    const bhavna = (await view("A")).people.find((p) => p.id === g.B.participantId)!;
    expect(bhavna).toMatchObject({ paidAndLeft: true, status: "paid", amountPaise: 46700 });
  });

  it("freezes their share: after reopen, new items go only to people still here (equal split)", async () => {
    await requestBill(scope());
    await setSplitMode(g.A, "equal");
    expect(await amounts()).toEqual([523, 523, 522, 522]);
    await pay("B");
    await markPaidAndLeft({ kind: "guest", ctx: g.A }, g.B.participantId);
    await reopenBill({ kind: "guest", ctx: g.A });
    expect((await view("A")).bill.reopened).toBe(true);
    // Later orders exclude them, shared items included
    await expect(addCartLine(g.A, { itemId: item("Cola"), qty: 1, sharedWith: [g.A.participantId, g.B.participantId] })).rejects.toMatchObject({ code: "invalid_line" });
    await addCartLine(g.A, { itemId: item("Cola"), qty: 1 });
    await placeOrder(g.A);
    await requestBill(scope());
    // 2060 subtotal + 103 GST = 2163; Bhavna stays 523; 1640 shared by three (extra rupee to the first)
    expect(await amounts()).toEqual([547, 523, 547, 546]);
    expect((await view("B")).people.find((p) => p.isMe)).toMatchObject({ status: "paid", paidAndLeft: true });
  });
});

describe("reopen", () => {
  it("is blocked while an online payment is in flight, keeps payments, and recalculates only what is unpaid", async () => {
    await requestBill(scope());
    const pending = await startPayment(g.B, { method: "upi", requestId: rid() });
    await failsWith(reopenBill({ kind: "guest", ctx: g.A }), "invalid_state", "payment_in_flight");
    mockGateway.settle(pending.gatewayRef!, "success");
    await confirmPayment(pending.paymentId, { gatewayRef: pending.gatewayRef!, status: "success", amountPaise: 46700 });
    await failsWith(reopenBill({ kind: "guest", ctx: g.B }), "invalid_state", "host_only");
    await reopenBill({ kind: "staff", ctx: cashier, sessionId: g.A.sessionId });
    expect(events).toContainEqual(expect.objectContaining({ type: "session.updated", data: { change: "bill_reopened" } }));
    // Bhavna orders more after paying: she owes only the new part
    await addCartLine(g.B, { itemId: item("Cola"), qty: 1 });
    await placeOrder(g.B);
    await requestBill(scope());
    const bhavna = (await view("B")).people.find((p) => p.isMe)!;
    expect(bhavna).toMatchObject({ paidPaise: 46700, amountPaise: 54100, duePaise: 7400, status: "unpaid" });
    expect((await view("B")).bill.reopened).toBe(true);
  });
});

describe("void after payment", () => {
  it("removes the item, recalculates tax, and turns the overpayment into a real pending refund", async () => {
    await requestBill(scope());
    const paid = await pay("B");
    const [dal] = await env.db.select().from(s.orderLines).where(and(eq(s.orderLines.sessionId, g.A.sessionId), eq(s.orderLines.nameEn, "Dal Makhani")));
    await env.db.update(s.orderLines).set({ status: "voided", voidReason: "Wrong dish" }).where(eq(s.orderLines.id, dal.id));
    await requestBill(scope()); // any bill recalculation picks it up
    // Bhavna now owes Naan 60 + Tikka 80 + Papad 45 = 185 + 9.25 GST = 194.25 -> 194, so 273 comes back
    const [refund] = await env.db.select().from(s.refunds).where(eq(s.refunds.paymentId, paid.paymentId));
    expect(refund).toMatchObject({ amountPaise: 27300, status: "pending" });
    const bhavna = await view("B");
    expect(bhavna.people.find((p) => p.isMe)).toMatchObject({ amountPaise: 19400, paidPaise: 19400, status: "paid" });
    expect(bhavna.refundPendingPaise).toBe(27300);
    expect(bhavna.bill.totals.totalPaise).toBe(209000 - 27300);
    // Recalculating again creates nothing new
    await requestBill(scope());
    expect(await env.db.select().from(s.refunds)).toHaveLength(1);

    // The refund goes to the gateway; it stays pending until a verified gateway event says done
    expect(await executeRefund(cashier, refund.id)).toBe("pending");
    const [sent] = await env.db.select().from(s.refunds).where(eq(s.refunds.id, refund.id));
    const [paidRow] = await env.db.select().from(s.payments).where(eq(s.payments.id, paid.paymentId));
    expect((await view("B")).refundPendingPaise).toBe(27300);
    const refundEvent = { kind: "refund" as const, gatewayRefundId: sent.gatewayRef!, gatewayPaymentId: paidRow.gatewayPaymentId!, status: "success" as const, amountPaise: 27300 };
    const bad = await hook(refundEvent, true);
    expect(bad.status).toBe(401);
    expect((await view("B")).refundPendingPaise).toBe(27300);
    expect((await hook(refundEvent)).status).toBe(200);
    const [done] = await env.db.select().from(s.refunds).where(eq(s.refunds.id, refund.id));
    expect(done.status).toBe("success");
    expect(done.completedAt).not.toBeNull();
    expect((await view("B")).refundPendingPaise).toBe(0);
  });
});

describe("gateway webhooks", () => {
  it("accept only a valid signature, settle once, and ignore duplicates", async () => {
    await requestBill(scope());
    const start = await startPayment(g.B, { method: "upi", requestId: rid() });
    const event: WebhookEvent = { kind: "payment", gatewayRef: start.gatewayRef!, gatewayPaymentId: "pay_1", status: "success", amountPaise: 46700 };
    expect((await hook(event, true)).status).toBe(401);
    expect((await view("B")).people.find((p) => p.isMe)?.status).toBe("paying");
    expect((await hook(event)).status).toBe(200);
    expect((await hook(event)).status).toBe(200);
    const bhavna = (await view("B")).people.find((p) => p.isMe)!;
    expect(bhavna).toMatchObject({ status: "paid", paidPaise: 46700 });
    const [row] = await env.db.select().from(s.payments).where(eq(s.payments.id, start.paymentId));
    expect(row).toMatchObject({ status: "success", gatewayPaymentId: "pay_1" });
    expect(await env.db.select().from(s.refunds)).toHaveLength(0);
  });

  it("creates guest orders with the restaurant's account and accepts only its signed Cashfree webhook once", async () => {
    const merchantId = "restaurant_cashfree_app_123";
    const merchantSecret = "restaurant_cashfree_secret_456";
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PAYMENT_CREDENTIALS_KEY", "d".repeat(64));
    vi.stubEnv("CASHFREE_MODE", "sandbox");
    vi.stubEnv("CASHFREE_CLIENT_ID", "tableqr_platform_app_123");
    vi.stubEnv("CASHFREE_CLIENT_SECRET", "tableqr_platform_secret_456");

    const encrypted = encryptMerchantCredentials({ mode: "sandbox", clientId: merchantId, clientSecret: merchantSecret });
    await env.db.update(s.outlets).set({ paymentGatewayConfig: encrypted }).where(eq(s.outlets.id, g.A.outletId));
    await requestBill(scope());

    const apiCalls: { url: string; init: RequestInit }[] = [];
    let orderNumber = 0;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      apiCalls.push({ url, init });
      if (url.endsWith("/refunds")) return Response.json({ refund_id: "restaurant_refund_001", refund_status: "PENDING" });
      orderNumber += 1;
      return Response.json({ order_id: `restaurant_order_00${orderNumber}` });
    });
    const start = await startPayment(g.B, {
      method: "upi",
      requestId: rid(),
      callbackUrl: "https://restaurant.example/payment-return?p={paymentId}",
    });

    expect(start.provider).toBe("cashfree");
    expect(apiCalls).toHaveLength(1);
    expect(apiCalls[0].init.headers).toMatchObject({ "x-client-id": merchantId, "x-client-secret": merchantSecret });
    expect(apiCalls[0].init.headers).not.toMatchObject({ "x-client-id": "tableqr_platform_app_123", "x-client-secret": "tableqr_platform_secret_456" });
    expect(JSON.parse(String(apiCalls[0].init.body)).order_meta.notify_url).toBe("https://restaurant.example/api/payments/cashfree/webhook");

    const raw = JSON.stringify({
      type: "PAYMENT_SUCCESS_WEBHOOK",
      data: {
        order: { order_id: start.gatewayRef },
        payment: { cf_payment_id: 908172635, payment_status: "SUCCESS", payment_amount: start.totalPaise / 100 },
      },
    });
    const wrongSecretResponse = await cashfreeHook(raw, "tableqr_platform_secret_456");
    expect(wrongSecretResponse.status).toBe(401);
    expect((await view("B")).people.find((person) => person.isMe)?.status).toBe("paying");

    expect((await cashfreeHook(raw, merchantSecret)).status).toBe(200);
    expect((await cashfreeHook(raw, merchantSecret)).status).toBe(200);
    const person = (await view("B")).people.find((entry) => entry.isMe)!;
    expect(person).toMatchObject({ status: "paid", paidPaise: start.totalPaise });
    const [payment] = await env.db.select().from(s.payments).where(eq(s.payments.id, start.paymentId));
    expect(payment).toMatchObject({ channel: "cashfree", gatewayRef: "restaurant_order_001", gatewayPaymentId: "908172635", status: "success" });
    expect(await env.db.select().from(s.payments).where(eq(s.payments.gatewayRef, "restaurant_order_001"))).toHaveLength(1);

    const failedStart = await startPayment(g.C, { method: "upi", requestId: rid(), callbackUrl: "https://restaurant.example/payment-return?p={paymentId}" });
    const failedRaw = JSON.stringify({
      type: "PAYMENT_FAILED_WEBHOOK",
      data: { order: { order_id: failedStart.gatewayRef }, payment: { cf_payment_id: 908172636, payment_status: "FAILED", payment_amount: failedStart.totalPaise / 100 } },
    });
    expect((await cashfreeHook(failedRaw, merchantSecret)).status).toBe(200);
    const [failedPayment] = await env.db.select().from(s.payments).where(eq(s.payments.id, failedStart.paymentId));
    expect(failedPayment).toMatchObject({ status: "failed", gatewayPaymentId: "908172636" });
    expect((await view("C")).people.find((person) => person.isMe)?.status).toBe("unpaid");

    const manager = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000002", pin: "2222" })).token))!;
    const refund = await requestRefund(manager, {
      paymentId: start.paymentId,
      amountPaise: 1000,
      reason: "Cashfree refund test",
      requestId: rid(),
    });
    expect(refund.status).toBe("pending");
    expect(apiCalls.at(-1)?.url).toBe("https://sandbox.cashfree.com/pg/orders/restaurant_order_001/refunds");
    const refundRaw = JSON.stringify({
      type: "REFUND_STATUS_WEBHOOK",
      data: { refund: { refund_id: "restaurant_refund_001", cf_payment_id: 908172635, refund_status: "SUCCESS", refund_amount: 10 } },
    });
    const wrongAmount = JSON.stringify({
      type: "REFUND_STATUS_WEBHOOK",
      data: { refund: { refund_id: "restaurant_refund_001", cf_payment_id: 908172635, refund_status: "SUCCESS", refund_amount: 9 } },
    });
    expect((await cashfreeHook(wrongAmount, merchantSecret)).status).toBe(200);
    const [stillPending] = await env.db.select().from(s.refunds).where(eq(s.refunds.id, refund.refundId));
    expect(stillPending.status).toBe("pending");
    expect((await cashfreeHook(refundRaw, merchantSecret)).status).toBe(200);
    expect((await cashfreeHook(refundRaw, merchantSecret)).status).toBe(200);
    const [refunded] = await env.db.select().from(s.refunds).where(eq(s.refunds.id, refund.refundId));
    expect(refunded).toMatchObject({ gatewayRef: "restaurant_refund_001", amountPaise: 1000, status: "success" });
    expect((await view("B")).people.find((person) => person.isMe)?.paidPaise).toBe(start.totalPaise);
    expect((await env.db.select().from(s.payments).where(eq(s.payments.id, start.paymentId)))[0].status).toBe("success");
  });

  it("refuses a webhook signed by another outlet's merchant that names this outlet's order", async () => {
    const victimSecret = "victim_cashfree_secret_456";
    const attackerSecret = "attacker_cashfree_secret_789";
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PAYMENT_CREDENTIALS_KEY", "d".repeat(64));
    await env.db.update(s.outlets).set({ paymentGatewayConfig: encryptMerchantCredentials({ mode: "sandbox", clientId: "victim_app_123", clientSecret: victimSecret }) })
      .where(eq(s.outlets.id, g.A.outletId));
    await env.db.update(s.outlets).set({ paymentGatewayConfig: encryptMerchantCredentials({ mode: "sandbox", clientId: "attacker_app_123", clientSecret: attackerSecret }) })
      .where(eq(s.outlets.id, env.other.outletId));
    // The attacker's own settled payment gives it a real cf_payment_id to point the lookup at
    await env.conn.query("SET FOREIGN_KEY_CHECKS = 0");
    await env.db.insert(s.payments).values({ id: rid(), tenantId: env.other.tenantId, outletId: env.other.outletId, billId: rid(), allocations: [], method: "upi", channel: "cashfree", gatewayRef: "attacker_order_001", gatewayPaymentId: "555000111", amountPaise: 100, status: "success" });
    await env.conn.query("SET FOREIGN_KEY_CHECKS = 1");

    await requestBill(scope());
    vi.stubGlobal("fetch", async () => Response.json({ order_id: "victim_order_001" }));
    const start = await startPayment(g.B, { method: "upi", requestId: rid(), callbackUrl: "https://restaurant.example/payment-return?p={paymentId}" });
    const forged = JSON.stringify({
      type: "PAYMENT_SUCCESS_WEBHOOK",
      data: { order: { order_id: start.gatewayRef }, payment: { cf_payment_id: 555000111, payment_status: "SUCCESS", payment_amount: start.totalPaise / 100 } },
    });

    expect((await cashfreeHook(forged, attackerSecret)).status).toBe(404);
    expect((await env.db.select().from(s.payments).where(eq(s.payments.id, start.paymentId)))[0].status).not.toBe("success");
    expect((await view("B")).people.find((person) => person.isMe)?.status).toBe("paying");
  });
});

describe("returning from the gateway", () => {
  const back = (paymentId: string, extra = "") =>
    paymentReturn(new Request(`http://localhost/api/payments/return?p=${paymentId}&to=${encodeURIComponent("/r/SRJ01/t/k7Qm/bill")}${extra}`));

  it("asks the gateway itself; the browser's word is never the result", async () => {
    await requestBill(scope());
    const start = await startPayment(g.B, { method: "upi", requestId: rid() });
    // Coming back before paying: still pending, never called failed
    let res = await back(start.paymentId);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`http://localhost/r/SRJ01/t/k7Qm/bill?p=${start.paymentId}`);
    expect((await view("B")).latestPayment?.status).toBe("pending");
    mockGateway.settle(start.gatewayRef!, "pending"); // the bank is still processing
    await back(start.paymentId);
    expect((await view("B")).latestPayment?.status).toBe("pending");
    mockGateway.settle(start.gatewayRef!, "success");
    res = await back(start.paymentId);
    expect((await view("B")).latestPayment?.status).toBe("success");
  });

  it("closes a cancelled attempt only when the gateway confirms nothing was attempted", async () => {
    await requestBill(scope());
    const start = await startPayment(g.B, { method: "card", requestId: rid() });
    await back(start.paymentId, "&cancelled=1");
    expect((await view("B")).latestPayment?.status).toBe("cancelled");
    // A late capture is still recorded: money taken is never lost
    mockGateway.settle(start.gatewayRef!, "success");
    await confirmPayment(start.paymentId, { gatewayRef: start.gatewayRef!, status: "success", amountPaise: 46700 });
    expect((await view("B")).people.find((p) => p.isMe)?.status).toBe("paid");
  });

  it("never redirects off the site", async () => {
    const res = await paymentReturn(new Request("http://localhost/api/payments/return?p=x&to=https%3A%2F%2Fevil.example%2F"));
    expect(res.headers.get("location")).toBe("http://localhost/");
  });

  it("settles a payment whose browser closed, through the minute re-check", async () => {
    await requestBill(scope());
    const start = await startPayment(g.B, { method: "upi", requestId: rid() });
    mockGateway.settle(start.gatewayRef!, "success");
    expect(await reconcilePendingPayments({ tenantId: g.A.tenantId, outletId: g.A.outletId })).toBe(1);
    expect((await view("B")).people.find((p) => p.isMe)?.status).toBe("paid");
  });

  it("closes attempts nobody paid so the bill can be reopened, and still records a late payment", async () => {
    await requestBill(scope());
    const open = await startPayment(g.B, { method: "upi", requestId: rid() });
    const lost = await startPayment(g.C, { method: "upi", requestId: rid() });
    // The server stopped before the gateway order was made
    await env.db.update(s.payments).set({ status: "initiated", gatewayRef: null }).where(eq(s.payments.id, lost.paymentId));
    const later = new Date(Date.now() + 31 * 60_000);
    await reconcilePendingPayments({ tenantId: g.A.tenantId, outletId: g.A.outletId }, later);
    const rows = new Map((await env.db.select().from(s.payments)).map((p) => [p.id, p]));
    expect(rows.get(open.paymentId)).toMatchObject({ status: "failed", failureReason: "Cancelled before paying" });
    expect(rows.get(lost.paymentId)).toMatchObject({ status: "failed", failureReason: "Never reached the payment gateway" });
    await reopenBill({ kind: "guest", ctx: g.A });

    mockGateway.settle(open.gatewayRef!, "success");
    await confirmPayment(open.paymentId, { gatewayRef: open.gatewayRef!, status: "success", amountPaise: open.totalPaise });
    expect((await env.db.select().from(s.payments).where(eq(s.payments.id, open.paymentId)))[0].status).toBe("success");
  });
});

describe("paying for others", () => {
  it("records exactly who was covered and blocks an overlapping attempt", async () => {
    await requestBill(scope());
    const start = await startPayment(g.A, { method: "upi", forParticipantIds: [g.A.participantId, g.C.participantId], requestId: rid() });
    await failsWith(startPayment(g.C, { method: "upi", requestId: rid() }), "invalid_state", "being_paid");
    mockGateway.settle(start.gatewayRef!, "success");
    await confirmPayment(start.paymentId, { gatewayRef: start.gatewayRef!, status: "success", amountPaise: 54100 + 62000 });
    const [row] = await env.db.select().from(s.payments).where(eq(s.payments.id, start.paymentId));
    const shares = await env.db.select().from(s.billShares).where(eq(s.billShares.billId, row.billId));
    const covered = row.allocations.map((a) => shares.find((sh) => sh.id === a.shareId)?.participantId).sort();
    expect(covered).toEqual([g.A.participantId, g.C.participantId].sort());
    expect((await view("C")).people.find((p) => p.isMe)).toMatchObject({ status: "paid", paidBy: "Aarav" });
    await failsWith(startPayment(g.C, { method: "upi", requestId: rid() }), "invalid_state", "nothing_due");
  });

  it("counter and online settling the same share at once count it once and refund the rest", async () => {
    await requestBill(scope());
    const start = await startPayment(g.C, { method: "upi", requestId: rid() });
    await Promise.all([
      settleAtCounter(cashier, { sessionId: g.A.sessionId, forParticipantIds: [g.C.participantId], method: "cash" }),
      confirmPayment(start.paymentId, { gatewayRef: start.gatewayRef!, status: "success", amountPaise: 62000 }),
    ]);
    const [chirag] = await env.db.select().from(s.billShares).where(eq(s.billShares.participantId, g.C.participantId));
    expect(chirag.paidPaise).toBe(62000);
    const refunds = await env.db.select().from(s.refunds);
    expect(refunds.map((r) => r.amountPaise)).toEqual([62000]);
  });
});
