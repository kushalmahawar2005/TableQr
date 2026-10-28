import type { AnyDraftLine } from "@/server/guest/order";
import type { PosTerminal } from "@/server/staff/pos-terminal";
import type { PriceQuote } from "@/domain/pricing";

export type OfflinePosOrder = {
  id: string;
  createdAt: number;
  staffUserId: string;
  current: { sessionId: string | null; tableId: string | null; code: string; takeaway: boolean; seats: number };
  guestName: string;
  partySize: number;
  lines: AnyDraftLine[];
  /** Server menu unit prices the cashier saw when saving the offline KOT. */
  quote?: PriceQuote;
  error?: string;
  retryCount?: number;
  nextRetryAt?: number;
};

type StoredOrder = OfflinePosOrder & { key: string; outletId: string };

// Persisted identity stays stable through the display-name change so unsynced KOTs are never orphaned.
const DB_NAME = "tableqr-pos-offline-v1";
const DB_VERSION = 3;
const LEGACY_QUEUE_PREFIX = "tq_pos_offline_orders_v1:";

let database: Promise<IDBDatabase> | null = null;

function openDatabase() {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots", { keyPath: "outletId" });
      if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts", { keyPath: "outletId" });
      if (!db.objectStoreNames.contains("orders")) {
        const orders = db.createObjectStore("orders", { keyPath: "key" });
        orders.createIndex("outletId", "outletId", { unique: false });
      }
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => { database = null; reject(request.error ?? new Error("Could not open POS storage.")); };
    request.onblocked = () => { database = null; reject(new Error("POS storage is busy in another tab. Close the other POS tab and try again.")); };
  });
  return database;
}

function read<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not read POS storage."));
  });
}

export async function savePosSnapshot(outletId: string, data: PosTerminal, sessionExpiresAt: number, staffUserId: string, hi: boolean, savedAt = Date.now()) {
  const db = await openDatabase();
  const tx = db.transaction(["snapshots", "meta"], "readwrite");
  tx.objectStore("snapshots").put({ outletId, savedAt, data, sessionExpiresAt, staffUserId, hi });
  tx.objectStore("meta").put({ key: "last-pos-outlet", outletId });
  await transactionDone(tx);
}

export type OfflinePosSnapshot = { outletId: string; savedAt: number; data: PosTerminal; sessionExpiresAt: number; staffUserId: string; hi: boolean };

export async function loadOfflinePosSnapshot(): Promise<OfflinePosSnapshot | null> {
  const db = await openDatabase();
  const value = await read(db.transaction("meta", "readonly").objectStore("meta").get("last-pos-outlet") as IDBRequest<{ outletId: string } | undefined>);
  if (!value) return null;
  const snapshot = await read(db.transaction("snapshots", "readonly").objectStore("snapshots").get(value.outletId) as IDBRequest<OfflinePosSnapshot | undefined>);
  return snapshot && snapshot.sessionExpiresAt > Date.now() ? snapshot : null;
}

export async function clearOfflinePosAccess() {
  const db = await openDatabase();
  const tx = db.transaction(["snapshots", "drafts", "meta"], "readwrite");
  const meta = tx.objectStore("meta");
  const previous = meta.get("last-pos-outlet");
  previous.onsuccess = () => {
    if (typeof previous.result?.outletId === "string") {
      tx.objectStore("snapshots").delete(previous.result.outletId);
      tx.objectStore("drafts").delete(previous.result.outletId);
    }
    meta.delete("last-pos-outlet");
  };
  await transactionDone(tx);
}

export async function savePosDraft<T>(outletId: string, draft: T | null) {
  const db = await openDatabase();
  const tx = db.transaction("drafts", "readwrite");
  const store = tx.objectStore("drafts");
  if (draft === null) store.delete(outletId);
  else store.put({ outletId, savedAt: Date.now(), draft });
  await transactionDone(tx);
}

export async function loadPosDraft<T>(outletId: string): Promise<{ savedAt: number; draft: T } | null> {
  const db = await openDatabase();
  const record = await read(db.transaction("drafts", "readonly").objectStore("drafts").get(outletId) as IDBRequest<{ savedAt: number; draft: T } | undefined>);
  return record ?? null;
}

export async function readOfflinePosOrders(outletId: string): Promise<OfflinePosOrder[]> {
  const db = await openDatabase();
  await importLegacyOrders(db, outletId);
  const values = await read(db.transaction("orders", "readonly").objectStore("orders").index("outletId").getAll(outletId) as IDBRequest<StoredOrder[]>);
  return values.sort((a, b) => a.createdAt - b.createdAt).map(toOfflinePosOrder);
}

/** A non-destructive recovery copy; exporting never changes or clears the local outbox. */
export async function buildOfflinePosRecoveryFile(outletId: string) {
  const orders = await readOfflinePosOrders(outletId);
  return JSON.stringify({
    format: "tableeqr-pos-offline-recovery",
    version: 1,
    outletId,
    exportedAt: new Date().toISOString(),
    orderCount: orders.length,
    orders,
  }, null, 2);
}

export async function writeOfflinePosOrder(outletId: string, order: OfflinePosOrder) {
  const db = await openDatabase();
  const tx = db.transaction("orders", "readwrite");
  tx.objectStore("orders").put({ ...order, key: `${outletId}:${order.id}`, outletId } satisfies StoredOrder);
  await transactionDone(tx);
}

export async function queueOfflinePosOrder(outletId: string, order: OfflinePosOrder) {
  const db = await openDatabase();
  const tx = db.transaction(["orders", "drafts"], "readwrite");
  tx.objectStore("orders").put({ ...order, key: `${outletId}:${order.id}`, outletId } satisfies StoredOrder);
  tx.objectStore("drafts").delete(outletId);
  await transactionDone(tx);
}

export async function removeOfflinePosOrder(outletId: string, orderId: string) {
  const db = await openDatabase();
  const tx = db.transaction("orders", "readwrite");
  tx.objectStore("orders").delete(`${outletId}:${orderId}`);
  await transactionDone(tx);
}

async function importLegacyOrders(db: IDBDatabase, outletId: string) {
  const marker = `legacy-imported:${outletId}`;
  const check = await read(db.transaction("meta", "readonly").objectStore("meta").get(marker) as IDBRequest<{ key: string } | undefined>);
  if (check) return;

  const legacyKey = `${LEGACY_QUEUE_PREFIX}${outletId}`;
  let legacy: OfflinePosOrder[] = [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(legacyKey) ?? "[]");
    if (Array.isArray(parsed)) legacy = parsed as OfflinePosOrder[];
  } catch {
    // Keep unreadable data in place for manual recovery; it is never deleted by this migration.
  }

  const tx = db.transaction(["meta", "orders"], "readwrite");
  for (const order of legacy) tx.objectStore("orders").put({ ...order, key: `${outletId}:${order.id}`, outletId } satisfies StoredOrder);
  tx.objectStore("meta").put({ key: marker, importedAt: Date.now() });
  await transactionDone(tx);
  if (legacy.length) {
    try { localStorage.removeItem(legacyKey); }
    catch { /* IndexedDB has the imported copy; keep the legacy copy if browser storage is restricted. */ }
  }
}

function toOfflinePosOrder(value: StoredOrder): OfflinePosOrder {
  return {
    id: value.id,
    createdAt: value.createdAt,
    staffUserId: value.staffUserId,
    current: value.current,
    guestName: value.guestName,
    partySize: value.partySize,
    lines: value.lines,
    ...(value.quote ? { quote: value.quote } : {}),
    ...(value.error ? { error: value.error } : {}),
    ...(value.retryCount !== undefined ? { retryCount: value.retryCount } : {}),
    ...(value.nextRetryAt !== undefined ? { nextRetryAt: value.nextRetryAt } : {}),
  };
}

function transactionDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save POS data."));
    tx.onabort = () => reject(tx.error ?? new Error("POS save was interrupted."));
  });
}
