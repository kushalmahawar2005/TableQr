import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { addCartLine } from "@/server/guest/cart";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { placeOrder } from "@/server/guest/order";
import {
  completeServiceRequest,
  createServiceRequest,
  escalateServiceRequests,
  getServiceRequests,
} from "@/server/guest/service-requests";
import { startOrJoinTable } from "@/server/guest/session";
import { cancelOrderLine, getOrderTracker } from "@/server/guest/tracker";
import { getTrackerScreen } from "@/server/guest/tracker-screen";
import { acceptOrder, bumpLine, markServed, startTicket } from "@/server/kitchen/actions";
import { onPublish, type RealtimeEvent } from "@/server/realtime/publish";
import type { StaffContext } from "@/server/staff/context";
import { resetTestDb } from "./setup-db";

let env: Awaited<ReturnType<typeof resetTestDb>>;
let host: GuestContext;
let friend: GuestContext;
let waiter: StaffContext;
let events: RealtimeEvent[] = [];
let batches: RealtimeEvent[][] = [];
let stop: () => void;
const T0 = new Date();
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

async function failsWith(p: Promise<unknown>, code: AppError["code"]) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  return err as AppError;
}

async function join(deviceId: string, displayName: string, qr = "k7Qm", outlet = "SRJ01") {
  const { participantId } = await startOrJoinTable({ outletCode: outlet, shortCode: qr, deviceId, displayName });
  return getGuestContext(outlet, qr, participantId, deviceId);
}

async function order(ctx: GuestContext, name = "Cola", qty = 1, now = T0) {
  await addCartLine(ctx, {
    itemId: env.demo.itemIds[name], qty,
    ...(name === "Butter Chicken" ? { modifierIds: [env.demo.modifierIds.noBread] } : {}),
  }, now);
  const placed = await placeOrder(ctx, {}, now);
  const lines = await env.db.select().from(s.orderLines).where(eq(s.orderLines.orderId, placed.orderId));
  return { ...placed, lines };
}

async function requestRow(id: string) {
  const [row] = await env.db.select().from(s.serviceRequests).where(eq(s.serviceRequests.id, id));
  return row;
}

async function portions() {
  const [row] = await env.db.select().from(s.outletItemOverrides).where(and(
    eq(s.outletItemOverrides.outletId, host.outletId),
    eq(s.outletItemOverrides.itemId, env.demo.itemIds["Butter Chicken"]),
  ));
  return row.portionsLeft;
}

beforeAll(() => {
  stop = onPublish((_scope, sent) => { events.push(...sent); batches.push(sent); });
});
beforeEach(async () => {
  if (env) await env.conn.end();
  env = await resetTestDb();
  host = await join("g6-host", "Aarav");
  friend = await join("g6-friend", "Nisha");
  const [user] = await env.db.select().from(s.users).where(eq(s.users.phone, "9000000005"));
  waiter = { tenantId: host.tenantId, outletId: host.outletId, userId: user.id };
  events = [];
  batches = [];
});
afterAll(async () => {
  stop();
  if (env) await env.conn.end();
  await appDb.$client.end();
});

describe("G6 service requests", () => {
  it("starts empty and shares one request and cooldown across simultaneous phones", async () => {
    expect((await getServiceRequests(host)).every((r) => r.requestId === null)).toBe(true);
    const [a, b] = await Promise.all([
      createServiceRequest(host, "water", "water-host-1", T0),
      createServiceRequest(friend, "water", "water-friend-1", T0),
    ]);
    expect(a.id).toBe(b.id);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(a.cooldownUntil).toBe(at(2).getTime());
    expect(await env.db.select().from(s.serviceRequests)).toHaveLength(1);
    expect(await getServiceRequests(friend)).toEqual(await getServiceRequests(host));
    expect(events.filter((e) => e.topic === "tasks" && e.type === "service_request.created")).toHaveLength(1);
  });

  it("keeps different request kinds independent", async () => {
    await createServiceRequest(host, "water", "water-request-1", T0);
    await createServiceRequest(friend, "cutlery", "cutlery-request-1", T0);
    expect(await env.db.select().from(s.serviceRequests)).toHaveLength(2);
  });

  it("replays the same attempt after completion, rejects reuse for another kind", async () => {
    const original = await createServiceRequest(host, "water", "replay-request-1", T0);
    await completeServiceRequest(waiter, original.id, at(1));
    const retry = await createServiceRequest(host, "water", "replay-request-1", at(8));
    expect(retry).toMatchObject({ id: original.id, replayed: true, createdAt: T0.getTime() });
    await failsWith(createServiceRequest(host, "cutlery", "replay-request-1", at(8)), "invalid_state");
    expect(await env.db.select().from(s.serviceRequests)).toHaveLength(1);
  });

  it("does not duplicate a pending task or restart its escalation clock after two minutes", async () => {
    const original = await createServiceRequest(host, "call_waiter", "waiter-request-1", T0);
    const retry = await createServiceRequest(friend, "call_waiter", "waiter-request-2", at(3));
    expect(retry).toMatchObject({ id: original.id, createdAt: T0.getTime(), replayed: true });
    expect(await env.db.select().from(s.serviceRequests)).toHaveLength(1);
    expect(await escalateServiceRequests(host, at(5))).toBe(1);
  });

  it("enforces the cooldown even when a waiter completes early; permits a new task at two minutes", async () => {
    const original = await createServiceRequest(host, "water", "cooldown-request-1", T0);
    await completeServiceRequest(waiter, original.id, at(0.5));
    expect((await createServiceRequest(friend, "water", "cooldown-request-2", at(1.99))).id).toBe(original.id);
    const next = await createServiceRequest(friend, "water", "cooldown-request-3", at(2));
    expect(next.id).not.toBe(original.id);
    expect(next.replayed).toBe(false);
  });

  it("allows only the host to request a bill, and publishes the committed task and bill transition", async () => {
    await order(host);
    events = [];
    const err = await failsWith(createServiceRequest(friend, "request_bill", "bill-friend-1", T0), "invalid_state");
    expect(err.details).toMatchObject({ reason: "host_only" });
    expect(await env.db.select().from(s.bills)).toHaveLength(0);
    expect(await env.db.select().from(s.serviceRequests)).toHaveLength(0);
    expect(events).toHaveLength(0);
    const requested = await createServiceRequest(host, "request_bill", "bill-host-1", T0);
    const [session] = await env.db.select().from(s.tableSessions).where(eq(s.tableSessions.id, host.sessionId));
    const [table] = await env.db.select().from(s.diningTables).where(eq(s.diningTables.id, host.tableId));
    expect(session.status).toBe("bill_requested");
    expect(table.state).toBe("bill_requested");
    expect((await requestRow(requested.id)).kind).toBe("request_bill");
    expect(await env.db.select().from(s.bills)).toHaveLength(1);
    expect(events.map((e) => e.type)).toEqual([
      "service_request.created", "service_request.created", "bill.updated", "table.state_changed",
    ]);
    await failsWith(order(friend), "table_settling");
    const screen = await getTrackerScreen("SRJ01", "k7Qm", "g6-friend", T0);
    expect(screen.session).toMatchObject({ status: "bill_requested", isHost: false, hostName: "Aarav" });
    expect(screen.rounds).toHaveLength(1);
  });

  it("rolls back the bill transition if inserting its waiter task fails", async () => {
    // A malformed trusted context simulates a referential-integrity failure after bill updates.
    await expect(createServiceRequest({ ...host, tableId: env.other.tableId }, "request_bill", "bill-rollback-1", T0)).rejects.toThrow();
    const [session] = await env.db.select().from(s.tableSessions).where(eq(s.tableSessions.id, host.sessionId));
    const [table] = await env.db.select().from(s.diningTables).where(eq(s.diningTables.id, host.tableId));
    expect(session.status).toBe("open");
    expect(table.state).toBe("seated");
    expect(await env.db.select().from(s.bills)).toHaveLength(0);
    expect(await env.db.select().from(s.serviceRequests)).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("requires an active staff member with an allowed role and the correct outlet", async () => {
    const request = await createServiceRequest(host, "clean_table", "clean-request-1", T0);
    const [kitchenUser] = await env.db.select().from(s.users).where(eq(s.users.phone, "9000000006"));
    await failsWith(completeServiceRequest({ ...waiter, userId: null }, request.id), "invalid_state");
    await failsWith(completeServiceRequest({ ...waiter, userId: kitchenUser.id }, request.id), "invalid_state");
    await failsWith(completeServiceRequest({ ...waiter, outletId: env.other.outletId }, request.id), "invalid_state");
    await env.db.update(s.users).set({ isActive: false }).where(eq(s.users.id, waiter.userId!));
    await failsWith(completeServiceRequest(waiter, request.id), "invalid_state");
    expect((await requestRow(request.id)).status).toBe("open");
    await env.db.update(s.users).set({ isActive: true }).where(eq(s.users.id, waiter.userId!));
    events = [];
    await completeServiceRequest(waiter, request.id, at(1));
    await completeServiceRequest(waiter, request.id, at(2));
    const row = await requestRow(request.id);
    expect(row).toMatchObject({ status: "done", doneByUserId: waiter.userId });
    expect(row.doneAt?.getTime()).toBe(at(1).getTime());
    expect(events.filter((e) => e.topic === "tasks" && e.type === "service_request.done")).toHaveLength(1);
  });

  it("escalates once at five minutes, excludes finished requests and other tenants", async () => {
    const water = await createServiceRequest(host, "water", "late-water-1", T0);
    const clean = await createServiceRequest(host, "clean_table", "late-clean-1", T0);
    await completeServiceRequest(waiter, clean.id, at(1));
    expect(await escalateServiceRequests(host, new Date(at(5).getTime() - 1))).toBe(0);
    expect(await escalateServiceRequests(env.other, at(10))).toBe(0);
    events = [];
    const runs = await Promise.all([escalateServiceRequests(host, at(5)), escalateServiceRequests(host, at(5))]);
    expect(runs.sort()).toEqual([0, 1]);
    expect(await escalateServiceRequests(host, at(10))).toBe(0);
    expect((await requestRow(water.id)).escalatedAt?.getTime()).toBe(at(5).getTime());
    expect((await requestRow(clean.id)).escalatedAt).toBeNull();
    expect(events.filter((e) => e.topic === "tasks" && e.type === "service_request.escalated")).toHaveLength(1);
  });

  it("does not escalate closed visits or accept requests from departed guests", async () => {
    await createServiceRequest(host, "water", "closed-water-1", T0);
    await env.db.update(s.participants).set({ removedAt: at(1) }).where(eq(s.participants.id, friend.participantId));
    await failsWith(createServiceRequest(friend, "cutlery", "removed-guest-1", at(2)), "session_expired");
    await env.db.update(s.tableSessions).set({ status: "closed" }).where(eq(s.tableSessions.id, host.sessionId));
    expect(await escalateServiceRequests(host, at(10))).toBe(0);
    await failsWith(createServiceRequest(host, "cutlery", "closed-guest-1", at(2)), "session_expired");
  });

  it("does not let old closed visits starve the active table's escalation", async () => {
    const closed = await join("g6-old-table", "Kiran", env.demo.tableQr.T1);
    await env.db.insert(s.serviceRequests).values(Array.from({ length: 101 }, () => ({
      tenantId: closed.tenantId, outletId: closed.outletId, sessionId: closed.sessionId,
      tableId: closed.tableId, participantId: closed.participantId, kind: "water" as const, createdAt: at(-10),
    })));
    await env.db.update(s.tableSessions).set({ status: "closed" }).where(eq(s.tableSessions.id, closed.sessionId));
    const pending = await createServiceRequest(host, "water", "active-escalation-1", T0);
    expect(await escalateServiceRequests(host, at(5))).toBe(1);
    expect((await requestRow(pending.id)).escalatedAt).not.toBeNull();
  });

  it("processes an escalation backlog in bounded batches the realtime service can accept", async () => {
    await env.db.insert(s.serviceRequests).values(Array.from({ length: 101 }, () => ({
      tenantId: host.tenantId, outletId: host.outletId, sessionId: host.sessionId,
      tableId: host.tableId, participantId: host.participantId, kind: "water" as const, createdAt: T0,
    })));
    batches = [];
    expect(await escalateServiceRequests(host, at(5))).toBe(100);
    expect(await escalateServiceRequests(host, at(5))).toBe(1);
    expect(await escalateServiceRequests(host, at(5))).toBe(0);
    expect(batches.every((batch) => batch.length <= 100)).toBe(true);
    expect(batches.flat().filter((e) => e.topic === "tasks" && e.type === "service_request.escalated")).toHaveLength(101);
  });

  it("isolates table sessions and rejects forged tenant/session combinations", async () => {
    const request = await createServiceRequest(host, "water", "isolated-water-1", T0);
    const another = await join("g6-other-table", "Kiran", env.demo.tableQr.T1);
    expect((await getServiceRequests(another)).every((r) => r.requestId === null)).toBe(true);
    expect((await createServiceRequest(another, "water", "isolated-water-1", T0)).id).not.toBe(request.id);
    await failsWith(createServiceRequest({ ...host, sessionId: another.sessionId }, "cutlery", "wrong-session-1", T0), "session_expired");
    await failsWith(createServiceRequest({ ...host, tenantId: env.other.tenantId }, "cutlery", "wrong-tenant-1", T0), "not_found");
    await failsWith(completeServiceRequest({ ...waiter, tenantId: env.other.tenantId }, request.id), "invalid_state");
  });
});

describe("G6 order tracker and cancellation", () => {
  it("shows newest rounds first, keeps ownership and counts quantities in progress", async () => {
    const first = await order(host, "Cola", 3);
    const second = await order(friend, "Masala Lassi", 2, at(1));
    const tracker = await getOrderTracker(host, at(1));
    expect(tracker.inProgress).toBe(5);
    expect(tracker.rounds.map((r) => r.orderId)).toEqual([second.orderId, first.orderId]);
    expect(tracker.rounds[0].lines[0]).toMatchObject({ qty: 2, isMine: false, canCancel: false });
    expect(tracker.rounds[1].lines[0]).toMatchObject({ qty: 3, isMine: true, canCancel: true });
    const screen = await getTrackerScreen("SRJ01", "k7Qm", "g6-host", at(1));
    expect(screen.rounds[0].placedAt).toBe(at(1).getTime());
    expect(screen.session).toMatchObject({ isHost: true, people: 2 });
    await failsWith(getTrackerScreen("SRJ01", "k7Qm", "unknown-device"), "session_expired");
  });

  it("preserves prep targets at placement and measures only outstanding dishes", async () => {
    await addCartLine(host, { itemId: env.demo.itemIds.Cola, qty: 1 }, T0);
    const placed = await order(host, "Butter Chicken");
    const cola = placed.lines.find((l) => l.nameEn === "Cola")!;
    const chicken = placed.lines.find((l) => l.nameEn === "Butter Chicken")!;
    expect(cola.prepMinutes).toBe(1);
    expect(chicken.prepMinutes).toBe(18);
    await env.db.update(s.menuItems).set({ prepMinutes: 60 }).where(eq(s.menuItems.id, cola.itemId));
    expect((await getOrderTracker(host, at(1.49))).rounds[0].isLate).toBe(false);
    expect((await getOrderTracker(host, at(1.5))).rounds[0]).toMatchObject({ isLate: true, lateAt: at(1.5).getTime() });
    await bumpLine(waiter, cola.id, at(2));
    expect((await getOrderTracker(host, at(2))).rounds[0]).toMatchObject({ isLate: false, lateAt: at(27).getTime() });
    await markServed(waiter, [cola.id], at(3));
    expect((await getOrderTracker(host, at(27))).rounds[0].isLate).toBe(true);
    await bumpLine(waiter, chicken.id, at(28));
    expect((await getOrderTracker(host, at(60))).rounds[0]).toMatchObject({ isLate: false, lateAt: null });
  });

  it("keeps terminal line states visible and removes their quantities from the active count", async () => {
    const placed = await order(host, "Cola", 3);
    await cancelOrderLine(host, placed.lines[0].id, at(1));
    const served = await order(host, "Masala Lassi", 2, at(2));
    await bumpLine(waiter, served.lines[0].id, at(3));
    await markServed(waiter, [served.lines[0].id], at(4));
    const voided = await order(friend, "Dal Makhani", 1, at(5));
    await env.db.update(s.orderLines).set({ status: "voided", voidReason: "Guest changed their mind" }).where(eq(s.orderLines.id, voided.lines[0].id));
    const tracker = await getOrderTracker(host, at(30));
    expect(tracker.inProgress).toBe(0);
    expect(tracker.rounds.flatMap((r) => r.lines.map((l) => l.status))).toEqual(["voided", "served", "cancelled"]);
    expect(tracker.rounds[1]).toMatchObject({ status: "served", step: 3 });
    expect(tracker.rounds.every((r) => !r.isLate && r.lines.every((l) => !l.canCancel))).toBe(true);
  });

  it("restores finite portions exactly once under duplicate cancellation and announces availability", async () => {
    const placed = await order(host, "Butter Chicken", 2);
    expect(await portions()).toBe(10);
    events = [];
    const results = await Promise.all([
      cancelOrderLine(host, placed.lines[0].id, at(1)),
      cancelOrderLine(host, placed.lines[0].id, at(1)),
    ]);
    expect(results).toEqual(["cancelled", "cancelled"]);
    expect(await portions()).toBe(12);
    expect(events.filter((e) => e.topic === "menu" && e.type === "item.availability")).toEqual([
      { topic: "menu", type: "item.availability", data: { itemId: env.demo.itemIds["Butter Chicken"] } },
    ]);
    expect(events.filter((e) => e.type === "order.status")).toHaveLength(1);
    const [ticket] = await env.db.select().from(s.tickets).where(eq(s.tickets.orderId, placed.orderId));
    expect(ticket.status).toBe("done");
  });

  it("rejects cancelling someone else's line, another visit, and another tenant", async () => {
    const placed = await order(host, "Butter Chicken");
    const another = await join("g6-other-table", "Kiran", env.demo.tableQr.T1);
    await failsWith(cancelOrderLine(friend, placed.lines[0].id), "not_found");
    await failsWith(cancelOrderLine(another, placed.lines[0].id), "not_found");
    await failsWith(cancelOrderLine({ ...host, tenantId: env.other.tenantId }, placed.lines[0].id), "not_found");
    expect((await getOrderTracker(another)).rounds).toHaveLength(0);
    expect((await getOrderTracker({ ...host, tenantId: env.other.tenantId })).rounds).toHaveLength(0);
    expect(await portions()).toBe(11);
  });

  it("serializes cancellation against kitchen acceptance without restoring an accepted dish", async () => {
    const placed = await order(host, "Butter Chicken", 2);
    const [cancel, accept] = await Promise.allSettled([
      cancelOrderLine(host, placed.lines[0].id, at(1)),
      acceptOrder(waiter, placed.orderId, at(1)),
    ]);
    expect(accept.status).toBe("fulfilled");
    const [line] = await env.db.select().from(s.orderLines).where(eq(s.orderLines.id, placed.lines[0].id));
    if (line.status === "accepted") {
      expect(cancel.status).toBe("rejected");
      if (cancel.status === "rejected") expect(cancel.reason).toMatchObject({ code: "invalid_state" });
      expect(await portions()).toBe(10);
    } else {
      expect(line.status).toBe("cancelled");
      expect(cancel.status).toBe("fulfilled");
      expect(await portions()).toBe(12);
    }
  });

  it("cannot cancel after removal or paying out, including with a previously valid context", async () => {
    const placed = await order(friend, "Butter Chicken", 2);
    await env.db.update(s.participants).set({ paidOutAt: at(1) }).where(eq(s.participants.id, friend.participantId));
    await failsWith(cancelOrderLine(friend, placed.lines[0].id, at(2)), "session_expired");
    await failsWith(createServiceRequest(friend, "water", "paidout-request-1", at(2)), "session_expired");
    await env.db.update(s.participants).set({ paidOutAt: null, removedAt: at(1) }).where(eq(s.participants.id, friend.participantId));
    await failsWith(cancelOrderLine(friend, placed.lines[0].id, at(2)), "session_expired");
    expect(await portions()).toBe(10);
    expect((await getOrderTracker(host)).rounds[0].lines[0].status).toBe("placed");
  });

  it("serializes a kitchen bump against cancellation so cancelled food cannot become ready", async () => {
    const placed = await order(host, "Butter Chicken", 2);
    const [cancel, bump] = await Promise.allSettled([
      cancelOrderLine(host, placed.lines[0].id, at(1)),
      bumpLine(waiter, placed.lines[0].id, at(1)),
    ]);
    const [line] = await env.db.select().from(s.orderLines).where(eq(s.orderLines.id, placed.lines[0].id));
    const winner = line.status === "cancelled" ? cancel : bump;
    const loser = line.status === "cancelled" ? bump : cancel;
    expect(["cancelled", "ready"]).toContain(line.status);
    expect(winner.status).toBe("fulfilled");
    expect(loser.status).toBe("rejected");
    if (loser.status === "rejected") expect(loser.reason).toMatchObject({ code: "invalid_state" });
    expect(await portions()).toBe(line.status === "cancelled" ? 12 : 10);
  });

  it("shows each kitchen progress step and rejects cancellation after acceptance", async () => {
    const placed = await order(host);
    expect((await getOrderTracker(host)).rounds[0].step).toBe(0);
    await acceptOrder(waiter, placed.orderId, at(1));
    expect((await getOrderTracker(host)).rounds[0].step).toBe(1);
    await failsWith(cancelOrderLine(host, placed.lines[0].id, at(1)), "invalid_state");
    const [ticket] = await env.db.select().from(s.tickets).where(eq(s.tickets.orderId, placed.orderId));
    await startTicket(waiter, ticket.id, at(2));
    expect((await getOrderTracker(host)).rounds[0].step).toBe(2);
    await bumpLine(waiter, placed.lines[0].id, at(3));
    expect((await getOrderTracker(host)).rounds[0]).toMatchObject({ step: 3, status: "ready" });
    expect((await getOrderTracker(host)).inProgress).toBe(1);
    await markServed(waiter, [placed.lines[0].id], at(4));
    expect((await getOrderTracker(host)).inProgress).toBe(0);
  });

  it("publishes the actual accepted state for an outlet that auto-accepts orders", async () => {
    await env.db.update(s.outlets).set({ autoAcceptOrders: true }).where(eq(s.outlets.id, host.outletId));
    const placed = await order(host);
    expect(events.find((e) => e.type === "order.status")?.data).toMatchObject({ orderId: placed.orderId, status: "accepted" });
    expect((await getOrderTracker(host)).rounds[0].lines[0].canCancel).toBe(false);
  });
});
