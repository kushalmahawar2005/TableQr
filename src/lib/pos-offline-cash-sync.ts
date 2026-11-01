import { markOfflinePosBillSettled, readOfflinePosCashCollections, readOfflinePosOrders, withOfflinePosSyncLock, writeOfflinePosCashCollection, type OfflinePosCashCollection } from "./pos-offline-queue";
import { connectionLost } from "./pos-offline-sync";

/** Cash is posted only after its existing server bill is still owed the exact locally recorded amount. */
export async function syncSavedPosCashCollections(input: {
  outletId: string;
  staffUserId: string;
  force?: boolean;
  deliver: (cash: OfflinePosCashCollection) => Promise<void>;
  now?: () => number;
}) {
  const lock = await withOfflinePosSyncLock(input.outletId, async () => {
    const now = input.now ?? Date.now;
    const cashRecords = await readOfflinePosCashCollections(input.outletId);
    const orders = await readOfflinePosOrders(input.outletId);
    let synced = 0;
    let blocked: OfflinePosCashCollection | null = null;
    // Each record settles its own bill, so one stopped record never holds back another.
    for (const saved of cashRecords) {
      if (orders.some((order) => order.current.sessionId === saved.sessionId)) continue;
      let cash = saved;
      if (!input.force && cash.nextRetryAt && cash.nextRetryAt > now()) continue;
      try {
        if (cash.staffUserId !== input.staffUserId) throw new Error("This offline cash record belongs to a different staff session. Ask a manager to review it.");
        await input.deliver(cash);
        await markOfflinePosBillSettled(input.outletId, cash.sessionId, cash.id);
        synced++;
      } catch (error) {
        const retryCount = (cash.retryCount ?? 0) + 1;
        const retryDelay = Math.min(5 * 60_000, 10_000 * (2 ** Math.min(retryCount - 1, 5)));
        cash = {
          ...cash,
          error: error instanceof Error ? error.message : "Could not sync this offline cash record.",
          retryCount,
          nextRetryAt: now() + retryDelay,
        };
        await writeOfflinePosCashCollection(input.outletId, cash);
        blocked ??= cash;
        if (connectionLost(error)) break;
      }
    }
    return { synced, blocked };
  });
  return lock.acquired ? lock.result! : { synced: 0, blocked: null, locked: true as const };
}
