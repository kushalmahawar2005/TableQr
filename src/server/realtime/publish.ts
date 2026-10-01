import "server-only";

// Publishing realtime hints after a change is committed (PS 9.3). Events carry ids only; screens
// reload the real data. Publishing never throws and never delays the guest for long: if the
// realtime service is slow or down, screens still catch up on reconnect and by polling.

export type RealtimeEvent = { topic: string; type: string; data?: Record<string, unknown> };
type Scope = { tenantId: string; outletId: string };
type Listener = (scope: Scope, events: RealtimeEvent[]) => void;

const listeners = new Set<Listener>();

/** In-process hook, used by tests to see what would be sent */
export function onPublish(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function publish(scope: Scope, events: RealtimeEvent[]): Promise<void> {
  if (events.length === 0) return;
  for (const listener of listeners) listener(scope, events);

  const url = process.env.REALTIME_URL;
  const secret = process.env.REALTIME_PUBLISH_SECRET;
  if (!url || !secret) return;
  try {
    const res = await fetch(`${url}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ tenantId: scope.tenantId, outletId: scope.outletId, events }),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) console.warn(`[realtime] publish failed: ${res.status}`);
  } catch (err) {
    console.warn(`[realtime] publish error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
