import "server-only";
import { randomBytes, randomInt } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { cleanRoomNumber, ROOM_CLASS, roomCode, type RoomRequestKind, type RoomStatus } from "@/domain/rooms";
import { canSee } from "@/lib/staff-permissions";
import { LOCK_THEN_READ, type Tx } from "../db-types";
import { AppError } from "../errors";
import { releaseVisitTables, visitChanged } from "../floor/assignments";
import { openVisit, visitAt } from "../floor/visits";
import { requireFeature, tenantFeatures } from "../plan";
import { publish } from "../realtime/publish";
import { audit } from "./audit";
import { waiterCoverage } from "./waiter-coverage";
import { topics } from "../realtime/token";
import type { StaffSession } from "./auth";

// Hotel rooms at one outlet: the room list, check-in and check-out, food for a room, and what
// guests ask for from the room's QR. Kept apart from the restaurant floor. Each room runs its food
// on a hidden counter (tableClass "room", never active on the floor) whose QR is the room's QR, so
// the kitchen, bill and payments are the restaurant's own.

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "roles" | "userId" | "name">;
const bad = (message: string) => new AppError("invalid_state", message);
const MANAGE = ["owner", "manager"] as const;

async function guard(staff: Staff, manage = false) {
  if (!canSee(staff, "rooms")) throw new AppError("forbidden", "Ask the owner, a manager or reception to open Rooms.");
  if (manage && !staff.roles.some((r) => (MANAGE as readonly string[]).includes(r))) throw new AppError("forbidden", "Only the owner or a manager can add or change rooms.");
  await requireFeature(staff.tenantId, "rooms");
}

const scopeOf = (staff: Staff) => ({ tenantId: staff.tenantId, outletId: staff.outletId });
const shortCode = () => randomBytes(6).toString("base64url").replace(/[-_]/g, "x").slice(0, 8);

async function roomRow(run: Tx | typeof db, staff: Staff, roomId: string, lock = false) {
  const q = run
    .select()
    .from(s.rooms)
    .where(and(eq(s.rooms.tenantId, staff.tenantId), eq(s.rooms.outletId, staff.outletId), eq(s.rooms.id, String(roomId)), eq(s.rooms.isActive, true)));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw new AppError("not_found", "This room was not found.");
  return row;
}

async function openStay(run: Tx | typeof db, tenantId: string, roomId: string) {
  const [stay] = await run.select().from(s.roomStays).where(and(eq(s.roomStays.tenantId, tenantId), eq(s.roomStays.openKey, roomId)));
  return stay ?? null;
}

/** Food on a room during a stay: what is still unpaid on the open tab, and what was paid */
async function foodOf(tenantId: string, tableIds: string[], since: Map<string, Date>) {
  if (!tableIds.length) return new Map<string, { sessionId: string | null; unpaidPaise: number; paidPaise: number; items: number }>();
  const earliest = new Date(Math.min(...[...since.values()].map((d) => d.getTime())));
  const sessions = await db
    .select({ id: s.tableSessions.id, tableId: s.tableSessions.tableId, status: s.tableSessions.status, openedAt: s.tableSessions.openedAt })
    .from(s.tableSessions)
    .where(and(eq(s.tableSessions.tenantId, tenantId), inArray(s.tableSessions.tableId, tableIds), gte(s.tableSessions.openedAt, earliest)));
  const mine = sessions.filter((x) => since.has(x.tableId) && x.openedAt >= since.get(x.tableId)!);
  const ids = mine.map((x) => x.id);
  const [lines, bills] = ids.length
    ? await Promise.all([
        db
          .select({ sessionId: s.orderLines.sessionId, paise: sql<string>`SUM(${s.orderLines.unitPricePaise} * ${s.orderLines.qty})`, n: sql<string>`SUM(${s.orderLines.qty})` })
          .from(s.orderLines)
          .where(and(eq(s.orderLines.tenantId, tenantId), inArray(s.orderLines.sessionId, ids), notInArray(s.orderLines.status, ["cancelled", "voided"])))
          .groupBy(s.orderLines.sessionId),
        db.select({ sessionId: s.bills.sessionId, total: s.bills.totalPaise }).from(s.bills).where(and(eq(s.bills.tenantId, tenantId), inArray(s.bills.sessionId, ids), eq(s.bills.status, "paid"))),
      ])
    : [[], []];
  const out = new Map<string, { sessionId: string | null; unpaidPaise: number; paidPaise: number; items: number }>();
  for (const x of mine) {
    const o = out.get(x.tableId) ?? { sessionId: null, unpaidPaise: 0, paidPaise: 0, items: 0 };
    const l = lines.find((r) => r.sessionId === x.id);
    if (x.status !== "closed") {
      o.sessionId = x.id;
      o.unpaidPaise += Number(l?.paise ?? 0);
      o.items += Number(l?.n ?? 0);
    }
    o.paidPaise += bills.filter((b) => b.sessionId === x.id).reduce((n, b) => n + b.total, 0);
    out.set(x.tableId, o);
  }
  return out;
}

export async function getRooms(staff: Staff & { outlet?: Pick<StaffSession["outlet"], "code"> }) {
  await guard(staff);
  const [rows, stays, requests, features] = await Promise.all([
    db
      .select({ room: s.rooms, shortCode: s.qrCodes.shortCode })
      .from(s.rooms)
      .leftJoin(s.qrCodes, and(eq(s.qrCodes.tenantId, s.rooms.tenantId), eq(s.qrCodes.tableId, s.rooms.tableId), eq(s.qrCodes.type, "table"), isNull(s.qrCodes.revokedAt)))
      .where(and(eq(s.rooms.tenantId, staff.tenantId), eq(s.rooms.outletId, staff.outletId), eq(s.rooms.isActive, true)))
      .orderBy(asc(s.rooms.number)),
    db.select().from(s.roomStays).where(and(eq(s.roomStays.tenantId, staff.tenantId), eq(s.roomStays.outletId, staff.outletId), eq(s.roomStays.status, "open"))),
    db
      .select({ id: s.roomRequests.id, roomId: s.roomRequests.roomId, kind: s.roomRequests.kind, note: s.roomRequests.note, createdAt: s.roomRequests.createdAt })
      .from(s.roomRequests)
      .where(and(eq(s.roomRequests.tenantId, staff.tenantId), eq(s.roomRequests.outletId, staff.outletId), eq(s.roomRequests.status, "open")))
      .orderBy(asc(s.roomRequests.createdAt)),
    tenantFeatures(staff.tenantId),
  ]);
  const stayOf = new Map(stays.map((x) => [x.roomId, x]));
  const since = new Map(rows.flatMap(({ room }) => (stayOf.has(room.id) ? [[room.tableId, stayOf.get(room.id)!.checkInAt] as const] : [])));
  const food = await foodOf(staff.tenantId, [...since.keys()], since);
  const rooms = rows
    .map(({ room, shortCode }) => {
      const stay = stayOf.get(room.id);
      const f = food.get(room.tableId);
      return {
        id: room.id,
        number: room.number,
        roomType: room.roomType,
        floorLabel: room.floorLabel,
        status: room.status as RoomStatus,
        hasQr: !!shortCode,
        /** The guest page behind the room's QR, so staff can open it to test */
        guestPath: shortCode && staff.outlet ? `/r/${encodeURIComponent(staff.outlet.code)}/room/${encodeURIComponent(shortCode)}` : null,
        stay: stay
          ? {
              id: stay.id,
              guestName: stay.guestName,
              guestPhone: stay.guestPhone,
              guests: stay.guests,
              foodPay: stay.foodPay,
              note: stay.note,
              checkInAt: stay.checkInAt.getTime(),
              expectedCheckOutAt: stay.expectedCheckOutAt?.getTime() ?? null,
              food: { sessionId: f?.sessionId ?? null, unpaidPaise: f?.unpaidPaise ?? 0, paidPaise: f?.paidPaise ?? 0, items: f?.items ?? 0 },
            }
          : null,
        requests: requests.filter((r) => r.roomId === room.id).map((r) => ({ id: r.id, kind: r.kind as RoomRequestKind, note: r.note, createdAt: r.createdAt.getTime() })),
      };
    })
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  // Who looks after each room: the same shift assignment a table has, so the waiter app and alerts follow it
  const coverage = await waiterCoverage(scopeOf(staff));
  const roomTable = new Map(rows.map(({ room }) => [room.id, room.tableId]));
  const waiterOf = (roomId: string) => {
    const id = coverage.shifts.find((a) => a.tableId === roomTable.get(roomId))?.waiterUserId;
    return id ? { id, name: coverage.owner(id)?.name ?? "Waiter" } : null;
  };
  return {
    rooms: rooms.map((r) => ({ ...r, waiter: waiterOf(r.id) })),
    waiters: coverage.waiters.map((w) => ({ id: w.id, name: w.name, onDuty: w.duty === "on" })),
    maxRooms: features.maxRooms,
    canManage: staff.roles.some((r) => (MANAGE as readonly string[]).includes(r)),
    canBill: canSee(staff, "billing"),
  };
}
export type RoomsData = Awaited<ReturnType<typeof getRooms>>;

/** The zone a room's hidden counter sits in: the outlet's first, or a hidden one for a hotel without a floor */
async function zoneFor(tx: Tx, staff: Staff) {
  const [zone] = await tx.select({ id: s.zones.id }).from(s.zones).where(and(eq(s.zones.tenantId, staff.tenantId), eq(s.zones.outletId, staff.outletId))).orderBy(asc(s.zones.sortOrder)).limit(1);
  if (zone) return zone.id;
  const id = uuidv7();
  await tx.insert(s.zones).values({ id, tenantId: staff.tenantId, outletId: staff.outletId, name: "Rooms", sortOrder: 99, isActive: false });
  return id;
}

/** A room with its hidden counter and QR; the caller has checked the number and the plan's limit */
export async function insertRoom(tx: Tx, at: { tenantId: string; outletId: string; zoneId: string }, room: { number: string; roomType?: string | null; floorLabel?: string | null }, now = new Date()) {
  const tableId = uuidv7();
  await tx.insert(s.diningTables).values({
    id: tableId,
    tenantId: at.tenantId,
    outletId: at.outletId,
    zoneId: at.zoneId,
    code: roomCode(room.number),
    minSeats: 1,
    maxSeats: 10,
    tableClass: ROOM_CLASS,
    joinCode: String(randomInt(1000, 10000)),
    isBookableOnline: false,
    isActive: false,
    state: "available",
    stateChangedAt: now,
  });
  await tx.insert(s.qrCodes).values({ id: uuidv7(), tenantId: at.tenantId, outletId: at.outletId, tableId, type: "table", shortCode: shortCode(), createdAt: now });
  const id = uuidv7();
  await tx.insert(s.rooms).values({ id, tenantId: at.tenantId, outletId: at.outletId, number: room.number, roomType: room.roomType ?? null, floorLabel: room.floorLabel ?? null, tableId });
  return id;
}

/** Add a room, or change its number, type or floor */
export async function saveRoom(staff: Staff, input: { id?: string | null; number: string; roomType?: string; floorLabel?: string }, now = new Date()) {
  await guard(staff, true);
  const number = cleanRoomNumber(input.number);
  if (!number) throw bad("Enter the room number as on the door, like 204 (up to 7 letters or digits).");
  const roomType = String(input.roomType ?? "").trim().replace(/\s+/g, " ").slice(0, 40) || null;
  const floorLabel = String(input.floorLabel ?? "").trim().replace(/\s+/g, " ").slice(0, 40) || null;
  return db.transaction(async (tx) => {
    const taken = await tx
      .select({ id: s.diningTables.id })
      .from(s.diningTables)
      .where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.outletId, staff.outletId), eq(s.diningTables.code, roomCode(number))));
    if (input.id) {
      const room = await roomRow(tx, staff, input.id, true);
      if (taken.some((t) => t.id !== room.tableId)) throw bad(`Room ${number} is already on your list.`);
      await tx.update(s.rooms).set({ number, roomType, floorLabel }).where(and(eq(s.rooms.tenantId, staff.tenantId), eq(s.rooms.id, room.id)));
      await tx.update(s.diningTables).set({ code: roomCode(number) }).where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.id, room.tableId)));
      await audit(tx, { ...staff }, { action: "room.updated", entity: "room", entityId: room.id, before: { number: room.number, roomType: room.roomType, floorLabel: room.floorLabel }, after: { number, roomType, floorLabel }, now });
      return { id: room.id };
    }
    if (taken.length) throw bad(`Room ${number} is already on your list.`);
    const { maxRooms } = await tenantFeatures(staff.tenantId);
    if (maxRooms !== null) {
      const [{ n }] = await tx.select({ n: sql<number>`COUNT(*)` }).from(s.rooms).where(and(eq(s.rooms.tenantId, staff.tenantId), eq(s.rooms.isActive, true)));
      if (Number(n) >= maxRooms) throw bad(`Your plan includes ${maxRooms} room${maxRooms === 1 ? "" : "s"}. To add more, ask Tableeqr to upgrade your plan.`);
    }
    const id = await insertRoom(tx, { tenantId: staff.tenantId, outletId: staff.outletId, zoneId: await zoneFor(tx, staff) }, { number, roomType, floorLabel }, now);
    await audit(tx, staff, { action: "room.added", entity: "room", entityId: id, after: { number, roomType, floorLabel }, now });
    return { id };
  });
}

/** Take a room off the list; its QR stops working. Not while a guest is in it. */
export async function removeRoom(staff: Staff, roomId: string, now = new Date()) {
  await guard(staff, true);
  await db.transaction(async (tx) => {
    const room = await roomRow(tx, staff, roomId, true);
    if (await openStay(tx, staff.tenantId, room.id)) throw bad(`Check the guest out of Room ${room.number} first.`);
    await tx.update(s.rooms).set({ isActive: false, number: `x${room.id.slice(-6)}` }).where(and(eq(s.rooms.tenantId, staff.tenantId), eq(s.rooms.id, room.id)));
    await tx.update(s.diningTables).set({ code: `x${room.id.slice(-8)}` }).where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.id, room.tableId)));
    await tx.update(s.qrCodes).set({ revokedAt: now }).where(and(eq(s.qrCodes.tenantId, staff.tenantId), eq(s.qrCodes.tableId, room.tableId), isNull(s.qrCodes.revokedAt)));
    await audit(tx, staff, { action: "room.removed", entity: "room", entityId: room.id, before: { number: room.number }, now });
  });
}

/** Ready, cleaning or out of service; a room with a guest in it changes only by check-out */
export async function setRoomStatus(staff: Staff, roomId: string, status: RoomStatus, now = new Date()) {
  await guard(staff);
  if (!["vacant", "cleaning", "blocked"].includes(status)) throw bad("Choose Ready, Cleaning or Out of service.");
  if (status === "blocked" && !staff.roles.some((r) => (MANAGE as readonly string[]).includes(r))) throw new AppError("forbidden", "Only the owner or a manager can take a room out of service.");
  await db.transaction(async (tx) => {
    const room = await roomRow(tx, staff, roomId, true);
    if (room.status === "occupied") throw bad(`Room ${room.number} has a guest. Check them out first.`);
    await tx.update(s.rooms).set({ status }).where(and(eq(s.rooms.tenantId, staff.tenantId), eq(s.rooms.id, room.id)));
    await audit(tx, staff, { action: "room.status", entity: "room", entityId: room.id, before: { status: room.status }, after: { status }, now });
  });
}

export async function checkIn(
  staff: Staff,
  roomId: string,
  input: { guestName: string; guestPhone?: string; guests?: number | string; foodPay?: string; checkOutDate?: string; note?: string },
  now = new Date(),
) {
  await guard(staff);
  const guestName = String(input.guestName ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (guestName.length < 2) throw bad("Enter the guest's name.");
  const phoneDigits = String(input.guestPhone ?? "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  if (phoneDigits && !/^\d{10}$/.test(phoneDigits)) throw bad("Enter a 10-digit mobile number, or leave it empty.");
  const guests = Math.floor(Number(input.guests ?? 1));
  if (!Number.isFinite(guests) || guests < 1 || guests > 20) throw bad("Enter how many guests, 1 to 20.");
  const foodPay = input.foodPay === "per_order" ? "per_order" : "at_checkout";
  let expected: Date | null = null;
  if (input.checkOutDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.checkOutDate)) throw bad("Choose the check-out date.");
    // Noon in India on that day, the usual check-out time
    expected = new Date(`${input.checkOutDate}T12:00:00+05:30`);
    if (expected.getTime() < now.getTime() - 86_400_000) throw bad("The check-out date is already past.");
  }
  const note = String(input.note ?? "").trim().slice(0, 140) || null;
  return db.transaction(async (tx) => {
    const room = await roomRow(tx, staff, roomId, true);
    if (await openStay(tx, staff.tenantId, room.id)) throw new AppError("conflict", `Room ${room.number} already has a guest.`);
    if (room.status === "blocked") throw bad(`Room ${room.number} is out of service.`);
    const id = uuidv7();
    await tx.insert(s.roomStays).values({
      id,
      tenantId: staff.tenantId,
      outletId: staff.outletId,
      roomId: room.id,
      guestName,
      guestPhone: phoneDigits ? `+91${phoneDigits}` : null,
      guests,
      foodPay,
      note,
      status: "open",
      openKey: room.id,
      checkInAt: now,
      expectedCheckOutAt: expected,
      checkedInByUserId: staff.userId,
    });
    await tx.update(s.rooms).set({ status: "occupied" }).where(and(eq(s.rooms.tenantId, staff.tenantId), eq(s.rooms.id, room.id)));
    await audit(tx, staff, { action: "room.checked_in", entity: "room", entityId: room.id, after: { stayId: id, guestName, guests, foodPay }, now });
    return { stayId: id };
  });
}

/** Closes a room's food tab that has nothing on it; one with food must be paid on Billing first */
async function closeEmptyTab(tx: Tx, staff: Staff, room: typeof s.rooms.$inferSelect, now: Date) {
  const visit = await visitAt(tx, scopeOf(staff), room.tableId);
  if (!visit) return null;
  const [line] = await tx
    .select({ id: s.orderLines.id })
    .from(s.orderLines)
    .where(and(eq(s.orderLines.tenantId, staff.tenantId), eq(s.orderLines.sessionId, visit.session.id), notInArray(s.orderLines.status, ["cancelled", "voided"])))
    .limit(1);
  if (line) throw new AppError("conflict", `Room ${room.number} has a food bill that is not paid yet. Take the payment on Billing first.`, { reason: "food_unpaid", sessionId: visit.session.id });
  await tx.update(s.tableSessions).set({ status: "closed", openKey: null, closedAt: now }).where(and(eq(s.tableSessions.tenantId, staff.tenantId), eq(s.tableSessions.id, visit.session.id)));
  await releaseVisitTables(tx, staff.tenantId, visit.session.id, now);
  await tx.update(s.diningTables).set({ state: "available", stateChangedAt: now }).where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.id, room.tableId)));
  return visit.session.id;
}

/** The guest leaves: the food must be paid, the room goes to Cleaning, open requests are closed */
export async function checkOut(staff: Staff, roomId: string, now = new Date()) {
  await guard(staff);
  const res = await db.transaction(async (tx) => {
    const room = await roomRow(tx, staff, roomId, true);
    const stay = await openStay(tx, staff.tenantId, room.id);
    if (!stay) throw bad(`Room ${room.number} has no guest checked in.`);
    const closed = await closeEmptyTab(tx, staff, room, now);
    await tx.update(s.roomStays).set({ status: "closed", openKey: null, checkOutAt: now, checkedOutByUserId: staff.userId }).where(and(eq(s.roomStays.tenantId, staff.tenantId), eq(s.roomStays.id, stay.id)));
    await tx.update(s.rooms).set({ status: "cleaning" }).where(and(eq(s.rooms.tenantId, staff.tenantId), eq(s.rooms.id, room.id)));
    await tx.update(s.roomRequests).set({ status: "done", doneAt: now, doneByUserId: staff.userId }).where(and(eq(s.roomRequests.tenantId, staff.tenantId), eq(s.roomRequests.stayId, stay.id), eq(s.roomRequests.status, "open")));
    await audit(tx, staff, { action: "room.checked_out", entity: "room", entityId: room.id, after: { stayId: stay.id }, now });
    return { closed };
  }, LOCK_THEN_READ);
  if (res.closed) await publish(scopeOf(staff), [visitChanged(res.closed, "closed")]);
}

/**
 * Staff take a room's food order (a phone call from the room): the room's open food tab, opened
 * now if there is none. Items are then added on Billing like any table.
 */
export async function roomFoodTab(staff: Staff, roomId: string, now = new Date()) {
  await guard(staff);
  if (!canSee(staff, "billing")) throw new AppError("forbidden", "Ask someone with Billing to add food for a room.");
  const res = await db.transaction(async (tx) => {
    const room = await roomRow(tx, staff, roomId, true);
    const stay = await openStay(tx, staff.tenantId, room.id);
    if (!stay) throw bad(`Check a guest in to Room ${room.number} first.`);
    const [table] = await tx.select().from(s.diningTables).where(and(eq(s.diningTables.tenantId, staff.tenantId), eq(s.diningTables.id, room.tableId))).for("update");
    const visit = await visitAt(tx, scopeOf(staff), table.id);
    if (visit) {
      if (visit.session.status !== "open") throw new AppError("conflict", `Room ${room.number}'s bill is being paid. Finish it on Billing first.`);
      return { sessionId: visit.session.id, opened: false };
    }
    const sessionId = await openVisit(tx, scopeOf(staff), [table], {
      source: "walk_in",
      partySize: stay.guests,
      guestName: stay.guestName,
      expectedEndAt: new Date(now.getTime() + 12 * 3_600_000),
      userId: staff.userId,
      now,
    });
    return { sessionId, opened: true };
  }, LOCK_THEN_READ);
  if (res.opened) await publish(scopeOf(staff), [visitChanged(res.sessionId, "seated")]);
  return { sessionId: res.sessionId };
}

export async function finishRoomRequest(staff: Staff, requestId: string, now = new Date()) {
  await guard(staff);
  await db
    .update(s.roomRequests)
    .set({ status: "done", doneAt: now, doneByUserId: staff.userId })
    .where(and(eq(s.roomRequests.tenantId, staff.tenantId), eq(s.roomRequests.outletId, staff.outletId), eq(s.roomRequests.id, String(requestId)), eq(s.roomRequests.status, "open")));
}

/** Past stays, newest first, for the History tab */
export async function stayHistory(staff: Staff, limit = 300) {
  await guard(staff);
  const rows = await db
    .select({ id: s.roomStays.id, number: s.rooms.number, guestName: s.roomStays.guestName, guestPhone: s.roomStays.guestPhone, guests: s.roomStays.guests, checkInAt: s.roomStays.checkInAt, checkOutAt: s.roomStays.checkOutAt, tableId: s.rooms.tableId })
    .from(s.roomStays)
    .innerJoin(s.rooms, and(eq(s.rooms.tenantId, s.roomStays.tenantId), eq(s.rooms.id, s.roomStays.roomId)))
    .where(and(eq(s.roomStays.tenantId, staff.tenantId), eq(s.roomStays.outletId, staff.outletId), ne(s.roomStays.status, "open")))
    .orderBy(desc(s.roomStays.checkOutAt))
    .limit(limit);
  // Room service paid during each stay
  const paid = rows.length
    ? await db
        .select({ tableId: s.tableSessions.tableId, openedAt: s.tableSessions.openedAt, total: s.bills.totalPaise })
        .from(s.bills)
        .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.bills.tenantId), eq(s.tableSessions.id, s.bills.sessionId)))
        .where(and(eq(s.bills.tenantId, staff.tenantId), eq(s.bills.status, "paid"), inArray(s.tableSessions.tableId, [...new Set(rows.map((r) => r.tableId))])))
    : [];
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    guestName: r.guestName,
    guestPhone: r.guestPhone,
    guests: r.guests,
    checkInAt: r.checkInAt.getTime(),
    checkOutAt: r.checkOutAt?.getTime() ?? null,
    foodPaise: paid.filter((p) => p.tableId === r.tableId && p.openedAt >= r.checkInAt && (!r.checkOutAt || p.openedAt <= r.checkOutAt)).reduce((n, p) => n + p.total, 0),
  }));
}
export type StayHistory = Awaited<ReturnType<typeof stayHistory>>;

/** Give a room to a waiter (or nobody). The room's food tab follows: their app shows it and its requests ring for them. */
export async function assignRoomWaiter(staff: Staff, roomId: string, waiterUserId: string | null, now = new Date()) {
  await guard(staff);
  if (!staff.userId) throw new AppError("forbidden", "Sign in again to assign a waiter.");
  const room = await roomRow(db, staff, roomId);
  if (waiterUserId) {
    const [waiter] = await db.select({ id: s.users.id }).from(s.users)
      .innerJoin(s.staffRoles, and(eq(s.staffRoles.tenantId, s.users.tenantId), eq(s.staffRoles.userId, s.users.id), eq(s.staffRoles.role, "waiter")))
      .where(and(eq(s.users.tenantId, staff.tenantId), eq(s.users.id, String(waiterUserId)), eq(s.users.isActive, true))).limit(1);
    if (!waiter) throw new AppError("not_found", "This waiter is not on your team.");
  }
  await db.transaction(async (tx) => {
    await tx.update(s.waiterTableAssignments).set({ active: false, activeKey: null, releasedAt: now })
      .where(and(eq(s.waiterTableAssignments.tenantId, staff.tenantId), eq(s.waiterTableAssignments.outletId, staff.outletId), eq(s.waiterTableAssignments.tableId, room.tableId), eq(s.waiterTableAssignments.active, true)));
    if (waiterUserId) {
      // A room stay runs for days, so the assignment lasts a week rather than one shift
      await tx.insert(s.waiterTableAssignments).values({ tenantId: staff.tenantId, outletId: staff.outletId, tableId: room.tableId, waiterUserId: String(waiterUserId), assignedByUserId: staff.userId!, periodKey: now.toISOString().slice(0, 10), activeKey: room.tableId, expiresAt: new Date(now.getTime() + 7 * 86_400_000), assignedAt: now });
    }
    // The food tab open right now moves too
    await tx.update(s.tableSessions).set({ waiterUserId: waiterUserId ? String(waiterUserId) : null })
      .where(and(eq(s.tableSessions.tenantId, staff.tenantId), eq(s.tableSessions.tableId, room.tableId), ne(s.tableSessions.status, "closed")));
    await audit(tx, staff, { action: "room.waiter_assigned", entity: "room", entityId: room.id, after: { waiterUserId }, now });
  }, LOCK_THEN_READ);
  await publish(scopeOf(staff), [{ topic: topics.floor, type: "waiter_assignment.changed", data: { tableIds: [room.tableId], waiterUserId } }, { topic: topics.tasks, type: "waiter_assignment.changed" }]);
}
