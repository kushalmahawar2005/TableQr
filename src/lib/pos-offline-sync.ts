import { readOfflinePosOrders, removeOfflinePosOrder, withOfflinePosSyncLock, writeOfflinePosOrder, type OfflinePosOrder } from "./pos-offline-queue";

type Checkpoint = (order: OfflinePosOrder) => Promise<void>;

/** A request that never got a reply; everything after it would fail the same way. */
export const connectionLost = (error: unknown) => error instanceof TypeError;

const visitKeys = (order: OfflinePosOrder) => [order.current.sessionId, order.current.tableId].filter((key): key is string => !!key);

/** Later rounds saved offline for this table belong to the visit the first round just opened. */
async function shareOpenedVisit(outletId: string, orders: OfflinePosOrder[], opened: OfflinePosOrder, from: number) {
  for (let index = from; index < orders.length; index++) {
    const later = orders[index];
    // A manager's approval is bound to the exact saved order, and another login's order stays theirs.
    if (later.current.sessionId || later.current.takeaway || later.current.tableId !== opened.current.tableId || later.staffUserId !== opened.staffUserId || later.managerApprovedByUserId) continue;
    orders[index] = { ...later, current: { ...later.current, sessionId: opened.current.sessionId } };
    await writeOfflinePosOrder(outletId, orders[index]);
  }
}

/**
 * Drain a fixed ordered snapshot: removing one order must never skip the following order. A stopped
 * order only holds back later orders for its own table, so the kitchen still gets each table's
 * rounds in order while every other table goes through.
 */
export async function syncSavedPosOrders(input: {
  outletId: string;
  force?: boolean;
  deliver: (order: OfflinePosOrder, checkpoint: Checkpoint) => Promise<void>;
  now?: () => number;
}) {
  const lock = await withOfflinePosSyncLock(input.outletId, async () => {
    const now = input.now ?? Date.now;
    const orders = await readOfflinePosOrders(input.outletId);
    const held = new Set<string>();
    const hold = (order: OfflinePosOrder) => visitKeys(order).forEach((key) => held.add(key));
    let synced = 0;
    let blocked: OfflinePosOrder | null = null;
    for (let index = 0; index < orders.length; index++) {
      let order = orders[index];
      const id = order.id;
      if (visitKeys(order).some((key) => held.has(key)) || (!input.force && order.nextRetryAt && order.nextRetryAt > now())) {
        hold(order);
        continue;
      }
      try {
        await input.deliver(order, async (updated) => {
          if (updated.id !== id) throw new Error("The saved order request ID cannot change during sync.");
          await writeOfflinePosOrder(input.outletId, updated);
          const opened = !order.current.sessionId && !!updated.current.sessionId;
          order = updated;
          if (opened) await shareOpenedVisit(input.outletId, orders, updated, index + 1);
        });
        await removeOfflinePosOrder(input.outletId, order.id);
        synced++;
      } catch (error) {
        const retryCount = (order.retryCount ?? 0) + 1;
        const retryDelay = Math.min(5 * 60_000, 10_000 * (2 ** Math.min(retryCount - 1, 5)));
        const stopped = {
          ...order,
          error: error instanceof Error ? error.message : "Could not sync this saved order.",
          retryCount,
          nextRetryAt: now() + retryDelay,
        };
        await writeOfflinePosOrder(input.outletId, stopped);
        blocked ??= stopped;
        hold(stopped);
        if (connectionLost(error)) break;
      }
    }
    return { synced, blocked };
  });
  return lock.acquired ? lock.result! : { synced: 0, blocked: null, locked: true as const };
}
