import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import type { TableState } from "@/db/schema";
import type { Runner, Tx } from "../db-types";
import type { RealtimeEvent } from "../realtime/publish";
import { topics } from "../realtime/token";

// Which physical tables a visit occupies (S1). Shared by guest flows (bill, close) and the host
// floor (seat, move, swap, combine), so table states always follow the whole visit.

/** Live table assignments of a visit, primary first */
export async function activeTableIds(run: Runner, tenantId: string, sessionId: string): Promise<string[]> {
  const rows = await run
    .select({ tableId: s.sessionTables.tableId, isPrimary: s.sessionTables.isPrimary })
    .from(s.sessionTables)
    .where(and(eq(s.sessionTables.tenantId, tenantId), eq(s.sessionTables.sessionId, sessionId), isNotNull(s.sessionTables.activeKey)));
  return rows.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).map((r) => r.tableId);
}

/** Sets every table of a visit to one state; returns the tables changed */
export async function setVisitTablesState(tx: Tx, tenantId: string, sessionId: string, state: TableState, now: Date) {
  const ids = await activeTableIds(tx, tenantId, sessionId);
  if (ids.length) {
    await tx.update(s.diningTables).set({ state, stateChangedAt: now }).where(and(eq(s.diningTables.tenantId, tenantId), inArray(s.diningTables.id, ids)));
  }
  return ids;
}

/** Ends every live assignment of a visit; the rows stay as history */
export async function releaseVisitTables(tx: Tx, tenantId: string, sessionId: string, now: Date) {
  await tx
    .update(s.sessionTables)
    .set({ activeKey: null, releasedAt: now })
    .where(and(eq(s.sessionTables.tenantId, tenantId), eq(s.sessionTables.sessionId, sessionId), isNotNull(s.sessionTables.activeKey)));
}

/** Assigns a table to a visit; the unique active key refuses a table that is already taken */
export async function assignTable(
  tx: Tx,
  where: { tenantId: string; outletId: string; sessionId: string },
  tableId: string,
  opts: { primary: boolean; userId?: string | null; now: Date },
) {
  await tx.insert(s.sessionTables).values({
    id: uuidv7(),
    tenantId: where.tenantId,
    outletId: where.outletId,
    sessionId: where.sessionId,
    tableId,
    isPrimary: opts.primary,
    activeKey: tableId,
    assignedAt: opts.now,
    assignedByUserId: opts.userId ?? null,
  });
}

/** Floor hints: each table's new state, then "this visit changed" so tiles reload their counts */
export const tableStateEvents = (tableIds: string[], state: TableState): RealtimeEvent[] =>
  tableIds.map((tableId) => ({ topic: topics.floor, type: "table.state_changed", data: { tableId, state } }));

export const visitChanged = (sessionId: string, change: string): RealtimeEvent => ({
  topic: topics.floor,
  type: "floor.session_updated",
  data: { sessionId, change },
});
