"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { connectRealtime } from "@/lib/realtime-client";
import { menuRealtimeTokenAction, setPlainQtyAction, type QtyResult } from "../actions";

// Keeps G3 in step with the server without flicker.
// - A tapped quantity shows at once. While its write is waiting or in flight, the phone's number
//   is the truth; a refresh that lands meanwhile cannot overwrite it.
// - Each confirmed write carries the server's time. Menu data rendered after that time already
//   includes the write, so from then on the server's number takes over.
// - Realtime events and reconnects ask for a refresh, held back until no write is pending.

const WRITE_DELAY_MS = 300;
const REFRESH_DELAY_MS = 250;

type Local = { qty: number; at: number };
export type CartError = Exclude<QtyResult, { ok: true }>["error"];

export function useMenuSync(opts: {
  outletCode: string;
  shortCode: string;
  /** Server time the page data was rendered at */
  renderedAt: number;
  serverQty: Record<string, number>;
  realtimeUrl: string | null;
  onError: (error: CartError, itemId: string) => void;
  /** Dev board: no server, no realtime */
  preview?: boolean;
  initial?: Record<string, number>;
}) {
  const { outletCode, shortCode, renderedAt, serverQty, realtimeUrl, preview } = opts;
  const router = useRouter();
  const [local, setLocal] = useState<Record<string, Local>>(() =>
    Object.fromEntries(Object.entries(opts.initial ?? {}).map(([id, qty]) => [id, { qty, at: Infinity }])),
  );

  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const inflight = useRef(new Set<string>());
  const wanted = useRef(new Map<string, number>());
  const confirmed = useRef(new Map<string, Local>());
  const refreshHeld = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onError = useRef(opts.onError);
  useEffect(() => {
    onError.current = opts.onError;
  });

  const busy = () => timers.current.size > 0 || inflight.current.size > 0;

  const requestRefresh = useCallback(() => {
    if (preview) return;
    if (busy()) {
      refreshHeld.current = true;
      return;
    }
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), REFRESH_DELAY_MS);
  }, [preview, router]);

  const send = useCallback(
    async (itemId: string) => {
      if (inflight.current.has(itemId)) return; // the running write picks up newer taps when it finishes
      inflight.current.add(itemId);
      let res: QtyResult = { ok: false, error: "failed" };
      // Keep writing while the guest has tapped again since the last write went out
      for (;;) {
        const qty = wanted.current.get(itemId);
        if (qty === undefined) break;
        try {
          res = await setPlainQtyAction(outletCode, shortCode, itemId, qty);
        } catch {
          res = { ok: false, error: "failed" };
        }
        if (!res.ok) break;
        confirmed.current.set(itemId, { qty: res.qty, at: res.at });
        if (wanted.current.get(itemId) === qty) {
          wanted.current.delete(itemId);
          const done = { qty: res.qty, at: res.at };
          setLocal((l) => ({ ...l, [itemId]: done }));
          break;
        }
        if (timers.current.has(itemId)) break; // a pending timer sends the newest number itself
      }
      inflight.current.delete(itemId);

      if (!res.ok) {
        // Back to the last number the server agreed to, or to the page's own
        wanted.current.delete(itemId);
        clearTimeout(timers.current.get(itemId));
        timers.current.delete(itemId);
        const last = confirmed.current.get(itemId);
        setLocal((l) => {
          const next = { ...l };
          if (last) next[itemId] = last;
          else delete next[itemId];
          return next;
        });
        onError.current(res.error, itemId);
        refreshHeld.current = true; // the page may now show why (paused, sold out, table gone)
      }
      if (!busy() && (refreshHeld.current || res.ok)) {
        refreshHeld.current = false;
        requestRefresh();
      }
    },
    [outletCode, shortCode, requestRefresh],
  );

  const setQty = useCallback(
    (itemId: string, qty: number) => {
      setLocal((l) => ({ ...l, [itemId]: { qty, at: Infinity } }));
      if (preview) return;
      wanted.current.set(itemId, qty);
      clearTimeout(timers.current.get(itemId));
      timers.current.set(
        itemId,
        setTimeout(() => {
          timers.current.delete(itemId);
          void send(itemId);
        }, WRITE_DELAY_MS),
      );
    },
    [preview, send],
  );

  // The item sheet (G4) signals a successful Add; reload so the stepper and cart bar catch up
  useEffect(() => {
    if (preview) return;
    window.addEventListener("tq-cart-changed", requestRefresh);
    return () => window.removeEventListener("tq-cart-changed", requestRefresh);
  }, [preview, requestRefresh]);

  // Realtime: any event for this table or the menu, and every reconnect, reloads the page data
  useEffect(() => {
    if (preview) return;
    return connectRealtime({
      url: realtimeUrl,
      getToken: () => menuRealtimeTokenAction(outletCode, shortCode),
      onEvents: () => requestRefresh(),
      onResync: () => requestRefresh(),
    });
  }, [preview, realtimeUrl, outletCode, shortCode, requestRefresh]);

  /** What the guest sees: their own pending or newer number, otherwise the server's */
  const qtyOf = (itemId: string) => {
    const l = local[itemId];
    return l && l.at >= renderedAt ? l.qty : (serverQty[itemId] ?? 0);
  };

  return { qtyOf, setQty, requestRefresh };
}

// Online / offline from the browser, without effects
function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function useOnline(forceOffline?: boolean) {
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  return forceOffline ? false : online;
}
