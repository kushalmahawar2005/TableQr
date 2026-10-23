import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { uuidv7 } from "@/db/id";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { assignWaitersToTables, claimWaiterVisit, getWaiterTasks } from "@/server/staff/waiter";
import { addPhonelessDiner, staffPlaceOrder } from "@/server/staff/waiter-mutations";
import { setDuty } from "@/server/staff/duty";
import { startOrJoinTable } from "@/server/guest/session";
import { getGuestContext, type GuestContext } from "@/server/guest/context";
import { createServiceRequest, escalateServiceRequests } from "@/server/guest/service-requests";
import { moveParty } from "@/server/floor/table-actions";
import { getFloor } from "@/server/floor/read";
import { waiterBoard, waiterDetail } from "@/server/staff/waiter-read";
import { resetTestDb } from "./setup-db";

let env: Awaited<ReturnType<typeof resetTestDb>>;
let manager: StaffSession, first: StaffSession, second: StaffSession, guest: GuestContext;
const signIn = async (phone: string, pin: string) => (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone, pin })).token))!;
const table = (code: string) => env.demo.tableIds[code];
const visit = async () => (await env.db.select().from(s.tableSessions).where(eq(s.tableSessions.id, guest.sessionId)))[0];

beforeAll(async () => {
  env = await resetTestDb();
  manager = await signIn("9000000002", "2222");
  first = await signIn("9000000005", "5555");
  const id = uuidv7();
  await env.db.insert(s.users).values({ id, tenantId: first.tenantId, name: "Backup Waiter", phone: "9000000015", pinHash: "not-used-by-test" });
  await env.db.insert(s.staffRoles).values({ tenantId: first.tenantId, userId: id, outletId: first.outletId, role: "waiter" });
  second = { ...first, userId: id, name: "Backup Waiter" };
  const joined = await startOrJoinTable({ outletCode: "SRJ01", shortCode: env.demo.tableQr.T1, deviceId: "assignment-test-phone", displayName: "Kushal" });
  guest = await getGuestContext("SRJ01", env.demo.tableQr.T1, joined.participantId, "assignment-test-phone");
});
afterAll(async () => { if (env) await env.conn.end(); await appDb.$client.end(); });

describe("table responsibility and automatic coverage", () => {
  it("scopes assignment to authorized managers, the outlet and on-duty waiters", async () => {
    await expect(assignWaitersToTables(first, [table("T1")], first.userId, "shift")).rejects.toThrow();
    await expect(assignWaitersToTables(manager, [env.other.tableId], first.userId, "shift")).rejects.toThrow();
    await setDuty(manager, second.userId, "break");
    await expect(assignWaitersToTables(manager, [table("T1")], second.userId, "shift")).rejects.toThrow("on duty");
    await setDuty(manager, second.userId, "on");
  });
  it("assigns bulk tables atomically and routes tasks only to the owner and manager", async () => {
    await assignWaitersToTables(manager, [table("T1"), table("T3")], first.userId, "shift");
    await createServiceRequest(guest, "water", "assignment-water-1");
    expect((await getWaiterTasks(first)).requests.some(r => r.sessionId === guest.sessionId)).toBe(true);
    expect((await getWaiterTasks(second)).requests.some(r => r.sessionId === guest.sessionId)).toBe(false);
    expect((await getWaiterTasks(manager)).requests.some(r => r.sessionId === guest.sessionId)).toBe(true);
    expect((await getFloor(manager)).tables.find(t => t.id === table("T1"))?.assignedWaiter?.id).toBe(first.userId);

    const firstBoard = await waiterBoard(first);
    expect(firstBoard.tables.some(t => t.id === table("T1"))).toBe(true);
    expect((await waiterDetail(first, guest.sessionId)).people.map(p => p.name)).toContain("Kushal");

    await assignWaitersToTables(manager, [table("T1")], second.userId, "shift");
    expect((await visit()).waiterUserId).toBe(second.userId);
    expect((await getFloor(manager)).tables.find(t => t.id === table("T1"))?.assignedWaiter?.id).toBe(second.userId);
    expect((await waiterBoard(first)).tables.some(t => t.id === table("T1"))).toBe(false);
    expect((await waiterBoard(second)).tables.some(t => t.id === table("T1"))).toBe(true);
    expect((await getWaiterTasks(first)).requests.some(r => r.sessionId === guest.sessionId)).toBe(false);
    expect((await getWaiterTasks(second)).requests.some(r => r.sessionId === guest.sessionId)).toBe(true);
  });
  it("keeps the customer's waiter and uses the new table label after a move", async () => {
    await assignWaitersToTables(manager, [table("T1")], first.userId, "shift");
    await assignWaitersToTables(manager, [table("T2")], second.userId, "shift");
    await moveParty(manager, { fromTableId: table("T1"), toTableId: table("T2") });
    expect((await visit()).waiterUserId).toBe(first.userId);
    expect((await getWaiterTasks(first)).requests.find(r => r.sessionId === guest.sessionId)?.tableCode).toBe("T2");
  });
  it("hands an away waiter's current visit to available staff immediately", async () => {
    await setDuty(manager, first.userId, "break");
    expect((await visit()).waiterUserId).toBe(second.userId);
    expect((await getWaiterTasks(second)).requests.some(r => r.sessionId === guest.sessionId)).toBe(true);
    await setDuty(manager, first.userId, "on");
  });
  it("lets only one of two simultaneous phones claim shared coverage", async () => {
    await assignWaitersToTables(manager, [table("T2")], null, "shift");
    const results = await Promise.allSettled([claimWaiterVisit(first, guest.sessionId), claimWaiterVisit(second, guest.sessionId)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
  });
  it("routes an overdue request to a backup once, without moving the customer's table", async () => {
    await assignWaitersToTables(manager, [table("T2")], first.userId, "shift");
    await env.db.update(s.serviceRequests).set({ createdAt: new Date(Date.now() - 360_000) }).where(and(eq(s.serviceRequests.tenantId, first.tenantId), eq(s.serviceRequests.sessionId, guest.sessionId)));
    expect(await escalateServiceRequests(first)).toBe(1);
    expect((await visit()).waiterUserId).toBe(second.userId);
    expect((await visit()).tableId).toBe(table("T2"));
    expect(await escalateServiceRequests(first)).toBe(0);
  });
  it("balances bulk auto-assignments and rejects blank customer names on the server", async () => {
    await assignWaitersToTables(manager, [table("T4"), table("T7"), table("T8"), table("T9")], "__auto", "auto-shift");
    const assigned = await env.db.select().from(s.waiterTableAssignments).where(and(eq(s.waiterTableAssignments.tenantId, first.tenantId), eq(s.waiterTableAssignments.periodKey, "auto-shift"), eq(s.waiterTableAssignments.active, true)));
    expect(new Set(assigned.map(a => a.waiterUserId)).size).toBe(2);
    await expect(addPhonelessDiner(first, guest.sessionId, "   ")).rejects.toThrow("customer");
    const diner = await addPhonelessDiner(first, guest.sessionId, "Aarav");
    expect(diner.name).toBe("Aarav");
    await env.db.update(s.participants).set({ displayName: "Guest 99" }).where(eq(s.participants.id, diner.id));
    await expect(staffPlaceOrder(first, { sessionId: guest.sessionId, tableId: table("T2"), participantId: diner.id, clientRequestId: "unnamed-order-1", lines: [{ itemId: env.demo.itemIds.Cola, qty: 1, modifierIds: [], note: "" }] })).rejects.toThrow("customer");
  });
});
