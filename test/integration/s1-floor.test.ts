import { and, eq, isNotNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { requestBill, settleAtCounter } from "@/server/billing/payments";
import { getGuestContext } from "@/server/guest/context";
import { guestContextForDevice } from "@/server/guest/menu-screen";
import { addCartLine } from "@/server/guest/cart";
import { placeOrder } from "@/server/guest/order";
import { startOrJoinTable } from "@/server/guest/session";
import { getTableLanding } from "@/server/guest/table";
import { getAfterVisit } from "@/server/guest/after-visit";
import { onPublish, type RealtimeEvent } from "@/server/realtime/publish";
import { resolveStaff, signInStaff, signOutStaff, type StaffSession } from "@/server/staff/auth";
import { getOnlineAvailability, setOnlineBookingsPaused, setSlotCapacity } from "@/server/floor/pacing";
import { getFloor, getTableDetail } from "@/server/floor/read";
import { checkInReservation, confirmReservation, createReservation, markNoShow, reassignReservation, seatReservation } from "@/server/floor/reservations";
import { reconcileFloor } from "@/server/floor/sync";
import {
  blockTable,
  clearEmptyVisit,
  combineTables,
  extendTime,
  markNeedsCleaning,
  markReady,
  moveParty,
  seatWalkIn,
  swapTables,
  uncombineTable,
  unblockTable,
} from "@/server/floor/table-actions";
import { addToWaitlist, notifyWaitlist, reorderWaitlist, seatWaitlist, skipWaitlist } from "@/server/floor/waitlist";
import { serviceDate } from "@/domain/booking-policy";
import { attachVerifiedTestGuest, resetTestDb } from "./setup-db";

let env: Awaited<ReturnType<typeof resetTestDb>>;
let host: StaffSession;
let manager: StaffSession;
const events: RealtimeEvent[] = [];
const T = (code: string) => env.demo.tableIds[code];
const QR = (code: string) => env.demo.tableQr[code];
const MIN = 60_000;

async function failsWith(p: Promise<unknown>, code: AppError["code"], reason?: string) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  if (reason) expect((err as AppError).details?.reason).toBe(reason);
  return err as AppError;
}
async function signIn(phone: string, pin: string, outletCode = "SRJ01") {
  const { token } = await signInStaff({ outletCode, phone, pin });
  return (await resolveStaff(token))!;
}
const stateOf = async (code: string) => (await env.db.select({ state: s.diningTables.state }).from(s.diningTables).where(eq(s.diningTables.id, T(code))))[0].state;
const auditCount = async (action: string) => (await env.db.select().from(s.auditLog).where(eq(s.auditLog.action, action))).length;

beforeAll(async () => {
  env = await resetTestDb();
  host = await signIn("9000000004", "4444");
  manager = await signIn("9000000002", "2222");
  onPublish((_scope, e) => events.push(...e));
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("staff auth", () => {
  it("signs in with phone and PIN; role and outlet come from the database", async () => {
    expect(host).toMatchObject({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, roles: ["host"], name: "Anil Kumar" });
    const owner = await signIn("+91 90000 00001", "1111");
    expect(owner.roles).toEqual(["owner"]);
  });

  it("checks the selected login card against assigned roles", async () => {
    await failsWith(signInStaff({ outletCode: "SRJ01", phone: "9000000004", pin: "4444", asRole: "owner" }), "sign_in_failed", "role_mismatch");
    const { token } = await signInStaff({ outletCode: "SRJ01", phone: "9000000004", pin: "4444", asRole: "host" });
    expect((await resolveStaff(token))?.roles).toEqual(["host"]);
  });

  it("refuses a wrong PIN, an inactive user, the wrong outlet and locks after five tries", async () => {
    await failsWith(signInStaff({ outletCode: "SRJ01", phone: "9000000004", pin: "1234" }), "sign_in_failed");
    await failsWith(signInStaff({ outletCode: "CNJ01", phone: "9000000004", pin: "4444" }), "sign_in_failed");
    await env.db.update(s.users).set({ isActive: false }).where(eq(s.users.id, env.demo.staffIds.kitchen));
    await failsWith(signInStaff({ outletCode: "SRJ01", phone: "9000000006", pin: "6666" }), "sign_in_failed");
    for (let i = 0; i < 4; i++) await signInStaff({ outletCode: "SRJ01", phone: "9000000005", pin: "0000" }).catch(() => null);
    await signInStaff({ outletCode: "SRJ01", phone: "9000000005", pin: "0000" }).catch(() => null);
    await failsWith(signInStaff({ outletCode: "SRJ01", phone: "9000000005", pin: "5555" }), "sign_in_failed", "locked");
  });

  it("drops the session when the user is deactivated, the role goes, or they sign out", async () => {
    const { token } = await signInStaff({ outletCode: "SRJ01", phone: "9000000003", pin: "3333" });
    expect((await resolveStaff(token))?.roles).toEqual(["cashier"]);
    await env.db.delete(s.staffRoles).where(eq(s.staffRoles.userId, env.demo.staffIds.cashier));
    expect(await resolveStaff(token)).toBeNull();
    const again = await signInStaff({ outletCode: "SRJ01", phone: "9000000002", pin: "2222" });
    await signOutStaff(again.token);
    expect(await resolveStaff(again.token)).toBeNull();
    expect(await resolveStaff("not-a-token")).toBeNull();
  });

  it("enforces roles on the server: a host cannot block a table", async () => {
    await failsWith(blockTable(host, { tableId: T("T1"), reason: "maintenance" }), "forbidden");
    const waiterOnly = { ...host, roles: ["waiter" as const] };
    await failsWith(seatWalkIn(waiterOnly, { tableId: T("T1"), partySize: 2 }), "forbidden");
  });
});

describe("walk-in and the table lifecycle", () => {
  it("seats a walk-in as a visit with nobody in it; the first phone becomes host", async () => {
    const { sessionId } = await seatWalkIn(host, { tableId: T("T3"), partySize: 3, guestName: "Kapoor" });
    expect(await stateOf("T3")).toBe("seated");
    const [session] = await env.db.select().from(s.tableSessions).where(eq(s.tableSessions.id, sessionId));
    expect(session).toMatchObject({ source: "walk_in", partySize: 3, guestName: "Kapoor", hostParticipantId: null, openedByUserId: host.userId });
    expect(session.expectedEndAt).not.toBeNull();
    expect(await env.db.select().from(s.participants).where(eq(s.participants.sessionId, sessionId))).toHaveLength(0);
    const [a, b] = await Promise.all([
      startOrJoinTable({ outletCode: "SRJ01", shortCode: QR("T3"), deviceId: "walk-a", displayName: "Ravi" }),
      startOrJoinTable({ outletCode: "SRJ01", shortCode: QR("T3"), deviceId: "walk-b", displayName: "Sana" }),
    ]);
    expect(a.sessionId).toBe(sessionId);
    expect(b.sessionId).toBe(sessionId);
    expect([a.isHost, b.isHost].filter(Boolean)).toHaveLength(1);
    const [after] = await env.db.select().from(s.tableSessions).where(eq(s.tableSessions.id, sessionId));
    expect(after.hostParticipantId).toBe(a.isHost ? a.participantId : b.participantId);
    expect(await auditCount("table.seat_walk_in")).toBe(1);
  });

  it("refuses a party bigger than the table and a table that is taken", async () => {
    await failsWith(seatWalkIn(host, { tableId: T("T1"), partySize: 3 }), "conflict", "capacity");
    await failsWith(seatWalkIn(host, { tableId: T("T3"), partySize: 2 }), "conflict", "occupied");
  });

  it("lets only one of two hosts seat the same table at once", async () => {
    const results = await Promise.allSettled([seatWalkIn(host, { tableId: T("T4"), partySize: 2 }), seatWalkIn(manager, { tableId: T("T4"), partySize: 2 })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await env.db.select().from(s.sessionTables).where(and(eq(s.sessionTables.tableId, T("T4")), isNotNull(s.sessionTables.activeKey)))).toHaveLength(1);
  });

  it("goes straight to Needs cleaning when paid, then Available, and never resets a table out of order", async () => {
    const visit = (await getTableDetail(host, T("T4"))).visit!;
    const guest = await startOrJoinTable({ outletCode: "SRJ01", shortCode: QR("T4"), deviceId: "t4-a", displayName: "Tara" });
    const ctx = await attachVerifiedTestGuest(appDb, await getGuestContext("SRJ01", QR("T4"), guest.participantId, "t4-a"), "Tara");
    await addCartLine(ctx, { itemId: env.demo.itemIds["Cola"], qty: 1 });
    await placeOrder(ctx);
    await failsWith(markNeedsCleaning(host, T("T4")), "invalid_state");
    await failsWith(markReady(host, T("T4")), "invalid_state");
    await settleAtCounter({ tenantId: host.tenantId, outletId: host.outletId, userId: host.userId }, { sessionId: visit.sessionId, method: "cash" });
    // Paying sends the table straight to Needs cleaning; the old Paid step is skipped
    expect(await stateOf("T4")).toBe("needs_cleaning");
    await failsWith(markNeedsCleaning(host, T("T4")), "invalid_state");
    await markReady(host, T("T4"));
    expect(await stateOf("T4")).toBe("available");
  });

  it("blocks and unblocks for managers only, with a reason; blocked tables cannot be seated", async () => {
    await failsWith(blockTable(manager, { tableId: T("T7"), reason: "other" }), "invalid_state", "note");
    await blockTable(manager, { tableId: T("T7"), reason: "maintenance", note: "Wobbly leg" });
    const tile = (await getFloor(host)).tables.find((t) => t.code === "T7")!;
    expect(tile).toMatchObject({ state: "blocked", blocked: { reason: "maintenance", note: "Wobbly leg" } });
    await failsWith(seatWalkIn(host, { tableId: T("T7"), partySize: 2 }), "conflict", "blocked");
    await failsWith(startOrJoinTable({ outletCode: "SRJ01", shortCode: QR("T7"), deviceId: "blk" }), "table_not_open");
    await failsWith(unblockTable(host, T("T7")), "forbidden");
    await unblockTable(manager, T("T7"));
    expect(await stateOf("T7")).toBe("available");
    expect(await auditCount("table.block")).toBe(1);
  });

  it("clears a walk-in that left without ordering, but never one with orders", async () => {
    await seatWalkIn(host, { tableId: T("B2"), partySize: 2 });
    await clearEmptyVisit(host, T("B2"));
    expect(await stateOf("B2")).toBe("needs_cleaning");
    await markReady(host, T("B2"));
    await failsWith(clearEmptyVisit(host, T("T5")), "conflict", "empty");
  });

  it("lifts a timed block when its time passes", async () => {
    const now = new Date();
    await blockTable(manager, { tableId: T("T2"), reason: "private_event", until: now.getTime() + 30 * MIN }, now);
    await reconcileFloor({ tenantId: host.tenantId, outletId: host.outletId }, new Date(now.getTime() + 31 * MIN));
    expect(await stateOf("T2")).toBe("available");
  });
});

describe("move, swap and combine keep the visit intact", () => {
  let guestSession: string;
  it("moves a party; phones, orders and bill follow; the old table needs cleaning", async () => {
    const joined = await startOrJoinTable({ outletCode: "SRJ01", shortCode: QR("T5"), deviceId: "mv-a", displayName: "Meher" });
    guestSession = joined.sessionId;
    const ctx = await attachVerifiedTestGuest(appDb, await getGuestContext("SRJ01", QR("T5"), joined.participantId, "mv-a"), "Meher");
    await addCartLine(ctx, { itemId: env.demo.itemIds["Cola"], qty: 2 });
    await placeOrder(ctx);
    await moveParty(host, { fromTableId: T("T5"), toTableId: T("T9") });
    expect(await stateOf("T9")).toBe("seated");
    expect(await stateOf("T5")).toBe("needs_cleaning");
    // The phone still has its visit from the old QR, and sees the new table
    const viaOld = await guestContextForDevice("SRJ01", QR("T5"), "mv-a");
    expect(viaOld.ctx.sessionId).toBe(guestSession);
    expect(viaOld.t.table.code).toBe("T9");
    expect(viaOld.ctx.tableId).toBe(T("T9"));
    expect((await getGuestContext("SRJ01", QR("T5"), joined.participantId, "mv-a")).sessionId).toBe(guestSession);
    expect((await getTableLanding("SRJ01", QR("T5"), "mv-a")).landing.kind).toBe("rejoin");
    const again = await startOrJoinTable({ outletCode: "SRJ01", shortCode: QR("T5"), deviceId: "mv-a" });
    expect(again.sessionId).toBe(guestSession);
    // Orders stay with the visit, and a new phone at the new table joins it
    const detail = (await getTableDetail(host, T("T9"))).visit!;
    expect(detail.rounds).toHaveLength(1);
    expect((await startOrJoinTable({ outletCode: "SRJ01", shortCode: QR("T9"), deviceId: "mv-b" })).sessionId).toBe(guestSession);
    // A new party at the old table gets its own visit once it is reset
    await markReady(host, T("T5"));
    const fresh = await startOrJoinTable({ outletCode: "SRJ01", shortCode: QR("T5"), deviceId: "new-at-t5" });
    expect(fresh.sessionId).not.toBe(guestSession);
  });

  it("swaps two seated parties atomically", async () => {
    const t5 = (await getTableDetail(host, T("T5"))).visit!.sessionId;
    await swapTables(host, { tableId: T("T9"), otherTableId: T("T5") });
    expect((await getTableDetail(host, T("T5"))).visit!.sessionId).toBe(guestSession);
    expect((await getTableDetail(host, T("T9"))).visit!.sessionId).toBe(t5);
    expect((await guestContextForDevice("SRJ01", QR("T9"), "mv-b")).ctx.sessionId).toBe(guestSession);
    await failsWith(swapTables(host, { tableId: T("T5"), otherTableId: T("T1") }), "conflict", "empty");
  });

  it("combines only configured tables; either QR joins the one visit; uncombines safely", async () => {
    await failsWith(combineTables(host, { tableId: T("T5"), addTableId: T("T10") }), "conflict", "not_combinable");
    await combineTables(host, { tableId: T("T5"), addTableId: T("T6") });
    expect(await stateOf("T6")).toBe("seated");
    const viaT6 = await startOrJoinTable({ outletCode: "SRJ01", shortCode: QR("T6"), deviceId: "cb-c", displayName: "Noor" });
    expect(viaT6.sessionId).toBe(guestSession);
    const floor = await getFloor(host);
    const [a, b] = ["T5", "T6"].map((c) => floor.tables.find((t) => t.code === c)!.visit!);
    expect(a.sessionId).toBe(b.sessionId);
    expect(a.tableIds).toEqual([T("T5"), T("T6")]);
    // One physical table, one live visit
    await failsWith(seatWalkIn(host, { tableId: T("T6"), partySize: 2 }), "conflict", "occupied");
    await failsWith(uncombineTable(host, T("T5")), "conflict", "primary");
    await failsWith(moveParty(host, { fromTableId: T("T5"), toTableId: T("T10") }), "conflict", "combined");
    await uncombineTable(host, T("T6"));
    expect(await stateOf("T6")).toBe("needs_cleaning");
    await markReady(host, T("T6"));
  });
});

describe("reservations, arrivals and extend", () => {
  let booking: string;
  it("reserves the table shortly before, shows the arrival, checks in and seats it", async () => {
    const now = new Date();
    ({ reservationId: booking } = await createReservation(host, { name: "Iyer", phone: "9876543210", partySize: 4, startAt: now.getTime() + 20 * MIN, tableIds: [T("T10")], occasion: "Birthday" }, now));
    expect(await stateOf("T10")).toBe("reserved");
    const floor = await getFloor(host, now);
    expect(floor.arrivals.map((a) => a.name)).toContain("Iyer");
    expect(floor.arrivals.find((a) => a.name === "Iyer")).toMatchObject({ partySize: 4, occasion: "Birthday", tableIds: [T("T10")], confirmed: true, lateMinutes: 0 });
    // A walk-in cannot take a reserved table; a guest scanning it is told it is reserved
    await failsWith(seatWalkIn(host, { tableId: T("T10"), partySize: 2 }), "conflict", "reserved");
    expect((await getTableLanding("SRJ01", QR("T10"), "scan-x")).landing.kind).toBe("reserved");
    await failsWith(markNoShow(host, booking, now), "conflict", "grace");
    await checkInReservation(host, booking, now);
    const { sessionId } = await seatReservation(host, { reservationId: booking }, now);
    const [r] = await env.db.select().from(s.reservations).where(eq(s.reservations.id, booking));
    expect(r).toMatchObject({ status: "seated", sessionId });
    expect(await stateOf("T10")).toBe("seated");
  });

  it("refuses a booking that collides with another on the same table, and a reassign into one", async () => {
    const now = new Date();
    const at = now.getTime() + 4 * 60 * MIN;
    await createReservation(host, { name: "Shah", partySize: 2, startAt: at, tableIds: [T("T3")] }, now).catch(() => null);
    const { reservationId: a } = await createReservation(host, { name: "Rao", partySize: 2, startAt: at, tableIds: [T("T11")] }, now);
    await failsWith(createReservation(host, { name: "Das", partySize: 2, startAt: at + 30 * MIN, tableIds: [T("T11")] }, now), "conflict", "booking");
    const { reservationId: b } = await createReservation(host, { name: "Das", partySize: 2, startAt: at + 30 * MIN, tableIds: [T("T12")] }, now);
    await failsWith(reassignReservation(host, { reservationId: b, tableIds: [T("T11")] }, now), "conflict", "booking");
    await reassignReservation(host, { reservationId: a, tableIds: [T("T11"), T("T12")] }, now).catch((e: AppError) => expect(e.code).toBe("conflict"));
  });

  it("marks a no-show only after the grace period, freeing the table", async () => {
    const now = new Date();
    const { reservationId } = await createReservation(host, { name: "Late", partySize: 2, startAt: now.getTime() + 5 * MIN, tableIds: [T("T2")] }, now);
    expect(await stateOf("T2")).toBe("reserved");
    const later = new Date(now.getTime() + 25 * MIN);
    const floor = await getFloor(host, later);
    expect(floor.arrivals.find((a) => a.id === reservationId)).toMatchObject({ lateMinutes: 20, canNoShow: true });
    await markNoShow(host, reservationId, later);
    expect(await stateOf("T2")).toBe("available");
  });

  it("extends in 15-minute steps and refuses to run into a booking, naming it", async () => {
    const now = new Date();
    const { sessionId } = await seatWalkIn(host, { tableId: T("T8"), partySize: 4 }, now);
    const [before] = await env.db.select().from(s.tableSessions).where(eq(s.tableSessions.id, sessionId));
    const res = await extendTime(host, { tableId: T("T8") }, now);
    expect(res.expectedEndAt - before.expectedEndAt!.getTime()).toBe(15 * MIN);
    await createReservation(host, { name: "Menon", partySize: 6, startAt: res.expectedEndAt + 20 * MIN, tableIds: [T("T8")] }, now);
    const err = await failsWith(extendTime(host, { tableId: T("T8") }, now), "conflict", "booking");
    expect(err.message).toContain("Menon");
    await failsWith(extendTime(host, { tableId: T("T8"), minutes: 10 }, now), "invalid_state");
  });
});

describe("held vs reserved, and multi-table bookings", () => {
  it("a held online booking cannot be checked in or seated until it is confirmed", async () => {
    const now = new Date();
    const [r] = await env.db
      .insert(s.reservations)
      .values({ tenantId: host.tenantId, outletId: host.outletId, name: "Online", partySize: 2, startAt: new Date(now.getTime() + 60 * MIN), expectedEndAt: new Date(now.getTime() + 135 * MIN), status: "requested", source: "online", holdExpiresAt: new Date(now.getTime() + 8 * MIN), createdAt: now })
      .$returningId();
    await env.db.insert(s.reservationTables).values({ tenantId: host.tenantId, reservationId: r.id, tableId: T("B4") });
    await reconcileFloor({ tenantId: host.tenantId, outletId: host.outletId }, now);
    expect(await stateOf("B4")).toBe("held");
    const tile = (await getFloor(host, now)).tables.find((t) => t.code === "B4")!;
    expect(tile.booking).toMatchObject({ held: true, holdUntil: now.getTime() + 8 * MIN });
    await failsWith(checkInReservation(host, r.id, now), "conflict", "held");
    await failsWith(seatReservation(host, { reservationId: r.id }, now), "conflict", "held");
    await confirmReservation(host, r.id, now);
    await checkInReservation(host, r.id, now);
  });

  it("seats a booking on all of its combined tables, never on one part", async () => {
    const now = new Date();
    const { reservationId } = await createReservation(host, { name: "Das", partySize: 6, startAt: now.getTime() + 10 * MIN, tableIds: [T("T11"), T("T12")] }, now).catch(async () => {
      // T11/T12 may hold an earlier booking from this file; use the other pair
      return createReservation(host, { name: "Das", partySize: 6, startAt: now.getTime() + 10 * MIN, tableIds: [T("T5"), T("T6")] }, now);
    });
    const tables = (await env.db.select().from(s.reservationTables).where(eq(s.reservationTables.reservationId, reservationId))).map((t) => t.tableId);
    await failsWith(seatReservation(host, { reservationId, tableIds: [tables[0]] }, now), "conflict", "partial_tables");
    const { sessionId } = await seatReservation(host, { reservationId }, now);
    const live = await env.db.select().from(s.sessionTables).where(and(eq(s.sessionTables.sessionId, sessionId), isNotNull(s.sessionTables.activeKey)));
    expect(live.map((l) => l.tableId).sort()).toEqual([...tables].sort());
  });

  it("lets a host pause and resume online bookings, but not open extra covers", async () => {
    const now = new Date();
    await setOnlineBookingsPaused(host, { paused: true }, now);
    expect((await getFloor(host, now)).pacing.paused).toBe(true);
    await setOnlineBookingsPaused(host, { paused: false }, now);
    expect((await getFloor(host, now)).pacing.paused).toBe(false);
    await failsWith(setSlotCapacity(host, { slotStartAt: Date.parse("2026-10-02T14:30:00Z"), extraCovers: 10 }), "forbidden");
  });
});

describe("waitlist", () => {
  it("keeps queue order, reorders, notifies, skips and seats once even when two hosts race", async () => {
    const a = await addToWaitlist(host, { name: "Gupta", partySize: 2, quotedMinutes: 15 });
    const b = await addToWaitlist(host, { name: "Bose", partySize: 4, quotedMinutes: 25 });
    const c = await addToWaitlist(host, { name: "Khan", partySize: 2 });
    const order = async () => (await getFloor(host)).waitlist.map((w) => w.name);
    expect(await order()).toEqual(["Gupta", "Bose", "Khan"]);
    await reorderWaitlist(host, { entryId: c.entryId, toIndex: 0 });
    expect(await order()).toEqual(["Khan", "Gupta", "Bose"]);
    await notifyWaitlist(host, a.entryId);
    expect((await getFloor(host)).waitlist.find((w) => w.name === "Gupta")?.status).toBe("notified");
    await skipWaitlist(host, b.entryId);
    expect(await order()).toEqual(["Khan", "Gupta"]);
    await failsWith(seatWaitlist(host, { entryId: b.entryId, tableIds: [T("B1")] }), "conflict");
    const results = await Promise.allSettled([seatWaitlist(host, { entryId: c.entryId, tableIds: [T("T1")] }), seatWaitlist(manager, { entryId: c.entryId, tableIds: [T("T7")] })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await order()).toEqual(["Gupta"]);
    expect(events.some((e) => e.type === "waitlist.updated")).toBe(true);
  });
});

describe("pacing and online booking", () => {
  it("counts covers per 30-minute slot, honours pause and extra capacity", async () => {
    const now = new Date();
    const scope = { tenantId: host.tenantId, outletId: host.outletId };
    const date = serviceDate(now, "Asia/Kolkata");
    const floor = await getFloor(host, now);
    expect(floor.pacing.slots.length).toBeGreaterThan(10);
    expect(floor.pacing.slots.every((sl) => sl.capacity === 40)).toBe(true);
    const booked = floor.pacing.slots.find((sl) => sl.covers > 0)!;
    expect(booked).toBeDefined();
    await failsWith(setSlotCapacity(host, { slotStartAt: booked.startAt, extraCovers: 10 }), "forbidden");
    await setSlotCapacity(manager, { slotStartAt: booked.startAt, extraCovers: 10, reason: "Big party" });
    expect((await getFloor(host, now)).pacing.slots.find((sl) => sl.startAt === booked.startAt)?.capacity).toBe(50);
    const open = await getOnlineAvailability(scope, { date, partySize: 2 }, now);
    expect(open.paused).toBe(false);
    await setOnlineBookingsPaused(host, { paused: true, reason: "Kitchen short" }, now);
    expect(await getOnlineAvailability(scope, { date, partySize: 2 }, now)).toEqual({ paused: true, slots: [] });
    expect((await getFloor(host, now)).pacing.paused).toBe(true);
    await setOnlineBookingsPaused(host, { paused: false }, now);
    expect(await auditCount("booking.pause")).toBe(2);
  });
});

describe("realtime and isolation", () => {
  it("hints the floor for state changes, bookings, waitlist and visit changes", () => {
    const types = new Set(events.filter((e) => e.topic === "floor").map((e) => e.type));
    for (const t of ["table.state_changed", "reservation.created", "reservation.updated", "waitlist.updated", "floor.session_updated", "pacing.updated"]) expect(types).toContain(t);
  });

  it("never shows or touches another restaurant's floor", async () => {
    const floor = await getFloor(host);
    expect(floor.tables.some((t) => t.id === env.other.tableId)).toBe(false);
    await failsWith(seatWalkIn(host, { tableId: env.other.tableId, partySize: 1 }), "not_found");
    await failsWith(markReady(host, env.other.tableId), "not_found");
    expect((await getTableDetail(host, env.other.tableId)).visit).toBeNull();
  });

  it("still settles a combined or moved party for G9: paid page finds the visit from any of its QRs", async () => {
    const visit = (await getTableDetail(host, T("T5"))).visit!;
    await settleAtCounter({ tenantId: host.tenantId, outletId: host.outletId, userId: host.userId }, { sessionId: visit.sessionId, method: "cash" });
    expect(await stateOf("T5")).toBe("needs_cleaning");
    const after = await getAfterVisit("SRJ01", QR("T9"), "mv-b");
    expect(after && !after.expired && after.state).toBe("closed");
  });
});
