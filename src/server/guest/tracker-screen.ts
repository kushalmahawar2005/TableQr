import "server-only";
import { isPlaceholderName } from "@/domain/guest-name";
import { guestContextForDevice } from "./menu-screen";
import { getOrderTracker } from "./tracker";
import { getServiceRequests } from "./service-requests";

export async function getTrackerScreen(outletCode: string, shortCode: string, deviceId: string | null, now = new Date()) {
  const { t, open, ctx } = await guestContextForDevice(outletCode, shortCode, deviceId);
  const [tracker, requests] = await Promise.all([getOrderTracker(ctx, now), getServiceRequests(ctx)]);
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
  };
}
export type TrackerScreenData = Awaited<ReturnType<typeof getTrackerScreen>>;
