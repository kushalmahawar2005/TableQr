import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { orderedSoFar, tablePeople } from "@/domain/table-people";
import { guestContextForDevice } from "./menu-screen";
import { getServiceRequests } from "./service-requests";

// Everything G7 Table & People shows, in one server call: the people at the table, the host,
// what has been ordered so far, ordering paused or not, and the table's service requests.

export async function getTableScreen(outletCode: string, shortCode: string, deviceId: string | null, now = new Date()) {
  const { t, open, ctx } = await guestContextForDevice(outletCode, shortCode, deviceId);
  const where = { tenantId: ctx.tenantId, sessionId: ctx.sessionId };
  const [rows, lines, requests] = await Promise.all([
    db
      .select({
        id: s.participants.id,
        displayName: s.participants.displayName,
        joinedAt: s.participants.joinedAt,
        paidOutAt: s.participants.paidOutAt,
        removedAt: s.participants.removedAt,
      })
      .from(s.participants)
      .where(and(eq(s.participants.tenantId, where.tenantId), eq(s.participants.sessionId, where.sessionId)))
      .orderBy(asc(s.participants.id)),
    // Prices as snapshotted when each round was placed, never today's menu price
    db
      .select({ orderId: s.orderLines.orderId, unitPricePaise: s.orderLines.unitPricePaise, qty: s.orderLines.qty, status: s.orderLines.status })
      .from(s.orderLines)
      .where(and(eq(s.orderLines.tenantId, where.tenantId), eq(s.orderLines.sessionId, where.sessionId))),
    getServiceRequests(ctx),
  ]);

  const session = open.session;
  const people = tablePeople(rows, ctx.participantId, session.hostParticipantId);
  const me = people.find((p) => p.isMe);
  const host = people.find((p) => p.isHost);
  const ordered = orderedSoFar(lines);
  const hostConfirmed = session.mode === "host_confirmed";
  // Read only where joining needs it, so the code never leaves the server otherwise
  const [code]: { joinCode: string }[] = hostConfirmed
    ? await db
        .select({ joinCode: s.diningTables.joinCode })
        .from(s.diningTables)
        .where(and(eq(s.diningTables.tenantId, ctx.tenantId), eq(s.diningTables.id, ctx.tableId)))
    : [];

  return {
    renderedAt: now.getTime(),
    outlet: { code: t.outlet.code, name: t.outlet.name, city: t.outlet.city, logoUrl: t.logoUrl, accentColor: t.outlet.accentColor },
    table: { code: t.table.code },
    invite: {
      mode: session.mode,
      /** The table's 4-digit join code, only where joining needs it (Host-confirmed mode) */
      joinCode: (code?.joinCode ?? null) as string | null,
    },
    session: {
      key: session.id,
      status: session.status,
      orderingLocked: session.orderingLocked,
      /** Host controls are shown only to the current host while they are still at the table */
      isHost: !!me?.isHost && me.state === "active",
      hostName: host?.name ?? null,
      hostIsMe: !!host?.isMe,
      /** People still at the table, the count in the header */
      people: people.filter((p) => p.state === "active").length,
    },
    people,
    ordered,
    inProgress: ordered.inKitchen,
    requests,
  };
}

export type TableScreenData = Awaited<ReturnType<typeof getTableScreen>>;
