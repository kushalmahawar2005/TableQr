import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { OfflinePosOrder } from "@/lib/pos-offline-queue";

const makeOrder = (id: string, createdAt = 100): OfflinePosOrder => ({
  id, createdAt, staffUserId: "cashier-1",
  current: { sessionId: null, tableId: "table-1", code: "T1", takeaway: false, seats: 4 },
  guestName: "Meena", partySize: 2,
  lines: [{ itemId: "dish-1", qty: 2, modifierIds: [] }],
  quote: { "dish-1|": 15000 },
});

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  const legacy = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => legacy.get(key) ?? null,
    setItem: (key: string, value: string) => { legacy.set(key, value); },
    removeItem: (key: string) => { legacy.delete(key); },
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("offline POS durable outbox", () => {
  it("restores price quotes and retry state from IndexedDB after the app reloads", async () => {
    const storage = await import("@/lib/pos-offline-queue");
    const order = { ...makeOrder("order-1"), error: "Connection dropped", retryCount: 3, nextRetryAt: 9000 };
    await storage.writeOfflinePosOrder("outlet-1", order);

    vi.resetModules();
    const reopened = await import("@/lib/pos-offline-queue");
    expect(await reopened.readOfflinePosOrders("outlet-1")).toEqual([order]);
    expect(await reopened.readOfflinePosOrders("outlet-2")).toEqual([]);
  });

  it("exports every recovery field without removing the pending order", async () => {
    const storage = await import("@/lib/pos-offline-queue");
    const order = { ...makeOrder("order-1"), retryCount: 2, nextRetryAt: 5000 };
    await storage.queueOfflinePosOrder("outlet-1", order);
    const exported = JSON.parse(await storage.buildOfflinePosRecoveryFile("outlet-1"));
    expect(exported).toMatchObject({ format: "tableeqr-pos-offline-recovery", version: 2, outletId: "outlet-1", orderCount: 1, cashCollectionCount: 0, orders: [order], cashCollections: [] });
    expect(await storage.readOfflinePosOrders("outlet-1")).toEqual([order]);
  });

  it("restores a recovery copy only into the matching outlet and skips identical request IDs", async () => {
    const storage = await import("@/lib/pos-offline-queue");
    const first = makeOrder("order-restore1");
    const second = makeOrder("order-restore2", 200);
    const file = JSON.stringify({ format: "tableeqr-pos-offline-recovery", version: 2, outletId: "outlet-1", orders: [first, second], cashCollections: [] });
    await storage.writeOfflinePosOrder("outlet-1", first);
    await expect(storage.importOfflinePosRecoveryFile("outlet-2", file)).rejects.toThrow(/different outlet/);
    const result = await storage.importOfflinePosRecoveryFile("outlet-1", file);
    expect(result).toEqual({ imported: 1, importedCash: 0, total: 2, totalCash: 0 });
    expect((await storage.readOfflinePosOrders("outlet-1")).map((order) => order.id)).toEqual([first.id, second.id]);
  });

  it("rejects a request ID collision without partially importing the rest of the file", async () => {
    const storage = await import("@/lib/pos-offline-queue");
    await storage.writeOfflinePosOrder("outlet-1", makeOrder("order-collide1"));
    const collision = { ...makeOrder("order-collide1"), lines: [{ itemId: "dish-1", qty: 3, modifierIds: [] }] };
    const additional = makeOrder("order-collide2", 200);
    const file = JSON.stringify({ format: "tableeqr-pos-offline-recovery", version: 2, outletId: "outlet-1", orders: [collision, additional], cashCollections: [] });
    await expect(storage.importOfflinePosRecoveryFile("outlet-1", file)).rejects.toThrow(/different order details/);
    expect((await storage.readOfflinePosOrders("outlet-1")).map((order) => order.id)).toEqual(["order-collide1"]);
  });

  it("exports, restores, and syncs a provisional cash record exactly once", async () => {
    const storage = await import("@/lib/pos-offline-queue");
    const { syncSavedPosCashCollections } = await import("@/lib/pos-offline-cash-sync");
    const cash = { id: "cash-record-0001", createdAt: 100, staffUserId: "cashier-1", sessionId: "session-1", billId: "bill-1", tableCode: "T1", expectedDuePaise: 12500, receivedPaise: 15000 };
    const file = JSON.stringify({ format: "tableeqr-pos-offline-recovery", version: 2, outletId: "outlet-1", orders: [], cashCollections: [cash] });
    expect(await storage.importOfflinePosRecoveryFile("outlet-1", file)).toEqual({ imported: 0, importedCash: 1, total: 0, totalCash: 1 });
    expect(JSON.parse(await storage.buildOfflinePosRecoveryFile("outlet-1"))).toMatchObject({ cashCollections: [cash], cashCollectionCount: 1 });
    const attempts: string[] = [];
    const deliver = async (record: typeof cash) => { attempts.push(record.id); if (attempts.length === 1) throw new Error("Reply lost after server commit"); };
    await syncSavedPosCashCollections({ outletId: "outlet-1", staffUserId: "cashier-1", now: () => 1000, deliver });
    const retry = await syncSavedPosCashCollections({ outletId: "outlet-1", staffUserId: "cashier-1", force: true, now: () => 1001, deliver });
    expect(retry).toEqual({ synced: 1, blocked: null });
    expect(attempts).toEqual([cash.id, cash.id]);
    expect(await storage.readOfflinePosCashCollections("outlet-1")).toEqual([]);
  });

  it("drains three consecutive orders in one pass without skipping the middle order", async () => {
    const storage = await import("@/lib/pos-offline-queue");
    const { syncSavedPosOrders } = await import("@/lib/pos-offline-sync");
    for (const [id, createdAt] of [["order-3", 300], ["order-1", 100], ["order-2", 200]] as const) {
      await storage.writeOfflinePosOrder("outlet-1", makeOrder(id, createdAt));
    }
    const delivered: string[] = [];
    const result = await syncSavedPosOrders({ outletId: "outlet-1", deliver: async (order) => { delivered.push(order.id); } });
    expect(delivered).toEqual(["order-1", "order-2", "order-3"]);
    expect(result).toEqual({ synced: 3, blocked: null });
    expect(await storage.readOfflinePosOrders("outlet-1")).toEqual([]);
  });

  it("keeps a session checkpoint, blocks later orders, and persists backoff across reload", async () => {
    const storage = await import("@/lib/pos-offline-queue");
    const { syncSavedPosOrders } = await import("@/lib/pos-offline-sync");
    await storage.writeOfflinePosOrder("outlet-1", makeOrder("order-1"));
    await storage.writeOfflinePosOrder("outlet-1", makeOrder("order-2", 200));
    const result = await syncSavedPosOrders({
      outletId: "outlet-1", now: () => 1000,
      deliver: async (order, checkpoint) => {
        await checkpoint({ ...order, current: { ...order.current, sessionId: "session-1" } });
        throw new Error("Server unavailable");
      },
    });
    expect(result.blocked).toMatchObject({ id: "order-1", current: { sessionId: "session-1" }, retryCount: 1, nextRetryAt: 11000 });

    vi.resetModules();
    const reloaded = await import("@/lib/pos-offline-sync");
    const deliver = vi.fn();
    expect(await reloaded.syncSavedPosOrders({ outletId: "outlet-1", now: () => 2000, deliver })).toEqual({ synced: 0, blocked: null });
    expect(deliver).not.toHaveBeenCalled();
    const queued = await (await import("@/lib/pos-offline-queue")).readOfflinePosOrders("outlet-1");
    expect(queued.map((order) => order.id)).toEqual(["order-1", "order-2"]);
    expect(queued[0].quote).toEqual({ "dish-1|": 15000 });
  });

  it("manual retry preserves the request ID after a lost reply and clears the queue on acknowledgment", async () => {
    const storage = await import("@/lib/pos-offline-queue");
    const { syncSavedPosOrders } = await import("@/lib/pos-offline-sync");
    await storage.writeOfflinePosOrder("outlet-1", makeOrder("order-1"));
    const accepted = new Set<string>();
    const attempts: string[] = [];
    const deliver = async (order: OfflinePosOrder) => {
      attempts.push(order.id);
      accepted.add(order.id);
      if (attempts.length === 1) throw new Error("Reply lost after server commit");
    };
    await syncSavedPosOrders({ outletId: "outlet-1", now: () => 1000, deliver });
    const result = await syncSavedPosOrders({ outletId: "outlet-1", now: () => 1001, force: true, deliver });
    expect(attempts).toEqual(["order-1", "order-1"]);
    expect(accepted.size).toBe(1);
    expect(result).toEqual({ synced: 1, blocked: null });
    expect(await storage.readOfflinePosOrders("outlet-1")).toEqual([]);
  });

  it("coordinates queue draining across two POS tabs", async () => {
    const storage = await import("@/lib/pos-offline-queue");
    const { syncSavedPosOrders } = await import("@/lib/pos-offline-sync");
    await storage.writeOfflinePosOrder("outlet-1", makeOrder("order-lock-1"));
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => { finish = resolve; });
    const first = syncSavedPosOrders({ outletId: "outlet-1", deliver: async () => waiting });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await syncSavedPosOrders({ outletId: "outlet-1", deliver: async () => { throw new Error("must not run twice"); } });
    expect(second).toEqual({ synced: 0, blocked: null, locked: true });
    finish();
    expect(await first).toEqual({ synced: 1, blocked: null });
    expect(await storage.readOfflinePosOrders("outlet-1")).toEqual([]);
  });
});
