import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { isPlaceholderName } from "@/domain/guest-name";
import { guestContextForDevice } from "./menu-screen";
import { getOrderTracker } from "./tracker";
import { getServiceRequests } from "./service-requests";

export async function getTrackerScreen(outletCode: string, shortCode: string, deviceId: string | null, now = new Date()) {
  const { t, open, ctx } = await guestContextForDevice(outletCode, shortCode, deviceId);
  const [tracker, requests, [cart]] = await Promise.all([
    getOrderTracker(ctx, now),
    getServiceRequests(ctx),
    // My cart's item count for the header badge; the cart screen does the pricing
    db.select({ count: sql<number>`coalesce(sum(${s.cartLines.qty}), 0)`.mapWith(Number) })
      .from(s.cartLines)
      .where(and(eq(s.cartLines.tenantId, ctx.tenantId), eq(s.cartLines.sessionId, ctx.sessionId), eq(s.cartLines.participantId, ctx.participantId))),
  ]);
  const host = open.people.find((p) => p.id === open.session.hostParticipantId);
  return {
    renderedAt: now.getTime(),
    outlet: { code: t.outlet.code, name: t.outlet.name, logoUrl: t.logoUrl, accentColor: t.outlet.accentColor },
    table: { code: t.table.code },
    timezone: ctx.timezone,
    session: { key: ctx.sessionId, people: open.people.length, status: open.session.status, orderingLocked: open.session.orderingLocked, isHost: open.session.hostParticipantId === ctx.participantId, hostName: host && !isPlaceholderName(host.displayName) ? host.displayName : null },
    ...tracker,
    // Plain numbers across the server/client boundary, never a locale-dependent date string.
    rounds: tracker.rounds.map((r) => ({ ...r, placedAt: r.placedAt.getTime(), placedBy: r.placedBy && !isPlaceholderName(r.placedBy) ? r.placedBy : null })),
    requests,
    cartCount: cart?.count ?? 0,
  };
}
export type TrackerScreenData = Awaited<ReturnType<typeof getTrackerScreen>>;
