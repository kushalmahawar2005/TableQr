import "server-only";
import { randomInt } from "node:crypto";
import { and, asc, eq, like, notInArray } from "drizzle-orm";
import { uuidv7 } from "@/db/id";
import { db } from "@/db";
import * as s from "@/db/schema";
import { LOCK_THEN_READ } from "../db-types";
import { AppError } from "../errors";
import { publish } from "../realtime/publish";
import { audit } from "../staff/audit";
import type { StaffSession } from "../staff/auth";
import { requireStaffRole } from "../staff/waiter";
import { openVisit, visitAt } from "./visits";
import { releaseVisitTables, visitChanged } from "./assignments";
import { TAKEAWAY_CLASS } from "./takeaway-class";
import { findStaffOpenRequest, staffOpenRequestFingerprint, validateStaffOpenRequestId } from "./staff-open-request";

// Takeaway (parcel) orders, for guests who order at the counter and do not sit down. Each one
// runs on a takeaway counter: a hidden table "TA-1", "TA-2" … that never shows on the floor, in
// bookings, QR codes or the table limit. Orders, the kitchen, the bill and payments work exactly
// as for a table. A counter is reused once its order is paid; more are made when all are busy.

export const takeawayRoles = ["owner", "manager", "cashier", "waiter", "reception"] as const;

/** Opens a takeaway order and returns its visit, ready for items */
export async function startTakeaway(staff: StaffSession, input: { name?: string | null; clientRequestId?: string } = {}, now = new Date()) {
  await requireStaffRole(staff, takeawayRoles);
  const scope = { tenantId: staff.tenantId, outletId: staff.outletId };
  const name = String(input.name ?? "").trim().slice(0, 80) || null;
  const requestId = input.clientRequestId ? validateStaffOpenRequestId(input.clientRequestId) : null;
  const fingerprint = requestId ? staffOpenRequestFingerprint({ type: "takeaway", name }) : null;
  const res = await db.transaction(async (tx) => {
    // Serializes allocation and request lookup, including the first takeaway counter for an outlet.
    const [outlet] = await tx.select({ id: s.outlets.id }).from(s.outlets)
      .where(and(eq(s.outlets.tenantId, scope.tenantId), eq(s.outlets.id, scope.outletId))).for("update");
    if (!outlet) throw new AppError("not_found", "This outlet was not found.");
    const existing = requestId ? await findStaffOpenRequest(tx, scope, requestId, staff.userId, fingerprint!) : null;
    if (existing) {
      const [table] = await tx.select({ id: s.diningTables.id, code: s.diningTables.code }).from(s.diningTables)
        .where(and(eq(s.diningTables.tenantId, scope.tenantId), eq(s.diningTables.id, existing.tableId)));
      if (!table) throw new AppError("not_found", "The saved takeaway counter was not found.");
      return { sessionId: existing.id, tableId: table.id, code: table.code };
    }
    const counters = await tx
      .select()
      .from(s.diningTables)
      .where(and(eq(s.diningTables.tenantId, scope.tenantId), eq(s.diningTables.outletId, scope.outletId), eq(s.diningTables.tableClass, TAKEAWAY_CLASS), like(s.diningTables.code, "TA-%")))
      .orderBy(asc(s.diningTables.code))
      .for("update");
    let table: (typeof counters)[number] | undefined;
    for (const c of counters.sort((a, b) => num(a.code) - num(b.code))) {
      if (!(await visitAt(tx, scope, c.id))) {
        table = c;
        break;
      }
    }
    if (!table) {
      const [zone] = await tx.select({ id: s.zones.id }).from(s.zones).where(and(eq(s.zones.tenantId, scope.tenantId), eq(s.zones.outletId, scope.outletId))).orderBy(asc(s.zones.sortOrder)).limit(1);
      if (!zone) throw new AppError("invalid_state", "Set up the floor plan first.");
      const taken = new Set((await tx.select({ code: s.diningTables.code }).from(s.diningTables).where(and(eq(s.diningTables.tenantId, scope.tenantId), eq(s.diningTables.outletId, scope.outletId)))).map((r) => r.code));
      let n = counters.length + 1;
      while (taken.has(`TA-${n}`)) n++;
      const id = uuidv7();
      await tx.insert(s.diningTables).values({
        id,
        tenantId: scope.tenantId,
        outletId: scope.outletId,
        zoneId: zone.id,
        code: `TA-${n}`,
        minSeats: 1,
        maxSeats: 50,
        tableClass: TAKEAWAY_CLASS,
        joinCode: String(randomInt(1000, 10000)),
        isBookableOnline: false,
        isActive: false,
        state: "available",
        stateChangedAt: now,
      });
      [table] = await tx.select().from(s.diningTables).where(and(eq(s.diningTables.tenantId, scope.tenantId), eq(s.diningTables.id, id)));
    }
    const sessionId = await openVisit(tx, scope, [table!], { source: "walk_in", partySize: 1, guestName: name, expectedEndAt: new Date(now.getTime() + 60 * 60_000), userId: staff.userId, staffRequestId: requestId, staffRequestFingerprint: fingerprint, now });
    await audit(tx, staff, { action: "takeaway.started", entity: "table", entityId: table!.id, after: { sessionId, code: table!.code, name }, now });
    return { sessionId, tableId: table!.id, code: table!.code };
  }, LOCK_THEN_READ);
  await publish(scope, [visitChanged(res.sessionId, "seated")]);
  return res;
}

const num = (code: string) => Number(code.replace(/\D/g, "")) || 0;

/** Drops a takeaway opened by mistake, as long as nothing was ordered on it */
export async function cancelTakeaway(staff: StaffSession, sessionId: string, now = new Date()) {
  await requireStaffRole(staff, takeawayRoles);
  const scope = { tenantId: staff.tenantId, outletId: staff.outletId };
  const res = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ session: s.tableSessions, tableClass: s.diningTables.tableClass })
      .from(s.tableSessions)
      .innerJoin(s.diningTables, and(eq(s.diningTables.tenantId, s.tableSessions.tenantId), eq(s.diningTables.id, s.tableSessions.tableId)))
      .where(and(eq(s.tableSessions.tenantId, scope.tenantId), eq(s.tableSessions.outletId, scope.outletId), eq(s.tableSessions.id, String(sessionId))))
      .for("update");
    if (!row || row.tableClass !== TAKEAWAY_CLASS) throw new AppError("not_found", "That takeaway order is not here.");
    if (row.session.status === "closed") return { tableId: row.session.tableId };
    const [line] = await tx
      .select({ id: s.orderLines.id })
      .from(s.orderLines)
      .where(and(eq(s.orderLines.tenantId, scope.tenantId), eq(s.orderLines.sessionId, row.session.id), notInArray(s.orderLines.status, ["cancelled", "voided"])))
      .limit(1);
    if (line) throw new AppError("conflict", "This takeaway has items. Remove them or take the payment.", { reason: "has_items" });
    await tx.update(s.tableSessions).set({ status: "closed", openKey: null, closedAt: now }).where(and(eq(s.tableSessions.tenantId, scope.tenantId), eq(s.tableSessions.id, row.session.id)));
    await releaseVisitTables(tx, scope.tenantId, row.session.id, now);
    await tx.update(s.diningTables).set({ state: "available", stateChangedAt: now }).where(and(eq(s.diningTables.tenantId, scope.tenantId), eq(s.diningTables.id, row.session.tableId)));
    await audit(tx, staff, { action: "takeaway.cancelled", entity: "table", entityId: row.session.tableId, after: { sessionId: row.session.id }, now });
    return { tableId: row.session.tableId };
  }, LOCK_THEN_READ);
  await publish(scope, [visitChanged(String(sessionId), "closed")]);
  return res;
}
