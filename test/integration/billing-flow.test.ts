import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { financialYear } from "@/domain/invoice";
import { getBillView } from "@/server/billing/bill";
import { confirmPayment, requestBill, setSplitMode, settleAtCounter, startPayment } from "@/server/billing/payments";
import { AppError } from "@/server/errors";
import { addCartLine } from "@/server/guest/cart";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { mockGateway } from "@/server/payments/gateway";
import type { StaffContext } from "@/server/staff/context";
import { resetTestDb } from "./setup-db";

// The worked example from PS 3.6, played end to end: four friends at Table 12, GST 5%.
// Paneer Tikka is shared by all four, Masala Papad by Aarav and Bhavna.

let env: Awaited<ReturnType<typeof resetTestDb>>;
const g: Record<"A" | "B" | "C" | "D", GuestContext> = {} as never;
let cashier: StaffContext;

async function failsWith(p: Promise<unknown>, code: AppError["code"]) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  return err as AppError;
}

const scope = () => ({ tenantId: g.A.tenantId, outletId: g.A.outletId, sessionId: g.A.sessionId });
const view = (who: keyof typeof g) => getBillView({ ...scope(), participantId: g[who].participantId });
const amounts = async () => (await view("A")).people.map((p) => p.amountPaise / 100);

/** Pays through the mock gateway the way the webhook would confirm it */
async function payOnline(who: keyof typeof g, opts: Parameters<typeof startPayment>[1] = { method: "upi" }, outcome: "success" | "failed" = "success") {
  const start = await startPayment(g[who], opts);
  mockGateway.settle(start.checkout.orderRef, outcome);
  const status = await mockGateway.fetchStatus(start.checkout.orderRef);
  const res = await confirmPayment(start.paymentId, {
    gatewayRef: start.checkout.orderRef,
    status: status.status === "success" ? "success" : "failed",
    amountPaise: status.amountPaise,
  });
  return { start, res };
}

beforeAll(async () => {
  env = await resetTestDb();
  cashier = { tenantId: env.demo.tenantId, outletId: env.demo.outletId, userId: null };
  const item = (name: string) => env.demo.itemIds[name];

  for (const [key, name] of [["A", "Aarav"], ["B", "Bhavna"], ["C", "Chirag"], ["D", "Divya"]] as const) {
    const device = `bill-${key}`;
    const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: "k7Qm", deviceId: device, displayName: name });
    g[key] = await getGuestContext("SRJ01", "k7Qm", participantId, device);
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
  await placeOrder(g.D);
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("the bill (G8)", () => {
  it("matches the spec's worked example to the paise", async () => {
    const bill = await view("A");
    expect(bill.totals).toMatchObject({ subtotalPaise: 199000, taxPaise: 9950, roundOffPaise: 50, totalPaise: 209000 });
    expect(await amounts()).toEqual([541, 467, 620, 462]);
    expect(bill.mine).toMatchObject({
      ownItems: ["Veg Biryani", "Masala Lassi"],
      sharedItems: ["Paneer Tikka", "Masala Papad"],
      detail: { ownItemsPaise: 39000, sharedItemsPaise: 12500, subtotalPaise: 51500, taxPaise: 2575, roundOffPaise: 25, amountPaise: 54100 },
    });
    expect(bill.canChangeMode).toBe(true);
    expect((await view("B")).canChangeMode).toBe(false); // only the host
  });

  it("lets the host switch to an equal split and back", async () => {
    await setSplitMode(g.A, "equal");
    expect(await amounts()).toEqual([523, 523, 522, 522]);
    await failsWith(setSplitMode(g.B, "my_items"), "invalid_state");
    await setSplitMode(g.A, "my_items");
    expect(await amounts()).toEqual([541, 467, 620, 462]);
  });

  it("accepts custom amounts only when they add up to the bill", async () => {
    const custom = (a: number, b: number, c: number, d: number) =>
      [g.A, g.B, g.C, g.D].map((x, i) => ({ participantId: x.participantId, amountPaise: [a, b, c, d][i] * 100 }));
    const err = await failsWith(setSplitMode(g.A, "custom", custom(1000, 500, 500, 0)), "invalid_state");
    expect(err.message).toBe("The amounts must add up to the bill. Still to assign: INR 90.");
    await setSplitMode(g.A, "custom", custom(1090, 500, 500, 0));
    expect(await amounts()).toEqual([1090, 500, 500, 0]);
    await setSplitMode(g.A, "my_items");
  });

  it("request bill pauses ordering and marks the table", async () => {
    await requestBill(scope());
    const [table] = await env.db.select().from(s.diningTables).where(eq(s.diningTables.id, env.demo.tableIds.T12));
    expect(table.state).toBe("bill_requested");
    // Carts freeze too (G3 decision 4); browsing and viewing stay open
    await failsWith(addCartLine(g.D, { itemId: env.demo.itemIds["Cola"], qty: 1 }), "table_settling");
    await failsWith(placeOrder(g.D), "table_settling");
  });
});

describe("paying", () => {
  it("Bhavna pays her own share by UPI; the split is then fixed", async () => {
    const { start, res } = await payOnline("B");
    expect(start).toMatchObject({ amountPaise: 46700, tipPaise: 0, totalPaise: 46700 });
    expect(res).toMatchObject({ status: "success", billPaid: false });
    const bhavna = (await view("A")).people.find((p) => p.name === "Bhavna")!;
    expect(bhavna).toMatchObject({ status: "paid", duePaise: 0 });
    await failsWith(setSplitMode(g.A, "equal"), "invalid_state");
  });

  it("confirming the same payment twice changes nothing the second time", async () => {
    const [p] = await env.db.select().from(s.payments).where(eq(s.payments.status, "success"));
    const again = await confirmPayment(p.id, { gatewayRef: p.gatewayRef!, status: "success", amountPaise: p.amountPaise });
    expect(again).toMatchObject({ alreadyFinal: true });
    const shares = await env.db.select().from(s.billShares).where(eq(s.billShares.paidPaise, 46700));
    expect(shares).toHaveLength(1);
  });

  it("Aarav pays for himself and Divya with a tip; Divya's share shows who paid", async () => {
    const { start } = await payOnline("A", { method: "upi", forParticipantIds: [g.A.participantId, g.D.participantId], tipPaise: 5000 });
    expect(start).toMatchObject({ amountPaise: 54100 + 46200, tipPaise: 5000, totalPaise: 105300 });
    const divya = (await view("D")).people.find((p) => p.isMe)!;
    expect(divya).toMatchObject({ status: "paid", paidBy: "Aarav" });
  });

  it("a failed payment leaves the share unpaid and the table open", async () => {
    const { res } = await payOnline("C", { method: "card" }, "failed");
    expect(res.status).toBe("failed");
    expect((await view("C")).people.find((p) => p.isMe)?.status).toBe("unpaid");
  });

  it("rejects a gateway amount that does not match", async () => {
    const start = await startPayment(g.C, { method: "upi" });
    const res = await confirmPayment(start.paymentId, { gatewayRef: start.checkout.orderRef, status: "success", amountPaise: 100 });
    expect(res.status).toBe("failed");
  });

  it("blocks a second person paying a share someone is already paying", async () => {
    await startPayment(g.C, { method: "upi" }); // Chirag is mid-checkout
    await failsWith(startPayment(g.B, { method: "upi", forParticipantIds: [g.C.participantId] }), "invalid_state");
    await startPayment(g.C, { method: "upi" }); // Chirag retrying replaces his own attempt
  });

  it("the cashier settles the last share in cash; the bill closes with a GST invoice and the table frees", async () => {
    const res = await settleAtCounter(cashier, { sessionId: g.A.sessionId, method: "cash", receivedPaise: 70000 });
    expect(res).toMatchObject({ amountPaise: 62000, changePaise: 8000, billPaid: true });

    const [bill] = await env.db.select().from(s.bills).where(eq(s.bills.sessionId, g.A.sessionId));
    expect(bill).toMatchObject({ status: "paid", totalPaise: 209000, tipPaise: 5000 });

    const [invoice] = await env.db.select().from(s.invoices).where(eq(s.invoices.billId, bill.id));
    expect(invoice.number).toBe(`SRJ01/${financialYear(new Date())}/000001`);
    expect(invoice.snapshot).toMatchObject({
      table: "T12",
      totalPaise: 209000,
      totalInWords: "Rupees Two Thousand Ninety Only",
      seller: { gstin: "08AABCS1234F1Z5", fssai: "12225018000123" },
      paymentModes: { upi: 46700 + 100300, cash: 62000 },
    });

    const [session] = await env.db.select().from(s.tableSessions).where(eq(s.tableSessions.id, g.A.sessionId));
    expect(session).toMatchObject({ status: "closed", openKey: null });
    const [table] = await env.db.select().from(s.diningTables).where(eq(s.diningTables.id, env.demo.tableIds.T12));
    expect(table.state).toBe("paid");
  });

  it("Chirag's UPI succeeding after he paid cash is recorded and queued for refund, never double counted", async () => {
    const [late] = await env.db
      .select()
      .from(s.payments)
      .where(and(eq(s.payments.payerParticipantId, g.C.participantId), eq(s.payments.status, "pending")));
    const res = await confirmPayment(late.id, { gatewayRef: late.gatewayRef!, status: "success", amountPaise: late.amountPaise });
    expect(res).toMatchObject({ status: "success", billPaid: false, refundPaise: 62000 });

    const [refund] = await env.db.select().from(s.refunds).where(eq(s.refunds.paymentId, late.id));
    expect(refund).toMatchObject({ amountPaise: 62000, status: "pending", reason: "Paid twice: this share was already settled" });
    const [chirag] = await env.db.select().from(s.billShares).where(eq(s.billShares.participantId, g.C.participantId));
    expect(chirag.paidPaise).toBe(62000);
    expect(await env.db.select().from(s.invoices)).toHaveLength(1);
  });

  it("an attempt we replaced still gets recorded if the gateway later captures it", async () => {
    const [replaced] = await env.db
      .select()
      .from(s.payments)
      .where(and(eq(s.payments.payerParticipantId, g.C.participantId), eq(s.payments.failureReason, "Replaced by a new attempt")));
    const res = await confirmPayment(replaced.id, { gatewayRef: replaced.gatewayRef!, status: "success", amountPaise: replaced.amountPaise });
    expect(res).toMatchObject({ status: "success", refundPaise: 62000 });
    // A second identical webhook is a no-op
    expect(await confirmPayment(replaced.id, { gatewayRef: replaced.gatewayRef!, status: "success", amountPaise: replaced.amountPaise })).toMatchObject({ alreadyFinal: true });
    expect(await env.db.select().from(s.refunds)).toHaveLength(2);
  });
});

describe("simultaneous final payments", () => {
  it("two people paying the last two shares at the same moment close the bill exactly once", async () => {
    const guests: GuestContext[] = [];
    for (const device of ["t11-x", "t11-y"]) {
      const qr = env.demo.tableQr.T11;
      const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: device, displayName: "Jaya" });
      const ctx = await getGuestContext("SRJ01", qr, participantId, device);
      await addCartLine(ctx, { itemId: env.demo.itemIds["Jeera Rice"], qty: 1 });
      await placeOrder(ctx);
      guests.push(ctx);
    }
    const starts = await Promise.all(guests.map((ctx) => startPayment(ctx, { method: "upi" })));
    const results = await Promise.all(
      starts.map((st) => confirmPayment(st.paymentId, { gatewayRef: st.checkout.orderRef, status: "success", amountPaise: st.totalPaise })),
    );
    expect(results.filter((r) => r.billPaid)).toHaveLength(1);
    const [bill] = await env.db.select().from(s.bills).where(eq(s.bills.sessionId, guests[0].sessionId));
    const invoices = await env.db.select().from(s.invoices).where(eq(s.invoices.billId, bill.id));
    expect(invoices).toHaveLength(1);
    expect(invoices[0].seq).toBe(2);
  });
});

describe("speed", () => {
  it("builds the G8 bill view fast enough to refresh on every event", async () => {
    const runs = 50;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) await view("A");
    const avgMs = (performance.now() - t0) / runs;
    console.log(`getBillView average: ${avgMs.toFixed(2)} ms`);
    expect(avgMs).toBeLessThan(25);
  });
});

describe("billing isolation", () => {
  it("another restaurant cannot see or settle this table's bill", async () => {
    const nukkad: StaffContext = { tenantId: env.other.tenantId, outletId: env.other.outletId, userId: null };
    await failsWith(settleAtCounter(nukkad, { sessionId: g.A.sessionId, method: "cash" }), "not_found");
    await failsWith(getBillView({ tenantId: env.other.tenantId, outletId: env.other.outletId, sessionId: g.A.sessionId, participantId: g.A.participantId }), "not_found");
  });
});
