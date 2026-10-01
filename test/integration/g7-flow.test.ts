import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { addCartLine, assertCartEditable } from "@/server/guest/cart";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { passHost, removeParticipant, setOrderingLocked } from "@/server/guest/host-controls";
import { tableInvite } from "@/server/guest/invite";
import { getMenuScreen } from "@/server/guest/menu-screen";
import { placeOrder } from "@/server/guest/order";
import { createServiceRequest, getServiceRequests } from "@/server/guest/service-requests";
import { startOrJoinTable } from "@/server/guest/session";
import { getTableLanding } from "@/server/guest/table";
import { getTableScreen } from "@/server/guest/table-screen";
import { cancelOrderLine } from "@/server/guest/tracker";
import { getTrackerScreen } from "@/server/guest/tracker-screen";
import { onPublish, type RealtimeEvent } from "@/server/realtime/publish";
import { resetTestDb } from "./setup-db";

// G7 Table & People: the screen's data, host controls, removal and the realtime hints.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let host: GuestContext;
let riya: GuestContext;
let karan: GuestContext;
let events: RealtimeEvent[] = [];
let stop: () => void;

const devices = { host: "g7-host", riya: "g7-riya", karan: "g7-karan" };

async function failsWith(p: Promise<unknown>, code: AppError["code"], reason?: string) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  if (reason) expect((err as AppError).details?.reason).toBe(reason);
  return err as AppError;
}

async function join(deviceId: string, displayName?: string) {
  const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: "k7Qm", deviceId, displayName });
  return getGuestContext("SRJ01", "k7Qm", participantId, deviceId);
}

const screen = (deviceId: string) => getTableScreen("SRJ01", "k7Qm", deviceId);
const item = (name: string) => env.demo.itemIds[name];

/** Places one dish; a guest without a name gives one at their first order (G1 decision N3) */
async function order(ctx: GuestContext, name: string, qty = 1) {
  await addCartLine(ctx, { itemId: item(name), qty });
  return placeOrder(ctx, { name: "Karan" });
}

async function session() {
  const [row] = await env.db.select().from(s.tableSessions).where(eq(s.tableSessions.id, host.sessionId));
  return row;
}

beforeAll(() => {
  stop = onPublish((_scope, sent) => events.push(...sent));
});
beforeEach(async () => {
  if (env) await env.conn.end();
  env = await resetTestDb();
  host = await join(devices.host, "Aarav");
  riya = await join(devices.riya, "Riya");
  karan = await join(devices.karan);
  events = [];
});
afterAll(async () => {
  stop();
  if (env) await env.conn.end();
  await appDb.$client.end();
});

describe("G7 table screen", () => {
  it("lists people with the host and You, and never a stand-in name", async () => {
    const data = await screen(devices.host);
    expect(data.people.map((p) => [p.name, p.isMe, p.isHost])).toEqual([
      ["Aarav", true, true],
      ["Riya", false, false],
      [null, false, false],
    ]);
    expect(JSON.stringify(data)).not.toMatch(/Guest \d/);
    expect(data.session).toMatchObject({ isHost: true, hostName: "Aarav", hostIsMe: true, people: 3, orderingLocked: false });

    const mine = await screen(devices.karan);
    expect(mine.people.find((p) => p.isMe)).toMatchObject({ name: null, isHost: false });
    expect(mine.session).toMatchObject({ isHost: false, hostName: "Aarav", hostIsMe: false });
  });

  it("sums ordered so far from placed snapshot prices, without cancelled or voided lines", async () => {
    await order(host, "Paneer Tikka", 2); // 320 x 2
    const second = await order(riya, "Masala Papad", 1); // 90
    const third = await order(riya, "Cola", 3); // 70 x 3
    // Today's price changes do not move what was already ordered
    await env.db.update(s.menuItems).set({ pricePaise: 99_900 }).where(eq(s.menuItems.id, item("Paneer Tikka")));
    const [papad] = await env.db.select().from(s.orderLines).where(eq(s.orderLines.orderId, second.orderId));
    await cancelOrderLine(riya, papad.id);
    const [cola] = await env.db.select().from(s.orderLines).where(eq(s.orderLines.orderId, third.orderId));
    await env.db.update(s.orderLines).set({ status: "voided", voidReason: "Spilled" }).where(eq(s.orderLines.id, cola.id));

    const { ordered, inProgress } = await screen(devices.karan);
    expect(ordered).toEqual({ totalPaise: 64_000, items: 2, rounds: 1, inKitchen: 2 });
    expect(inProgress).toBe(2);
  });

  it("shows the join code only in Host-confirmed mode, and the invite only carries the table address", async () => {
    expect((await screen(devices.host)).invite).toEqual({ mode: "open", joinCode: null });
    await env.db.update(s.tableSessions).set({ mode: "host_confirmed" }).where(eq(s.tableSessions.id, host.sessionId));
    expect((await screen(devices.riya)).invite).toEqual({ mode: "host_confirmed", joinCode: "4821" });

    const invite = tableInvite("https://tableqr.example", "SRJ01", "k7Qm");
    expect(invite.url).toBe("https://tableqr.example/r/SRJ01/t/k7Qm");
    for (const secret of [host.participantId, host.sessionId, riya.participantId, devices.host, "4821"]) {
      expect(invite.url).not.toContain(secret);
    }
    expect(invite.qrPath.length).toBeGreaterThan(100);
  });

  it("shows people who paid and left as paid, and leaves removed people out", async () => {
    await env.db.update(s.participants).set({ paidOutAt: new Date() }).where(eq(s.participants.id, riya.participantId));
    await removeParticipant(host, karan.participantId);
    const data = await screen(devices.host);
    expect(data.people.map((p) => [p.name, p.state])).toEqual([
      ["Aarav", "active"],
      ["Riya", "paid"],
    ]);
    expect(data.session.people).toBe(1);
  });
});

describe("G7 pause and resume ordering", () => {
  it("lets only the host pause and resume, and blocks every way of adding while paused", async () => {
    await failsWith(setOrderingLocked(riya, true), "invalid_state", "host_only");
    expect((await session()).orderingLocked).toBe(false);

    await addCartLine(riya, { itemId: item("Cola"), qty: 1 });
    expect(await setOrderingLocked(host, true)).toEqual({ orderingLocked: true, changed: true });
    expect(events).toContainEqual(expect.objectContaining({ topic: `session:${host.sessionId}`, type: "session.updated", data: { change: "ordering_paused" } }));
    // G3, G4, G5 and G6 all read the same flag
    await failsWith(placeOrder(riya, {}), "ordering_locked");
    await failsWith(assertCartEditable(riya), "ordering_locked");
    expect((await getMenuScreen("SRJ01", "k7Qm", devices.riya)).session.orderingLocked).toBe(true);
    expect((await getTrackerScreen("SRJ01", "k7Qm", devices.riya)).session.orderingLocked).toBe(true);
    expect((await screen(devices.riya)).session.orderingLocked).toBe(true);

    // Repeating is harmless and announces nothing
    events = [];
    expect(await setOrderingLocked(host, true)).toEqual({ orderingLocked: true, changed: false });
    expect(events).toHaveLength(0);

    await failsWith(setOrderingLocked(riya, false), "invalid_state", "host_only");
    expect(await setOrderingLocked(host, false)).toMatchObject({ orderingLocked: false, changed: true });
    expect((await placeOrder(riya, {})).roundNo).toBe(1);
  });
});

describe("G7 remove someone", () => {
  it("lets only the host remove, never themselves", async () => {
    await failsWith(removeParticipant(riya, karan.participantId), "invalid_state", "host_only");
    await failsWith(removeParticipant(host, host.participantId), "invalid_state", "self");
    await failsWith(removeParticipant(host, "not-a-person"), "not_found");
    expect((await screen(devices.host)).people).toHaveLength(3);
  });

  it("drops their unplaced cart and shares, keeps placed orders, and stops them ordering", async () => {
    const placed = await order(karan, "Masala Papad", 1);
    await addCartLine(karan, { itemId: item("Cola"), qty: 2 });
    await addCartLine(riya, { itemId: item("Paneer Tikka"), qty: 1, sharedWith: [riya.participantId, karan.participantId] });
    await addCartLine(host, { itemId: item("Masala Lassi"), qty: 1, sharedWith: [host.participantId, riya.participantId, karan.participantId] });

    events = [];
    expect(await removeParticipant(host, karan.participantId)).toEqual({ changed: true });
    expect(events.map((e) => e.type)).toEqual(["participant.removed", "cart.updated"]);

    const cart = await env.db.select().from(s.cartLines).where(eq(s.cartLines.sessionId, host.sessionId));
    expect(cart.filter((l) => l.participantId === karan.participantId)).toHaveLength(0);
    expect(cart.find((l) => l.participantId === riya.participantId)?.sharedWith).toBeNull();
    expect(cart.find((l) => l.participantId === host.participantId)?.sharedWith).toEqual([host.participantId, riya.participantId]);
    const lines = await env.db.select().from(s.orderLines).where(eq(s.orderLines.orderId, placed.orderId));
    expect(lines.map((l) => [l.participantId, l.status])).toEqual([[karan.participantId, "placed"]]);

    // Any screen or action from that phone now finds no seat at the table
    await failsWith(getGuestContext("SRJ01", "k7Qm", karan.participantId, devices.karan), "session_expired");
    await failsWith(screen(devices.karan), "session_expired");
    await failsWith(placeOrder(karan, {}), "session_expired");
    await failsWith(createServiceRequest(karan, "water", "removed-water-1"), "session_expired");
    // Removing again changes nothing
    events = [];
    expect(await removeParticipant(host, karan.participantId)).toEqual({ changed: false });
    expect(events).toHaveLength(0);
  });

  it("keeps the same phone out for the rest of the session, while others can still join", async () => {
    await removeParticipant(host, karan.participantId);
    await failsWith(startOrJoinTable({ outletCode: "SRJ01", shortCode: "k7Qm", deviceId: devices.karan }), "participant_removed");
    const rows = await env.db.select().from(s.participants).where(eq(s.participants.sessionId, host.sessionId));
    expect(rows.filter((r) => r.deviceId === devices.karan)).toHaveLength(1);
    expect((await getTableLanding("SRJ01", "k7Qm", devices.karan)).landing).toEqual({ kind: "removed" });
    // A new phone is unaffected
    const newcomer = await join("g7-newcomer", "Meera");
    expect(newcomer.sessionId).toBe(host.sessionId);
    expect((await getTableLanding("SRJ01", "k7Qm", "g7-someone-else")).landing.kind).toBe("join");
  });

  it("cannot remove someone who has paid and left, or anyone once the bill is requested", async () => {
    await env.db.update(s.participants).set({ paidOutAt: new Date() }).where(eq(s.participants.id, riya.participantId));
    await failsWith(removeParticipant(host, riya.participantId), "invalid_state", "paid_out");
    await order(host, "Cola");
    await createServiceRequest(host, "request_bill", "g7-bill-1");
    await failsWith(removeParticipant(host, karan.participantId), "table_settling");
    await failsWith(passHost(host, karan.participantId), "table_settling");
    await failsWith(setOrderingLocked(host, true), "table_settling");
  });
});

describe("G7 pass host", () => {
  it("moves host to one active person; the old host loses controls and the new one gains them", async () => {
    await failsWith(passHost(riya, karan.participantId), "invalid_state", "host_only");
    await failsWith(passHost(host, host.participantId), "invalid_state", "self");
    await passHost(host, riya.participantId);
    expect((await session()).hostParticipantId).toBe(riya.participantId);
    expect(events).toContainEqual(expect.objectContaining({ type: "session.updated", data: { change: "host_changed" } }));

    await failsWith(setOrderingLocked(host, true), "invalid_state", "host_only");
    await failsWith(removeParticipant(host, karan.participantId), "invalid_state", "host_only");
    expect((await setOrderingLocked(riya, true)).changed).toBe(true);
    const views = await Promise.all([screen(devices.host), screen(devices.riya)]);
    expect(views.map((v) => v.session.isHost)).toEqual([false, true]);
    expect(views.map((v) => v.people.filter((p) => p.isHost).length)).toEqual([1, 1]);
    expect(views[0].session.hostName).toBe("Riya");
  });

  it("will not pass host to someone removed or paid and left", async () => {
    await removeParticipant(host, karan.participantId);
    await failsWith(passHost(host, karan.participantId), "invalid_state", "removed");
    await env.db.update(s.participants).set({ paidOutAt: new Date() }).where(eq(s.participants.id, riya.participantId));
    await failsWith(passHost(host, riya.participantId), "invalid_state", "paid_out");
    expect((await session()).hostParticipantId).toBe(host.participantId);
  });

  it("lets exactly one of two simultaneous transfers win", async () => {
    const results = await Promise.allSettled([passHost(host, riya.participantId), passHost(host, karan.participantId)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((lost.reason as AppError).details?.reason).toBe("host_only");
    const { hostParticipantId } = await session();
    expect([riya.participantId, karan.participantId]).toContain(hostParticipantId);
    expect((await screen(devices.host)).people.filter((p) => p.isHost)).toHaveLength(1);
  });

  it("does not let a host remove the person they are handing host to at the same time", async () => {
    const results = await Promise.allSettled([passHost(host, riya.participantId), removeParticipant(host, riya.participantId)]);
    const { hostParticipantId } = await session();
    const [riyaRow] = await env.db.select().from(s.participants).where(eq(s.participants.id, riya.participantId));
    // Either Riya is the host and still at the table, or she was removed and Aarav is still host
    if (hostParticipantId === riya.participantId) expect(riyaRow.removedAt).toBeNull();
    else expect(hostParticipantId).toBe(host.participantId);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("G7 realtime reconciliation", () => {
  it("announces each change on the table's topic and the screen reloads to the new truth", async () => {
    const topic = `session:${host.sessionId}`;
    const before = await screen(devices.riya);

    await join("g7-meera", "Meera");
    expect(events).toContainEqual(expect.objectContaining({ topic, type: "participant.joined" }));
    const joined = await screen(devices.riya);
    expect(joined.people.map((p) => p.name)).toEqual([...before.people.map((p) => p.name), "Meera"]);

    await passHost(host, riya.participantId);
    expect(events).toContainEqual(expect.objectContaining({ topic, type: "session.updated", data: { change: "host_changed" } }));
    expect((await screen(devices.riya)).session.isHost).toBe(true);

    await setOrderingLocked(riya, true);
    expect(events).toContainEqual(expect.objectContaining({ topic, type: "session.updated", data: { change: "ordering_paused" } }));
    expect((await screen(devices.host)).session.orderingLocked).toBe(true);
    // Every hint goes only to this table's topic: other tables hear nothing
    expect(events.every((e) => e.topic === topic || e.topic === "floor")).toBe(true);
  });
});

describe("G7 service requests reuse G6", () => {
  it("shows the same requests and cooldown as Orders, and Request bill pauses the table", async () => {
    const water = await createServiceRequest(riya, "water", "g7-water-1");
    const [g6, g7] = await Promise.all([getServiceRequests(riya), screen(devices.host)]);
    expect(g7.requests).toEqual(g6);
    expect(g7.requests.find((r) => r.kind === "water")).toMatchObject({ requestId: water.id, status: "open", cooldownUntil: water.cooldownUntil });

    await failsWith(createServiceRequest(riya, "request_bill", "g7-bill-guest"), "invalid_state", "host_only");
    await order(host, "Cola");
    await createServiceRequest(host, "request_bill", "g7-bill-host");
    const after = await screen(devices.riya);
    expect(after.session.status).toBe("bill_requested");
    await failsWith(assertCartEditable(riya), "table_settling");
    const [table] = await env.db.select({ state: s.diningTables.state }).from(s.diningTables).where(and(eq(s.diningTables.id, host.tableId)));
    expect(table.state).toBe("bill_requested");
  });
});
