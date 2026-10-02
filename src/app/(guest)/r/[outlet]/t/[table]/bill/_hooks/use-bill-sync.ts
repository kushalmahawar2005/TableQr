"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { connectRealtime } from "@/lib/realtime-client";
import type { BillScreenData } from "@/server/guest/bill-screen";
import { billDataAction, billTokenAction } from "../actions";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/**
 * G8 live data. The database and the gateway's verified answers are the truth: every realtime hint
 * for this table (bill.updated, payment.updated, refund.updated, someone paid and left, the table
 * closed) and every reconnect reload the whole bill. If the table closed, the paid screen takes over.
 */
export function useBillSync(initial: BillScreenData, shortCode: string, realtimeUrl: string | null, preview = false, forceOffline = false) {
  const [data, setData] = useState(initial);
  const [failed, setFailed] = useState(false);
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true) && !forceOffline;
  const inflight = useRef(false);
  const held = useRef(false);
  const alive = useRef(true);
  const router = useRouter();
  const base = `/r/${encodeURIComponent(initial.outlet.code)}/t/${encodeURIComponent(shortCode)}`;

  const refresh = useCallback(async () => {
    if (preview || !navigator.onLine) return;
    if (inflight.current) {
      held.current = true;
      return;
    }
    inflight.current = true;
    try {
      const res = await billDataAction(initial.outlet.code, shortCode);
      if (!alive.current) return;
      if (res.ok) {
        setData(res.data);
        setFailed(false);
      } else if (res.error === "gone") router.replace(`${base}/paid`);
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
  }, [initial.outlet.code, shortCode, preview, router, base]);

  useEffect(() => {
    alive.current = true;
    if (preview) return;
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15_000);
    const stop = connectRealtime({
      url: realtimeUrl,
      getToken: () => billTokenAction(initial.outlet.code, shortCode),
      onEvents: () => void refresh(),
      onResync: () => void refresh(),
    });
    const onOnline = () => void refresh();
    window.addEventListener("online", onOnline);
    return () => {
      alive.current = false;
      stop();
      clearInterval(poll);
      window.removeEventListener("online", onOnline);
    };
  }, [initial.outlet.code, preview, realtimeUrl, refresh, shortCode]);

  return { data, online, failed, refresh };
}
