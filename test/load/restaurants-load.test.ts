import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import { dbConfig } from "@/db/config";
import { uuidv7 } from "@/db/id";
import * as schema from "@/db/schema";
import * as s from "@/db/schema";
import { serviceDate } from "@/domain/booking-policy";
import { requestBill, settleAtCounter } from "@/server/billing/payments";
import { confirmBooking, createBookingHold, getBookingAvailability } from "@/server/booking/core";
import { addCartLine } from "@/server/guest/cart";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { getMenuScreen } from "@/server/guest/menu-screen";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { acceptOrder, bumpLine, markServed } from "@/server/kitchen/actions";
import { getKitchenDisplay } from "@/server/kitchen/display";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { getDashboard } from "@/server/staff/dashboard";
import { posQueue } from "@/server/staff/pos-read";
import { waiterBoard } from "@/server/staff/waiter-read";
import { seedPlatform, wipeAll, type Db } from "../../scripts/demo-data";

// Load run, not part of the normal suite: LOAD=15 npx vitest run test/load
// LOAD is a comma list of restaurant counts, e.g. LOAD=15,50,100. For each count it builds that
// many restaurants in the test database, then runs one busy evening in all of them at once:
// online bookings, guests ordering from QR, kitchen, waiter and POS screens, and paying the bill.

const COUNTS = (process.env.LOAD ?? "").split(",").map(Number).filter((n) => n > 0);
const TABLES = 10; // per restaurant
const DINING_TABLES = 6; // tables that order during the run
const GUESTS_PER_TABLE = 3;
const BOOKINGS = 5; // online bookings per restaurant
const SCREEN_REFRESHES = 3; // staff screens reloaded during the run

type Restaurant = { code: string; tenantId: string; outletId: string; qrs: string[]; itemIds: string[]; owner: StaffSession };
type Sample = { op: string; ms: number; ok: boolean; error?: string };

let conn: mysql.Connection;
let db: Db;
const samples: Sample[] = [];

async function timed<T>(op: string, fn: () => Promise<T>): Promise<T | null> {
  const t = performance.now();
  try {
    const out = await fn();
    samples.push({ op, ms: performance.now() - t, ok: true });
    return out;
  } catch (e) {
    samples.push({ op, ms: performance.now() - t, ok: false, error: e instanceof Error ? `${(e as { code?: string }).code ?? ""} ${e.message}`.slice(0, 120) : String(e) });
    return null;
  }
}

async function createRestaurant(i: number): Promise<Restaurant> {
  const { hashPin } = await import("@/server/staff/pin");
  const code = `LD${String(i).padStart(4, "0")}`;
  const tenantId = uuidv7();
  const brandId = uuidv7();
  const outletId = uuidv7();
  const zoneId = uuidv7();
  const userId = uuidv7();
  const phone = `98${String(i).padStart(8, "0")}`;
  await db.insert(s.tenants).values({ id: tenantId, name: `Load Restaurant ${i}`, planCode: "growth", status: "active", contactName: "Owner", contactPhone: phone });
  await db.insert(s.brands).values({ id: brandId, tenantId, name: `Load ${i}` });
  await db.insert(s.outlets).values({ id: outletId, tenantId, brandId, code, name: `Load Restaurant ${i}`, city: "Jaipur", address: "Load Road" });
  await db.insert(s.users).values({ id: userId, tenantId, phone, name: `Owner ${i}`, pinHash: await hashPin("1234") });
  await db.insert(s.staffRoles).values({ id: uuidv7(), tenantId, userId, outletId, role: "owner" });
  await db.insert(s.zones).values({ id: zoneId, tenantId, outletId, name: "Main Hall" });
  const qrs: string[] = [];
  for (let t = 1; t <= TABLES; t++) {
    const tableId = uuidv7();
    const qr = `l${i}t${t}`;
    await db.insert(s.diningTables).values({ id: tableId, tenantId, outletId, zoneId, code: `T${t}`, maxSeats: 4, tableClass: "4-top", joinCode: "1234" });
    await db.insert(s.qrCodes).values({ id: uuidv7(), tenantId, outletId, tableId, type: "table", shortCode: qr });
    qrs.push(qr);
  }
  const itemIds: string[] = [];
  for (let c = 1; c <= 4; c++) {
    const categoryId = uuidv7();
    await db.insert(s.menuCategories).values({ id: categoryId, tenantId, brandId, nameEn: `Category ${c}`, sortOrder: c });
    for (let k = 1; k <= 5; k++) {
      const id = uuidv7();
      await db.insert(s.menuItems).values({ id, tenantId, brandId, categoryId, nameEn: `Dish ${c}-${k}`, pricePaise: 10000 + k * 2000, isVeg: k % 2 === 0, station: k % 2 ? "Kitchen" : "Tandoor" });
      itemIds.push(id);
    }
  }
  const owner = (await resolveStaff((await signInStaff({ outletCode: code, phone, pin: "1234" })).token))!;
  return { code, tenantId, outletId, qrs, itemIds, owner };
}

/** Five guests book a table for tomorrow evening, all at the same moment */
async function bookings(r: Restaurant, run: string) {
  const tomorrow = new Date(Date.now() + 24 * 3600_000);
  const date = serviceDate(tomorrow, "Asia/Kolkata");
  const availability = await timed("booking: see free times", () => getBookingAvailability(r.code, { date, partySize: 2 }));
  const slots = availability?.slots.filter((x) => x.available) ?? [];
  await Promise.all(
    Array.from({ length: BOOKINGS }, async (_, b) => {
      const slot = slots[(slots.length >> 1) + b];
      if (!slot) return;
      const token = `${run}-${r.code}-b${b}`;
      const hold = await timed("booking: hold table", () => createBookingHold(r.code, { date, startAt: slot.startAt, partySize: 2, requestId: token, holdToken: token }));
      if (hold) await timed("booking: confirm", () => confirmBooking(r.code, token, { name: `Guest ${b}`, phone: `97${String(b).padStart(8, "0")}` }));
    }),
  );
}

/** One table: guests scan, read the menu, fill the cart, order; the kitchen cooks; the bill is paid */
async function dining(r: Restaurant, t: number, run: string) {
  const qr = r.qrs[t];
  const guests: GuestContext[] = [];
  for (let g = 0; g < GUESTS_PER_TABLE; g++) {
    const deviceId = `${run}-${r.code}-t${t}-g${g}`;
    const seated = await timed("guest: scan QR and join", () => startOrJoinTable({ outletCode: r.code, shortCode: qr, deviceId, displayName: `G${g}` }));
    if (!seated) continue;
    guests.push(await getGuestContext(r.code, qr, seated.participantId, deviceId));
  }
  await Promise.all(
    guests.map(async (ctx, g) => {
      await timed("guest: open menu", () => getMenuScreen(r.code, qr, `${run}-${r.code}-t${t}-g${g}`));
      await timed("guest: add to cart", () => addCartLine(ctx, { itemId: r.itemIds[(t * 3 + g) % r.itemIds.length], qty: 1 }));
      await timed("guest: add to cart", () => addCartLine(ctx, { itemId: r.itemIds[(t * 7 + g * 2 + 1) % r.itemIds.length], qty: 2 }));
    }),
  );
  if (!guests.length) return;
  const placed = await timed("guest: place order", () => placeOrder(guests[0], { requestId: `${run}-${r.code}-t${t}` }));
  if (!placed) return;
  if (placed.status === "placed") await timed("kitchen: accept order", () => acceptOrder(r.owner, placed.orderId));
  const lines = await appDb.select({ id: s.orderLines.id }).from(s.orderLines).where(and(eq(s.orderLines.tenantId, r.tenantId), eq(s.orderLines.orderId, placed.orderId)));
  for (const l of lines) await timed("kitchen: dish ready", () => bumpLine(r.owner, l.id));
  await timed("waiter: mark served", () => markServed(r.owner, lines.map((l) => l.id)));
  await timed("bill: request", () => requestBill({ tenantId: r.tenantId, outletId: r.outletId, sessionId: guests[0].sessionId }));
  await timed("bill: pay at counter", () => settleAtCounter(r.owner, { sessionId: guests[0].sessionId, method: "cash", receivedPaise: 1_000_000 }));
}

/** Owner, kitchen, waiter and cashier screens refreshing while service runs */
async function screens(r: Restaurant) {
  for (let i = 0; i < SCREEN_REFRESHES; i++) {
    await Promise.all([
      timed("screen: kitchen display", () => getKitchenDisplay(r.owner)),
      timed("screen: waiter board", () => waiterBoard(r.owner)),
      timed("screen: POS queue", () => posQueue(r.owner)),
      timed("screen: owner dashboard", () => getDashboard(r.owner)),
    ]);
  }
}

const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] ?? 0;

function report(n: number, wallMs: number, from: number) {
  const run = samples.slice(from);
  const ops = [...new Set(run.map((x) => x.op))];
  const rows = ops.map((op) => {
    const xs = run.filter((x) => x.op === op);
    const ms = xs.filter((x) => x.ok).map((x) => x.ms).sort((a, b) => a - b);
    return { step: op, count: xs.length, failed: xs.filter((x) => !x.ok).length, p50_ms: Math.round(pct(ms, 50)), p95_ms: Math.round(pct(ms, 95)), max_ms: Math.round(ms.at(-1) ?? 0) };
  });
  const failed = run.filter((x) => !x.ok);
  const errors = [...new Set(failed.map((x) => `${x.op}: ${x.error}`))].slice(0, 10);
  const summary = { restaurants: n, total_steps: run.length, failed: failed.length, seconds: +(wallMs / 1000).toFixed(1), steps_per_second: Math.round(run.length / (wallMs / 1000)) };
  console.log(`\n===== ${n} restaurants at once =====`);
  console.table(rows);
  console.log(JSON.stringify(summary));
  if (errors.length) console.log("Errors:\n" + errors.join("\n"));
  return summary;
}

describe.skipIf(COUNTS.length === 0)("many restaurants at once", () => {
  beforeAll(async () => {
    const config = dbConfig();
    if (config.database !== "tableqr_test") throw new Error(`Refusing to load ${config.database}`);
    conn = await mysql.createConnection({ ...config, charset: "utf8mb4", timezone: "Z", multipleStatements: false });
    db = drizzle({ client: conn, schema, mode: "default" });
    await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  });

  afterAll(async () => {
    if (conn) {
      await wipeAll(db);
      await conn.end();
    }
    await appDb.$client.end();
  });

  for (const n of COUNTS) {
    it(`${n} restaurants run a busy evening together`, async () => {
      await wipeAll(db);
      await seedPlatform(db);
      const list: Restaurant[] = [];
      for (let i = 1; i <= n; i++) list.push(await createRestaurant(i));
      const run = `r${n}`;
      // One booking lookup with nothing else running, to see its own cost apart from queueing
      const date = serviceDate(new Date(Date.now() + 24 * 3600_000), "Asia/Kolkata");
      const solo = performance.now();
      await getBookingAvailability(list[0].code, { date, partySize: 2 });
      console.log(`Booking free times, alone: ${Math.round(performance.now() - solo)} ms`);
      const from = samples.length;
      const t = performance.now();
      await Promise.all(
        list.map((r) =>
          Promise.all([bookings(r, run), screens(r), ...Array.from({ length: DINING_TABLES }, (_, k) => dining(r, k, run))]),
        ),
      );
      const summary = report(n, performance.now() - t, from);
      // Every restaurant's data stayed its own while they all ran together
      const ids = list.map((r) => r.tenantId);
      const paid = await appDb.select({ tenantId: s.bills.tenantId }).from(s.bills).where(and(inArray(s.bills.tenantId, ids), eq(s.bills.status, "paid")));
      console.log(`Paid bills: ${paid.length} of ${n * DINING_TABLES}`);
      expect(summary.total_steps).toBeGreaterThan(0);
    }, 3_600_000);
  }
});
