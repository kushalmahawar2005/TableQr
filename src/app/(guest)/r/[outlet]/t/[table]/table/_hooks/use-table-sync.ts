"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { connectRealtime } from "@/lib/realtime-client";
import type { TableScreenData } from "@/server/guest/table-screen";
import { tableDataAction, tableTokenAction } from "../actions";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/**
 * G7 live data. The database is the truth: every realtime event for this table (someone joined,
 * was removed, paid, host changed, ordering paused, bill requested, a request completed) and
 * every reconnect only triggers a reload of the whole screen.
 */
export function useTableSync(initial: TableScreenData, shortCode: string, realtimeUrl: string | null, preview = false, forceOffline = false) {
  const [data, setData] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [clock, setClock] = useState(initial.renderedAt);
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true) && !forceOffline;
  const inflight = useRef(false);
  const held = useRef(false);
  const alive = useRef(true);
  const router = useRouter();
  const tablePath = `/r/${encodeURIComponent(initial.outlet.code)}/t/${encodeURIComponent(shortCode)}`;

  const refresh = useCallback(async () => {
    if (preview || !navigator.onLine) return;
    if (inflight.current) {
      held.current = true;
      return;
    }
    inflight.current = true;
    try {
      const res = await tableDataAction(initial.outlet.code, shortCode);
      if (!alive.current) return;
      if (res.ok) {
        setData(res.data);
        setClock(res.data.renderedAt);
        setFailed(false);
      } else if (res.error === "gone") router.replace(tablePath);
      else setFailed(true);
    } catch {
      if (alive.current) setFailed(true);
    } finally {
      inflight.current = false;
      if (alive.current && held.current) {
        held.current = false;
        void refresh();
      }
    }
  }, [initial.outlet.code, shortCode, preview, router, tablePath]);

  useEffect(() => {
    alive.current = true;
    if (preview) return;
    // Server clock plus monotonic elapsed time, so a phone with a wrong clock still counts down right
    let at = performance.now();
    const tick = setInterval(() => {
      const next = performance.now();
      const elapsed = next - at;
      at = next;
      setClock((c) => c + elapsed);
    }, 1000);
    // Slow reconciliation while connected covers a lost realtime hint
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15_000);
    const stop = connectRealtime({
      url: realtimeUrl,
      getToken: () => tableTokenAction(initial.outlet.code, shortCode),
      onEvents: () => void refresh(),
      onResync: () => void refresh(),
    });
    const onOnline = () => void refresh();
    window.addEventListener("online", onOnline);
    return () => {
      alive.current = false;
      stop();
      clearInterval(tick);
      clearInterval(poll);
      window.removeEventListener("online", onOnline);
    };
  }, [initial.outlet.code, preview, realtimeUrl, refresh, shortCode]);

  return { data, clock, online, failed, refresh };
}
