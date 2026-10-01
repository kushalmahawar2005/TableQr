"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { connectRealtime, type RealtimeStatus } from "@/lib/realtime-client";
import type { TrackerScreenData } from "@/server/guest/tracker-screen";
import { trackerDataAction, trackerTokenAction } from "../actions";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb); window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
}
export function useTrackerSync(initial: TrackerScreenData, shortCode: string, realtimeUrl: string | null, preview = false, forceOffline = false) {
  const [data, setData] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [clock, setClock] = useState(initial.renderedAt);
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true) && !forceOffline;
  const inflight = useRef(false);
  const held = useRef(false);
  const alive = useRef(true);
  const router = useRouter();
  const tablePath = `/r/${encodeURIComponent(initial.outlet.code)}/t/${encodeURIComponent(shortCode)}`;
  const refresh = useCallback(async () => {
    if (preview || !navigator.onLine) return;
    if (inflight.current) { held.current = true; return; }
    inflight.current = true;
    try {
      const res = await trackerDataAction(initial.outlet.code, shortCode);
      if (!alive.current) return;
      if (res.ok) { setData(res.data); setClock(res.data.renderedAt); setFailed(false); }
      else if (res.error === "gone") router.replace(tablePath);
      else setFailed(true);
    } catch { if (alive.current) setFailed(true); }
    finally {
      inflight.current = false;
      if (alive.current && held.current) { held.current = false; void refresh(); }
    }
  }, [initial.outlet.code, shortCode, preview, router, tablePath]);
  useEffect(() => {
    alive.current = true;
    if (preview) return;
    // Server clock plus monotonic elapsed time avoids a phone with an incorrect wall clock.
    let at = performance.now();
    const tick = setInterval(() => {
      const next = performance.now(); const elapsed = next - at; at = next;
      setClock((c) => c + elapsed);
    }, 1000);
    // Low-frequency reconciliation while connected covers best-effort publish loss too.
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15_000);
    const stop = connectRealtime({
      url: realtimeUrl,
      getToken: () => trackerTokenAction(initial.outlet.code, shortCode),
      onEvents: (events) => { if (events.some((e) => e.type === "order.status" || e.type === "bill.updated" || e.type.startsWith("service_request.") || e.type === "participant.joined")) void refresh(); },
      onResync: () => { void refresh(); }, onStatus: setStatus,
    });
    const onOnline = () => { void refresh(); };
    window.addEventListener("online", onOnline);
    return () => { alive.current = false; stop(); clearInterval(tick); clearInterval(poll); window.removeEventListener("online", onOnline); };
  }, [initial.outlet.code, preview, realtimeUrl, refresh, shortCode]);
  return { data, clock, online, status, failed, refresh };
}
