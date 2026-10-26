import "server-only";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";

// One delivery changed: the outlet's delivery desk (floor topic) and the customer following
// it (its session topic) both hear about it and fetch fresh data. Never throws.
export async function announceDelivery(scope: { tenantId: string; outletId: string }, sessionId: string | null | undefined, type = "delivery.updated", riderIds: (string | null | undefined)[] = []) {
  await publish(scope, [
    { topic: topics.floor, type, data: { sessionId: sessionId ?? null } },
    ...(sessionId ? [{ topic: topics.session(sessionId), type }] : []),
    // The riders whose list this changes (the one given the job, and one it was taken from)
    ...[...new Set(riderIds.filter((id): id is string => !!id))].map((id) => ({ topic: topics.rider(id), type })),
  ]);
}
