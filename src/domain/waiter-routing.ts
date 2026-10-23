export type WaiterLoad = { id: string; duty: string; activeTables: number; pendingRequests: number; readyOrders: number };

/** Linear scan; compare queued work before assigning another table. Stable ids break equal-load ties. */
export function chooseWaiter<T extends WaiterLoad>(waiters: T[], preferredId?: string | null, excludeId?: string | null): T | null {
  const score = (w: WaiterLoad) => w.activeTables * 2 + w.pendingRequests * 3 + w.readyOrders * 2;
  let best: T | null = null;
  for (const waiter of waiters) {
    if (waiter.duty !== "on" || waiter.id === excludeId) continue;
    if (!best || score(waiter) < score(best) || (score(waiter) === score(best) && waiter.id.localeCompare(best.id) < 0)) best = waiter;
  }
  const preferred = waiters.find(w => w.id === preferredId && w.duty === "on" && w.id !== excludeId);
  return preferred && best && score(preferred) <= score(best) + 2 ? preferred : best;
}
