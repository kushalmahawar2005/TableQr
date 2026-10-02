import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { confirmPayment, requestBill, settleAtCounter, startPayment } from "@/server/billing/payments";
import { AppError } from "@/server/errors";
import { AFTER_VISIT_HOURS, findVisit, getAfterVisit, getReceipt, requireVisit, submitFeedback } from "@/server/guest/after-visit";
import { addCartLine } from "@/server/guest/cart";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { guestContextForDevice } from "@/server/guest/menu-screen";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { mockGateway } from "@/server/payments/gateway";
import { onPublish, type RealtimeEvent } from "@/server/realtime/publish";
import { configuredReceiptChannels, registerReceiptSender, sendReceipt } from "@/server/receipts/channels";
import type { StaffContext } from "@/server/staff/context";
import { resetTestDb } from "./setup-db";

// G9 Paid, receipt and next visit: progress, the 24-hour read-only visit, the receipt, one
// rating, the manager alert, the review link for everyone, and receipt channels.

let env: Awaited<ReturnType<typeof resetTestDb>>;
const g: Record<"A" | "B" | "C", GuestContext> = {} as never;
let cashier: StaffContext;
let events: RealtimeEvent[] = [];
let stop: () => void;
let n = 0;
const rid = () => `g9-req-${++n}-${Date.now()}`;
const scope = () => ({ tenantId: g.A.tenantId, outletId: g.A.outletId, sessionId: g.A.sessionId });
const after = (who: string, now?: Date) => getAfterVisit("SRJ01", "k7Qm", `g9-${who}`, now);

async function failsWith(p: Promise<unknown>, code: AppError["code"]) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}

async function pay(who: keyof typeof g, forWho?: (keyof typeof g)[]) {
  const start = await startPayment(g[who], { method: "upi", requestId: rid(), forParticipantIds: forWho?.map((w) => g[w].participantId), tipPaise: who === "A" ? 2000 : 0 });
  mockGateway.settle(start.gatewayRef!, "success");
  await confirmPayment(start.paymentId, { gatewayRef: start.gatewayRef!, status: "success", amountPaise: start.totalPaise });
}

beforeAll(() => {
  stop = onPublish((_s, sent) => events.push(...sent));
});
beforeEach(async () => {
  if (env) await env.conn.end();
  env = await resetTestDb();
  cashier = { tenantId: env.demo.tenantId, outletId: env.demo.outletId, userId: null };
  for (const [key, name] of [["A", "Aarav"], ["B", "Bhavna"], ["C", "Chirag"]] as const) {
    const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: "k7Qm", deviceId: `g9-${key}`, displayName: name });
    g[key] = await getGuestContext("SRJ01", "k7Qm", participantId, `g9-${key}`);
    await addCartLine(g[key], { itemId: env.demo.itemIds[key === "A" ? "Veg Biryani" : key === "B" ? "Dal Makhani" : "Cola"], qty: 1 });
    await placeOrder(g[key]);
  }
  await requestBill(scope());
  events = [];
});
afterAll(async () => {
  stop();
  registerReceiptSender(null, "sms");
  if (env) await env.conn.end();
  await appDb.$client.end();
});

describe("after paying, table still open", () => {
  it("shows what I paid, the table's progress and who is still to pay", async () => {
    await pay("B");
    const v = await after("B");
    expect(v).toMatchObject({ expired: false, state: "open", paidPaise: 27300, mySettled: true, progress: { paid: 1, total: 3 }, allSettled: false });
    expect(v && !v.expired && v.waitingFor).toEqual(["Aarav", "Chirag"]);
    expect(v && !v.expired && v.receipt).toEqual({ available: true, kind: "payment_receipt" });
  });

  it("names who I paid for", async () => {
    await pay("A", ["A", "C"]);
    const v = await after("A");
    expect(v).toMatchObject({ paidFor: ["Chirag"], tipPaise: 2000, progress: { paid: 2, total: 3 } });
    const receipt = await getReceipt("SRJ01", "k7Qm", "g9-A");
    expect(receipt.invoice).toBeNull();
    expect(receipt.myPayments).toHaveLength(1);
    expect(receipt.myPayments[0]).toMatchObject({ method: "upi", tipPaise: 2000 });
    expect(receipt.myPayments[0].covered.map((c) => (c.isMe ? "me" : c.name)).sort()).toEqual(["Chirag", "me"]);
  });
});

describe("after the table closes", () => {
  it("keeps read-only access on the same phone for 24 hours, with the invoice", async () => {
    await pay("A", ["A", "C"]);
    await settleAtCounter(cashier, { sessionId: g.A.sessionId, method: "cash" });
    const v = await after("A");
    expect(v).toMatchObject({ state: "closed", allSettled: true, progress: { paid: 3, total: 3 }, receipt: { available: true, kind: "tax_invoice" } });
    // Still no way back into ordering
    await failsWith(guestContextForDevice("SRJ01", "k7Qm", "g9-A"), "session_expired");
    const receipt = await getReceipt("SRJ01", "k7Qm", "g9-A");
    expect(receipt.invoice).toMatchObject({ docType: "tax_invoice" });
    expect(receipt.invoice?.snapshot.payments.map((p) => [p.payer, p.covered.sort()])).toEqual([["Aarav", ["Aarav", "Chirag"]], [null, ["Bhavna"]]]);

    const [session] = await env.db.select().from(s.tableSessions).where(eq(s.tableSessions.id, g.A.sessionId));
    const later = (h: number) => new Date(session.closedAt!.getTime() + h * 3600_000);
    expect((await after("A", later(AFTER_VISIT_HOURS - 0.1)))?.expired).toBe(false);
    expect((await after("A", later(AFTER_VISIT_HOURS + 0.1)))?.expired).toBe(true);
    await failsWith(requireVisit("SRJ01", "k7Qm", "g9-A", later(AFTER_VISIT_HOURS + 0.1)), "session_expired");
    await failsWith(getReceipt("SRJ01", "k7Qm", "g9-A", later(AFTER_VISIT_HOURS + 0.1)), "session_expired");
    // Another phone, or none, sees nothing
    expect(await after("stranger")).toBeNull();
    expect(await findVisit("SRJ01", "k7Qm", null)).toBeNull();
  });

  it("labels the document a Receipt, never a Tax invoice, when the restaurant has no GSTIN", async () => {
    await env.db.update(s.outlets).set({ gstin: null }).where(eq(s.outlets.id, g.A.outletId));
    await settleAtCounter(cashier, { sessionId: g.A.sessionId, method: "cash" });
    expect((await after("B"))).toMatchObject({ receipt: { kind: "receipt" } });
    expect((await getReceipt("SRJ01", "k7Qm", "g9-B")).invoice?.docType).toBe("receipt");
  });

  it("gives a removed person no after-visit view", async () => {
    await env.db.update(s.participants).set({ removedAt: new Date() }).where(eq(s.participants.id, g.C.participantId));
    expect(await after("C")).toBeNull();
  });
});

describe("feedback", () => {
  it("takes one rating per person; two stars or fewer alerts the manager, silently", async () => {
    const visit = await requireVisit("SRJ01", "k7Qm", "g9-B");
    expect(await submitFeedback(visit, 2)).toEqual({ rating: 2, alreadyRated: false });
    expect(events).toContainEqual(expect.objectContaining({ topic: "tasks", type: "feedback.low_rating" }));
    events = [];
    expect(await submitFeedback(visit, 5)).toEqual({ rating: 2, alreadyRated: true });
    expect(events).toHaveLength(0);
    const rows = await env.db.select().from(s.feedback);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rating: 2, needsRecovery: true });
    await expect(submitFeedback(visit, 6)).rejects.toBeInstanceOf(AppError);

    const happy = await requireVisit("SRJ01", "k7Qm", "g9-A");
    await submitFeedback(happy, 5);
    expect(events).toHaveLength(0);
    expect((await env.db.select().from(s.feedback).where(eq(s.feedback.rating, 5)))[0].needsRecovery).toBe(false);
  });

  it("shows the review link to everyone the same way, whatever they rated", async () => {
    expect((await after("A"))).toMatchObject({ reviewUrl: null });
    await env.db.update(s.outlets).set({ reviewUrl: "https://g.page/r/spice-route/review" }).where(eq(s.outlets.id, g.A.outletId));
    await submitFeedback(await requireVisit("SRJ01", "k7Qm", "g9-A"), 1);
    await submitFeedback(await requireVisit("SRJ01", "k7Qm", "g9-B"), 5);
    const [low, high, none] = await Promise.all([after("A"), after("B"), after("C")]);
    for (const v of [low, high, none]) expect(v).toMatchObject({ reviewUrl: "https://g.page/r/spice-route/review" });
  });
});

describe("receipt channels", () => {
  it("offers only configured channels and records what really happened", async () => {
    expect(configuredReceiptChannels()).toEqual([]);
    expect((await after("A"))).toMatchObject({ channels: [] });
    const sent: string[] = [];
    registerReceiptSender({ channel: "sms", send: async (i) => (sent.push(i.to), { ok: true, ref: "sms_1" }) });
    expect(configuredReceiptChannels()).toEqual(["sms"]);
    const visit = await requireVisit("SRJ01", "k7Qm", "g9-A");
    // Open mode: no verified number, so nothing is sent and nothing is recorded as sent
    await expect(sendReceipt(visit, "sms", { outletName: "Spice Route", amountText: "₹294", link: "/x" })).rejects.toMatchObject({ details: { reason: "no_destination" } });
    const [guest] = await env.db.insert(s.guests).values({ tenantId: visit.tenantId, phone: "+919876543210", name: "Aarav" }).$returningId();
    await env.db.update(s.participants).set({ guestId: guest.id }).where(and(eq(s.participants.id, visit.participantId)));
    expect(await sendReceipt(visit, "sms", { outletName: "Spice Route", amountText: "₹294", link: "/x" })).toEqual({ ok: true, destination: "+9198xxxxxx10" });
    expect(sent).toEqual(["+919876543210"]);
    const [row] = await env.db.select().from(s.receiptDeliveries);
    expect(row).toMatchObject({ channel: "sms", status: "sent", providerRef: "sms_1", destination: "+9198xxxxxx10" });
    await expect(sendReceipt(visit, "email", { outletName: "x", amountText: "x", link: "/x" })).rejects.toBeInstanceOf(AppError);
    registerReceiptSender(null, "sms");
  });
});
