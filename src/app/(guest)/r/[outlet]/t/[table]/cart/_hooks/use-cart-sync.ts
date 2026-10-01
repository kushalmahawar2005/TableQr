"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { connectRealtime } from "@/lib/realtime-client";
import { removeLineAction, setLineQtyAction, type RemoveResult } from "../actions";

// G5's cart changes, applied on the phone at once and saved in the background (same rules as the
// menu): while a change is waiting or in flight the phone's number is the truth; a confirmed
// change carries the server's time, and page data rendered after it takes over again.

const WRITE_DELAY_MS = 300;
type Local = { qty: number; at: number };

export function useCartSync(opts: {
  outletCode: string;
  shortCode: string;
  renderedAt: number;
  realtimeUrl: string | null;
  getToken: () => Promise<string | null>;
  onError: (error: "blocked" | "gone" | "failed") => void;
  preview?: boolean;
  initialRemoved?: string[];
}) {
  const { outletCode, shortCode, renderedAt, realtimeUrl, preview } = opts;
  const router = useRouter();
  const [local, setLocal] = useState<Record<string, Local>>({});
  const [removed, setRemoved] = useState<Record<string, number>>(() =>
    Object.fromEntries((opts.initialRemoved ?? []).map((id) => [id, Infinity])),
  );
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const inflight = useRef(new Set<string>());
  const wanted = useRef(new Map<string, number>());
  const held = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onError = useRef(opts.onError);
  const getToken = useRef(opts.getToken);
  useEffect(() => {
    onError.current = opts.onError;
    getToken.current = opts.getToken;
  });

  const busy = () => timers.current.size > 0 || inflight.current.size > 0;
  const refresh = useCallback(() => {
    if (preview) return;
    if (busy()) {
      held.current = true;
      return;
    }
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 250);
  }, [preview, router]);

  const settle = useCallback(() => {
    if (!busy()) {
      held.current = false;
      refresh();
    }
  }, [refresh]);

  const send = useCallback(
    async (lineId: string) => {
      if (inflight.current.has(lineId)) return;
      inflight.current.add(lineId);
      let failed: "blocked" | "gone" | "failed" | null = null;
      for (;;) {
        const qty = wanted.current.get(lineId);
        if (qty === undefined) break;
        let res: Awaited<ReturnType<typeof setLineQtyAction>>;
        try {
          res = await setLineQtyAction(outletCode, shortCode, lineId, qty);
        } catch {
          res = { ok: false, error: "failed" };
        }
        if (!res.ok) {
          failed = res.error;
          break;
        }
        if (wanted.current.get(lineId) === qty) {
          wanted.current.delete(lineId);
          const done = { qty, at: res.at };
          setLocal((l) => ({ ...l, [lineId]: done }));
          break;
        }
        if (timers.current.has(lineId)) break;
      }
      inflight.current.delete(lineId);
      if (failed) {
        wanted.current.delete(lineId);
        // Back to the page's number
        setLocal((l) => {
          const next = { ...l };
          delete next[lineId];
          return next;
        });
        onError.current(failed);
      }
      settle();
    },
    [outletCode, shortCode, settle],
  );

  const setQty = useCallback(
    (lineId: string, qty: number) => {
      setLocal((l) => ({ ...l, [lineId]: { qty, at: Infinity } }));
      if (preview) return;
      wanted.current.set(lineId, qty);
      clearTimeout(timers.current.get(lineId));
      timers.current.set(
        lineId,
        setTimeout(() => {
          timers.current.delete(lineId);
          void send(lineId);
        }, WRITE_DELAY_MS),
      );
    },
    [preview, send],
  );

  /** Removes at once on screen; resolves with the server's answer (and the Undo snapshot) */
  const remove = useCallback(
    async (lineId: string): Promise<RemoveResult> => {
      setRemoved((r) => ({ ...r, [lineId]: Infinity }));
      if (preview) return { ok: true, at: 0, snapshot: null };
      clearTimeout(timers.current.get(lineId));
      timers.current.delete(lineId);
      wanted.current.delete(lineId);
      inflight.current.add(`rm:${lineId}`);
      let res: RemoveResult;
      try {
        res = await removeLineAction(outletCode, shortCode, lineId);
      } catch {
        res = { ok: false, error: "failed" };
      }
      inflight.current.delete(`rm:${lineId}`);
      if (res.ok) {
        const at = res.at;
        setRemoved((r) => ({ ...r, [lineId]: at }));
      } else {
        setRemoved((r) => {
          const next = { ...r };
          delete next[lineId];
          return next;
        });
        onError.current(res.error);
      }
      settle();
      return res;
    },
    [outletCode, shortCode, preview, settle],
  );

  // Realtime: other people's carts, sold-out dishes, the bill; every reconnect reloads too
  useEffect(() => {
    if (preview) return;
    return connectRealtime({
      url: realtimeUrl,
      getToken: () => getToken.current(),
      onEvents: () => refresh(),
      onResync: () => refresh(),
    });
  }, [preview, realtimeUrl, refresh]);

  const qtyOf = (lineId: string, server: number) => {
    const l = local[lineId];
    return l && l.at >= renderedAt ? l.qty : server;
  };
  const isRemoved = (lineId: string) => (removed[lineId] ?? -1) >= renderedAt;

  return { qtyOf, setQty, remove, isRemoved, refresh };
}

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function useOnline(forceOffline?: boolean) {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  return forceOffline ? false : online;
}
