import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { confirmByGatewayRef, reconcilePayment, requestBill, startPayment } from "@/server/billing/payments";
import { requestRefund } from "@/server/billing/refunds";
import { recheckOnlinePayment, releaseStuckPayment } from "@/server/billing/stuck-payment";
import { AppError } from "@/server/errors";
import { addCartLine } from "@/server/guest/cart";
import { getBillScreen } from "@/server/guest/bill-screen";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { acceptOrder, acceptTicket, bumpLine, bumpTicket, markServed, recallTicket, setOutOfStock, startTicket } from "@/server/kitchen/actions";
import { mockGateway } from "@/server/payments/gateway";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import type { StaffContext } from "@/server/staff/context";
import { attachVerifiedTestGuest, resetTestDb } from "./setup-db";

// Phase 3C: a restaurant's kitchen, payments and guests cannot reach another restaurant's rows by
// id, and a request cannot change the restaurant or outlet it speaks for.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let manager: StaffSession;
let demoKitchen: StaffContext;
let otherGuest: GuestContext;
let demoGuest: GuestContext;
let otherOrderId: string;
let otherTicketId: string;
let otherLineId: string;
let otherPaymentId: string;
let otherGatewayRef: string;
let otherSessionId: string;

const refused = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof AppError ? e.code : `other:${String(e)}`));
const rid = () => `p3i-${Math.random().toString(36).slice(2, 12)}`;

async function seat(outletCode: string, shortCode: string, deviceId: string, name: string) {
  const { participantId } = await startOrJoinTable({ outletCode, shortCode, deviceId, displayName: name });
  return attachVerifiedTestGuest(appDb, await getGuestContext(outletCode, shortCode, participantId, deviceId), name);
}

beforeAll(async () => {
  env = await resetTestDb();
  manager = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000002", pin: "2222" })).token))!;
  demoKitchen = { tenantId: env.demo.tenantId, outletId: env.demo.outletId, userId: null };

  otherGuest = await seat("CNJ01", env.other.tableQr, "p3i-other", "Nina");
  await addCartLine(otherGuest, { itemId: env.other.itemId, qty: 2 });
  const placed = await placeOrder(otherGuest, { requestId: rid() });
  otherOrderId = placed.orderId;
  otherSessionId = otherGuest.sessionId;
  const [ticket] = await env.db.select().from(s.tickets).where(eq(s.tickets.orderId, otherOrderId));
  otherTicketId = ticket.id;
  const [line] = await env.db.select().from(s.orderLines).where(eq(s.orderLines.orderId, otherOrderId));
  otherLineId = line.id;
  await requestBill({ tenantId: otherGuest.tenantId, outletId: otherGuest.outletId, sessionId: otherSessionId });
  const start = await startPayment(otherGuest, { method: "upi", requestId: rid() });
  otherPaymentId = start.paymentId;
  otherGatewayRef = start.gatewayRef!;

  demoGuest = await seat("SRJ01", env.demo.tableQr.T2, "p3i-demo", "Dev");
  await addCartLine(demoGuest, { itemId: env.demo.itemIds["Dal Makhani"], qty: 1 });
  await placeOrder(demoGuest, { requestId: rid() });
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

async function otherRows() {
  const [order] = await env.db.select().from(s.orders).where(eq(s.orders.id, otherOrderId));
  const [line] = await env.db.select().from(s.orderLines).where(eq(s.orderLines.id, otherLineId));
  const [payment] = await env.db.select().from(s.payments).where(eq(s.payments.id, otherPaymentId));
  return { order: order.status, line: line.status, payment: payment.status };
}

describe("kitchen: another restaurant's ticket, line and dish", () => {
  it("cannot be accepted, started, bumped, recalled, served or marked out of stock by id", async () => {
    const before = await otherRows();
    const results = await Promise.all([
      refused(acceptOrder(demoKitchen, otherOrderId)),
      refused(acceptTicket(demoKitchen, otherTicketId)),
      refused(startTicket(demoKitchen, otherTicketId)),
      refused(bumpTicket(demoKitchen, otherTicketId)),
      refused(recallTicket(demoKitchen, otherTicketId)),
      refused(bumpLine(demoKitchen, otherLineId)),
      refused(markServed(demoKitchen, [otherLineId])),
      refused(setOutOfStock(demoKitchen, env.other.itemId, true)),
    ]);
    for (const r of results) expect(r, JSON.stringify(results)).not.toBeNull();
    expect(await otherRows()).toEqual(before);
    const [override] = await env.db.select().from(s.outletItemOverrides).where(eq(s.outletItemOverrides.itemId, env.other.itemId));
    expect(override?.isAvailable ?? true).toBe(true);
  });

  it("is not reachable by pointing the demo outlet at the other restaurant's outlet id either", async () => {
    const spoofed: StaffContext = { tenantId: env.demo.tenantId, outletId: env.other.outletId, userId: null };
    expect(await refused(acceptTicket(spoofed, otherTicketId))).not.toBeNull();
    const crossed: StaffContext = { tenantId: env.other.tenantId, outletId: env.demo.outletId, userId: null };
    expect(await refused(acceptTicket(crossed, otherTicketId))).not.toBeNull();
  });
});

describe("payments: another restaurant's payment", () => {
  it("cannot be refunded, rechecked, released or reconciled by a manager of another restaurant", async () => {
    const before = await otherRows();
    expect(await refused(requestRefund(manager, { paymentId: otherPaymentId, amountPaise: 100, reason: "Not mine", requestId: rid() }))).toBe("not_found");
    expect(await recheckOnlinePayment(manager, otherSessionId)).toBe("none");
    expect(await releaseStuckPayment(manager, otherSessionId, new Date(Date.now() + 60 * 60_000))).toEqual({ released: false, view: "none" });
    expect(await refused(reconcilePayment({ tenantId: env.demo.tenantId }, otherPaymentId))).toBe("not_found");
    expect(await otherRows()).toEqual(before);
    expect(await env.db.select().from(s.refunds).where(eq(s.refunds.paymentId, otherPaymentId))).toHaveLength(0);
  });

  it("is settled only through its own gateway reference, and a reference of another channel finds nothing", async () => {
    expect(await confirmByGatewayRef("cashfree", { gatewayRef: otherGatewayRef, status: "success", amountPaise: 30000, gatewayPaymentId: "pay_x" })).toBeNull();
    expect((await otherRows()).payment).toBe("pending");
    mockGateway.settle(otherGatewayRef, "success");
    const done = await confirmByGatewayRef("mock", { gatewayRef: otherGatewayRef, status: "success", amountPaise: 30000, gatewayPaymentId: "pay_other" });
    expect(done?.status).toBe("success");
    const [row] = await env.db.select().from(s.payments).where(eq(s.payments.id, otherPaymentId));
    expect(row).toMatchObject({ tenantId: env.other.tenantId, outletId: env.other.outletId });
  });
});

describe("guests: a request cannot change whose restaurant it is", () => {
  it("ignores a tenant or outlet swapped into the guest context", async () => {
    await addCartLine(demoGuest, { itemId: env.demo.itemIds["Cola"], qty: 1 });
    const tenantSwapped = { ...demoGuest, tenantId: env.other.tenantId };
    const outletSwapped = { ...demoGuest, outletId: env.other.outletId };
    const beforeOther = await env.db.select().from(s.orders).where(eq(s.orders.tenantId, env.other.tenantId));
    expect(await refused(placeOrder(tenantSwapped, { requestId: rid() }))).not.toBeNull();
    expect(await refused(placeOrder(outletSwapped, { requestId: rid() }))).not.toBeNull();
    expect(await refused(addCartLine(tenantSwapped, { itemId: env.demo.itemIds["Cola"], qty: 1 }))).not.toBeNull();
    expect(await env.db.select().from(s.orders).where(eq(s.orders.tenantId, env.other.tenantId))).toHaveLength(beforeOther.length);
    const strays = await env.db.select().from(s.cartLines).where(and(eq(s.cartLines.tenantId, env.other.tenantId), eq(s.cartLines.itemId, env.demo.itemIds["Cola"])));
    expect(strays).toHaveLength(0);
  });

  it("does not open a table, or a bill, with another restaurant's code, QR or participant", async () => {
    expect(await refused(getGuestContext("CNJ01", env.demo.tableQr.T2, demoGuest.participantId, "p3i-demo"))).not.toBeNull();
    expect(await refused(getGuestContext("SRJ01", env.other.tableQr, otherGuest.participantId, "p3i-other"))).not.toBeNull();
    expect(await refused(getGuestContext("SRJ01", env.demo.tableQr.T2, otherGuest.participantId, "p3i-other"))).not.toBeNull();
    expect(await refused(getGuestContext("SRJ01", env.demo.tableQr.T2, demoGuest.participantId, "someone-elses-phone"))).not.toBeNull();
    expect(await refused(getBillScreen("CNJ01", env.demo.tableQr.T2, "p3i-demo"))).not.toBeNull();
  });
});

describe("responses do not leak who else is at the table", () => {
  it("never carry another diner's phone number or a secret", async () => {
    const second = await seat("SRJ01", env.demo.tableQr.T2, "p3i-demo-2", "Esha");
    await addCartLine(second, { itemId: env.demo.itemIds["Cola"], qty: 1 });
    await placeOrder(second, { requestId: rid() });
    const phones = (await env.db.select({ phone: s.guests.phone }).from(s.guests).where(eq(s.guests.tenantId, env.demo.tenantId))).map((g) => g.phone);
    expect(phones.length).toBeGreaterThan(1);
    const screen = JSON.stringify(await getBillScreen("SRJ01", env.demo.tableQr.T2, "p3i-demo"));
    for (const phone of phones) expect(screen).not.toContain(phone.replace(/^\+91/, ""));
    expect(screen).not.toMatch(/secret|credential|password|tokenHash|webhook/i);
  });
});
