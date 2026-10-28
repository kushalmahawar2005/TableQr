import type { AnyDraftLine } from "@/server/guest/order";
import type { PosTerminal } from "@/server/staff/pos-terminal";
import type { PosBillDetail } from "@/server/staff/pos-read";
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

export type OfflinePosCashCollection = {
  /** Also sent as the stable idempotency key when the server settles the bill. */
  id: string;
  createdAt: number;
  staffUserId: string;
  sessionId: string;
  billId: string;
  tableCode: string;
  expectedDuePaise: number;
  receivedPaise: number;
  error?: string;
  retryCount?: number;
  nextRetryAt?: number;
};

export type OfflinePosBillSnapshot = {
  sessionId: string;
  status: PosBillDetail["status"];
  lines: PosBillDetail["lines"];
  bill: { id: string; status: string; totalPaise: number } | null;
  shares: Array<{ amountPaise: number; paidPaise: number }>;
  payments: Array<{ status: string; channel: string }>;
};

type StoredOrder = OfflinePosOrder & { key: string; outletId: string };

// Persisted identity stays stable through the display-name change so unsynced KOTs are never orphaned.
const DB_NAME = "tableqr-pos-offline-v1";
const DB_VERSION = 7;
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
      if (!db.objectStoreNames.contains("billSnapshots")) {
        const billSnapshots = db.createObjectStore("billSnapshots", { keyPath: "key" });
        billSnapshots.createIndex("outletId", "outletId", { unique: false });
      }
      if (!db.objectStoreNames.contains("orders")) {
        const orders = db.createObjectStore("orders", { keyPath: "key" });
        orders.createIndex("outletId", "outletId", { unique: false });
      }
      if (!db.objectStoreNames.contains("cashCollections")) {
        const cash = db.createObjectStore("cashCollections", { keyPath: "key" });
        cash.createIndex("outletId", "outletId", { unique: false });
        cash.createIndex("outletSession", ["outletId", "sessionId"], { unique: true });
      } else {
        const cash = request.transaction!.objectStore("cashCollections");
        if (!cash.indexNames.contains("outletSession")) cash.createIndex("outletSession", ["outletId", "sessionId"], { unique: true });
      }
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("locks")) db.createObjectStore("locks", { keyPath: "key" });
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
  const tx = db.transaction(["snapshots", "drafts", "billSnapshots", "meta"], "readwrite");
  const meta = tx.objectStore("meta");
  const previous = meta.get("last-pos-outlet");
  previous.onsuccess = () => {
    if (typeof previous.result?.outletId === "string") {
      tx.objectStore("snapshots").delete(previous.result.outletId);
      tx.objectStore("drafts").delete(previous.result.outletId);
      const bills = tx.objectStore("billSnapshots").index("outletId").openKeyCursor(previous.result.outletId);
      bills.onsuccess = () => { if (bills.result) { bills.result.delete(); bills.result.continue(); } };
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

export async function checkOfflinePosStorage() {
  if (typeof navigator === "undefined" || !navigator.storage) return { supported: false, persistent: false, usage: null, quota: null };
  try {
    let persistent = await navigator.storage.persisted();
    if (!persistent && navigator.storage.persist) persistent = await navigator.storage.persist();
    const { usage, quota } = await navigator.storage.estimate();
    return { supported: true, persistent, usage: usage ?? null, quota: quota ?? null };
  } catch {
    return { supported: true, persistent: false, usage: null, quota: null };
  }
}

export async function saveOfflinePosBillSnapshot(outletId: string, staffUserId: string, sessionExpiresAt: number, detail: PosBillDetail, savedAt = Date.now()) {
  const db = await openDatabase();
  const snapshot: OfflinePosBillSnapshot = {
    sessionId: detail.sessionId,
    status: detail.status,
    lines: detail.lines,
    bill: detail.bill ? { id: detail.bill.id, status: detail.bill.status, totalPaise: detail.bill.totalPaise } : null,
    shares: detail.shares.map(({ amountPaise, paidPaise }) => ({ amountPaise, paidPaise })),
    payments: detail.payments.map(({ status, channel }) => ({ status, channel })),
  };
  const tx = db.transaction("billSnapshots", "readwrite");
  tx.objectStore("billSnapshots").put({ key: `${outletId}:${detail.sessionId}`, outletId, staffUserId, sessionExpiresAt, savedAt, snapshot });
  await transactionDone(tx);
}

export async function loadOfflinePosBillSnapshot(outletId: string, sessionId: string, staffUserId: string, now = Date.now()): Promise<{ savedAt: number; snapshot: OfflinePosBillSnapshot } | null> {
  const db = await openDatabase();
  const record = await read(db.transaction("billSnapshots", "readonly").objectStore("billSnapshots").get(`${outletId}:${sessionId}`) as IDBRequest<{ staffUserId: string; sessionExpiresAt: number; savedAt: number; snapshot: OfflinePosBillSnapshot } | undefined>);
  return record && record.staffUserId === staffUserId && record.sessionExpiresAt > now ? { savedAt: record.savedAt, snapshot: record.snapshot } : null;
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
  const cashCollections = await readOfflinePosCashCollections(outletId);
  return JSON.stringify({
    format: "tableeqr-pos-offline-recovery",
    version: 2,
    outletId,
    exportedAt: new Date().toISOString(),
    orderCount: orders.length,
    cashCollectionCount: cashCollections.length,
    orders,
    cashCollections,
  }, null, 2);
}

/** Import only a matching outlet's recovery file, preserving existing requests and rejecting ID collisions. */
export async function importOfflinePosRecoveryFile(outletId: string, raw: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("This recovery file is not valid JSON."); }
  if (!parsed || typeof parsed !== "object") throw new Error("This is not a Tableeqr POS recovery file.");
  const file = parsed as { format?: unknown; version?: unknown; outletId?: unknown; orders?: unknown; cashCollections?: unknown };
  if (file.format !== "tableeqr-pos-offline-recovery" || ![1, 2].includes(file.version as number) || file.outletId !== outletId || !Array.isArray(file.orders) || (file.version === 2 && !Array.isArray(file.cashCollections))) {
    throw new Error("This recovery file belongs to a different outlet or uses an unsupported format.");
  }
  if (file.orders.length > 5000) throw new Error("This recovery file contains too many orders to restore safely.");
  const orders = file.orders.map(validateRecoveryOrder);
  if (new Set(orders.map((order) => order.id)).size !== orders.length) throw new Error("This recovery file contains duplicate request IDs.");
  const cashCollections = file.version === 2 ? (file.cashCollections as unknown[]).map(validateRecoveryCashCollection) : [];
  if (new Set(cashCollections.map((cash) => cash.id)).size !== cashCollections.length) throw new Error("This recovery file contains duplicate cash record IDs.");

  const db = await openDatabase();
  const tx = db.transaction(["orders", "cashCollections", "meta"], "readwrite");
  const store = tx.objectStore("orders");
  const cashStore = tx.objectStore("cashCollections");
  const metaStore = tx.objectStore("meta");
  let imported = 0, importedCash = 0, collision: string | null = null;
  const checks = orders.length + cashCollections.length * 3;
  let checked = 0;
  const currentOrders = new Map<string, StoredOrder | undefined>();
  const currentCash = new Map<string, (OfflinePosCashCollection & { key: string; outletId: string }) | undefined>();
  const cashBySession = new Map<string, (OfflinePosCashCollection & { key: string; outletId: string }) | undefined>();
  const alreadySettled = new Set<string>();
  const checkedOne = () => { checked++; applyImport(); };
  const applyImport = () => {
    if (checked !== checks) return;
    for (const candidate of orders) {
      const current = currentOrders.get(candidate.id);
      if (current && stableJson(toOfflinePosOrder(current)) !== stableJson(candidate)) collision = candidate.id;
    }
    for (const candidate of cashCollections) {
      const current = currentCash.get(candidate.id);
      const sessionRecord = cashBySession.get(candidate.sessionId);
      if (alreadySettled.has(candidate.sessionId) || sessionRecord && sessionRecord.id !== candidate.id || current && stableJson(toOfflinePosCashCollection(current)) !== stableJson(candidate)) collision = candidate.id;
    }
    if (collision) return;
    for (const candidate of orders) if (!currentOrders.get(candidate.id)) {
      store.put({ ...candidate, key: `${outletId}:${candidate.id}`, outletId } satisfies StoredOrder);
      imported++;
    }
    for (const candidate of cashCollections) if (!currentCash.get(candidate.id)) {
      cashStore.put({ ...candidate, key: `${outletId}:${candidate.id}`, outletId });
      importedCash++;
    }
  };
  for (const order of orders) {
    const get = store.get(`${outletId}:${order.id}`) as IDBRequest<StoredOrder | undefined>;
    get.onsuccess = () => { currentOrders.set(order.id, get.result); checkedOne(); };
  }
  for (const cash of cashCollections) {
    const get = cashStore.get(`${outletId}:${cash.id}`) as IDBRequest<(OfflinePosCashCollection & { key: string; outletId: string }) | undefined>;
    const bySession = cashStore.index("outletSession").get([outletId, cash.sessionId]) as IDBRequest<(OfflinePosCashCollection & { key: string; outletId: string }) | undefined>;
    const settled = metaStore.get(`cash-settled:${outletId}:${cash.sessionId}`) as IDBRequest<{ key: string } | undefined>;
    get.onsuccess = () => { currentCash.set(cash.id, get.result); checkedOne(); };
    bySession.onsuccess = () => { cashBySession.set(cash.sessionId, bySession.result); checkedOne(); };
    settled.onsuccess = () => { if (settled.result) alreadySettled.add(cash.sessionId); checkedOne(); };
  }
  try { await transactionDone(tx); }
  catch (error) {
    if (error instanceof DOMException && error.name === "ConstraintError") throw new Error("This recovery file contains another cash record for a bill already saved on this device.");
    throw error;
  }
  if (collision) throw new Error(`Request ID ${collision} already exists here with different order details. Nothing from this file was imported.`);
  return { imported, importedCash, total: orders.length, totalCash: cashCollections.length };
}

export async function readOfflinePosCashCollections(outletId: string): Promise<OfflinePosCashCollection[]> {
  const db = await openDatabase();
  const values = await read(db.transaction("cashCollections", "readonly").objectStore("cashCollections").index("outletId").getAll(outletId) as IDBRequest<(OfflinePosCashCollection & { key: string; outletId: string })[]>);
  return values.sort((a, b) => a.createdAt - b.createdAt).map(toOfflinePosCashCollection);
}

export async function writeOfflinePosCashCollection(outletId: string, cash: OfflinePosCashCollection) {
  const db = await openDatabase();
  const tx = db.transaction(["cashCollections", "meta"], "readwrite");
  const store = tx.objectStore("cashCollections");
  const bySession = store.index("outletSession").get([outletId, cash.sessionId]);
  const settled = tx.objectStore("meta").get(`cash-settled:${outletId}:${cash.sessionId}`);
  let reason: Error | null = null;
  const complete = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(reason ?? tx.error ?? new Error("Could not save POS cash data."));
    tx.onabort = () => reject(reason ?? tx.error ?? new Error("POS cash save was interrupted."));
  });
  let reads = 0;
  const afterRead = () => {
    if (++reads !== 2) return;
    if (settled.result || bySession.result && bySession.result.id !== cash.id) {
      reason = new Error("Cash is already recorded locally or reconciled for this bill.");
      return;
    }
    store.put({ ...cash, key: `${outletId}:${cash.id}`, outletId });
  };
  bySession.onsuccess = afterRead;
  settled.onsuccess = afterRead;
  await complete;
  if (reason) throw reason;
}

/** Keeps a same-device guard after sync so another stale POS tab cannot collect the same bill twice. */
export async function markOfflinePosBillSettled(outletId: string, sessionId: string, requestId: string) {
  const db = await openDatabase();
  const tx = db.transaction(["cashCollections", "meta"], "readwrite");
  tx.objectStore("cashCollections").delete(`${outletId}:${requestId}`);
  tx.objectStore("meta").put({ key: `cash-settled:${outletId}:${sessionId}`, settledAt: Date.now() });
  await transactionDone(tx);
}

export async function removeOfflinePosCashCollection(outletId: string, id: string) {
  const db = await openDatabase();
  const tx = db.transaction("cashCollections", "readwrite");
  tx.objectStore("cashCollections").delete(`${outletId}:${id}`);
  await transactionDone(tx);
}

function validateRecoveryOrder(value: unknown): OfflinePosOrder {
  if (!value || typeof value !== "object") throw new Error("The recovery file contains an invalid order.");
  const order = value as Partial<OfflinePosOrder>;
  if (typeof order.id !== "string" || !/^[a-zA-Z0-9_-]{8,64}$/.test(order.id)
    || !Number.isSafeInteger(order.createdAt) || typeof order.staffUserId !== "string" || !order.staffUserId
    || !order.current || typeof order.current !== "object" || typeof order.current.code !== "string"
    || !(order.current.sessionId === null || typeof order.current.sessionId === "string")
    || !(order.current.tableId === null || typeof order.current.tableId === "string")
    || typeof order.current.takeaway !== "boolean" || !Number.isSafeInteger(order.current.seats) || order.current.seats < 1 || order.current.seats > 200
    || typeof order.guestName !== "string" || order.guestName.length > 120 || typeof order.partySize !== "number" || !Number.isSafeInteger(order.partySize) || order.partySize < 1 || order.partySize > 200
    || !Array.isArray(order.lines) || order.lines.length < 1 || order.lines.length > 100) {
    throw new Error("The recovery file contains an invalid order.");
  }
  if (order.quote !== undefined && (!order.quote || typeof order.quote !== "object" || Object.values(order.quote).some((price) => !Number.isSafeInteger(price) || price < 0))) throw new Error("The recovery file contains an invalid saved price quote.");
  if (order.retryCount !== undefined && (!Number.isSafeInteger(order.retryCount) || order.retryCount < 0) || order.nextRetryAt !== undefined && !Number.isSafeInteger(order.nextRetryAt) || order.error !== undefined && (typeof order.error !== "string" || order.error.length > 1000)) throw new Error("The recovery file contains invalid retry information.");
  for (const line of order.lines) {
    if (!line || typeof line !== "object" || !Number.isSafeInteger(line.qty) || line.qty < 1 || line.qty > 99 || line.note !== undefined && (typeof line.note !== "string" || line.note.length > 140) || line.personalForPickup !== undefined && typeof line.personalForPickup !== "boolean") throw new Error("The recovery file contains an invalid order line.");
    if ("itemId" in line) {
      if (typeof line.itemId !== "string" || !Array.isArray(line.modifierIds) || line.modifierIds.length > 20 || line.modifierIds.some((id) => typeof id !== "string")) throw new Error("The recovery file contains an invalid menu item.");
    } else if (!line.open || typeof line.open.name !== "string" || !line.open.name.trim() || line.open.name.length > 120 || !Number.isSafeInteger(line.open.pricePaise) || line.open.pricePaise < 1 || !Number.isSafeInteger(line.open.taxRateBp) || line.open.taxRateBp < 0 || line.open.taxRateBp > 10000 || typeof line.open.station !== "string" || !line.open.station.trim()) {
      throw new Error("The recovery file contains an invalid open item.");
    }
  }
  return order as OfflinePosOrder;
}

function validateRecoveryCashCollection(value: unknown): OfflinePosCashCollection {
  if (!value || typeof value !== "object") throw new Error("The recovery file contains an invalid cash record.");
  const cash = value as Partial<OfflinePosCashCollection>;
  if (typeof cash.id !== "string" || !/^[a-zA-Z0-9_-]{8,64}$/.test(cash.id) || !Number.isSafeInteger(cash.createdAt)
    || typeof cash.staffUserId !== "string" || !cash.staffUserId || typeof cash.sessionId !== "string" || !cash.sessionId
    || typeof cash.billId !== "string" || !cash.billId || typeof cash.tableCode !== "string"
    || !Number.isSafeInteger(cash.expectedDuePaise) || cash.expectedDuePaise! <= 0
    || !Number.isSafeInteger(cash.receivedPaise) || cash.receivedPaise! < cash.expectedDuePaise!
    || cash.error !== undefined && (typeof cash.error !== "string" || cash.error.length > 1000)
    || cash.retryCount !== undefined && (!Number.isSafeInteger(cash.retryCount) || cash.retryCount < 0)
    || cash.nextRetryAt !== undefined && !Number.isSafeInteger(cash.nextRetryAt)) throw new Error("The recovery file contains an invalid cash record.");
  return cash as OfflinePosCashCollection;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

const SYNC_LOCK_MS = 30_000;
const SYNC_LOCK_HEARTBEAT_MS = 10_000;

/** IndexedDB's read/write transaction makes this lease exclusive across same-origin POS tabs. */
export async function withOfflinePosSyncLock<T>(outletId: string, work: () => Promise<T>): Promise<{ acquired: boolean; result?: T }> {
  const db = await openDatabase();
  const owner = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const key = `sync:${outletId}`;
  const claim = async (renew: boolean) => {
    const tx = db.transaction("locks", "readwrite");
    const store = tx.objectStore("locks");
    const request = store.get(key) as IDBRequest<{ key: string; owner: string; expiresAt: number } | undefined>;
    let acquired = false;
    request.onsuccess = () => {
      const current = request.result;
      if (renew ? current?.owner === owner : !current || current.expiresAt <= Date.now()) {
        store.put({ key, owner, expiresAt: Date.now() + SYNC_LOCK_MS });
        acquired = true;
      }
    };
    await transactionDone(tx);
    return acquired;
  };
  if (!await claim(false)) return { acquired: false };
  const heartbeat = globalThis.setInterval(() => { void claim(true).catch(() => {}); }, SYNC_LOCK_HEARTBEAT_MS);
  try { return { acquired: true, result: await work() }; }
  finally {
    globalThis.clearInterval(heartbeat);
    const tx = db.transaction("locks", "readwrite");
    const store = tx.objectStore("locks");
    const request = store.get(key) as IDBRequest<{ key: string; owner: string } | undefined>;
    request.onsuccess = () => { if (request.result?.owner === owner) store.delete(key); };
    await transactionDone(tx);
  }
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

function toOfflinePosCashCollection(value: OfflinePosCashCollection & { key: string; outletId: string }): OfflinePosCashCollection {
  return {
    id: value.id, createdAt: value.createdAt, staffUserId: value.staffUserId,
    sessionId: value.sessionId, billId: value.billId, tableCode: value.tableCode,
    expectedDuePaise: value.expectedDuePaise, receivedPaise: value.receivedPaise,
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
