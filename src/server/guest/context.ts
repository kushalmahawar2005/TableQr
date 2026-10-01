import "server-only";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "../errors";
import { findTableByQr } from "./table";

/** Everything a guest action needs, all resolved and checked on the server */
export type GuestContext = {
  tenantId: string;
  outletId: string;
  brandId: string;
  timezone: string;
  sessionId: string;
  tableId: string;
  participantId: string;
};

/**
 * Proves the caller is a live participant of the open session on this QR's table.
 * participantId and deviceId come from the guest's cookie; neither is trusted alone.
 */
export async function getGuestContext(
  outletCode: string,
  shortCode: string,
  participantId: string,
  deviceId: string,
): Promise<GuestContext> {
  const t = await findTableByQr(db, outletCode, shortCode);
  // The visit must have sat at this QR's table: now, combined with it, or before a move (S1)
  const [row] = await db
    .select({ sessionId: s.tableSessions.id, tableId: s.tableSessions.tableId })
    .from(s.participants)
    .innerJoin(
      s.tableSessions,
      and(eq(s.tableSessions.id, s.participants.sessionId), eq(s.tableSessions.tenantId, s.participants.tenantId)),
    )
    .innerJoin(
      s.sessionTables,
      and(eq(s.sessionTables.sessionId, s.participants.sessionId), eq(s.sessionTables.tenantId, s.participants.tenantId)),
    )
    .where(
      and(
        eq(s.participants.tenantId, t.outlet.tenantId),
        eq(s.participants.id, participantId),
        eq(s.participants.deviceId, deviceId),
        isNull(s.participants.removedAt),
        eq(s.sessionTables.tableId, t.table.id),
        ne(s.tableSessions.status, "closed"),
      ),
    )
    .limit(1);

  if (!row) throw new AppError("session_expired", "Your table session has ended. Scan the table QR again to continue.");

  return {
    tenantId: t.outlet.tenantId,
    outletId: t.outlet.id,
    brandId: t.outlet.brandId,
    timezone: t.outlet.timezone,
    sessionId: row.sessionId,
    tableId: row.tableId,
    participantId,
  };
}
