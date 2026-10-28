import { readOfflinePosOrders, removeOfflinePosOrder, withOfflinePosSyncLock, writeOfflinePosOrder, type OfflinePosOrder } from "./pos-offline-queue";

type Checkpoint = (order: OfflinePosOrder) => Promise<void>;

/** Drain a fixed ordered snapshot: removing one order must never skip the following order. */
export async function syncSavedPosOrders(input: {
  outletId: string;
  force?: boolean;
  deliver: (order: OfflinePosOrder, checkpoint: Checkpoint) => Promise<void>;
  now?: () => number;
}) {
  const lock = await withOfflinePosSyncLock(input.outletId, async () => {
    const now = input.now ?? Date.now;
    const orders = await readOfflinePosOrders(input.outletId);
    let synced = 0;
    for (const saved of orders) {
      let order = saved;
      if (!input.force && order.nextRetryAt && order.nextRetryAt > now()) break;
      try {
        await input.deliver(order, async (updated) => {
          if (updated.id !== saved.id) throw new Error("The saved order request ID cannot change during sync.");
          await writeOfflinePosOrder(input.outletId, updated);
          order = updated;
        });
        await removeOfflinePosOrder(input.outletId, order.id);
        synced++;
      } catch (error) {
        const retryCount = (order.retryCount ?? 0) + 1;
        const retryDelay = Math.min(5 * 60_000, 10_000 * (2 ** Math.min(retryCount - 1, 5)));
        const blocked = {
          ...order,
          error: error instanceof Error ? error.message : "Could not sync this saved order.",
          retryCount,
          nextRetryAt: now() + retryDelay,
        };
        await writeOfflinePosOrder(input.outletId, blocked);
        return { synced, blocked };
      }
    }
    return { synced, blocked: null };
  });
  return lock.acquired ? lock.result! : { synced: 0, blocked: null, locked: true as const };
}
