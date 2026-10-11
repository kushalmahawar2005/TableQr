"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { connectRealtime, type RealtimeEvent } from "@/lib/realtime-client";
import type { KdsBoard } from "@/server/kitchen/kds";
import { useKdsActions } from "./kds-actions";
import type { Connection } from "./kds-logic";

export const POLL_MS = 12_000;
export const DEBOUNCE_MS = 400;

/** Kitchen events that should reload the board; anything else on the socket is ignored */
export const isKitchenHint = (e: RealtimeEvent) => e.topic === "kitchen" || (e.topic === "menu" && e.type === "item.availability");

/**
 * S2 live data. The database is the truth: realtime events are hints that trigger one debounced
 * reload, every reconnect reloads in full, and a 12-second poll covers anything missed. The clock
 * ticks locally every second, corrected by the server's time on each load.
 */
export function useKdsSync(initial: KdsBoard, realtimeUrl: string | null, preview: boolean) {
  const router = useRouter();
  const actions = useKdsActions();
  const [board, setBoard] = useState(initial);
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(initial.renderedAt);
  const [conn, setConn] = useState<Connection>(realtimeUrl ? "connecting" : "polling");
  const [offline, setOffline] = useState(false);
  const station = useRef(initial.station);
  const inflight = useRef(false);
  const again = useRef(false);
  const everLive = useRef(false);
  const skewRef = useRef(skew);
  useEffect(() => {
    skewRef.current = skew;
  }, [skew]);

  // One stable refresh for the realtime connection; the React Compiler leaves this hook as written
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const refresh = useCallback(async () => {
    if (preview) return;
    if (!navigator.onLine) {
      setOffline(true);
      return;
    }
    if (inflight.current) {
      again.current = true;
      return;
    }
    inflight.current = true;
    try {
      const res = await actions.board(station.current);
      setOffline(false);
      if (res.ok) {
        setBoard(res.data);
        setSkew(res.data.renderedAt - Date.now());
      } else if (res.code === "staff_signed_out" || res.code === "forbidden") router.refresh();
    } catch {
      // The request itself failed: the network is gone, keep what is on screen
      setOffline(true);
    } finally {
      inflight.current = false;
      if (again.current) {
        again.current = false;
        void refresh();
      }
    }
  }, [preview, router, actions]);

  const showStation = useCallback(
    (next: string | null) => {
      station.current = next;
      setBoard((b) => ({ ...b, station: next, cards: b.cards.filter((c) => !next || c.station === next) }));
      void refresh();
    },
    [refresh],
  );

  useEffect(() => {
    if (preview) return;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const hint = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => void refresh(), DEBOUNCE_MS);
    };
    const tick = setInterval(() => setNow(Date.now() + skewRef.current), 1000);
    const poll = setInterval(() => void refresh(), POLL_MS);
    const stop = connectRealtime({
      url: realtimeUrl,
      getToken: actions.token,
      pollMs: POLL_MS,
      onEvents: (events) => events.some(isKitchenHint) && hint(),
      onResync: () => void refresh(),
      onStatus: (s) => {
        if (s === "live") everLive.current = true;
        setConn(s === "live" ? "live" : s === "connecting" ? (everLive.current ? "reconnecting" : "connecting") : "reconnecting");
      },
    });
    const goOnline = () => void refresh();
    const goOffline = () => setOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      clearTimeout(debounce);
      clearInterval(tick);
      clearInterval(poll);
      stop();
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [preview, realtimeUrl, refresh, actions]);

  return { board, now, conn: (offline ? "offline" : conn) as Connection, offline, refresh, showStation };
}
