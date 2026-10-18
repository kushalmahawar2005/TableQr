import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { requestBill, settleAtCounter } from "@/server/billing/payments";
import { AppError } from "@/server/errors";
import { addCartLine } from "@/server/guest/cart";
import { getGuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { getDashboard, getRevenueTrend } from "@/server/staff/dashboard";
import { resetTestDb } from "./setup-db";

// O1 Owner Dashboard read model against the real MySQL test database. Rows are written directly
// with known timestamps so every boundary is exact; one test plays the real order-to-paid flow.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let owner: StaffSession;
let manager: StaffSession;
let host: StaffSession;
const realTz = process.env.TZ;
/** 20:00 in Jaipur on Sunday 4 October 2026 */
const NOW = new Date("2026-10-04T14:30:00Z");
/** Local midnight that starts 4 October in India */
const IST_MIDNIGHT = new Date("2026-10-03T18:30:00Z");
let second: { outletId: string; tableId: string };

const signIn = async (phone: string, pin: string) => (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone, pin })).token))!;
const T = (code: string) => env.demo.tableIds[code];
const item = (name: string) => env.demo.itemIds[name];
const min = (m: number, from = NOW) => new Date(from.getTime() + m * 60_000);
const inZone = (staff: StaffSession, timezone: string): StaffSession => ({ ...staff, outlet: { ...staff.outlet, timezone } });
const dash = (staff: StaffSession = owner, now = NOW) => getDashboard(staff, now);

const OPS_TABLES = [
  "refunds", "payments", "bill_shares", "discounts", "invoices", "invoice_series", "receipt_deliveries", "feedback", "bills", "order_lines", "tickets", "orders",
  "service_requests", "cart_lines", "participants", "session_tables", "table_sessions", "reservation_tables", "reservation_history", "reservation_credits",
  "booking_notifications", "reservations", "waitlist_entries", "booking_policies",
];
async function wipeOps() {
  await env.db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
  for (const t of OPS_TABLES) await env.db.execute(sql.raw(`TRUNCATE TABLE \`${t}\``));
  await env.db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
  await env.db.update(s.diningTables).set({ state: "available", isActive: true }).where(eq(s.diningTables.tenantId, env.demo.tenantId));
}

type Where = { tenantId?: string; outletId?: string };
async function visit(table: string, o: { status?: "open" | "bill_requested" | "closed"; partySize?: number | null; closedAt?: Date; people?: number; tables?: string[] } & Where & { tableId?: string } = {}) {
  const id = uuidv7();
  const tenantId = o.tenantId ?? env.demo.tenantId;
  const tableId = o.tableId ?? T(table);
  const status = o.status ?? "closed";
  await env.db.insert(s.tableSessions).values({ id, tenantId, outletId: o.outletId ?? env.demo.outletId, tableId, mode: "open", status, source: "walk_in", partySize: o.partySize ?? null, openKey: status === "closed" ? null : tableId, openedAt: min(-90, o.closedAt ?? NOW), closedAt: status === "closed" ? (o.closedAt ?? NOW) : null });
  for (let i = 0; i < (o.people ?? 0); i++) await env.db.insert(s.participants).values({ tenantId, sessionId: id, displayName: `Guest ${i + 1}` });
  for (const code of o.tables ?? []) await env.db.insert(s.sessionTables).values({ tenantId, outletId: o.outletId ?? env.demo.outletId, sessionId: id, tableId: T(code), isPrimary: code === table });
  return id;
}
async function bill(sessionId: string, o: { status?: "open" | "paid"; total: number; subtotal?: number; tax?: number; service?: number; tip?: number; discount?: number; credit?: number; closedAt?: Date; requestedAt?: Date } & Where) {
  const id = uuidv7();
  const status = o.status ?? "paid";
  await env.db.insert(s.bills).values({ id, tenantId: o.tenantId ?? env.demo.tenantId, outletId: o.outletId ?? env.demo.outletId, sessionId, status, totalPaise: o.total, subtotalPaise: o.subtotal ?? o.total, taxPaise: o.tax ?? 0, serviceChargePaise: o.service ?? 0, tipPaise: o.tip ?? 0, discountPaise: o.discount ?? 0, bookingCreditPaise: o.credit ?? 0, closedAt: status === "paid" ? (o.closedAt ?? NOW) : null, requestedAt: o.requestedAt ?? null, createdAt: min(-60, o.closedAt ?? NOW) });
  return id;
}
async function paidVisit(table: string, total: number, closedAt = min(-30), extra: Omit<Parameters<typeof bill>[1], "total" | "closedAt"> & { partySize?: number; people?: number } = {}) {
  const sessionId = await visit(table, { closedAt, partySize: extra.partySize ?? 2, people: extra.people, tenantId: extra.tenantId, outletId: extra.outletId, tableId: extra.outletId === second?.outletId ? second.tableId : undefined });
  return { sessionId, billId: await bill(sessionId, { ...extra, total, closedAt }) };
}
const share = (billId: string, amount: number, paid: number) => env.db.insert(s.billShares).values({ tenantId: env.demo.tenantId, billId, amountPaise: amount, paidPaise: paid, status: paid >= amount ? "paid" : "unpaid" });
const rounds = new Map<string, number>();
async function order(sessionId: string, placedAt: Date, lines: { name: string; qty: number; status?: "placed" | "served" | "cancelled" | "voided"; snapshot?: string; unit?: number }[], status: "placed" | "served" | "cancelled" = "served", where: Where = {}) {
  const id = uuidv7();
  const roundNo = (rounds.get(sessionId) ?? 0) + 1;
  rounds.set(sessionId, roundNo);
  const tenantId = where.tenantId ?? env.demo.tenantId;
  await env.db.insert(s.orders).values({ id, tenantId, outletId: where.outletId ?? env.demo.outletId, sessionId, roundNo, status, placedAt });
  for (const [i, l] of lines.entries()) {
    await env.db.insert(s.orderLines).values({ tenantId, orderId: id, sessionId, itemId: where.tenantId === env.other?.tenantId && where.tenantId ? env.other.itemId : item(l.name), nameEn: l.snapshot ?? l.name, unitPricePaise: l.unit ?? 10_000, qty: l.qty, taxRateBp: 500, station: "kitchen", status: l.status ?? "served", createdAt: new Date(placedAt.getTime() + i) });
  }
  return id;
}
async function booking(o: { name?: string; phone?: string; startAt: Date; status: (typeof s.reservationStatuses)[number]; party?: number; confirmed?: boolean; hold?: Date; tables?: string[] }) {
  const id = uuidv7();
  await env.db.insert(s.reservations).values({ id, tenantId: env.demo.tenantId, outletId: env.demo.outletId, name: o.name ?? "Booked Guest", phone: o.phone ?? null, partySize: o.party ?? 2, startAt: o.startAt, expectedEndAt: min(90, o.startAt), status: o.status, source: o.hold ? "online" : "phone", confirmedAt: o.confirmed === false ? null : min(-600), holdExpiresAt: o.hold ?? null });
  for (const code of o.tables ?? []) await env.db.insert(s.reservationTables).values({ tenantId: env.demo.tenantId, reservationId: id, tableId: T(code) });
  return id;
}
let sort = 0;
const queue = (status: (typeof s.waitlistStatuses)[number], name = "Queue Guest") =>
  env.db.insert(s.waitlistEntries).values({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, name, phone: "9811122233", partySize: 2, status, sortOrder: ++sort, joinedAt: min(-20) });
const setTable = (code: string, patch: Partial<typeof s.diningTables.$inferInsert>) => env.db.update(s.diningTables).set(patch).where(eq(s.diningTables.id, T(code)));
async function failsWith(p: Promise<unknown>, code: AppError["code"]) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}

beforeAll(async () => {
  env = await resetTestDb();
  owner = await signIn("9000000001", "1111");
  manager = await signIn("9000000002", "2222");
  host = await signIn("9000000004", "4444");
  // A second outlet of the same restaurant, to prove outlet isolation
  const outletId = uuidv7();
  const zoneId = uuidv7();
  const tableId = uuidv7();
  await env.db.insert(s.outlets).values({ id: outletId, tenantId: env.demo.tenantId, brandId: env.demo.brandId, code: "SRJ02", name: "Spice Route Two", city: "Jaipur", address: "Malviya Nagar" });
  await env.db.insert(s.zones).values({ id: zoneId, tenantId: env.demo.tenantId, outletId, name: "Indoor" });
  await env.db.insert(s.diningTables).values({ id: tableId, tenantId: env.demo.tenantId, outletId, zoneId, code: "T1", maxSeats: 2, tableClass: "2-top", joinCode: "2222" });
  second = { outletId, tableId };
});
beforeEach(wipeOps);
afterEach(() => {
  if (realTz === undefined) delete process.env.TZ;
  else process.env.TZ = realTz;
});
afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("today's revenue", () => {
  it("A/B: only bills paid and closed inside today's outlet-local day count; open bills never do", async () => {
    await paidVisit("T1", 120_000, min(-60));
    await paidVisit("T2", 80_000, IST_MIDNIGHT); // first instant of today
    await paidVisit("T3", 55_000, min(-1, IST_MIDNIGHT)); // last millisecond-ish of yesterday
    const open = await visit("T4", { status: "bill_requested" });
    await bill(open, { status: "open", total: 99_000 });
    const d = await dash();
    expect(d.kpis.revenue.today).toBe(200_000);
    expect(d.kpis.paidBills).toBe(2);
    expect(d.kpis.revenue.yesterday).toBe(55_000);
  });

  it("C/E: tips stay out of revenue; tax, service charge and tips are reported beside it", async () => {
    await paidVisit("T1", 105_000, min(-10), { subtotal: 90_000, tax: 5_000, service: 10_000, tip: 7_500 });
    await paidVisit("T2", 52_500, min(-5), { subtotal: 50_000, tax: 2_500, tip: 2_000 });
    const d = await dash();
    expect(d.kpis.revenue.today).toBe(157_500);
    expect(d.secondary).toEqual({ taxPaise: 7_500, serviceChargePaise: 10_000, tipPaise: 9_500 });
  });

  it("D: booking credit is counted once: revenue is the stored net total, never total + discount + credit", async () => {
    // Subtotal 1,000 + tax 50 = 1,050; 500 of credit applied (stored in both discount and credit columns)
    await paidVisit("T1", 55_000, min(-10), { subtotal: 100_000, tax: 5_000, discount: 50_000, credit: 50_000 });
    const d = await dash();
    expect(d.kpis.revenue.today).toBe(55_000);
    expect(d.kpis.averageBill.today).toBe(55_000);
  });

  it("D (real flow): a booking with paid credit, ordered, billed and settled in cash, adds exactly the bill total", async () => {
    const now = new Date();
    const device = "o1-credit";
    const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: env.demo.tableQr.T12, deviceId: device, displayName: "Kavya" });
    const g = await getGuestContext("SRJ01", env.demo.tableQr.T12, participantId, device);
    await env.db.insert(s.reservations).values({ tenantId: g.tenantId, outletId: g.outletId, name: "Kavya", partySize: 2, startAt: min(-30, now), expectedEndAt: min(60, now), status: "seated", source: "online", confirmedAt: min(-600, now), sessionId: g.sessionId, creditRequiredPaise: 20_000, creditPaidPaise: 20_000, creditStatus: "paid" });
    await addCartLine(g, { itemId: item("Paneer Tikka"), qty: 2 });
    await placeOrder(g);
    await requestBill({ tenantId: g.tenantId, outletId: g.outletId, sessionId: g.sessionId });
    const res = await settleAtCounter({ tenantId: g.tenantId, outletId: g.outletId, userId: null }, { sessionId: g.sessionId, method: "cash" });
    expect(res.billPaid).toBe(true);
    const [b] = await env.db.select().from(s.bills).where(eq(s.bills.sessionId, g.sessionId));
    expect(b.bookingCreditPaise).toBe(20_000);
    expect(b.discountPaise).toBe(20_000); // the credit, shown as the bill's adjustment
    const d = await dash(owner, new Date());
    expect(d.kpis.revenue.today).toBe(b.totalPaise);
    expect(d.kpis.revenue.today).toBe(b.subtotalPaise + b.taxPaise + b.serviceChargePaise + b.roundOffPaise - 20_000);
    expect(d.kpis.revenue.today).not.toBe(b.totalPaise + b.bookingCreditPaise);
    const [inv] = await env.db.select().from(s.invoices).where(eq(s.invoices.billId, b.id));
    expect(inv.totalPaise).toBe(d.kpis.revenue.today);
    expect(d.topItems).toEqual([expect.objectContaining({ name: "Paneer Tikka", qty: 2 })]);
  });

  it("F/H: yesterday is the previous outlet-local day, split at Indian midnight (18:30 UTC)", async () => {
    await paidVisit("T1", 10_000, new Date("2026-10-02T18:30:00Z")); // 3 Oct 00:00 IST: yesterday
    await paidVisit("T2", 20_000, new Date("2026-10-02T18:29:59Z")); // 2 Oct 23:59 IST: neither
    await paidVisit("T3", 40_000, new Date("2026-10-03T18:29:59Z")); // 3 Oct 23:59 IST: yesterday
    await paidVisit("T4", 80_000, IST_MIDNIGHT); // today
    const d = await dash();
    expect(d.date).toBe("2026-10-04");
    expect(d.kpis.revenue).toEqual({ today: 80_000, yesterday: 50_000 });
  });

  it("G: a UTC outlet splits at UTC midnight, whatever the server's own time zone", async () => {
    process.env.TZ = "America/Los_Angeles";
    await paidVisit("T1", 10_000, new Date("2026-10-03T23:59:59Z"));
    await paidVisit("T2", 20_000, new Date("2026-10-04T00:00:00Z"));
    const d = await dash(inZone(owner, "UTC"));
    expect(d.kpis.revenue).toEqual({ today: 20_000, yesterday: 10_000 });
  });

  it("I: a New York outlet splits at 04:00 UTC in October", async () => {
    await paidVisit("T1", 10_000, new Date("2026-10-04T03:59:59Z")); // 3 Oct 23:59 EDT
    await paidVisit("T2", 20_000, new Date("2026-10-04T04:00:00Z")); // 4 Oct 00:00 EDT
    const d = await dash(inZone(owner, "America/New_York"));
    expect(d.date).toBe("2026-10-04");
    expect(d.kpis.revenue).toEqual({ today: 20_000, yesterday: 10_000 });
  });

  it("J/K: another restaurant's and another outlet's bills, orders and queue never appear", async () => {
    await paidVisit("T1", 10_000);
    await paidVisit("T1", 777_000, min(-5), { outletId: second.outletId });
    const nukkad = await visit("T1", { tenantId: env.other.tenantId, outletId: env.other.outletId, tableId: env.other.tableId, closedAt: min(-5) });
    await bill(nukkad, { tenantId: env.other.tenantId, outletId: env.other.outletId, total: 888_000, closedAt: min(-5) });
    await order(nukkad, min(-20), [{ name: "x", qty: 9 }], "served", { tenantId: env.other.tenantId, outletId: env.other.outletId });
    await env.db.insert(s.waitlistEntries).values({ tenantId: env.demo.tenantId, outletId: second.outletId, name: "Elsewhere", partySize: 2, status: "waiting", sortOrder: 1 });
    const d = await dash();
    expect(d.kpis.revenue.today).toBe(10_000);
    expect(d.kpis.orders.today).toBe(0);
    expect(d.kpis.waitlist).toBe(0);
    expect(d.topItems).toEqual([]);
    // The same staff session pointed at the other outlet sees only that outlet
    const there = await dash({ ...owner, outletId: second.outletId });
    expect(there.kpis.revenue.today).toBe(777_000);
  });
});

describe("KPIs", () => {
  it("L/M: orders today exclude cancelled orders; voided and cancelled lines never count as sold", async () => {
    const v = await visit("T1", { status: "open" });
    await order(v, min(-50), [{ name: "Paneer Tikka", qty: 2 }]);
    await order(v, min(-40), [{ name: "Butter Naan", qty: 3 }, { name: "Dal Makhani", qty: 1, status: "voided" }]);
    await order(v, min(-30), [{ name: "Veg Biryani", qty: 1, status: "cancelled" }], "cancelled");
    await order(v, min(-25, IST_MIDNIGHT), [{ name: "Paneer Tikka", qty: 5 }]); // yesterday
    const d = await dash();
    expect(d.kpis.orders).toEqual({ today: 2, yesterday: 1 });
    expect(d.topItems.map((t) => [t.name, t.qty])).toEqual([["Butter Naan", 3], ["Paneer Tikka", 2]]);
  });

  it("N/O/P: covers count each paid visit once, even across combined tables; average bill is revenue / paid bills", async () => {
    expect((await dash()).kpis.averageBill).toEqual({ today: 0, yesterday: 0 });
    await paidVisit("T5", 120_000, min(-30), { partySize: 6, people: 2 });
    await env.db.insert(s.sessionTables).values([
      { tenantId: env.demo.tenantId, outletId: env.demo.outletId, sessionId: (await env.db.select().from(s.bills))[0].sessionId, tableId: T("T5"), isPrimary: true },
      { tenantId: env.demo.tenantId, outletId: env.demo.outletId, sessionId: (await env.db.select().from(s.bills))[0].sessionId, tableId: T("T6") },
    ]);
    const qr = await visit("T1", { closedAt: min(-20), partySize: null, people: 3 });
    await bill(qr, { total: 30_001, closedAt: min(-20) });
    await visit("T2", { closedAt: min(-10), partySize: 4 }); // cleared empty: no paid bill, no covers
    const d = await dash();
    expect(d.kpis.covers.today).toBe(9);
    expect(d.kpis.averageBill.today).toBe(Math.round(150_001 / 2));
  });

  it("Q/R: open tables are seated + bill requested over active tables", async () => {
    await setTable("T1", { state: "seated" });
    await setTable("T2", { state: "bill_requested" });
    await setTable("T3", { state: "reserved" });
    await setTable("T4", { state: "blocked" });
    await setTable("T5", { state: "needs_cleaning" });
    await setTable("T6", { state: "paid" });
    await setTable("T9", { state: "seated", isActive: false });
    const active = (await env.db.select().from(s.diningTables).where(eq(s.diningTables.outletId, env.demo.outletId))).filter((t) => t.isActive).length;
    const d = await dash();
    expect(d.kpis.openTables).toEqual({ open: 2, total: active });
    expect(d.operations.tables).toMatchObject({ seated: 1, billRequested: 1, reserved: 1, blocked: 1, available: active - 6, total: active });
  });

  it("S: upcoming reservations are confirmed or reminded in the next 90 minutes; holds and cancelled holds never count", async () => {
    await booking({ startAt: min(30), status: "confirmed", tables: ["T3"] });
    await booking({ startAt: min(89), status: "reminded" });
    await booking({ startAt: min(20), status: "requested", confirmed: false, hold: min(-1) }); // expired hold not yet swept
    await booking({ startAt: min(25), status: "requested", confirmed: false, hold: min(4) }); // hold in progress
    await booking({ startAt: min(40), status: "cancelled", confirmed: false }); // abandoned hold
    await booking({ startAt: min(45), status: "arrived" });
    await booking({ startAt: min(91), status: "confirmed" });
    await booking({ startAt: min(-1), status: "confirmed" });
    const d = await dash();
    expect(d.kpis.upcomingReservations).toBe(2);
    expect(d.operations.upcoming[0]).toMatchObject({ partySize: 2, status: "confirmed", tables: ["T3"] });
  });

  it("T: the waitlist counts waiting and notified parties only", async () => {
    for (const st of ["waiting", "waiting", "notified", "seated", "left", "skipped", "expired"] as const) await queue(st);
    const d = await dash();
    expect(d.kpis.waitlist).toBe(3);
    expect(d.operations.waitlist).toEqual({ waiting: 2, notified: 1 });
  });

  it("U: outstanding is the unpaid share balance on bills of visits that are not closed", async () => {
    const a = await visit("T1", { status: "open" });
    const ab = await bill(a, { status: "open", total: 80_000 });
    await share(ab, 50_000, 20_000);
    await share(ab, 30_000, 45_000); // overpaid: counts as 0, never negative
    const b = await visit("T2", { status: "bill_requested" });
    await share(await bill(b, { status: "open", total: 40_000 }), 40_000, 0);
    const done = await paidVisit("T3", 60_000);
    await share(done.billId, 60_000, 0); // a paid, closed bill is never outstanding
    expect((await dash()).kpis.outstandingPaise).toBe(70_000);
  });
});

describe("alerts", () => {
  it("V/W: a bill requested exactly 10 minutes ago does not alert; 11 minutes does, with table code and wait", async () => {
    const a = await visit("T7", { status: "bill_requested" });
    await bill(a, { status: "open", total: 1, requestedAt: min(-10) });
    expect((await dash()).alerts.slowBills).toEqual([]);
    const b = await visit("T12", { status: "bill_requested" });
    await bill(b, { status: "open", total: 1, requestedAt: min(-11) });
    const d = await dash();
    expect(d.alerts.slowBills).toEqual([{ sessionId: b, tableCode: "T12", waitedMinutes: 11 }]);
    expect(d.operations.billRequestedTables).toBe(2);
  });

  it("X: sold out follows the guest menu's availability rule (portions, switched off, timed sold-out)", async () => {
    const base = (await dash()).alerts.soldOut; // seed: Mutton Curry is switched off
    expect(base).toBe(1);
    const upsert = (name: string, v: Partial<typeof s.outletItemOverrides.$inferInsert>) =>
      env.db.insert(s.outletItemOverrides).values({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, itemId: item(name), ...v }).onDuplicateKeyUpdate({ set: v });
    await upsert("Butter Chicken", { portionsLeft: 0 });
    await upsert("Paneer Tikka", { isAvailable: false, soldOutUntil: min(60) });
    await upsert("Dal Makhani", { isAvailable: false, soldOutUntil: min(-1) }); // timer ran out: available again
    await upsert("Butter Naan", { portionsLeft: 3 });
    expect((await dash()).alerts.soldOut).toBe(3);
    await env.db.update(s.menuItems).set({ isActive: false }).where(eq(s.menuItems.id, item("Paneer Tikka"))); // archived items are not on the menu
    expect((await dash()).alerts.soldOut).toBe(2);
    await env.db.update(s.menuItems).set({ isActive: true }).where(eq(s.menuItems.id, item("Paneer Tikka")));
    await upsert("Butter Chicken", { portionsLeft: 12 });
    await env.db.delete(s.outletItemOverrides).where(eq(s.outletItemOverrides.itemId, item("Paneer Tikka")));
    await env.db.delete(s.outletItemOverrides).where(eq(s.outletItemOverrides.itemId, item("Dal Makhani")));
    await env.db.delete(s.outletItemOverrides).where(eq(s.outletItemOverrides.itemId, item("Butter Naan")));
  });

  it("Y: late and no-show eligibility use the outlet's own grace period", async () => {
    await env.db.insert(s.bookingPolicies).values({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, graceMinutes: 20 });
    await booking({ name: "Rao", startAt: min(-15), status: "confirmed", tables: ["T6"] });
    await booking({ name: "Singh", startAt: min(-25), status: "reminded" });
    await booking({ name: "Here", startAt: min(-25), status: "arrived" });
    const d = await dash();
    expect(d.alerts.late.map((l) => [l.name, l.lateMinutes, l.noShowEligible])).toEqual([["Singh", 25, true], ["Rao", 15, false]]);
    expect(d.alerts.late[1].tables).toEqual(["T6"]);
    // With the default 15-minute grace Rao would already be eligible
    await env.db.update(s.bookingPolicies).set({ graceMinutes: 15 });
    expect((await dash()).alerts.late.find((l) => l.name === "Rao")!.noShowEligible).toBe(true);
  });

  it("Z: pending refunds show count and amount; completed and failed refunds are not pending", async () => {
    const { billId } = await paidVisit("T1", 50_000);
    const paymentId = uuidv7();
    await env.db.insert(s.payments).values({ id: paymentId, tenantId: env.demo.tenantId, outletId: env.demo.outletId, billId, allocations: [], method: "upi", channel: "mock", gatewayRef: "order_secret_ref", gatewayPaymentId: "pay_secret_id", amountPaise: 60_000, status: "success" });
    for (const [amount, status] of [[6_000, "pending"], [4_050, "pending"], [9_999, "success"], [1_234, "failed"]] as const) await env.db.insert(s.refunds).values({ tenantId: env.demo.tenantId, paymentId, amountPaise: amount, reason: "test", status });
    const d = await dash();
    expect(d.alerts.pendingRefunds).toEqual({ count: 2, paise: 10_050 });
    expect(d.kpis.revenue.today).toBe(50_000); // refunds never touch revenue
  });

  it("AA/AB: blocked active tables are counted; a calm outlet has no alerts", async () => {
    await env.db.update(s.outletItemOverrides).set({ isAvailable: true }).where(eq(s.outletItemOverrides.itemId, item("Mutton Curry")));
    const calm = await dash();
    expect(calm.alerts).toEqual({ slowBills: [], soldOut: 0, late: [], pendingRefunds: { count: 0, paise: 0 }, blockedTables: 0, lowStock: [] });
    await setTable("T1", { state: "blocked" });
    await setTable("T2", { state: "blocked" });
    await setTable("T3", { state: "blocked", isActive: false });
    expect((await dash()).alerts.blockedTables).toBe(2);
    await env.db.update(s.outletItemOverrides).set({ isAvailable: false }).where(eq(s.outletItemOverrides.itemId, item("Mutton Curry")));
  });
});

describe("top items", () => {
  it("AC/AD/AE/AF/AG/AH: top five by quantity from line snapshots; voided and cancelled excluded; renames never rewrite history", async () => {
    const v = await visit("T1", { status: "open" });
    await order(v, min(-60), [
      { name: "Butter Naan", qty: 9 },
      { name: "Paneer Tikka", qty: 4, snapshot: "Paneer Tikka (old name)" },
      { name: "Dal Makhani", qty: 6, unit: 26_000 },
      { name: "Veg Biryani", qty: 2 },
      { name: "Masala Lassi", qty: 3 },
      { name: "Masala Papad", qty: 1 },
      { name: "Butter Chicken", qty: 50, status: "voided" },
      { name: "Mutton Curry", qty: 40, status: "cancelled" },
    ]);
    await order(v, min(-30), [{ name: "Paneer Tikka", qty: 1, snapshot: "Paneer Tikka (old name)" }]);
    await env.db.update(s.menuItems).set({ nameEn: "Paneer Tikka Renamed" }).where(eq(s.menuItems.id, item("Paneer Tikka")));
    const d = await dash();
    expect(d.topItems.map((t) => [t.name, t.qty])).toEqual([
      ["Butter Naan", 9],
      ["Dal Makhani", 6],
      ["Paneer Tikka (old name)", 5],
      ["Masala Lassi", 3],
      ["Veg Biryani", 2],
    ]);
    expect(d.topItems.find((t) => t.name === "Dal Makhani")!.grossPaise).toBe(156_000);
    await env.db.update(s.menuItems).set({ nameEn: "Paneer Tikka" }).where(eq(s.menuItems.id, item("Paneer Tikka")));
  });
});

describe("7-day trend", () => {
  it("AI/AJ/AK/AL: seven outlet-local days ending today, same net-sales formula, midnight bills on the right day, zeros kept", async () => {
    await paidVisit("T1", 11_000, IST_MIDNIGHT, { tip: 999 }); // today 00:00 IST
    await paidVisit("T2", 22_000, min(-1, IST_MIDNIGHT)); // yesterday 23:59 IST
    await paidVisit("T3", 33_000, new Date("2026-09-27T18:30:00Z")); // 28 Sep 00:00 IST: oldest bucket
    await paidVisit("T4", 44_000, new Date("2026-09-27T18:29:00Z")); // 27 Sep: outside
    const open = await visit("T5", { status: "bill_requested" });
    await bill(open, { status: "open", total: 5_000_000 });
    const trend = await getRevenueTrend(owner, NOW);
    expect(trend).toEqual([
      { date: "2026-09-28", revenuePaise: 33_000 },
      { date: "2026-09-29", revenuePaise: 0 },
      { date: "2026-09-30", revenuePaise: 0 },
      { date: "2026-10-01", revenuePaise: 0 },
      { date: "2026-10-02", revenuePaise: 0 },
      { date: "2026-10-03", revenuePaise: 22_000 },
      { date: "2026-10-04", revenuePaise: 11_000 },
    ]);
    const d = await dash();
    expect(d.kpis.revenue).toEqual({ today: trend[6].revenuePaise, yesterday: trend[5].revenuePaise });
  });

  it("keeps buckets contiguous across a daylight-saving change (New York, 1 Nov 2026 is 25 hours)", async () => {
    const now = new Date("2026-11-03T15:00:00Z");
    await paidVisit("T1", 7_000, new Date("2026-11-01T04:00:00Z")); // 1 Nov 00:00 EDT
    await paidVisit("T2", 9_000, new Date("2026-11-02T04:59:59Z")); // 1 Nov 23:59:59 EST
    await paidVisit("T3", 5_000, new Date("2026-11-02T05:00:00Z")); // 2 Nov 00:00 EST
    const trend = await getRevenueTrend(inZone(owner, "America/New_York"), now);
    expect(trend.map((t) => t.date)).toEqual(["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(trend.find((t) => t.date === "2026-11-01")!.revenuePaise).toBe(16_000);
    expect(trend.find((t) => t.date === "2026-11-02")!.revenuePaise).toBe(5_000);
  });
});

describe("access, safety and read-only", () => {
  it("AM–AS: owner and manager may read; host, waiter, cashier, kitchen and accountant are refused by the server", async () => {
    await expect(dash(owner)).resolves.toBeTruthy();
    await expect(dash(manager)).resolves.toBeTruthy();
    for (const role of ["host", "waiter", "cashier", "kitchen", "accountant"] as const) {
      await failsWith(getDashboard({ ...owner, roles: [role] }, NOW), "forbidden");
      await failsWith(getRevenueTrend({ ...owner, roles: [role] }, NOW), "forbidden");
    }
    await failsWith(getDashboard(host, NOW), "forbidden");
  });

  it("never exposes phone numbers, gateway references, tokens or staff ids", async () => {
    await booking({ name: "Phone Guest", phone: "9876543210", startAt: min(20), status: "confirmed" });
    await booking({ name: "Late Phone", phone: "9123456780", startAt: min(-30), status: "confirmed" });
    await queue("waiting");
    const { billId } = await paidVisit("T1", 10_000);
    const paymentId = uuidv7();
    await env.db.insert(s.payments).values({ id: paymentId, tenantId: env.demo.tenantId, outletId: env.demo.outletId, billId, allocations: [], method: "upi", channel: "mock", gatewayRef: "order_secret_ref", gatewayPaymentId: "pay_secret_id", amountPaise: 12_000, status: "success", takenByUserId: owner.userId });
    await env.db.insert(s.refunds).values({ tenantId: env.demo.tenantId, paymentId, amountPaise: 2_000, reason: "test", status: "pending", gatewayRef: "rfnd_secret" });
    const json = JSON.stringify(await dash());
    for (const secret of ["9876543210", "9123456780", "9811122233", "order_secret_ref", "pay_secret_id", "rfnd_secret", paymentId, owner.userId, "manageToken", "phone"]) expect(json).not.toContain(secret);
  });

  it("is read-only: an expired hold, a timed block and every row stay exactly as they were", async () => {
    const hold = await booking({ startAt: min(30), status: "requested", confirmed: false, hold: min(-5), tables: ["T3"] });
    await setTable("T3", { state: "held" });
    await setTable("T4", { state: "blocked", blockedUntil: min(-5) });
    const v = await visit("T1", { status: "bill_requested" });
    await bill(v, { status: "open", total: 1, requestedAt: min(-30) });
    const snapshot = async () => ({
      reservations: await env.db.select().from(s.reservations),
      tables: await env.db.select().from(s.diningTables),
      sessions: await env.db.select().from(s.tableSessions),
      bills: await env.db.select().from(s.bills),
      audit: await env.db.select({ n: sql<number>`count(*)` }).from(s.auditLog),
      overrides: await env.db.select().from(s.outletItemOverrides),
    });
    const before = await snapshot();
    await dash();
    await getRevenueTrend(owner, NOW);
    expect(await snapshot()).toEqual(before);
    expect((await env.db.select().from(s.reservations).where(eq(s.reservations.id, hold)))[0].status).toBe("requested");
  });
});
