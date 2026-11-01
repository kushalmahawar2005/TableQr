import { and, eq, ne, sql } from "drizzle-orm";
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
import { requestBill, settleAtCounter } from "@/server/billing/payments";
import { AppError } from "@/server/errors";
import { addCartLine } from "@/server/guest/cart";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { getMenuScreen } from "@/server/guest/menu-screen";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { getDashboard } from "@/server/staff/dashboard";
import { archiveMenuItem, menuManagerData, saveMenuCategory, saveMenuItem, setMenuAvailability } from "@/server/staff/menu-manager";
import { getRecentOrders } from "@/server/staff/orders-read";
import { posBillDetail, posQueue } from "@/server/staff/pos-read";
import { getPricingData, setOutletPrice } from "@/server/staff/pricing";
import { getReport } from "@/server/staff/reports-read";
import { attachVerifiedTestGuest } from "./setup-db";
import { getOutletSettings } from "@/server/staff/settings-read";
import { changeRole, listTeam, resetPin, setMemberActive } from "@/server/staff/team";
import { waiterBoard, waiterDetail } from "@/server/staff/waiter-read";
import { checkIn, checkOut, getRooms, roomFoodTab, saveRoom } from "@/server/staff/rooms";
import { askFromRoom, getRoomPage } from "@/server/guest/room";
import { seedPlatform, wipeAll, type Db } from "../../scripts/demo-data";

// Three restaurants on one Tableeqr install, set up the way the platform admin creates them. Each
// one gets its own menu, team, guests, orders and a paid bill. Then every staff screen and guest
// path is run as one restaurant against the other two: nothing of theirs may be seen or changed.

type Restaurant = {
  key: string;
  name: string;
  outletCode: string;
  tenantId: string;
  outletId: string;
  ownerPhone: string;
  ownerPin: string;
  tableQr: string;
  owner: StaffSession;
  categoryId: string;
  itemId: string;
  itemName: string;
  memberId: string;
  memberName: string;
  sessionId: string;
  guest: GuestContext;
};

let conn: mysql.Connection;
const R: Record<"A" | "B" | "C", Restaurant> = {} as never;
const keys = ["A", "B", "C"] as const;
const others = (k: (typeof keys)[number]) => keys.filter((x) => x !== k).map((x) => R[x]);

/** Same rows the admin "Create restaurant" form writes */
async function createRestaurant(db: Db, key: string, name: string, outletCode: string, ownerPhone: string, ownerPin: string) {
  const { hashPin } = await import("@/server/staff/pin");
  const tenantId = uuidv7();
  const brandId = uuidv7();
  const outletId = uuidv7();
  const zoneId = uuidv7();
  const userId = uuidv7();
  const tableId = uuidv7();
  const tableQr = `iso${key}`;
  await db.insert(s.tenants).values({ id: tenantId, name: `${name} Pvt Ltd`, planCode: "pro", status: "active", contactName: `${name} Owner`, contactPhone: ownerPhone });
  await db.insert(s.brands).values({ id: brandId, tenantId, name });
  await db.insert(s.outlets).values({ id: outletId, tenantId, brandId, code: outletCode, name, city: "Jaipur", address: `${name} Road` });
  await db.insert(s.users).values({ id: userId, tenantId, phone: ownerPhone, name: `${name} Owner`, pinHash: await hashPin(ownerPin) });
  await db.insert(s.staffRoles).values({ id: uuidv7(), tenantId, userId, outletId, role: "owner" });
  await db.insert(s.zones).values({ id: zoneId, tenantId, outletId, name: "Main Hall" });
  await db.insert(s.diningTables).values({ id: tableId, tenantId, outletId, zoneId, code: "T1", maxSeats: 4, tableClass: "4-top", joinCode: "1234" });
  await db.insert(s.qrCodes).values({ id: uuidv7(), tenantId, outletId, tableId, type: "table", shortCode: tableQr });
  return { tenantId, outletId, tableQr };
}

async function seedWaiter(db: Db, tenantId: string, outletId: string, name: string, phone: string, pin: string) {
  const { hashPin } = await import("@/server/staff/pin");
  const id = uuidv7();
  await db.insert(s.users).values({ id, tenantId, phone, name, pinHash: await hashPin(pin), isActive: true });
  await db.insert(s.staffRoles).values({ id: uuidv7(), tenantId, userId: id, outletId, role: "waiter" });
  return { id };
}

const signIn = async (outletCode: string, phone: string, pin: string) => (await resolveStaff((await signInStaff({ outletCode, phone, pin })).token))!;

async function failsWith(p: Promise<unknown>, codes: AppError["code"][]) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, "expected the call to be refused").toBeInstanceOf(AppError);
  expect(codes).toContain((err as AppError).code);
}

/** A new guest sits at the restaurant's table and opens the menu */
async function guestMenu(r: Restaurant, deviceId: string) {
  // A paid table waits for cleaning; mark it clean as the host would
  await appDb.update(s.diningTables).set({ state: "available" }).where(and(eq(s.diningTables.tenantId, r.tenantId), ne(s.diningTables.state, "seated")));
  await startOrJoinTable({ outletCode: r.outletCode, shortCode: r.tableQr, deviceId });
  return getMenuScreen(r.outletCode, r.tableQr, deviceId);
}

/** Every string anywhere inside a value, so a leak cannot hide in a nested field */
const textOf = (value: unknown) => JSON.stringify(value);

beforeAll(async () => {
  const config = dbConfig();
  if (config.database !== "tableqr_test") throw new Error(`Refusing to reset ${config.database}`);
  conn = await mysql.createConnection({ ...config, charset: "utf8mb4", timezone: "Z", multipleStatements: false });
  const db = drizzle({ client: conn, schema, mode: "default" });
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  await wipeAll(db);
  await seedPlatform(db);

  const setup = [
    { key: "A", name: "Alpha Dhaba", code: "ISOA1", phone: "9100000001", pin: "1111", item: "Alpha Paneer", member: "Alpha Waiter", memberPhone: "9100000011" },
    { key: "B", name: "Bravo Cafe", code: "ISOB1", phone: "9100000002", pin: "2222", item: "Bravo Sandwich", member: "Bravo Waiter", memberPhone: "9100000022" },
    { key: "C", name: "Charlie Pizza", code: "ISOC1", phone: "9100000003", pin: "3333", item: "Charlie Margherita", member: "Charlie Waiter", memberPhone: "9100000033" },
  ] as const;

  for (const x of setup) {
    const made = await createRestaurant(db, x.key, x.name, x.code, x.phone, x.pin);
    const owner = await signIn(x.code, x.phone, x.pin);
    const categoryId = await saveMenuCategory(owner, { nameEn: `${x.name} Mains` });
    const itemId = await saveMenuItem(owner, { categoryId: categoryId!, nameEn: x.item, pricePaise: 20000, isVeg: true, prepMinutes: 10, station: "Kitchen" });
    const member = await seedWaiter(db, made.tenantId, made.outletId, x.member, x.memberPhone, "4444");

    await db.update(s.outlets).set({ confirmFirstTableOrder: false }).where(eq(s.outlets.id, made.outletId));
    // A guest scans this restaurant's table, orders and the bill is paid at the counter
    const deviceId = `iso-guest-${x.key}`;
    const { participantId } = await startOrJoinTable({ outletCode: x.code, shortCode: made.tableQr, deviceId, displayName: `${x.key} Guest` });
    const guest = await attachVerifiedTestGuest(appDb, await getGuestContext(x.code, made.tableQr, participantId, deviceId), `${x.key} Guest`);
    await addCartLine(guest, { itemId, qty: 1 });
    await placeOrder(guest);

    R[x.key] = {
      key: x.key,
      name: x.name,
      outletCode: x.code,
      tenantId: made.tenantId,
      outletId: made.outletId,
      ownerPhone: x.phone,
      ownerPin: x.pin,
      tableQr: made.tableQr,
      owner,
      categoryId: categoryId!,
      itemId,
      itemName: x.item,
      memberId: member.id,
      memberName: x.member,
      sessionId: guest.sessionId,
      guest,
    };
  }
  // A and B have paid; C's table is still open, so queues and boards have live data to leak
  for (const k of ["A", "B"] as const) {
    await requestBill({ tenantId: R[k].tenantId, outletId: R[k].outletId, sessionId: R[k].sessionId });
    await settleAtCounter(R[k].owner, { sessionId: R[k].sessionId, method: "cash", receivedPaise: 100_000 });
  }
}, 120_000);

afterAll(async () => {
  // Leave the shared test database empty of this file's rows
  if (conn) {
    await wipeAll(drizzle({ client: conn, schema, mode: "default" }));
    await conn.end();
  }
  await appDb.$client.end();
});

describe("sign-in stays inside one restaurant", () => {
  it("an owner's phone and PIN do not open another restaurant's outlet", async () => {
    for (const k of keys) {
      for (const other of others(k)) {
        await failsWith(signInStaff({ outletCode: other.outletCode, phone: R[k].ownerPhone, pin: R[k].ownerPin }), ["sign_in_failed"]);
      }
    }
  });

  it("each signed-in owner is scoped to their own restaurant", () => {
    for (const k of keys) {
      expect(R[k].owner.tenantId).toBe(R[k].tenantId);
      expect(R[k].owner.outletId).toBe(R[k].outletId);
    }
  });
});

describe("staff screens show only their own restaurant", () => {
  it.each(keys)("restaurant %s: menu, team, orders, dashboard, reports, pricing, settings, POS and waiter board", async (k) => {
    const me = R[k];
    const screens = {
      menu: await menuManagerData(me.owner),
      team: await listTeam(me.owner),
      orders: await getRecentOrders(me.owner, new Date()),
      dashboard: await getDashboard(me.owner),
      report: await getReport(me.owner, 30, new Date()),
      pricing: await getPricingData(me.owner),
      settings: await getOutletSettings(me.owner),
      pos: await posQueue(me.owner),
      waiter: await waiterBoard(me.owner),
    };
    for (const [screen, data] of Object.entries(screens)) {
      const text = textOf(data);
      for (const other of others(k)) {
        for (const secret of [other.tenantId, other.outletId, other.itemId, other.itemName, other.memberId, other.memberName, other.sessionId, other.name, other.categoryId]) {
          expect(text.includes(secret), `${me.name} ${screen} shows ${other.name}'s "${secret}"`).toBe(false);
        }
      }
    }
    // And it still sees its own data, so the check above is not passing on empty screens
    expect(textOf(screens.menu)).toContain(me.itemName);
    expect(textOf(screens.team)).toContain(me.memberName);
  });

  it("dashboard and reports count only their own sales", async () => {
    // A and B each sold one dish; neither total may include the other's bill
    for (const k of ["A", "B"] as const) {
      const report = await getReport(R[k].owner, 30, new Date());
      expect(textOf(report)).not.toContain(R[k === "A" ? "B" : "A"].itemName);
    }
    const c = await getReport(R.C.owner, 30, new Date());
    expect(textOf(c)).not.toContain(R.A.itemName);
    expect(textOf(c)).not.toContain(R.B.itemName);
  });

  it("opening another restaurant's bill or table by id finds nothing", async () => {
    for (const k of keys) {
      for (const other of others(k)) {
        const pos = await posBillDetail(R[k].owner, other.sessionId).then((v) => v, (e: unknown) => e);
        if (!(pos instanceof AppError)) expect(textOf(pos)).not.toContain(other.itemName);
        const waiter = await waiterDetail(R[k].owner, other.sessionId).then((v) => v, (e: unknown) => e);
        if (!(waiter instanceof AppError)) expect(textOf(waiter)).not.toContain(other.itemName);
      }
    }
  });
});

describe("staff cannot change another restaurant's data", () => {
  it("menu: cannot edit, archive, mark sold out or reprice another restaurant's dish", async () => {
    const a = R.A.owner;
    const b = R.B;
    await failsWith(saveMenuItem(a, { id: b.itemId, categoryId: b.categoryId, nameEn: "Hacked", pricePaise: 100, isVeg: true, prepMinutes: 1, station: "X" }), ["invalid_state", "not_found"]);
    await failsWith(saveMenuItem(a, { id: b.itemId, categoryId: R.A.categoryId, nameEn: "Hacked", pricePaise: 100, isVeg: true, prepMinutes: 1, station: "X" }), ["not_found"]);
    await failsWith(archiveMenuItem(a, b.itemId), ["not_found"]);
    await failsWith(setMenuAvailability(a, b.itemId, "off"), ["not_found"]);
    await setOutletPrice(a, b.itemId, 100).catch(() => null);
    // Category rename by id: must not touch B's row
    await saveMenuCategory(a, { id: b.categoryId, nameEn: "Hacked category" }).catch(() => null);

    const [item] = await appDb.select().from(s.menuItems).where(eq(s.menuItems.id, b.itemId));
    expect(item).toMatchObject({ nameEn: b.itemName, pricePaise: 20000, isActive: true });
    const [cat] = await appDb.select().from(s.menuCategories).where(eq(s.menuCategories.id, b.categoryId));
    expect(cat.nameEn).toBe(`${b.name} Mains`);
    const overrides = await appDb.select().from(s.outletItemOverrides).where(eq(s.outletItemOverrides.itemId, b.itemId));
    expect(overrides.filter((o) => o.tenantId !== b.tenantId)).toEqual([]);
    expect(overrides).toEqual([]);
    // B's guests still see the dish, at its own price
    const screen = await guestMenu(b, "iso-fresh-B");
    const row = screen.menu.flatMap((c) => c.items).find((i) => i.id === b.itemId);
    expect(row).toMatchObject({ nameEn: b.itemName, available: true });
    expect(row!.price.paise).toBe(20000);
  });

  it("team: cannot change role, reset PIN or switch off another restaurant's staff", async () => {
    const a = R.A.owner;
    const c = R.C;
    await failsWith(changeRole(a, c.memberId, "manager"), ["not_found", "invalid_state", "forbidden"]);
    await failsWith(resetPin(a, c.memberId, "9999"), ["not_found", "invalid_state", "forbidden"]);
    await failsWith(setMemberActive(a, c.memberId, false), ["not_found", "invalid_state", "forbidden"]);
    const [user] = await appDb.select().from(s.users).where(eq(s.users.id, c.memberId));
    expect(user.isActive).toBe(true);
    const roles = await appDb.select().from(s.staffRoles).where(eq(s.staffRoles.userId, c.memberId));
    expect(roles.map((r) => [r.tenantId, r.role])).toEqual([[c.tenantId, "waiter"]]);
    // C's waiter still signs in with the old PIN
    expect(await signIn(c.outletCode, "9100000033", "4444")).toMatchObject({ tenantId: c.tenantId });
  });

  it("adding a team member with another restaurant's phone makes a separate person", async () => {
    const added = await seedWaiter(appDb, R.A.tenantId, R.A.outletId, "Shared Phone", "9100000033", "5555");
    expect(added.id).not.toBe(R.C.memberId);
    // Each restaurant's sign-in keeps its own PIN for that phone
    expect(await signIn(R.A.outletCode, "9100000033", "5555")).toMatchObject({ tenantId: R.A.tenantId });
    await failsWith(signInStaff({ outletCode: R.A.outletCode, phone: "9100000033", pin: "4444" }), ["sign_in_failed"]);
    expect(await signIn(R.C.outletCode, "9100000033", "4444")).toMatchObject({ tenantId: R.C.tenantId });
  });

  it("billing: cannot settle or request the bill of another restaurant's table", async () => {
    await failsWith(settleAtCounter(R.A.owner, { sessionId: R.C.sessionId, method: "cash", receivedPaise: 100_000 }), ["not_found", "session_expired", "invalid_state", "invalid_line"]);
    await failsWith(requestBill({ tenantId: R.A.tenantId, outletId: R.A.outletId, sessionId: R.C.sessionId }), ["not_found", "session_expired", "invalid_state"]);
    const [session] = await appDb.select().from(s.tableSessions).where(eq(s.tableSessions.id, R.C.sessionId));
    expect(session.status).toBe("open");
    const bills = await appDb.select().from(s.bills).where(eq(s.bills.sessionId, R.C.sessionId));
    expect(bills).toEqual([]);
  });
});

describe("guests stay inside the restaurant whose QR they scanned", () => {
  it("one restaurant's outlet code with another's table QR does not open a table", async () => {
    for (const k of keys) {
      for (const other of others(k)) {
        await failsWith(startOrJoinTable({ outletCode: R[k].outletCode, shortCode: other.tableQr, deviceId: `iso-mix-${k}-${other.key}` }), ["not_found", "table_not_found", "invalid_qr", "session_expired"] as AppError["code"][]);
      }
    }
  });

  it("each guest menu lists only that restaurant's dishes", async () => {
    for (const k of keys) {
      const screen = await guestMenu(R[k], `iso-menu-${k}`);
      const text = textOf(screen);
      expect(text).toContain(R[k].itemName);
      for (const other of others(k)) expect(text.includes(other.itemName), `${R[k].name} menu shows ${other.itemName}`).toBe(false);
    }
  });

  it("a guest cannot put another restaurant's dish in the cart", async () => {
    await failsWith(addCartLine(R.C.guest, { itemId: R.A.itemId, qty: 1 }), ["not_found", "invalid_line", "sold_out", "unavailable_now"] as AppError["code"][]);
    const lines = await appDb.select().from(s.cartLines).where(eq(s.cartLines.sessionId, R.C.sessionId));
    expect(lines.filter((l) => l.itemId === R.A.itemId)).toEqual([]);
  });

  it("every order line and bill row belongs to the restaurant of its table", async () => {
    const [mismatch] = await appDb.execute(sql`
      SELECT COUNT(*) AS n FROM order_lines ol
      JOIN orders o ON o.id = ol.order_id
      JOIN menu_items mi ON mi.id = ol.item_id
      WHERE ol.tenant_id <> o.tenant_id OR mi.tenant_id <> o.tenant_id`);
    expect(Number((mismatch as unknown as { n: number }[])[0].n)).toBe(0);
    const [bills] = await appDb.execute(sql`
      SELECT COUNT(*) AS n FROM bills b JOIN table_sessions ts ON ts.id = b.session_id WHERE b.tenant_id <> ts.tenant_id`);
    expect(Number((bills as unknown as { n: number }[])[0].n)).toBe(0);
  });
});

describe("hotel rooms stay inside one restaurant", () => {
  it("cannot see, check in, check out or order for another restaurant's room, and its room QR opens nothing elsewhere", async () => {
    for (const k of ["A", "C"] as const) await appDb.update(s.tenants).set({ planCode: "hotel_plus" }).where(eq(s.tenants.id, R[k].tenantId));
    const { id: roomC } = await saveRoom(R.C.owner, { number: "101" });
    await checkIn(R.C.owner, roomC, { guestName: "C Guest" });
    const [qr] = await appDb.select({ code: s.qrCodes.shortCode }).from(s.rooms).innerJoin(s.qrCodes, eq(s.qrCodes.tableId, s.rooms.tableId)).where(eq(s.rooms.id, roomC));

    expect((await getRooms(R.A.owner)).rooms).toEqual([]);
    await failsWith(checkIn(R.A.owner, roomC, { guestName: "Intruder" }), ["not_found"]);
    await failsWith(checkOut(R.A.owner, roomC), ["not_found"]);
    await failsWith(roomFoodTab(R.A.owner, roomC), ["not_found"]);
    // A restaurant without rooms in its plan cannot open Rooms at all
    await failsWith(getRooms(R.B.owner), ["forbidden"]);
    // A's outlet code with C's room QR finds nothing
    expect(await getRoomPage(R.A.outletCode, qr.code, null)).toEqual({ kind: "error", code: "not_found" });
    await failsWith(askFromRoom(R.A.outletCode, qr.code, "towels", null), ["not_found"]);
    const [stay] = await appDb.select().from(s.roomStays).where(eq(s.roomStays.roomId, roomC));
    expect(stay).toMatchObject({ tenantId: R.C.tenantId, status: "open", guestName: "C Guest" });
    for (const k of ["A", "C"] as const) await appDb.update(s.tenants).set({ planCode: "pro" }).where(eq(s.tenants.id, R[k].tenantId));
  });
});
