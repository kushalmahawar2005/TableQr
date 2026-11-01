"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileUp, Loader2, Minus, Package, PenLine, Plus, ReceiptText, Search, Send, ShoppingBag, Trash2, Users, WifiOff } from "lucide-react";
import { placeLabel } from "@/domain/delivery";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OPEN_TAX_RATES } from "@/domain/gst";
import { menuThumb } from "@/domain/menu-photo";
import { priceLine, quoteKey, type PriceQuote } from "@/domain/pricing";
import { connectRealtime } from "@/lib/realtime-client";
import { usePrint } from "@/components/print/print-provider";
import { offlinePosKotHtml } from "@/lib/pos-offline-kot";
import { PosPayPanel } from "./pos-pay-panel";
import type { AnyDraftLine } from "@/server/guest/order";
import type { PosBillDetail } from "@/server/staff/pos-read";
import type { PosTerminal } from "@/server/staff/pos-terminal";
import { buildOfflinePosRecoveryFile, checkOfflinePosStorage, importOfflinePosRecoveryFile, loadOfflinePosBillSnapshot, loadPosDraft, queueOfflinePosOrder, readOfflinePosCashCollections, readOfflinePosOrders, saveOfflinePosBillSnapshot, savePosDraft, savePosSnapshot, writeOfflinePosCashCollection, writeOfflinePosOrder, type OfflinePosBillSnapshot, type OfflinePosCashCollection, type OfflinePosOrder } from "@/lib/pos-offline-queue";
import { syncSavedPosOrders } from "@/lib/pos-offline-sync";
import { syncSavedPosCashCollections } from "@/lib/pos-offline-cash-sync";
import { approveOfflineOrderAction, billAction, newTakeawayAction, openTableAction, orderAction, recoverOfflineOrderVisitAction, sendOrderAction, settleOfflineCashAction, terminalAction, tokenAction } from "../actions";

// POS terminal, the way a counter bills: the table view first, then dishes by category with the
// order on the right. New lines stay on this screen until they are sent to the kitchen (KOT);
// the bill is paid right here in the order panel; splits and changes stay on the Billing screen.

type Dish = PosTerminal["menu"][number];
type Table = PosTerminal["tables"][number];
type Line =
  | { key: string; kind: "menu"; dish: Dish; qty: number; mods: string[]; note: string; parcel: boolean }
  | { key: string; kind: "open"; name: string; pricePaise: number; station: string; taxRateBp: number; qty: number; note: string; parcel: boolean };
/** What the cashier is billing: a table or a takeaway, opened on the server once the first KOT goes */
type Current = { sessionId: string | null; tableId: string | null; code: string; takeaway: boolean; seats: number };
type CachedBillDetail = PosBillDetail | OfflinePosBillSnapshot;
type PersistedDraft = { current: Current | null; detail: CachedBillDetail | null; cart: Line[]; guestName: string; partySize: number; requestId: string | null; requestFingerprint: string | null };
const hasPriceChanges = (cart: Line[], menu: Dish[]) => cart.some((line) => {
  if (line.kind !== "menu") return false;
  const fresh = menu.find((item) => item.id === line.dish.id);
  if (!fresh || !fresh.pricing.isAvailable) return true;
  const oldPrice = priceLine(line.dish.pricing, line.qty, line.mods);
  const newPrice = priceLine(fresh.pricing, line.qty, line.mods);
  return !oldPrice.ok || !newPrice.ok || oldPrice.line.linePaise !== newPrice.line.linePaise;
});
const quoteForCart = (cart: Line[]): PriceQuote | null => {
  const quote: PriceQuote = {};
  for (const line of cart) {
    if (line.kind !== "menu") continue;
    const priced = priceLine(line.dish.pricing, line.qty, line.mods);
    if (!priced.ok) return null;
    quote[quoteKey(line.dish.id, line.mods)] = priced.line.unitPricePaise;
  }
  return quote;
};
const queuedQuoteChanges = (order: OfflinePosOrder, menu: Dish[]) => order.lines.flatMap((line) => {
  if (!("itemId" in line)) return [];
  const dish = menu.find((item) => item.id === line.itemId);
  const priced = dish ? priceLine(dish.pricing, line.qty, line.modifierIds) : null;
  const next = priced?.ok ? priced.line.unitPricePaise : null;
  const key = quoteKey(line.itemId, line.modifierIds);
  const previous = order.quote?.[key];
  if (next === null || previous === undefined || previous !== next) {
    return [{ name: dish?.name ?? line.itemId, previous, next }];
  }
  return [];
});

const rs = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const field = `h-11 w-full rounded-xl border border-line bg-surface px-3 text-body text-ink placeholder:text-muted ${focus}`;
const primary = `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-forest px-4 text-button font-semibold text-white disabled:opacity-50 ${focus}`;
const quiet = `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-button font-semibold text-ink hover:bg-accent disabled:opacity-50 ${focus}`;
const chip = (on: boolean) => `inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-caption font-semibold ${on ? "border-forest bg-forest text-white" : "border-line bg-surface text-muted hover:text-ink"} ${focus}`;
const DEAD = ["cancelled", "voided"];
/** How long a table has been open: "45 min", "2 h 10 min", "3 days" */
const since = (from: number, now: number, L: (en: string, h: string) => string) => {
  const m = Math.max(0, Math.floor((now - from) / 60_000));
  if (m < 60) return `${m} ${L("min", "मिनट")}`;
  if (m < 24 * 60) return `${Math.floor(m / 60)} ${L("h", "घं")}${m % 60 ? ` ${m % 60} ${L("min", "मि")}` : ""}`;
  const d = Math.floor(m / (24 * 60));
  return `${d} ${L(d === 1 ? "day" : "days", "दिन")}`;
};
/** Photos on the dish tiles, remembered on this device (a busy counter may prefer the compact grid) */
const photoPref = (() => {
  const KEY = "tq_pos_photos";
  const listeners = new Set<() => void>();
  return {
    get: () => { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } },
    set: (on: boolean) => { try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private window: this visit only */ } listeners.forEach((l) => l()); },
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
  };
})();

export function PosTerminalScreen({ initial, outletId, staffUserId, canReviewOfflineOrders = false, sessionExpiresAt, hi, realtimeUrl, initialSavedAt, initialIsServerFresh, startOffline = false }: { initial: PosTerminal; outletId: string; staffUserId: string; canReviewOfflineOrders?: boolean; sessionExpiresAt: number; hi: boolean; realtimeUrl: string | null; initialSavedAt: number; initialIsServerFresh: boolean; startOffline?: boolean }) {
  const router = useRouter();
  const printer = usePrint().manager;
  const L = useCallback((en: string, h: string) => (hi ? h : en), [hi]);
  const [data, setData] = useState(initial);
  const [current, setCurrent] = useState<Current | null>(null);
  const [detail, setDetail] = useState<CachedBillDetail | null>(null);
  const [cart, setCart] = useState<Line[]>([]);
  const [category, setCategory] = useState<string>("all");
  const [zone, setZone] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [guest, setGuest] = useState("");
  const [pax, setPax] = useState(2);
  const [choosing, setChoosing] = useState<{ dish: Dish; mods: string[]; qty: number } | null>(null);
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(startOffline);
  const [queuedCount, setQueuedCount] = useState(0);
  const [queuedOrders, setQueuedOrders] = useState<OfflinePosOrder[]>([]);
  const [cashCollections, setCashCollections] = useState<OfflinePosCashCollection[]>([]);
  const [cashDialogOpen, setCashDialogOpen] = useState(false);
  const [reviewOrder, setReviewOrder] = useState<OfflinePosOrder | null>(null);
  const [cashReceived, setCashReceived] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [storageNearlyFull, setStorageNearlyFull] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [paying, setPaying] = useState<PosBillDetail | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState(initialSavedAt);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const requestId = useRef<string | null>(null);
  const requestFingerprint = useRef<string | null>(null);
  const currentId = useRef<string | null>(null);
  const syncingQueue = useRef(false);
  const searchBox = useRef<HTMLInputElement>(null);
  const recoveryFile = useRef<HTMLInputElement>(null);
  const photos = useSyncExternalStore(photoPref.subscribe, photoPref.get, () => true);
  const togglePhotos = () => photoPref.set(!photos);

  useEffect(() => { currentId.current = current?.sessionId ?? null; }, [current]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOffline((wasOffline) => wasOffline || !navigator.onLine);
      void readOfflinePosOrders(outletId).then((orders) => { setQueuedOrders(orders); setQueuedCount(orders.length); }).catch(() => {
        setMessage({ tone: "bad", text: L("Offline order storage is unavailable on this device.", "इस डिवाइस पर ऑफ़लाइन ऑर्डर स्टोरेज उपलब्ध नहीं है।") });
      });
      void readOfflinePosCashCollections(outletId).then(setCashCollections).catch(() => {
        setMessage({ tone: "bad", text: L("Offline cash records could not be read on this device.", "इस डिवाइस पर ऑफ़लाइन नकद रिकॉर्ड नहीं पढ़े जा सके।") });
      });
      void loadPosDraft<PersistedDraft>(outletId).then((record) => {
        if (record) {
          setCurrent(record.draft.current);
          currentId.current = record.draft.current?.sessionId ?? null;
          setDetail(record.draft.detail);
          setCart(record.draft.cart);
          setGuest(record.draft.guestName);
          setPax(record.draft.partySize);
          requestId.current = record.draft.requestId;
          requestFingerprint.current = record.draft.requestFingerprint;
          if (initialIsServerFresh && hasPriceChanges(record.draft.cart, initial.menu)) {
            setMessage({ tone: "bad", text: L("The menu changed since this cart was saved. Review the new prices before sending.", "कार्ट सेव होने के बाद मेन्यू बदला है। भेजने से पहले नई कीमतें जाँचें।") });
          }
        }
        setDraftReady(true);
      }).catch(() => {
        setMessage({ tone: "bad", text: L("The saved POS draft could not be read. Your new changes may not survive a restart.", "सेव POS ड्राफ्ट नहीं पढ़ा जा सका। नए बदलाव रीस्टार्ट के बाद नहीं बच सकते।") });
        setDraftReady(true);
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [outletId, initialIsServerFresh, initial.menu, L]);
  useEffect(() => {
    if (!initialIsServerFresh) return;
    void savePosSnapshot(outletId, data, sessionExpiresAt, staffUserId, hi, initialSavedAt).catch(() => {
      setMessage({ tone: "bad", text: L("Could not save the menu and tables for offline use.", "मेन्यू और टेबल ऑफ़लाइन उपयोग के लिए सेव नहीं हो सके।") });
    });
  }, [outletId, data, sessionExpiresAt, staffUserId, hi, initialSavedAt, initialIsServerFresh, L]);
  useEffect(() => {
    if (!draftReady) return;
    const draft: PersistedDraft | null = current ? { current, detail, cart, guestName: guest, partySize: pax, requestId: requestId.current, requestFingerprint: requestFingerprint.current } : null;
    void savePosDraft(outletId, draft).catch(() => {
      setMessage({ tone: "bad", text: L("The POS draft could not be saved on this device.", "POS ड्राफ्ट इस डिवाइस पर सेव नहीं हो सका।") });
    });
  }, [outletId, current, detail, cart, guest, pax, draftReady, L]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!draftReady) return;
    let live = true;
    void checkOfflinePosStorage().then((storage) => {
      if (!live) return;
      const nearlyFull = storage.quota && storage.usage !== null && storage.usage / storage.quota >= 0.9;
      setStorageNearlyFull(!!nearlyFull);
      if (nearlyFull) setStorageWarning(L(`This device is nearly out of storage (${Math.max(0, Math.floor((storage.quota! - storage.usage!) / (1024 * 1024)))} MB left). Download a recovery copy and free space.`, `इस डिवाइस की स्टोरेज लगभग भर गई है (${Math.max(0, Math.floor((storage.quota! - storage.usage!) / (1024 * 1024)))} MB बची है)। रिकवरी कॉपी डाउनलोड करके जगह खाली करें।`));
      else if (!storage.supported || !storage.persistent) setStorageWarning(L("The browser may clear saved offline data. Keep a recovery copy on another device.", "ब्राउज़र सेव ऑफ़लाइन डेटा हटा सकता है। रिकवरी कॉपी किसी दूसरी जगह सुरक्षित रखें।"));
      else setStorageWarning(null);
    });
    return () => { live = false; };
  }, [draftReady, L]);
  const cacheBillDetail = useCallback(async (billDetail: PosBillDetail) => {
    setDetail(billDetail);
    try { await saveOfflinePosBillSnapshot(outletId, staffUserId, sessionExpiresAt, billDetail); }
    catch { setMessage({ tone: "bad", text: L("The bill summary could not be saved for offline cash review.", "बिल का सार ऑफ़लाइन नकद जाँच के लिए सेव नहीं हो सका।") }); }
  }, [outletId, staffUserId, sessionExpiresAt, L]);

  const refresh = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      const r = await terminalAction();
      if (!r.ok) return;
      const syncedAt = Date.now();
      setData(r.data);
      setLastSyncedAt(syncedAt);
      setOffline(false);
      void savePosSnapshot(outletId, r.data, sessionExpiresAt, staffUserId, hi, syncedAt).catch(() => {
        setMessage({ tone: "bad", text: L("POS data refreshed but could not be saved for offline use.", "POS डेटा अपडेट हुआ लेकिन ऑफ़लाइन उपयोग के लिए सेव नहीं हो सका।") });
      });
      if (currentId.current) { const d = await orderAction(currentId.current); if (d.ok) await cacheBillDetail(d.data); }
    } catch { setOffline(true); }
  }, [outletId, sessionExpiresAt, staffUserId, hi, L, cacheBillDetail]);

  const syncOfflineCash = useCallback(async (force = false) => {
    if (!navigator.onLine) return;
    const result = await syncSavedPosCashCollections({
      outletId, staffUserId, force,
      deliver: async (cash) => {
        const settled = await settleOfflineCashAction({ sessionId: cash.sessionId, clientRequestId: cash.id, receivedPaise: cash.receivedPaise, expectedDuePaise: cash.expectedDuePaise });
        if (!settled.ok) throw new Error(settled.error);
      },
    });
    const records = await readOfflinePosCashCollections(outletId);
    setCashCollections(records);
    if (result.blocked) setMessage({ tone: "bad", text: L(`Offline cash record needs review: ${result.blocked.error}`, `ऑफ़लाइन नकद रिकॉर्ड जाँचें: ${result.blocked.error}`) });
    else if (result.synced) {
      setMessage({ tone: "ok", text: L("Offline cash is now recorded in the server bill. The official receipt is ready online.", "ऑफ़लाइन नकद अब सर्वर बिल में दर्ज है। आधिकारिक रसीद ऑनलाइन उपलब्ध है।") });
      await refresh();
    }
  }, [outletId, staffUserId, L, refresh]);

  const syncOfflineOrders = useCallback(async (force = false) => {
    if (!navigator.onLine || syncingQueue.current) return;
    syncingQueue.current = true;
    try {
      const result = await syncSavedPosOrders({
        outletId,
        force,
        deliver: async (saved, checkpoint) => {
          let order = saved;
          const managerApproved = order.managerApprovedByUserId === staffUserId;
          if (order.staffUserId !== staffUserId && !managerApproved) throw new Error(L("This saved order belongs to a different staff session. Ask a manager to review it.", "यह सेव ऑर्डर दूसरे स्टाफ़ सेशन का है। मैनेजर से जाँच करवाएँ।"));
          // A previous request may have reached the server even when its reply was lost. Ask the
          // idempotent endpoint first for an already-open session so a later menu change cannot
          // strand an order the kitchen has already received.
          if (order.current.sessionId) {
            const replay = await sendOrderAction({ sessionId: order.current.sessionId, clientRequestId: order.id, lines: order.lines, quote: order.quote ?? {}, guestName: order.guestName.trim() || null, ...(managerApproved ? { managerApprovedOfflineRequestId: order.id } : {}) });
            if (replay.ok) return;
            if (!/prices have changed/i.test(replay.error)) throw new Error(replay.error);
          }
          const hasMenuLines = order.lines.some((line) => "itemId" in line);
          if (hasMenuLines) {
            if (!order.quote) throw new Error(L("This saved order has no saved menu prices. Review the current prices before syncing it.", "इस सेव ऑर्डर की मेन्यू कीमतें सेव नहीं हैं। सिंक से पहले अभी की कीमतें जाँचें।"));
            const fresh = await terminalAction();
            if (!fresh.ok) throw new Error(fresh.error);
            setData(fresh.data);
            setOffline(false);
            const syncedAt = Date.now();
            setLastSyncedAt(syncedAt);
            void savePosSnapshot(outletId, fresh.data, sessionExpiresAt, staffUserId, hi, syncedAt).catch(() => {
              setMessage({ tone: "bad", text: L("Fresh POS data could not be saved for offline use.", "ताज़ा POS डेटा ऑफ़लाइन उपयोग के लिए सेव नहीं हुआ।") });
            });
            const changes = queuedQuoteChanges(order, fresh.data.menu);
            if (changes.length) {
              const names = changes.slice(0, 3).map((change) => change.name).join(", ");
              throw new Error(L(`Menu price or availability changed for ${names}. Review the saved order before syncing.`, `${names} की कीमत या उपलब्धता बदली है। सिंक से पहले सेव ऑर्डर जाँचें।`));
            }
          }
          if (!order.current.sessionId) {
            if (managerApproved) {
              const opened = await recoverOfflineOrderVisitAction({ requestId: order.id, current: order.current, guestName: order.guestName, partySize: order.partySize });
              if (!opened.ok) throw new Error(opened.error);
              order = { ...order, current: { ...order.current, sessionId: opened.data.sessionId, tableId: opened.data.tableId, code: opened.data.code } };
              await checkpoint(order);
            } else if (order.current.takeaway) {
              const opened = await newTakeawayAction(order.guestName.trim() || null, order.id);
              if (!opened.ok) throw new Error(opened.error);
              order = { ...order, current: { ...order.current, sessionId: opened.data.sessionId, tableId: opened.data.tableId, code: opened.data.code } };
            } else {
              const opened = await openTableAction({ tableId: order.current.tableId!, partySize: order.partySize, guestName: order.guestName.trim() || null, clientRequestId: order.id });
              if (!opened.ok) throw new Error(opened.error);
              order = { ...order, current: { ...order.current, sessionId: opened.data.sessionId } };
            }
            await checkpoint(order);
          }
          const sent = await sendOrderAction({ sessionId: order.current.sessionId!, clientRequestId: order.id, lines: order.lines, quote: order.quote ?? {}, guestName: order.guestName.trim() || null, ...(managerApproved ? { managerApprovedOfflineRequestId: order.id } : {}) });
          if (!sent.ok) throw new Error(sent.error);
        },
      });
      if (result.blocked) {
        setMessage({ tone: "bad", text: L(`A saved order needs attention: ${result.blocked.error}`, `सेव किए ऑर्डर पर ध्यान दें: ${result.blocked.error}`) });
      } else if (result.synced > 0) {
        setMessage({ tone: "ok", text: L("Offline KOTs synced to the server.", "ऑफ़लाइन KOT सर्वर पर सिंक हुए।") });
      }
      await syncOfflineCash(force);
    } catch {
      setMessage({ tone: "bad", text: L("Saved orders could not be synced. They remain on this device; retry or download a recovery copy.", "सेव ऑर्डर सिंक नहीं हुए। वे इस डिवाइस पर हैं; फिर कोशिश करें या रिकवरी कॉपी डाउनलोड करें।") });
    } finally {
      try { const saved = await readOfflinePosOrders(outletId); setQueuedOrders(saved); setQueuedCount(saved.length); }
      catch { setMessage({ tone: "bad", text: L("Could not read saved offline orders on this device.", "इस डिवाइस पर सेव ऑफ़लाइन ऑर्डर पढ़े नहीं जा सके।") }); }
      finally { syncingQueue.current = false; }
    }
  }, [outletId, sessionExpiresAt, staffUserId, hi, L, syncOfflineCash]);

  const approveAndSyncOfflineOrder = useCallback(async (order: OfflinePosOrder) => {
    if (!canReviewOfflineOrders || !navigator.onLine) return;
    const approval = await approveOfflineOrderAction({ requestId: order.id, originalStaffUserId: order.staffUserId, current: order.current, partySize: order.partySize, lines: order.lines, quote: order.quote, guestName: order.guestName });
    if (!approval.ok) {
      setMessage({ tone: "bad", text: approval.error });
      return;
    }
    const approved = { ...order, managerApprovedByUserId: staffUserId, error: undefined, retryCount: 0, nextRetryAt: undefined };
    try {
      await writeOfflinePosOrder(outletId, approved);
      const saved = await readOfflinePosOrders(outletId);
      setQueuedOrders(saved);
      setQueuedCount(saved.length);
      setReviewOrder(null);
      setMessage({ tone: "ok", text: L("Manager approval recorded. Retrying this order with the same request ID; server checks will still apply.", "मैनेजर की मंज़ूरी दर्ज हुई। उसी request ID से ऑर्डर फिर भेज रहे हैं; सर्वर की जाँचें लागू रहेंगी।") });
      await syncOfflineOrders(true);
    } catch {
      setMessage({ tone: "bad", text: L("Approval was recorded, but this device could not update the saved order. Keep the recovery copy and try again.", "मंज़ूरी दर्ज हुई, लेकिन डिवाइस सेव ऑर्डर अपडेट नहीं कर सका। रिकवरी कॉपी सुरक्षित रखें और फिर कोशिश करें।") });
    }
  }, [canReviewOfflineOrders, outletId, staffUserId, L, syncOfflineOrders]);

  const printOfflineKitchenCopy = useCallback(async (order: OfflinePosOrder) => {
    const run = await printer.print({ kind: "kot", subject: { type: "offline_pos_order", id: order.id }, build: (paper) => offlinePosKotHtml(order, data.menu, paper) });
    setMessage({ tone: run.status === "failed" ? "bad" : "ok", text: run.status === "failed" ? run.message : L("Local kitchen copy opened in the print dialog. It is not a server KOT; hand it to the kitchen and confirm the paper printed.", "लोकल किचन कॉपी प्रिंट डायलॉग में खुली। यह सर्वर KOT नहीं है; इसे किचन तक पहुँचाएँ और प्रिंट हुआ है या नहीं जाँचें।") });
  }, [printer, data.menu, L]);

  const acceptCurrentMenuQuote = useCallback(async (order: OfflinePosOrder) => {
    if (!navigator.onLine) {
      setMessage({ tone: "bad", text: L("Reconnect before reviewing current menu prices.", "अभी की मेन्यू कीमतें जाँचने के लिए इंटरनेट जोड़ें।") });
      return;
    }
    const fresh = await terminalAction();
    if (!fresh.ok) {
      setMessage({ tone: "bad", text: fresh.error });
      return;
    }
    setData(fresh.data);
    const refreshedAt = Date.now();
    setLastSyncedAt(refreshedAt);
    setOffline(false);
    void savePosSnapshot(outletId, fresh.data, sessionExpiresAt, staffUserId, hi, refreshedAt).catch(() => {
      setMessage({ tone: "bad", text: L("Fresh POS data could not be saved for offline use.", "ताज़ा POS डेटा ऑफ़लाइन उपयोग के लिए सेव नहीं हुआ।") });
    });
    const quote: PriceQuote = {};
    for (const line of order.lines) {
      if (!("itemId" in line)) continue;
      const dish = fresh.data.menu.find((item) => item.id === line.itemId);
      const priced = dish ? priceLine(dish.pricing, line.qty, line.modifierIds) : null;
      if (!priced?.ok) {
        setMessage({ tone: "bad", text: L("This saved order contains a dish or option that is unavailable now. Ask a manager to resolve it before sending.", "इस सेव ऑर्डर की डिश या विकल्प अभी उपलब्ध नहीं है। भेजने से पहले मैनेजर से हल करवाएँ।") });
        return;
      }
      quote[quoteKey(line.itemId, line.modifierIds)] = priced.line.unitPricePaise;
    }
    const reviewed = { ...order, quote, managerApprovedByUserId: undefined, error: undefined, retryCount: 0, nextRetryAt: undefined };
    await writeOfflinePosOrder(outletId, reviewed);
    const saved = await readOfflinePosOrders(outletId);
    setQueuedOrders(saved);
    setQueuedCount(saved.length);
    setMessage({ tone: "ok", text: L("Current menu prices accepted for this saved order. Syncing it now.", "इस सेव ऑर्डर के लिए अभी की मेन्यू कीमतें स्वीकार हुईं। अब सिंक कर रहे हैं।") });
    await syncOfflineOrders(true);
  }, [outletId, sessionExpiresAt, staffUserId, hi, L, syncOfflineOrders]);

  const exportSavedOrders = async () => {
    try {
      const recoveryFile = await buildOfflinePosRecoveryFile(outletId);
      const blobUrl = URL.createObjectURL(new Blob([recoveryFile], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `tableeqr-pos-recovery-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      setMessage({ tone: "ok", text: L("Recovery copy downloaded. Saved orders remain on this device.", "रिकवरी कॉपी डाउनलोड हुई। सेव ऑर्डर इस डिवाइस पर बने रहेंगे।") });
    } catch {
      setMessage({ tone: "bad", text: L("Could not create a recovery copy. Keep this POS open and try again.", "रिकवरी कॉपी नहीं बनी। POS खुला रखें और फिर कोशिश करें।") });
    }
  };

  const importSavedOrders = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error(L("This recovery file is too large to import safely.", "यह रिकवरी फ़ाइल सुरक्षित रूप से इम्पोर्ट करने के लिए बहुत बड़ी है।"));
      const result = await importOfflinePosRecoveryFile(outletId, await file.text());
      const saved = await readOfflinePosOrders(outletId);
      setQueuedOrders(saved);
      setQueuedCount(saved.length);
      setCashCollections(await readOfflinePosCashCollections(outletId));
      setMessage({ tone: "ok", text: L(`${result.imported} saved KOT${result.imported === 1 ? "" : "s"} and ${result.importedCash} cash record${result.importedCash === 1 ? "" : "s"} restored. Existing work was kept.`, `${result.imported} सेव KOT और ${result.importedCash} नकद रिकॉर्ड वापस आए। पहले से मौजूद काम सुरक्षित रहा।`) });
    } catch (error) {
      setMessage({ tone: "bad", text: error instanceof Error ? error.message : L("This recovery copy could not be restored.", "यह रिकवरी कॉपी वापस नहीं लाई जा सकी।") });
    }
  };

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      setMessage({ tone: "bad", text: L("Offline app support could not be prepared on this browser.", "इस ब्राउज़र पर ऑफ़लाइन ऐप तैयार नहीं हो सका।") });
    });
  }, [L]);
  useEffect(() => {
    const stop = connectRealtime({ url: realtimeUrl, getToken: tokenAction, pollMs: 20000, onResync: () => void refresh(), onEvents: () => void refresh(), onStatus: (s) => setOffline(s === "offline") });
    const poll = setInterval(() => { void refresh(); if (navigator.onLine) void syncOfflineOrders(); }, 30000);
    const initialSync = window.setTimeout(() => { if (navigator.onLine) void syncOfflineOrders(); }, 0);
    const on = () => { setOffline(false); void syncOfflineOrders().then(() => refresh()); };
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { stop(); clearInterval(poll); window.clearTimeout(initialSync); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [realtimeUrl, refresh, syncOfflineOrders]);

  const fail = (text: string) => setMessage({ tone: "bad", text });
  const clearRequest = () => { requestId.current = null; requestFingerprint.current = null; };

  // ---- choosing what to bill
  const pickTable = async (t: Table) => {
    setMessage(null);
    clearRequest();
    setCart([]); setGuest(""); setQuery(""); setCategory("all");
    setPax(Math.min(2, t.seats));
    setCurrent({ sessionId: t.visit?.id ?? null, tableId: t.id, code: t.code, takeaway: false, seats: t.seats });
    setDetail(null);
    if (t.visit && navigator.onLine) {
      try { const d = await orderAction(t.visit.id); if (d.ok) await cacheBillDetail(d.data); else fail(d.error); }
      catch { setOffline(true); }
    } else if (t.visit) {
      const saved = await loadOfflinePosBillSnapshot(outletId, t.visit.id, staffUserId);
      if (saved) setDetail(saved.snapshot);
    }
    setTimeout(() => searchBox.current?.focus(), 50);
  };
  const pickTakeaway = async (t: PosTerminal["takeaways"][number] | null) => {
    setMessage(null);
    clearRequest();
    setCart([]); setGuest(t?.visit.guestName ?? ""); setQuery(""); setCategory("all");
    setCurrent({ sessionId: t?.visit.id ?? null, tableId: t?.tableId ?? null, code: t?.code ?? L("New takeaway", "नया पार्सल"), takeaway: true, seats: 1 });
    setDetail(null);
    if (t && navigator.onLine) {
      try { const d = await orderAction(t.visit.id); if (d.ok) await cacheBillDetail(d.data); else fail(d.error); }
      catch { setOffline(true); }
    } else if (t) {
      const saved = await loadOfflinePosBillSnapshot(outletId, t.visit.id, staffUserId);
      if (saved) setDetail(saved.snapshot);
    }
    setTimeout(() => searchBox.current?.focus(), 50);
  };
  const back = () => {
    if (cart.length && !window.confirm(L("Leave without sending these items to the kitchen?", "ये आइटम किचन भेजे बिना वापस जाएँ?"))) return;
    setCurrent(null); setDetail(null); setCart([]); setMessage(null);
    clearRequest();
    void refresh();
  };

  const closePay = () => {
    setPaying(null); setCurrent(null); setDetail(null); setMessage(null);
    void refresh();
  };

  // ---- the cart
  const linePrice = (l: Line) => {
    if (l.kind === "open") return l.pricePaise * l.qty;
    const r = priceLine(l.dish.pricing, l.qty, l.mods);
    return r.ok ? r.line.linePaise : 0;
  };
  const add = (dish: Dish) => {
    if (current?.sessionId && cashCollections.some((cash) => cash.sessionId === current.sessionId)) return fail(L("Cash is already saved locally for this bill. Wait for sync before adding more items.", "इस बिल का नकद इस डिवाइस पर सेव है। नए आइटम जोड़ने से पहले सिंक होने दें।"));
    if (!dish.pricing.isAvailable) return;
    if (dish.pricing.groups.some((g) => g.modifiers.length > 0)) { setChoosing({ dish, mods: [], qty: 1 }); return; }
    setCart((c) => {
      const same = c.find((l) => l.kind === "menu" && l.dish.id === dish.id && l.mods.length === 0 && !l.note && l.parcel === !!current?.takeaway);
      return same ? c.map((l) => (l === same ? { ...l, qty: Math.min(50, l.qty + 1) } : l)) : [...c, { key: `${dish.id}-${Date.now()}`, kind: "menu", dish, qty: 1, mods: [], note: "", parcel: !!current?.takeaway }];
    });
  };
  const change = (key: string, patch: Partial<{ qty: number; note: string; parcel: boolean }>) => setCart((c) => c.map((l) => (l.key === key ? ({ ...l, ...patch } as Line) : l)).filter((l) => l.qty > 0));

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.menu.filter((m) => (q ? `${m.name} ${m.nameHi ?? ""}`.toLowerCase().includes(q) : category === "all" || m.categoryId === category));
  }, [data.menu, query, category]);

  const sent = (detail?.lines ?? []).filter((l) => !DEAD.includes(l.status));
  const cachedVisit = current?.takeaway
    ? data.takeaways.find((takeaway) => takeaway.tableId === current.tableId)?.visit
    : data.tables.find((table) => table.id === current?.tableId)?.visit;
  const sentTotal = detail ? sent.reduce((n, l) => n + l.unitPricePaise * l.qty, 0) : cachedVisit?.orderedPaise ?? 0;
  const sentCount = detail ? sent.reduce((n, l) => n + l.qty, 0) : cachedVisit?.items ?? 0;
  const cartTotal = cart.reduce((n, l) => n + linePrice(l), 0);
  const cartCount = cart.reduce((n, l) => n + l.qty, 0);
  const priceReviewRequired = hasPriceChanges(cart, data.menu);
  const billAsked = detail?.status === "bill_requested";
  const offlineCashForCurrent = current?.sessionId ? cashCollections.find((cash) => cash.sessionId === current.sessionId) ?? null : null;
  const offlineCashDuePaise = detail?.bill ? detail.shares.reduce((sum, share) => sum + Math.max(0, share.amountPaise - share.paidPaise), 0) : 0;
  const currentHasQueuedKot = current ? queuedOrders.some((order) => order.current.sessionId === current.sessionId || (!order.current.sessionId && order.current.tableId === current.tableId)) : false;
  const hasPendingPayment = detail?.payments.some((payment) => payment.status === "initiated" || payment.status === "pending") ?? false;
  const canRecordOfflineCash = offline && !!current?.sessionId && !!detail?.bill && billAsked && detail.bill.status !== "paid" && detail.bill.status !== "cancelled" && offlineCashDuePaise > 0 && cart.length === 0 && !currentHasQueuedKot && !hasPendingPayment && !offlineCashForCurrent;
  const offlineSessionExpired = offline && now >= sessionExpiresAt;

  const handleRecordOfflineCash = async () => {
    if (!canRecordOfflineCash || !current?.sessionId || !detail?.bill) return;
    const receivedPaise = Math.round(Number(cashReceived) * 100);
    if (!Number.isSafeInteger(receivedPaise) || receivedPaise < offlineCashDuePaise) {
      setMessage({ tone: "bad", text: L("Cash received must cover the full outstanding bill.", "मिला नकद पूरे बाकी बिल से कम नहीं हो सकता।") });
      return;
    }
    try {
      const cash: OfflinePosCashCollection = {
        id: crypto.randomUUID(), createdAt: now, staffUserId,
        sessionId: current.sessionId, billId: detail.bill.id, tableCode: current.code,
        expectedDuePaise: offlineCashDuePaise, receivedPaise,
      };
      await writeOfflinePosCashCollection(outletId, cash);
      setCashCollections(await readOfflinePosCashCollections(outletId));
      setCashDialogOpen(false);
      setMessage({ tone: "ok", text: L("Provisional cash record saved on this device. The server bill and official receipt will update after reconnection.", "अस्थायी नकद रिकॉर्ड इस डिवाइस पर सेव हुआ। इंटरनेट लौटने पर सर्वर बिल और आधिकारिक रसीद अपडेट होगी।") });
    } catch {
      setMessage({ tone: "bad", text: L("Cash could not be safely saved on this device. Do not treat it as recorded.", "नकद इस डिवाइस पर सुरक्षित रूप से सेव नहीं हुआ। इसे दर्ज हुआ न मानें।") });
    }
  };

  // ---- sending
  const ensureSession = async (clientRequestId?: string): Promise<string | null> => {
    if (!current) return null;
    if (current.sessionId) return current.sessionId;
    let opened: Partial<Current> & { sessionId: string };
    if (current.takeaway) {
      const r = await newTakeawayAction(guest.trim() || null, clientRequestId);
      if (!r.ok) { fail(r.error); return null; }
      opened = { sessionId: r.data.sessionId, tableId: r.data.tableId, code: r.data.code };
    } else {
      const r = await openTableAction({ tableId: current.tableId!, partySize: pax, guestName: guest.trim() || null, clientRequestId });
      if (!r.ok) { fail(r.error); return null; }
      opened = { sessionId: r.data.sessionId };
    }
    setCurrent((c) => (c ? { ...c, ...opened } : c));
    currentId.current = opened.sessionId;
    return opened.sessionId;
  };
  const draft = (): AnyDraftLine[] => cart.map((l) => l.kind === "open"
    ? { open: { name: l.name, pricePaise: l.pricePaise, station: l.station, taxRateBp: l.taxRateBp }, qty: l.qty, note: l.note || undefined, personalForPickup: l.parcel }
    : { itemId: l.dish.id, qty: l.qty, modifierIds: l.mods, note: l.note || undefined, personalForPickup: l.parcel });
  const requestFor = (lines: AnyDraftLine[]) => {
    const fingerprint = JSON.stringify({ visit: current?.sessionId ?? current?.tableId ?? current?.code, lines });
    if (!requestId.current || requestFingerprint.current !== fingerprint) {
      requestId.current = crypto.randomUUID();
      requestFingerprint.current = fingerprint;
    }
    return { id: requestId.current, fingerprint };
  };

  const send = async (thenBill: boolean) => {
    if (busy || !current) return;
    if (offlineCashForCurrent) return fail(L("This bill already has a cash record waiting to sync. Do not add or collect more until it is reconciled.", "इस बिल का नकद रिकॉर्ड सिंक की प्रतीक्षा में है। मिलान होने तक और सामान या नकद न लें।"));
    if (priceReviewRequired) return fail(L("Review the updated menu price or remove unavailable items before sending this cart.", "कार्ट भेजने से पहले नई कीमत स्वीकारें या अनुपलब्ध आइटम हटाएँ।"));
    if (offline) {
      if (thenBill) return fail(L("Billing needs a connection. Save the KOT first, then bill when online.", "बिल के लिए कनेक्शन चाहिए। पहले KOT सेव करें, फिर ऑनलाइन बिल बनाएँ।"));
      if (!cart.length) return;
      const lines = draft();
      const quote = quoteForCart(cart);
      if (!quote) return fail(L("A dish option needs review before it can be saved.", "सेव करने से पहले डिश का विकल्प जाँचना होगा।"));
      const { id } = requestFor(lines);
      const order: OfflinePosOrder = { id, createdAt: Date.now(), staffUserId, current, guestName: guest, partySize: pax, lines, quote };
      try {
        await queueOfflinePosOrder(outletId, order);
        const saved = await readOfflinePosOrders(outletId);
        setQueuedOrders(saved);
        setQueuedCount(saved.length);
        clearRequest();
        setCart([]);
        setCurrent(null);
        setDetail(null);
        setMessage({ tone: "ok", text: L("Saved on this device. KOT will reach the kitchen when internet returns; it is not sent yet.", "इस डिवाइस पर सेव हुआ। इंटरनेट आने पर KOT किचन भेजा जाएगा; अभी नहीं पहुँचा है।") });
      } catch {
        fail(L("Could not save this order on the device. Keep this screen open and reconnect.", "ऑर्डर डिवाइस पर सेव नहीं हुआ। यह स्क्रीन खुली रखें और कनेक्शन वापस लाएँ।"));
      }
      return;
    }
    const missing = cart.find((l) => l.kind === "menu" && !priceLine(l.dish.pricing, l.qty, l.mods).ok);
    if (missing && missing.kind === "menu") return fail(`${missing.dish.name}: ${L("choose the required option", "ज़रूरी विकल्प चुनें")}`);
    setBusy(true); setMessage(null);
    const lines = cart.length ? draft() : [];
    const pending = lines.length ? requestFor(lines) : null;
    const quote = lines.length ? quoteForCart(cart) : undefined;
    if (lines.length && !quote) return fail(L("A dish option needs review before it can be sent.", "भेजने से पहले डिश का विकल्प जाँचना होगा।"));
    let activeSessionId = current.sessionId;
    try {
      if (pending) await savePosDraft(outletId, { current, detail, cart, guestName: guest, partySize: pax, requestId: pending.id, requestFingerprint: pending.fingerprint } satisfies PersistedDraft);
      const sessionId = await ensureSession(pending?.id);
      if (!sessionId) return;
      activeSessionId = sessionId;
      if (cart.length) {
        if (pending) await savePosDraft(outletId, { current: { ...current, sessionId }, detail, cart, guestName: guest, partySize: pax, requestId: pending.id, requestFingerprint: pending.fingerprint } satisfies PersistedDraft);
        const r = await sendOrderAction({ sessionId, clientRequestId: pending!.id, lines, quote: quote ?? undefined, guestName: guest.trim() || null });
        if (!r.ok) {
          if (r.error.toLowerCase().includes("price")) await refresh();
          return fail(r.error);
        }
        clearRequest();
        setCart([]);
      }
      if (thenBill) {
        const d = await orderAction(sessionId);
        if (d.ok && d.data.status !== "bill_requested") {
          const b = await billAction(sessionId);
          if (!b.ok) return fail(b.error);
        }
        const ready = await orderAction(sessionId);
        if (ready.ok && ready.data.bill) { setPaying(ready.data); setOrderOpen(true); }
        else router.push(`/console/billing?session=${encodeURIComponent(sessionId)}`);
        return;
      }
      setMessage({ tone: "ok", text: L(`KOT sent for ${current.takeaway ? "the takeaway" : current.code}.`, `${current.takeaway ? "पार्सल" : current.code} का KOT भेज दिया।`) });
      setCurrent(null); setDetail(null);
      await refresh();
    } catch {
      setOffline(true);
      if (pending && current && cart.length) {
        try {
          const queue = await readOfflinePosOrders(outletId);
          if (!queue.some((order) => order.id === pending.id)) await queueOfflinePosOrder(outletId, { id: pending.id, createdAt: Date.now(), staffUserId, current: { ...current, sessionId: activeSessionId }, guestName: guest, partySize: pax, lines, quote: quote ?? undefined });
          setQueuedCount(queue.length + (queue.some((order) => order.id === pending.id) ? 0 : 1));
          setQueuedOrders(await readOfflinePosOrders(outletId));
          clearRequest();
          setCart([]);
          setCurrent(null);
          setDetail(null);
          setMessage({ tone: "ok", text: L("Connection dropped. The order is saved here and will sync when internet returns.", "कनेक्शन टूट गया। ऑर्डर यहाँ सेव है और इंटरनेट आने पर सिंक होगा।") });
        } catch {
          fail(L("Connection lost and device saving failed. Keep this screen open and reconnect.", "कनेक्शन टूट गया और डिवाइस पर सेव नहीं हुआ। स्क्रीन खुली रखें और कनेक्शन वापस लाएँ।"));
        }
      } else fail(L("Connection lost. Your order is still on screen; reconnect and try again.", "कनेक्शन टूट गया। ऑर्डर स्क्रीन पर है; कनेक्शन आने पर फिर कोशिश करें।"));
    } finally { setBusy(false); }
  };

  const zones = data.zones;
  const tables = data.tables.filter((t) => zone === "all" || t.zoneId === zone);
  const running = data.tables.filter((t) => t.visit).length;
  if (!current && orderOpen) setOrderOpen(false);
  const savedTime = new Intl.DateTimeFormat(hi ? "hi-IN" : "en-IN", { dateStyle: "medium", timeStyle: "short" }).format(lastSyncedAt);

  if (!draftReady) return <main className="grid min-h-[60dvh] place-items-center px-5 text-body text-muted">{L("Restoring this device’s POS…", "इस डिवाइस का POS वापस खोला जा रहा है…")}</main>;
  if (offlineSessionExpired) return <main className="mx-auto grid min-h-[70dvh] max-w-lg place-content-center gap-3 px-5 text-center"><h1 className="font-display text-title font-bold text-ink">{L("Staff session expired", "स्टाफ़ सेशन समाप्त हो गया")}</h1><p className="text-body text-muted">{L("Reconnect to sign in again before using POS.", "POS इस्तेमाल करने से पहले इंटरनेट जोड़कर फिर साइन इन करें।")}</p></main>;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-6">
      {offline && <p role="status" className="mb-3 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-caption font-semibold text-warning"><WifiOff className="size-4" aria-hidden="true" /><span>{L(`Offline. New KOTs and eligible cash records stay on this device until sync; kitchen delivery and UPI/card confirmation need internet. Menu and tables last synced ${savedTime}.`, `ऑफ़लाइन। नए KOT और योग्य नकद रिकॉर्ड सिंक होने तक इस डिवाइस पर रहेंगे; किचन डिलीवरी और UPI/कार्ड पुष्टि के लिए इंटरनेट चाहिए। मेन्यू और टेबल आख़िरी बार ${savedTime} पर अपडेट हुए थे।`)}</span></p>}
      {storageWarning && storageNearlyFull && <p role="status" className="mb-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-caption font-semibold text-warning">{storageWarning}</p>}
      <input ref={recoveryFile} type="file" accept="application/json,.json" className="hidden" onChange={importSavedOrders} aria-label={L("Choose a POS recovery copy", "POS रिकवरी कॉपी चुनें")} />
      {queuedCount > 0 ? <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-caption font-semibold text-warning"><span>{L(`${queuedCount} KOT ${queuedCount === 1 ? "is" : "are"} saved here and waiting to sync.`, `${queuedCount} KOT यहाँ सेव ${queuedCount === 1 ? "है" : "हैं"} और सिंक होने की प्रतीक्षा में ${queuedCount === 1 ? "है" : "हैं"}।`)}</span><div className="flex flex-wrap gap-2"><button type="button" onClick={() => recoveryFile.current?.click()} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-warning/50 bg-surface px-3 text-ink"><FileUp className="size-4" aria-hidden="true" />{L("Restore copy", "कॉपी वापस लाएँ")}</button><button type="button" onClick={() => void exportSavedOrders()} className="min-h-9 rounded-lg border border-warning/50 bg-surface px-3 text-ink">{L("Download recovery copy", "रिकवरी कॉपी डाउनलोड करें")}</button></div></div> : null}
      {queuedOrders.map((order) => {
        const changes = queuedQuoteChanges(order, data.menu);
        const needsReview = changes.length > 0 || (!order.quote && order.lines.some((line) => "itemId" in line)) || /price|unavailable|available/i.test(order.error ?? "");
        const canAccept = changes.every((change) => change.next !== null);
        return <section key={order.id} className="mb-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-3 text-caption text-ink">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold">{L("Saved KOT", "सेव किया KOT")} · {order.current.code || L("New takeaway", "नया पार्सल")} · {order.lines.length} {L("lines", "आइटम")}</p>
              {order.staffUserId !== staffUserId && <p role="alert" className="mt-1 text-danger">{L("This KOT belongs to another staff login. Sign back into that account on this device to sync it; do not enter the order again. If that account is unavailable, download the recovery copy and ask the owner to review it.", "यह KOT दूसरे स्टाफ़ लॉगिन का है। सिंक करने के लिए उसी अकाउंट से इस डिवाइस पर लॉगिन करें; ऑर्डर दोबारा दर्ज न करें। अकाउंट उपलब्ध न हो तो रिकवरी कॉपी डाउनलोड करके मालिक से जाँच करवाएँ।")}</p>}
              {order.error && <p role="alert" className="mt-1 text-danger">{order.error}</p>}
              {order.retryCount ? <p className="mt-1 text-muted">{L(`Sync attempt ${order.retryCount}; automatic retry is scheduled.`, `सिंक की ${order.retryCount} कोशिशें हुईं; अपने-आप फिर प्रयास होगा।`)}</p> : null}
            {offline && <button type="button" className="mt-2 min-h-9 rounded-lg border border-line bg-surface px-3 font-semibold text-ink" onClick={() => void printOfflineKitchenCopy(order)}>{L("Print local kitchen copy", "लोकल किचन कॉपी प्रिंट करें")}</button>}
              {needsReview && <ul className="mt-2 space-y-1 text-warning">{changes.map((change, index) => <li key={`${change.name}:${index}`}>{change.name}: {change.previous === undefined ? L("old price not saved", "पुरानी कीमत सेव नहीं थी") : rs(change.previous)} → {change.next === null ? L("unavailable", "उपलब्ध नहीं") : rs(change.next)}</li>)}</ul>}
            </div>
            {needsReview && !offline && (canAccept
              ? <button type="button" className="min-h-9 rounded-lg bg-warning px-3 font-semibold text-ink" onClick={() => void acceptCurrentMenuQuote(order)}>{L("Accept current prices & retry", "अभी की कीमतें मानकर फिर भेजें")}</button>
              : <p className="max-w-52 text-danger">{L("Unavailable items need a manager review.", "अनुपलब्ध आइटम मैनेजर से जाँचें।")}</p>)}
            {!needsReview && order.error && !offline && order.staffUserId === staffUserId && <button type="button" className="min-h-9 rounded-lg border border-line bg-surface px-3 font-semibold text-ink" onClick={() => void syncOfflineOrders(true)}>{L("Retry now", "अभी फिर कोशिश करें")}</button>}
            {order.staffUserId !== staffUserId && canReviewOfflineOrders && !offline && (order.current.takeaway || !!order.current.tableId) && order.managerApprovedByUserId !== staffUserId && <button type="button" className="min-h-9 rounded-lg bg-ink px-3 font-semibold text-paper" onClick={() => setReviewOrder(order)}>{order.current.sessionId ? L("Review & approve replay", "जाँचें और दोबारा भेजने की मंज़ूरी दें") : L("Review & recover order", "ऑर्डर जाँचें और वापस लें")}</button>}
            {order.staffUserId !== staffUserId && canReviewOfflineOrders && !offline && !order.current.sessionId && !order.current.takeaway && !order.current.tableId && <p className="max-w-56 text-danger">{L("This recovery copy is missing its table. Keep the copy and contact the owner before entering the order again.", "इस रिकवरी कॉपी में टेबल की जानकारी नहीं है। कॉपी सुरक्षित रखें और ऑर्डर दोबारा दर्ज करने से पहले मालिक से संपर्क करें।")}</p>}
            {order.managerApprovedByUserId === staffUserId && order.error && !offline && <button type="button" className="min-h-9 rounded-lg border border-line bg-surface px-3 font-semibold text-ink" onClick={() => void syncOfflineOrders(true)}>{L("Retry approved order", "मंज़ूर ऑर्डर फिर भेजें")}</button>}
          </div>
        </section>;
      })}
      {cashCollections.map((cash) => <section key={cash.id} className="mb-3 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-3 text-caption text-ink">
        <div>
          <p className="font-semibold">{L("Provisional local cash record", "अस्थायी लोकल नकद रिकॉर्ड")} · {cash.tableCode} · {cash.id.slice(0, 8).toUpperCase()}</p>
          <p className="mt-1">{L("Due", "बाकी")}: {rs(cash.expectedDuePaise)} · {L("Received", "मिला")}: {rs(cash.receivedPaise)} · {L("Change", "वापस")}: {rs(cash.receivedPaise - cash.expectedDuePaise)}</p>
          <p className="mt-1 text-warning">{cash.error || L("Saved on this device; waiting for the server to confirm the exact bill balance.", "इस डिवाइस पर सेव है; सर्वर से बिल की बाकी रकम की पुष्टि का इंतज़ार है।")}</p>
          {cash.staffUserId !== staffUserId && <p role="alert" className="mt-1 text-danger">{L("This cash record belongs to another staff login. Sign back into that account on this device to reconcile it. Keep this record and do not collect cash for this bill again until it is checked.", "यह नकद रिकॉर्ड दूसरे स्टाफ़ लॉगिन का है। मिलान के लिए उसी अकाउंट से इस डिवाइस पर लॉगिन करें। रिकॉर्ड सुरक्षित रखें और जाँच होने तक इस बिल का नकद दोबारा न लें।")}</p>}
          {cash.retryCount ? <p className="mt-1 text-muted">{L(`Sync attempt ${cash.retryCount}; the local record is still preserved.`, `सिंक की ${cash.retryCount} कोशिशें हुईं; लोकल रिकॉर्ड सुरक्षित है।`)}</p> : null}
        </div>
        {!offline && cash.staffUserId === staffUserId && <button type="button" className="min-h-9 rounded-lg border border-line bg-surface px-3 font-semibold text-ink" onClick={() => void syncOfflineCash(true)}>{L("Reconcile now", "अभी मिलान करें")}</button>}
      </section>)}
      {message && <p role={message.tone === "bad" ? "alert" : "status"} className={`mb-3 rounded-xl border px-3 py-2 text-body font-semibold ${message.tone === "bad" ? "border-danger/40 bg-danger/10 text-danger" : "border-success/40 bg-success/10 text-success"}`}>{message.text}</p>}
      {priceReviewRequired && <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-caption font-semibold text-warning"><span>{L("Menu price or availability changed since this cart was saved. Review the total before sending.", "कार्ट सेव होने के बाद कीमत या उपलब्धता बदली है। भेजने से पहले कुल जाँचें।")}</span><button type="button" className="min-h-9 rounded-lg bg-warning px-3 text-ink" onClick={() => setCart((saved) => saved.map((line) => line.kind === "menu" ? { ...line, dish: data.menu.find((item) => item.id === line.dish.id) ?? line.dish } : line))}>{L("Review new prices", "नई कीमतें जाँचें")}</button></div>}

      {!current ? (
        <TablesView
          L={L} now={now} zones={zones} zone={zone} setZone={setZone} tables={tables} running={running} total={data.tables.length}
          takeaways={data.takeaways} onTable={(t) => void pickTable(t)} onTakeaway={(t) => void pickTakeaway(t)}
          note={storageNearlyFull ? null : storageWarning} onRestore={queuedCount > 0 ? null : () => recoveryFile.current?.click()}
        />
      ) : (
        <div className="grid gap-4 lg:h-[calc(100dvh-6.5rem)] lg:min-h-[32rem] lg:grid-cols-[minmax(0,1fr)_23rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]">
          {/* Menu */}
          <section inert={!!paying} className={`min-h-0 min-w-0 flex-col ${orderOpen ? "hidden lg:flex" : "flex"} ${paying ? "opacity-50" : ""}`}>
            <div className="flex items-center gap-2">
              <button type="button" onClick={back} aria-label={L("Back to tables", "टेबल पर वापस")} className={`${quiet} shrink-0 max-sm:w-11 max-sm:px-0`}><ArrowLeft className="size-4" aria-hidden="true" /><span className="max-sm:hidden">{L("Tables", "टेबल")}</span></button>
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                <input
                  ref={searchBox} value={query} onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && shown[0]) { e.preventDefault(); add(shown[0]); setQuery(""); } }}
                  placeholder={L("Search dish", "डिश खोजें")} aria-label={L("Search the menu, press Enter to add", "मेन्यू खोजें, Enter से जोड़ें")} className={`${field} pl-9`}
                />
              </div>
              <button type="button" onClick={() => setTyping(true)} aria-label={L("Add an item not on the menu", "मेन्यू से बाहर का आइटम जोड़ें")} className={`${quiet} shrink-0 max-sm:w-11 max-sm:px-0`}><PenLine className="size-4" aria-hidden="true" /><span className="max-sm:hidden">{L("Open item", "ओपन आइटम")}</span></button>
            </div>

            <nav aria-label={L("Categories", "कैटेगरी")} className="no-scrollbar mt-3 flex shrink-0 gap-2 overflow-x-auto">
              {[{ id: "all", name: L("All", "सभी"), nameHi: null }, ...data.categories].map((c) => (
                <button key={c.id} type="button" aria-pressed={category === c.id && !query} onClick={() => { setCategory(c.id); setQuery(""); }} className={`${chip(category === c.id && !query)} shrink-0 whitespace-nowrap`}>
                  {hi ? c.nameHi || c.name : c.name}
                </button>
              ))}
            </nav>

            <div className="mt-3 flex shrink-0 items-center justify-between gap-2">
              <p className="text-caption text-muted">{shown.length} {L(shown.length === 1 ? "dish" : "dishes", "डिश")}</p>
              <button type="button" aria-pressed={photos} onClick={togglePhotos} className="min-h-9 rounded-lg px-2 text-caption font-semibold text-muted hover:text-ink">{photos ? L("Hide photos", "फ़ोटो छुपाएँ") : L("Show photos", "फ़ोटो दिखाएँ")}</button>
            </div>
            <div className={`no-scrollbar grid min-h-0 flex-1 content-start gap-2.5 lg:overflow-y-auto ${photos ? "[grid-template-columns:repeat(auto-fill,minmax(min(100%,9.5rem),1fr))]" : "[grid-template-columns:repeat(auto-fill,minmax(min(100%,8.75rem),1fr))]"}`}>
              {shown.length === 0 && <p className="col-span-full rounded-2xl border border-line bg-surface p-6 text-center text-body text-muted">{L("Nothing matches. Use Open item for a dish that is not on the menu.", "कुछ नहीं मिला। मेन्यू से बाहर की डिश के लिए ओपन आइटम लें।")}</p>}
              {shown.map((m) => (
                <DishTile key={m.id} dish={m} hi={hi} L={L} photos={photos} inCart={cart.reduce((n, l) => n + (l.kind === "menu" && l.dish.id === m.id ? l.qty : 0), 0)} onAdd={() => add(m)} />
              ))}
            </div>

            {/* Phones show one pane at a time; this keeps the order one tap away */}
            <button type="button" onClick={() => setOrderOpen(true)} className={`sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-10 mt-3 flex min-h-12 w-full items-center justify-between gap-3 rounded-xl bg-forest px-4 text-button font-semibold text-white sm:bottom-3 lg:hidden ${focus}`}>
              <span>{cartCount > 0 ? L(`View order · ${cartCount} new`, `ऑर्डर देखें · ${cartCount} नए`) : L("View order", "ऑर्डर देखें")}</span>
              <span className="tabular-nums">{rs(sentTotal + cartTotal)}</span>
            </button>
          </section>

          {/* Order */}
          <aside className={`min-h-0 flex-col rounded-2xl border border-line bg-surface ${orderOpen ? "flex" : "hidden lg:flex"}`}>
            {paying ? <PosPayPanel key={paying.sessionId} detail={paying} hi={hi} offline={offline} onClose={closePay} /> : <>
            <header className="shrink-0 border-b border-line p-4">
              <button type="button" onClick={() => setOrderOpen(false)} className="mb-2 inline-flex min-h-9 items-center gap-1.5 text-caption font-semibold text-muted hover:text-ink lg:hidden"><ArrowLeft className="size-4" aria-hidden="true" />{L("Add more dishes", "और डिश जोड़ें")}</button>
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-section font-bold text-ink">{current.takeaway ? <span className="inline-flex items-center gap-1.5"><ShoppingBag className="size-4" aria-hidden="true" />{L("Takeaway", "पार्सल")}{current.sessionId ? ` ${current.code.replace(/^TA-/, "")}` : ""}</span> : `${L("Table", "टेबल")} ${current.code}`}</h2>
                {detail && <span className={`rounded-full px-2.5 py-1 text-caption font-semibold ${billAsked ? "bg-warning/15 text-warning" : "bg-brand-soft text-ink"}`}>{billAsked ? L("Bill asked", "बिल माँगा") : L("Running", "चल रहा")}</span>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <input value={guest} onChange={(e) => setGuest(e.target.value)} disabled={!!current.sessionId && !current.takeaway} placeholder={L("Name (optional)", "नाम (वैकल्पिक)")} aria-label={L("Customer name", "ग्राहक का नाम")} className={`${field} h-10 min-w-0 flex-1`} />
                {!current.takeaway && !current.sessionId && (
                  <div className="flex items-center gap-1 rounded-xl border border-line px-1" aria-label={L("Guests", "मेहमान")}>
                    <Users className="mx-1 size-4 text-muted" aria-hidden="true" />
                    <button type="button" aria-label={L("One guest less", "एक कम")} onClick={() => setPax((p) => Math.max(1, p - 1))} className="grid size-8 place-items-center rounded-lg hover:bg-accent"><Minus className="size-3.5" aria-hidden="true" /></button>
                    <span className="w-6 text-center text-body font-bold tabular-nums">{pax}</span>
                    <button type="button" aria-label={L("One guest more", "एक और")} onClick={() => setPax((p) => Math.min(current.seats, p + 1))} className="grid size-8 place-items-center rounded-lg hover:bg-accent"><Plus className="size-3.5" aria-hidden="true" /></button>
                  </div>
                )}
              </div>
            </header>

            <div className="no-scrollbar min-h-40 flex-1 overflow-y-auto p-4">
              {sent.length > 0 && (
                <div className="mb-4">
                  <p className="text-caption font-semibold uppercase tracking-wide text-muted">{L("Already sent", "पहले भेजे")}</p>
                  <ul className="mt-1.5 divide-y divide-line">
                    {sent.map((l) => (
                      <li key={l.id} className="flex items-center justify-between gap-2 py-1.5 text-body">
                        <span className="min-w-0 truncate text-ink">{l.qty} × {hi ? l.nameHi || l.name : l.name}</span>
                        <span className="shrink-0 tabular-nums text-muted">{rs(l.unitPricePaise * l.qty)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {sent.length === 0 && sentCount > 0 && <p className="mb-4 rounded-xl bg-paper px-3 py-2 text-caption text-muted">{L(`${sentCount} previously sent items · ${rs(sentTotal)}. Item details will load when connected.`, `${sentCount} पहले भेजे आइटम · ${rs(sentTotal)}। इंटरनेट आने पर आइटम विवरण आएगा।`)}</p>}
              {cart.length === 0 ? (
                <p className="py-6 text-center text-body text-muted">{sent.length ? L("Tap dishes to add more.", "और जोड़ने के लिए डिश टैप करें।") : L("Tap a dish to start the order.", "ऑर्डर शुरू करने के लिए डिश टैप करें।")}</p>
              ) : (
                <>
                  <p className="text-caption font-semibold uppercase tracking-wide text-muted">{L("New items", "नए आइटम")}</p>
                  <ul className="mt-1.5 space-y-2">
                    {cart.map((l) => (
                      <CartRow key={l.key} line={l} hi={hi} L={L} takeaway={current.takeaway} price={linePrice(l)} onChange={(p) => change(l.key, p)} />
                    ))}
                  </ul>
                </>
              )}
            </div>

            <footer className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] shrink-0 rounded-b-2xl border-t border-line bg-surface p-4 sm:bottom-0">
              <dl className="space-y-1 text-body">
                {sentCount > 0 && cart.length > 0 && <div className="flex justify-between text-muted"><dt>{L("Sent", "भेजे गए")}</dt><dd className="tabular-nums">{rs(sentTotal)}</dd></div>}
                {cart.length > 0 && <div className="flex justify-between text-muted"><dt>{L("New", "नए")} · {cartCount}</dt><dd className="tabular-nums">{rs(cartTotal)}</dd></div>}
                <div className="flex justify-between font-display text-section font-bold text-ink"><dt>{L("Total before tax", "टैक्स से पहले कुल")}</dt><dd className="tabular-nums">{rs(sentTotal + cartTotal)}</dd></div>
              </dl>
              {canRecordOfflineCash && <div className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-3">
                <p className="text-caption font-semibold text-warning">{L("This bill was requested before the outage. You can record full cash locally; it is provisional until the server confirms the same balance.", "यह बिल इंटरनेट बंद होने से पहले माँगा गया था। पूरा नकद लोकल दर्ज कर सकते हैं; सर्वर पर बाकी रकम मिलने तक यह अस्थायी रहेगा।")}</p>
                <button type="button" className="mt-2 min-h-10 w-full rounded-lg bg-warning px-3 text-button font-semibold text-ink" onClick={() => { setCashReceived((offlineCashDuePaise / 100).toFixed(2)); setCashDialogOpen(true); }}>{L(`Record cash here · ${rs(offlineCashDuePaise)}`, `नकद यहाँ दर्ज करें · ${rs(offlineCashDuePaise)}`)}</button>
              </div>}
              {offline && current?.sessionId && detail?.bill && billAsked && !offlineCashForCurrent && !canRecordOfflineCash && <p className="mt-3 rounded-lg bg-paper px-3 py-2 text-caption text-muted">{currentHasQueuedKot ? L("Sync this table’s saved KOT before taking its offline cash.", "इस टेबल का ऑफ़लाइन नकद लेने से पहले सेव KOT सिंक करें।") : hasPendingPayment ? L("A payment is still pending. Reconnect and confirm it before taking cash.", "एक पेमेंट की पुष्टि बाकी है। नकद लेने से पहले इंटरनेट जोड़कर उसे जाँचें।") : cart.length ? L("Send or clear the new items before recording cash for this bill.", "इस बिल का नकद दर्ज करने से पहले नए आइटम भेजें या हटाएँ।") : L("Offline cash is available only for a saved, requested bill with a clear balance.", "ऑफ़लाइन नकद सिर्फ़ पहले से सेव, माँगे गए बिल और साफ़ बाकी रकम पर उपलब्ध है।")}</p>}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" className={current.takeaway ? quiet : primary} disabled={busy || (offline && cart.length === 0) || cart.length === 0} onClick={() => void send(false)}>
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}{offline ? L("Save KOT here", "KOT यहाँ सेव करें") : L("Send KOT", "KOT भेजें")}
                </button>
                <button type="button" className={current.takeaway ? primary : quiet} disabled={busy || offline || (cart.length === 0 && sentCount === 0)} onClick={() => void send(true)}>
                  <ReceiptText className="size-4" aria-hidden="true" />{cart.length ? L("KOT & pay", "KOT और भुगतान") : L("Pay", "भुगतान")}
                </button>
              </div>
              {cart.length > 0 && <button type="button" onClick={() => { setCart([]); clearRequest(); }} className="mt-2 inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg text-caption font-semibold text-muted hover:text-danger"><Trash2 className="size-3.5" aria-hidden="true" />{L("Clear new items", "नए आइटम हटाएँ")}</button>}
            </footer>
            </>}
          </aside>
        </div>
      )}

      {choosing && (
        <OptionsDialog
          L={L} hi={hi} state={choosing} onChange={setChoosing} onClose={() => setChoosing(null)}
          onAdd={() => { const c = choosing; setCart((x) => [...x, { key: `${c.dish.id}-${Date.now()}`, kind: "menu", dish: c.dish, qty: c.qty, mods: c.mods, note: "", parcel: !!current?.takeaway }]); setChoosing(null); }}
        />
      )}
      <Dialog open={cashDialogOpen} onOpenChange={setCashDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{L("Record provisional cash", "अस्थायी नकद दर्ज करें")}</DialogTitle>
            <DialogDescription>{L("This stays on this device until the server confirms the same bill balance. It is not an official invoice or receipt. UPI and card stay unavailable offline.", "यह रकम सर्वर पर बिल की बाकी रकम मिलने तक इसी डिवाइस पर रहेगी। यह आधिकारिक बिल या रसीद नहीं है। ऑफ़लाइन UPI और कार्ड उपलब्ध नहीं हैं।")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <p className="flex justify-between rounded-lg bg-paper px-3 py-2 font-semibold"><span>{L("Outstanding", "बाकी रकम")}</span><span>{rs(offlineCashDuePaise)}</span></p>
            <label className="grid gap-1 text-caption font-semibold text-ink" htmlFor="offline-cash-received">{L("Cash received (₹)", "मिला नकद (₹)")}
              <input id="offline-cash-received" type="number" inputMode="decimal" min={(offlineCashDuePaise / 100).toFixed(2)} step="0.01" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} className={field} />
            </label>
            <p className="text-caption text-muted">{L("Change", "वापस")}: {rs(Math.max(0, Math.round(Number(cashReceived) * 100) - offlineCashDuePaise))}</p>
            <button type="button" className={primary} disabled={!canRecordOfflineCash || !Number.isSafeInteger(Math.round(Number(cashReceived) * 100)) || Math.round(Number(cashReceived) * 100) < offlineCashDuePaise} onClick={() => void handleRecordOfflineCash()}>{L("Save local cash record", "लोकल नकद रिकॉर्ड सेव करें")}</button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!reviewOrder} onOpenChange={(open) => { if (!open) setReviewOrder(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{L("Review saved order before replay", "दोबारा भेजने से पहले सेव ऑर्डर जाँचें")}</DialogTitle>
            <DialogDescription>{L("This local order was created by another staff account. Approval is recorded in the audit log and the server checks prices and availability. If its table visit does not exist yet, the server opens the saved table only if it is still free; otherwise the order stays pending.", "यह लोकल ऑर्डर दूसरे स्टाफ़ अकाउंट ने बनाया था। मंज़ूरी audit log में दर्ज होगी और सर्वर कीमत व उपलब्धता जाँचेगा। अगर टेबल विज़िट अभी नहीं बनी है, तो सर्वर सेव टेबल तभी खोलेगा जब वह खाली हो; वरना ऑर्डर रुका रहेगा।")}</DialogDescription>
          </DialogHeader>
          {reviewOrder && <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-line p-3">
            <p className="font-semibold">{reviewOrder.current.code || L("New takeaway", "नया पार्सल")} · {new Date(reviewOrder.createdAt).toLocaleString(hi ? "hi-IN" : "en-IN")}</p>
            {reviewOrder.lines.map((line, index) => {
              const dish = "itemId" in line ? data.menu.find((item) => item.id === line.itemId) : null;
              const name = "itemId" in line ? dish?.name ?? line.itemId : line.open.name;
              const mods = "itemId" in line ? line.modifierIds.map((id) => dish?.pricing.groups.flatMap((group) => group.modifiers).find((mod) => mod.id === id)?.nameEn ?? id).join(", ") : "";
              return <div key={`${index}-${name}`} className="border-t border-line pt-2 text-caption"><p className="font-semibold">{line.qty} × {name}</p>{mods && <p className="text-muted">{mods}</p>}{line.note && <p className="text-warning">{L("Note", "नोट")}: {line.note}</p>}</div>;
            })}
          </div>}
          <div className="flex justify-end gap-2">
            <button type="button" className={quiet} onClick={() => setReviewOrder(null)}>{L("Cancel", "रद्द करें")}</button>
            <button type="button" className={primary} disabled={!reviewOrder || !canReviewOfflineOrders || offline} onClick={() => reviewOrder && void approveAndSyncOfflineOrder(reviewOrder)}>{reviewOrder && !reviewOrder.current.sessionId ? L("Approve & recover", "मंज़ूरी देकर वापस लें") : L("Approve & retry", "मंज़ूरी देकर फिर भेजें")}</button>
          </div>
        </DialogContent>
      </Dialog>
      {typing && (
        <OpenItemDialog
          L={L} config={data.openItem} onClose={() => setTyping(false)}
          onAdd={(o) => { setCart((x) => [...x, { key: `open-${Date.now()}`, kind: "open", ...o, note: "", parcel: !!current?.takeaway }]); setTyping(false); }}
        />
      )}
    </div>
  );
}

type Lx = (en: string, h: string) => string;

/** A dish on the POS: its photo (the small copy, falling back to the full one) or its initial, name, price and how many are in the cart */
function DishTile({ dish: m, hi, L, photos, inCart, onAdd }: { dish: Dish; hi: boolean; L: Lx; photos: boolean; inCart: number; onAdd: () => void }) {
  const [src, setSrc] = useState(() => menuThumb(m.imageUrl));
  const name = hi ? m.nameHi || m.name : m.name;
  const options = m.pricing.groups.some((g) => g.modifiers.length);
  const veg = (
    <span aria-label={m.isVeg ? L("Veg", "शाकाहारी") : L("Non-veg", "मांसाहारी")} className={`grid size-3.5 shrink-0 place-items-center rounded-[3px] border-[1.5px] bg-surface ${m.isVeg ? "border-success" : "border-danger"}`}><span className={`size-1.5 rounded-full ${m.isVeg ? "bg-success" : "bg-danger"}`} /></span>
  );
  return (
    <button type="button" disabled={!m.pricing.isAvailable} onClick={onAdd}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-surface text-left transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-line ${inCart ? "border-forest ring-1 ring-forest" : "border-line hover:border-ink/40"} ${focus}`}>
      {photos && (
        <span className={`relative block w-full overflow-hidden bg-accent ${src ? "aspect-[4/3]" : "aspect-[16/7]"}`}>
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element -- menu photos come from the photo bucket with their own small copies
            <img src={src} alt="" loading="lazy" decoding="async" onError={() => setSrc((s) => (s && s !== m.imageUrl ? m.imageUrl : null))} className="size-full object-cover transition duration-300 group-hover:scale-105" />
          ) : (
            <span aria-hidden="true" className="grid size-full place-items-center bg-gradient-to-br from-brand-soft to-accent font-display text-[22px] font-bold text-muted">{m.name.slice(0, 1).toUpperCase()}</span>
          )}
          <span className="absolute left-2 top-2">{veg}</span>
          {!m.pricing.isAvailable && <span className="absolute inset-x-0 bottom-0 bg-black/60 py-1 text-center text-caption font-semibold text-white">{L("Sold out", "खत्म")}</span>}
        </span>
      )}
      <span className="flex flex-1 flex-col justify-between gap-1.5 p-2.5">
        <span className="flex items-start gap-1.5">
          {!photos && <span className="mt-0.5">{veg}</span>}
          <span className="line-clamp-2 text-body font-semibold leading-snug text-ink">{name}</span>
        </span>
        <span className="flex items-center justify-between gap-1 text-caption">
          <span className="font-bold tabular-nums text-ink">{rs(m.pricing.pricePaise)}</span>
          {!photos && !m.pricing.isAvailable ? <span className="font-semibold text-danger">{L("Sold out", "खत्म")}</span> : options ? <span className="text-muted">{L("options", "विकल्प")}</span> : null}
        </span>
      </span>
      {inCart > 0 && <span className="absolute right-2 top-2 grid min-w-6 place-items-center rounded-full bg-forest px-1.5 py-0.5 text-caption font-bold text-white">{inCart}</span>}
    </button>
  );
}

function TablesView({ L, now, zones, zone, setZone, tables, running, total, takeaways, onTable, onTakeaway, note, onRestore }: {
  L: Lx; now: number; zones: PosTerminal["zones"]; zone: string; setZone: (z: string) => void; tables: Table[]; running: number; total: number;
  takeaways: PosTerminal["takeaways"]; onTable: (t: Table) => void; onTakeaway: (t: PosTerminal["takeaways"][number] | null) => void; note: string | null; onRestore: (() => void) | null;
}) {
  return (
    <div className="space-y-6">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-lg font-bold leading-6 tracking-tight text-ink sm:text-[28px] sm:leading-8">POS</h1>
            <p className="text-body text-muted">{L(`${running} of ${total} tables running. Tap a table to take its order.`, `${total} में से ${running} टेबल चल रहीं। ऑर्डर लेने के लिए टेबल टैप करें।`)}</p>
          </div>
          <button type="button" onClick={() => onTakeaway(null)} className={primary}><ShoppingBag className="size-4" aria-hidden="true" />{L("New takeaway", "नया पार्सल")}</button>
        </div>
        {zones.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {[{ id: "all", name: L("All areas", "सभी एरिया") }, ...zones].map((z) => <button key={z.id} type="button" aria-pressed={zone === z.id} onClick={() => setZone(z.id)} className={chip(zone === z.id)}>{z.name}</button>)}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-3 text-caption text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded border border-line bg-surface" />{L("Free", "खाली")}</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded border border-brand-border bg-brand-soft" />{L("Running", "चल रही")}</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded border border-warning/50 bg-warning/15" />{L("Bill asked", "बिल माँगा")}</span>
        </div>
        {tables.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-line bg-surface p-6 text-center text-body text-muted">{L("No tables yet. Add tables on the Floor, or bill as a takeaway.", "अभी कोई टेबल नहीं। फ़्लोर में टेबल जोड़ें, या पार्सल बिल बनाएँ।")}</p>
        ) : (
          <div className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,150px),1fr))]">
            {tables.map((t) => {
              const v = t.visit;
              const asked = v?.status === "bill_requested";
              const off = !v && (t.state === "blocked" || t.state === "needs_cleaning");
              const tone = asked ? "border-warning/50 bg-warning/15" : v ? "border-brand-border bg-brand-soft" : "border-line bg-surface";
              return (
                <button key={t.id} type="button" disabled={off} onClick={() => onTable(t)} className={`flex min-h-24 flex-col justify-between rounded-2xl border p-3 text-left hover:border-ink disabled:cursor-not-allowed disabled:opacity-50 ${tone} ${focus}`}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-display text-section font-bold text-ink">{t.code}</span>
                    <span className="text-caption text-muted">{t.seats} <span className="sr-only">{L("seats", "सीट")}</span><Users className="inline size-3" aria-hidden="true" /></span>
                  </span>
                  {v ? (
                    <span className="text-caption text-ink">
                      <span className="block font-semibold tabular-nums">{rs(v.orderedPaise)}</span>
                      <span className="text-muted">{asked ? L("Bill asked", "बिल माँगा") : since(v.openedAt, now, L)}</span>
                    </span>
                  ) : (
                    <span className="text-caption text-muted">{t.state === "needs_cleaning" ? L("Cleaning", "सफ़ाई") : t.state === "blocked" ? L("Blocked", "बंद") : t.state === "reserved" || t.state === "held" ? L("Reserved", "रिज़र्व") : L("Free", "खाली")}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-display text-section font-bold text-ink">{L("Running takeaways", "चल रहे पार्सल")}</h2>
        {takeaways.length === 0 ? (
          <p className="mt-2 text-body text-muted">{L("None right now.", "अभी कोई नहीं।")}</p>
        ) : (
          <div className="mt-3 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]">
            {takeaways.map((t) => (
              <button key={t.tableId} type="button" onClick={() => onTakeaway(t)} className={`flex min-h-20 flex-col justify-between rounded-2xl border p-3 text-left hover:border-ink ${t.visit.status === "bill_requested" ? "border-warning/50 bg-warning/15" : "border-brand-border bg-brand-soft"} ${focus}`}>
                <span className="flex items-center gap-1.5 font-display text-section font-bold text-ink"><Package className="size-4" aria-hidden="true" />{placeLabel(t.code)}</span>
                <span className="text-caption text-ink"><span className="font-semibold tabular-nums">{rs(t.visit.orderedPaise)}</span>{t.visit.guestName ? <span className="text-muted"> · {t.visit.guestName}</span> : null}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {(note || onRestore) && (
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-caption text-muted">
          <p>{note}</p>
          {onRestore && <button type="button" onClick={onRestore} className="inline-flex min-h-9 items-center gap-1.5 font-semibold text-ink hover:underline"><FileUp className="size-4" aria-hidden="true" />{L("Restore POS recovery copy", "POS रिकवरी कॉपी वापस लाएँ")}</button>}
        </footer>
      )}
    </div>
  );
}

function CartRow({ line: l, hi, L, takeaway, price, onChange }: { line: Line; hi: boolean; L: Lx; takeaway: boolean; price: number; onChange: (p: Partial<{ qty: number; note: string; parcel: boolean }>) => void }) {
  const [noting, setNoting] = useState(!!l.note);
  const name = l.kind === "open" ? l.name : hi ? l.dish.nameHi || l.dish.name : l.dish.name;
  const options = l.kind === "menu" ? l.dish.pricing.groups.flatMap((g) => g.modifiers.filter((m) => l.mods.includes(m.id)).map((m) => (hi ? m.nameHi || m.nameEn : m.nameEn))) : [];
  return (
    <li className="rounded-xl border border-line p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-body font-semibold text-ink">{name}{l.kind === "open" && <span className="ml-1.5 rounded bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-muted">{L("open", "ओपन")}</span>}</p>
          {options.length > 0 && <p className="truncate text-caption text-muted">{options.join(", ")}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" aria-label={L("One less", "एक कम")} onClick={() => onChange({ qty: l.qty - 1 })} className="grid size-8 place-items-center rounded-lg border border-line hover:bg-accent"><Minus className="size-3.5" aria-hidden="true" /></button>
          <span className="w-6 text-center text-body font-bold tabular-nums">{l.qty}</span>
          <button type="button" aria-label={L("One more", "एक और")} onClick={() => onChange({ qty: Math.min(50, l.qty + 1) })} className="grid size-8 place-items-center rounded-lg border border-line hover:bg-accent"><Plus className="size-3.5" aria-hidden="true" /></button>
          <span className="w-16 text-right text-body tabular-nums">{rs(price)}</span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!takeaway && <button type="button" aria-pressed={l.parcel} onClick={() => onChange({ parcel: !l.parcel })} className={chip(l.parcel)}><Package className="size-3.5" aria-hidden="true" />{L("Parcel", "पार्सल")}</button>}
        {!noting && <button type="button" onClick={() => setNoting(true)} className={chip(false)}><PenLine className="size-3.5" aria-hidden="true" />{L("Note", "नोट")}</button>}
      </div>
      {noting && <input value={l.note} onChange={(e) => onChange({ note: e.target.value.slice(0, 140) })} placeholder={L("e.g. less spicy, no onion", "जैसे कम तीखा, बिना प्याज़")} aria-label={L("Note for the kitchen", "किचन के लिए नोट")} className={`${field} mt-2 h-9 text-caption`} />}
    </li>
  );
}

function OptionsDialog({ L, hi, state, onChange, onClose, onAdd }: { L: Lx; hi: boolean; state: { dish: Dish; mods: string[]; qty: number }; onChange: (s: { dish: Dish; mods: string[]; qty: number }) => void; onClose: () => void; onAdd: () => void }) {
  const { dish, mods, qty } = state;
  const priced = priceLine(dish.pricing, qty, mods);
  const pick = (g: Dish["pricing"]["groups"][number], id: string) => {
    const others = mods.filter((x) => !g.modifiers.some((m) => m.id === x));
    const mine = mods.filter((x) => g.modifiers.some((m) => m.id === x));
    const on = mine.includes(id);
    const next = g.maxSelect === 1 ? (on && g.minSelect === 0 ? [] : [id]) : on ? mine.filter((x) => x !== id) : [...mine, id].slice(0, g.maxSelect);
    onChange({ ...state, mods: [...others, ...next] });
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="no-scrollbar max-h-[92dvh] gap-3 overflow-y-auto p-5 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-title font-bold">{hi ? dish.nameHi || dish.name : dish.name}</DialogTitle>
          <DialogDescription>{L("Choose the options, then add.", "विकल्प चुनें, फिर जोड़ें।")}</DialogDescription>
        </DialogHeader>
        {dish.pricing.groups.filter((g) => g.modifiers.length > 0).map((g) => {
          const chosen = g.modifiers.filter((m) => mods.includes(m.id)).length;
          const need = g.minSelect > 0 && chosen < g.minSelect;
          return (
            <div key={g.id}>
              <p className={`text-caption font-semibold ${need ? "text-danger" : "text-muted"}`}>{hi ? g.nameHi || g.nameEn : g.nameEn} · {g.minSelect > 0 ? L("required", "ज़रूरी") : L("optional", "वैकल्पिक")}{g.maxSelect > 1 ? ` · ${L("up to", "अधिकतम")} ${g.maxSelect}` : ""}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {g.modifiers.map((m) => (
                  <button key={m.id} type="button" role={g.maxSelect === 1 ? "radio" : "checkbox"} aria-checked={mods.includes(m.id)} disabled={!m.isAvailable} onClick={() => pick(g, m.id)} className={`${chip(mods.includes(m.id))} disabled:opacity-40`}>
                    {hi ? m.nameHi || m.nameEn : m.nameEn}{m.priceDeltaPaise ? ` +${rs(m.priceDeltaPaise)}` : ""}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label={L("One less", "एक कम")} onClick={() => onChange({ ...state, qty: Math.max(1, qty - 1) })} className="grid size-10 place-items-center rounded-lg border border-line hover:bg-accent"><Minus className="size-4" aria-hidden="true" /></button>
            <span className="w-8 text-center text-section font-bold tabular-nums">{qty}</span>
            <button type="button" aria-label={L("One more", "एक और")} onClick={() => onChange({ ...state, qty: Math.min(50, qty + 1) })} className="grid size-10 place-items-center rounded-lg border border-line hover:bg-accent"><Plus className="size-4" aria-hidden="true" /></button>
          </div>
          <button type="button" className={primary} disabled={!priced.ok} onClick={onAdd}>{priced.ok ? `${L("Add", "जोड़ें")} · ${rs(priced.line.linePaise)}` : L("Choose the required option", "ज़रूरी विकल्प चुनें")}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OpenItemDialog({ L, config, onClose, onAdd }: { L: Lx; config: PosTerminal["openItem"]; onClose: () => void; onAdd: (o: { name: string; pricePaise: number; station: string; taxRateBp: number; qty: number }) => void }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState(1);
  const [station, setStation] = useState(config.stations[0] ?? "kitchen");
  const [tax, setTax] = useState(config.taxRateBp);
  const pricePaise = Math.round(Number(price) * 100);
  const ok = name.trim().length >= 2 && Number.isFinite(pricePaise) && pricePaise >= 100 && pricePaise <= 10_000_000;
  const submit = () => { if (ok) onAdd({ name: name.trim(), pricePaise, station, taxRateBp: tax, qty }); };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-3 p-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-title font-bold">{L("Open item", "ओपन आइटम")}</DialogTitle>
          <DialogDescription>{L("For something that is not on the menu. It goes to the kitchen and on the bill like any dish.", "जो मेन्यू में नहीं है उसके लिए। ये किसी भी डिश की तरह किचन और बिल में जाएगा।")}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label className="grid gap-1 text-caption font-semibold text-muted">{L("Name", "नाम")}<input autoFocus value={name} onChange={(e) => setName(e.target.value.slice(0, 100))} placeholder={L("e.g. Extra butter, Special thali", "जैसे एक्स्ट्रा बटर, स्पेशल थाली")} className={field} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-caption font-semibold text-muted">{L("Price (₹ each)", "दाम (₹ प्रति)")}<input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" className={field} /></label>
            <div className="grid gap-1 text-caption font-semibold text-muted">{L("Quantity", "मात्रा")}
              <div className="flex h-11 items-center justify-between rounded-xl border border-line px-1">
                <button type="button" aria-label={L("One less", "एक कम")} onClick={() => setQty((q) => Math.max(1, q - 1))} className="grid size-9 place-items-center rounded-lg hover:bg-accent"><Minus className="size-4" aria-hidden="true" /></button>
                <span className="text-body font-bold tabular-nums text-ink">{qty}</span>
                <button type="button" aria-label={L("One more", "एक और")} onClick={() => setQty((q) => Math.min(50, q + 1))} className="grid size-9 place-items-center rounded-lg hover:bg-accent"><Plus className="size-4" aria-hidden="true" /></button>
              </div>
            </div>
          </div>
          {config.stations.length > 1 && (
            <label className="grid gap-1 text-caption font-semibold text-muted">{L("Kitchen station", "किचन स्टेशन")}
              <select value={station} onChange={(e) => setStation(e.target.value)} className={field}>{config.stations.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            </label>
          )}
          {config.gst && (
            <label className="grid gap-1 text-caption font-semibold text-muted">GST
              <select value={tax} onChange={(e) => setTax(Number(e.target.value))} className={field}>{OPEN_TAX_RATES.map((r) => <option key={r} value={r}>{r / 100}%</option>)}</select>
            </label>
          )}
          <button type="submit" className={primary} disabled={!ok}>{ok ? `${L("Add", "जोड़ें")} · ${rs(pricePaise * qty)}` : L("Enter a name and price", "नाम और दाम डालें")}</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
