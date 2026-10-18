import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { ROOM_CLASS } from "@/domain/rooms";
import { requestBill, settleAtCounter } from "@/server/billing/payments";
import { AppError } from "@/server/errors";
import { getOrCreateDraft } from "@/server/floor/editor";
import { addCartLine } from "@/server/guest/cart";
import { getGuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import { askFromRoom, getRoomPage } from "@/server/guest/room";
import { startOrJoinTable } from "@/server/guest/session";
import { checkIn, checkOut, finishRoomRequest, getRooms, roomFoodTab, saveRoom, setRoomStatus, stayHistory } from "@/server/staff/rooms";
import { resetTestDb } from "./setup-db";

// Hotel rooms: kept apart from the floor, checked in and out at the front desk, ordering food
// from the room QR through the same kitchen and bill, and housekeeping asks.

let env: Awaited<ReturnType<typeof resetTestDb>>;
const owner = () => ({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, roles: ["owner" as const], userId: env.demo.staffIds.owner, name: "Owner" });

async function refused(p: Promise<unknown>, code: AppError["code"]) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}

async function qrOf(roomId: string) {
  const [row] = await env.db
    .select({ shortCode: s.qrCodes.shortCode })
    .from(s.rooms)
    .innerJoin(s.qrCodes, and(eq(s.qrCodes.tenantId, s.rooms.tenantId), eq(s.qrCodes.tableId, s.rooms.tableId)))
    .where(eq(s.rooms.id, roomId));
  return row.shortCode;
}

beforeAll(async () => {
  env = await resetTestDb();
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("hotel rooms", () => {
  it("needs a plan with rooms", async () => {
    await refused(getRooms(owner()), "forbidden");
    await env.db.update(s.tenants).set({ planCode: "hotel_plus" }).where(eq(s.tenants.id, env.demo.tenantId));
    expect((await getRooms(owner())).rooms).toEqual([]);
  });

  it("a room stays off the floor, and its QR works only while a guest is checked in", async () => {
    const { id } = await saveRoom(owner(), { number: " 204 ", roomType: "Deluxe" });
    await refused(saveRoom(owner(), { number: "204" }), "invalid_state");
    const [table] = await env.db.select().from(s.diningTables).where(eq(s.diningTables.code, "Room 204"));
    expect(table).toMatchObject({ tableClass: ROOM_CLASS, isActive: false });
    // The floor editor never picks it up
    const draft = await getOrCreateDraft({ ...owner(), roles: ["owner"] } as never);
    expect(JSON.stringify(draft)).not.toContain("Room 204");

    const code = await qrOf(id);
    expect(await getRoomPage("SRJ01", code, null)).toMatchObject({ kind: "room", room: { number: "204" }, stay: null });
    await refused(startOrJoinTable({ outletCode: "SRJ01", shortCode: code, deviceId: "room-guest-1" }), "table_not_open");
    await refused(askFromRoom("SRJ01", code, "towels", null), "table_not_open");
  });

  it("check-in, food from the room QR, requests, payment and check-out", async () => {
    const room = (await getRooms(owner())).rooms[0];
    const code = await qrOf(room.id);
    await checkIn(owner(), room.id, { guestName: "Rahul Mehta", guestPhone: "98765 43210", guests: 2, foodPay: "at_checkout" });
    await refused(checkIn(owner(), room.id, { guestName: "Someone Else" }), "conflict");

    // The guest orders from the room: no table code or OTP, named from the check-in
    const seated = await startOrJoinTable({ outletCode: "SRJ01", shortCode: code, deviceId: "room-guest-1" });
    const ctx = await getGuestContext("SRJ01", code, seated.participantId, "room-guest-1");
    await addCartLine(ctx, { itemId: env.demo.itemIds.Cola, qty: 2 });
    await placeOrder(ctx);
    const [session] = await env.db.select().from(s.tableSessions).where(eq(s.tableSessions.id, ctx.sessionId));
    expect(session.guestName).toBe("Rahul Mehta");
    const page = await getRoomPage("SRJ01", code, "room-guest-1");
    expect(page).toMatchObject({ kind: "room", stay: { firstName: "Rahul", joined: true } });

    // Housekeeping: the same ask twice is sent once
    const first = await askFromRoom("SRJ01", code, "towels", null);
    expect((await askFromRoom("SRJ01", code, "towels", null)).repeated).toBe(true);
    let view = (await getRooms(owner())).rooms[0];
    expect(view.status).toBe("occupied");
    expect(view.requests.map((r) => r.kind)).toEqual(["towels"]);
    expect(view.stay!.food.unpaidPaise).toBeGreaterThan(0);
    await finishRoomRequest(owner(), first.id);

    // Staff adding food by phone land on the same open tab
    expect((await roomFoodTab(owner(), room.id)).sessionId).toBe(ctx.sessionId);

    // Unpaid food blocks check-out; once paid the room goes to Cleaning
    await refused(checkOut(owner(), room.id), "conflict");
    await requestBill({ tenantId: ctx.tenantId, outletId: ctx.outletId, sessionId: ctx.sessionId });
    const [bill] = await env.db.select().from(s.bills).where(eq(s.bills.sessionId, ctx.sessionId));
    await settleAtCounter({ tenantId: ctx.tenantId, outletId: ctx.outletId, userId: null }, { sessionId: ctx.sessionId, method: "cash", receivedPaise: bill.totalPaise });
    const [counter] = await env.db.select({ state: s.diningTables.state }).from(s.diningTables).where(eq(s.diningTables.code, "Room 204"));
    expect(counter.state).toBe("available");

    await checkOut(owner(), room.id);
    view = (await getRooms(owner())).rooms[0];
    expect(view).toMatchObject({ status: "cleaning", stay: null, requests: [] });
    expect((await stayHistory(owner()))[0]).toMatchObject({ number: "204", guestName: "Rahul Mehta", foodPaise: bill.totalPaise });
    await refused(startOrJoinTable({ outletCode: "SRJ01", shortCode: code, deviceId: "room-guest-2" }), "table_not_open");
    await setRoomStatus(owner(), room.id, "vacant");
  });

  it("reception may run rooms but not add them, and the plan's room limit holds", async () => {
    const reception = { ...owner(), roles: ["reception" as const] };
    await refused(saveRoom(reception, { number: "305" }), "forbidden");
    expect((await getRooms(reception)).canManage).toBe(false);
    await refused(getRooms({ ...owner(), roles: ["waiter" as const] }), "forbidden");

    await env.db.update(s.tenants).set({ customFeatures: { rooms: true, maxRooms: 1 }, planCode: "custom" }).where(eq(s.tenants.id, env.demo.tenantId));
    await refused(saveRoom(owner(), { number: "305" }), "invalid_state");
    await env.db.update(s.tenants).set({ customFeatures: null, planCode: "pro" }).where(eq(s.tenants.id, env.demo.tenantId));
  });
});
