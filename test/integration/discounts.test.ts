import { and, desc, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { clearBillDiscount, setBillDiscount } from "@/server/billing/discounts";
import { requestBill, settleAtCounter } from "@/server/billing/payments";
import { AppError } from "@/server/errors";
import { addCartLine } from "@/server/guest/cart";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { attachVerifiedTestGuest, resetTestDb } from "./setup-db";

// Bill discounts from the billing screen: percent or rupees, with a reason, before anyone pays.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let owner: StaffSession;
let waiter: StaffSession;
let guest: GuestContext;
const bill = async () => (await env.db.select().from(s.bills).where(eq(s.bills.sessionId, guest.sessionId)))[0];
const fails = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as AppError;

beforeAll(async () => {
  env = await resetTestDb();
  owner = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000001", pin: "1111" })).token))!;
  waiter = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000005", pin: "5555" })).token))!;
  const qr = env.demo.tableQr.T1;
  const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: "disc-a", displayName: "Aarav" });
  guest = await attachVerifiedTestGuest(appDb, await getGuestContext("SRJ01", qr, participantId, "disc-a"), "Aarav");
  await addCartLine(guest, { itemId: env.demo.itemIds["Dal Makhani"], qty: 2 });
  await placeOrder(guest);
  await requestBill({ tenantId: guest.tenantId, outletId: guest.outletId, sessionId: guest.sessionId });
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("bill discount", () => {
  it("takes a percent off the food total and lowers what the table pays", async () => {
    const before = await bill();
    const res = await setBillDiscount(owner, { sessionId: guest.sessionId, kind: "percent", value: 10, reason: "Regular guest" });
    const after = await bill();
    expect(res.amountPaise).toBe(Math.round(before.subtotalPaise * 0.1));
    expect(after.discountPaise).toBe(res.amountPaise);
    expect(after.totalPaise).toBeLessThan(before.totalPaise);
    const shares = await env.db.select().from(s.billShares).where(eq(s.billShares.billId, after.id));
    expect(shares.reduce((n, sh) => n + sh.amountPaise, 0)).toBe(after.totalPaise);
  });

  it("replaces the earlier discount, can be removed, and is audited", async () => {
    await setBillDiscount(owner, { sessionId: guest.sessionId, kind: "flat", value: 50, reason: "Late food" });
    const b = await bill();
    expect(b.discountPaise).toBe(5000);
    expect(await env.db.select().from(s.discounts).where(and(eq(s.discounts.billId, b.id), isNull(s.discounts.orderLineId)))).toHaveLength(1);
    await clearBillDiscount(owner, guest.sessionId);
    expect((await bill()).discountPaise).toBe(0);
    const logged = await env.db.select({ action: s.auditLog.action }).from(s.auditLog).where(eq(s.auditLog.entityId, b.id));
    expect(logged.map((l) => l.action)).toEqual(expect.arrayContaining(["bill.discount_set", "bill.discount_removed"]));
  });

  it("lets a cashier give up to 10% alone, and more only with a manager's PIN", async () => {
    const cashier = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000003", pin: "3333" })).token))!;
    await setBillDiscount(cashier, { sessionId: guest.sessionId, kind: "percent", value: 10, reason: "Regular guest" });
    expect((await fails(setBillDiscount(cashier, { sessionId: guest.sessionId, kind: "percent", value: 15, reason: "Birthday" }))).code).toBe("forbidden");
    expect((await fails(setBillDiscount(cashier, { sessionId: guest.sessionId, kind: "percent", value: 15, reason: "Birthday", approval: { phone: "9000000005", pin: "5555" } }))).code).toBe("forbidden");
    await setBillDiscount(cashier, { sessionId: guest.sessionId, kind: "percent", value: 15, reason: "Birthday", approval: { phone: "9000000002", pin: "2222" } });
    const b = await bill();
    expect(b.discountPaise).toBe(Math.round(b.subtotalPaise * 0.15));
    const [entry] = await env.db.select({ after: s.auditLog.after }).from(s.auditLog).where(and(eq(s.auditLog.entityId, b.id), eq(s.auditLog.action, "bill.discount_set"))).orderBy(desc(s.auditLog.createdAt)).limit(1);
    expect((entry.after as { approverUserId: string | null }).approverUserId).toBeTruthy();
    await clearBillDiscount(owner, guest.sessionId);
  });

  it("needs a reason and a billing role, and stops once money is taken", async () => {
    expect((await fails(setBillDiscount(owner, { sessionId: guest.sessionId, kind: "percent", value: 10, reason: "" }))).details?.reason).toBe("reason");
    expect((await fails(setBillDiscount(owner, { sessionId: guest.sessionId, kind: "percent", value: 150, reason: "Too much" }))).details?.reason).toBe("value");
    expect((await fails(setBillDiscount(waiter, { sessionId: guest.sessionId, kind: "percent", value: 10, reason: "Friend" }))).code).toBe("forbidden");
    const shares = await env.db.select().from(s.billShares).where(eq(s.billShares.billId, (await bill()).id));
    await settleAtCounter(owner, { sessionId: guest.sessionId, forParticipantIds: [shares[0].participantId!], method: "cash", receivedPaise: shares[0].amountPaise });
    expect((await fails(setBillDiscount(owner, { sessionId: guest.sessionId, kind: "percent", value: 10, reason: "After paying" }))).code).toMatch(/invalid_state|session_expired/);
  });
});
