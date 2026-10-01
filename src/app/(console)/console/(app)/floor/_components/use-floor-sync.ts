"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { connectRealtime } from "@/lib/realtime-client";
import type { FloorData, TableDetail } from "@/server/floor/read";
import { floorDataAction, floorTokenAction, tableDetailAction } from "../actions";

/**
 * S1 live data. The database is the truth: every realtime hint on the floor topic, every
 * reconnect and a 20-second poll reload the whole floor (and the open drawer's table).
 */
export function useFloorSync(initial: FloorData, realtimeUrl: string | null, preview: boolean, initialSelected: string | null, initialDetail: TableDetail | null, initialFailed: boolean) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [now, setNow] = useState(initial.renderedAt);
  const [failed, setFailed] = useState(initialFailed);
  const [selectedId, setSelected] = useState(initialSelected);
  const [detail, setDetail] = useState<TableDetail | null>(initialDetail);
  const selectedRef = useRef(initialSelected);
  const inflight = useRef(false);
  const again = useRef(false);

  async function loadDetail(tableId: string) {
    if (preview) return;
    const d = await tableDetailAction(tableId).catch(() => null);
    if (d?.ok && selectedRef.current === tableId) setDetail(d.detail);
  }

  // One stable refresh for the realtime connection; the React Compiler leaves this hook as written
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const refresh = useCallback(async () => {
    if (preview || !navigator.onLine) return;
    if (inflight.current) {
      again.current = true;
      return;
    }
    inflight.current = true;
    try {
      const res = await floorDataAction();
      if (res.ok) {
        setData(res.data);
        setNow(res.data.renderedAt);
        setFailed(false);
        const sel = selectedRef.current;
        if (sel && res.data.tables.find((t) => t.id === sel)?.visit) {
          const d = await tableDetailAction(sel).catch(() => null);
          if (d?.ok && selectedRef.current === sel) setDetail(d.detail);
        }
      } else if (res.code === "staff_signed_out") router.replace("/console/login");
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      inflight.current = false;
      if (again.current) {
        again.current = false;
        void refresh();
      }
    }
  }, [preview, router]);

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  function select(tableId: string, hasVisit: boolean) {
    setSelected(tableId);
    setDetail(null);
    if (hasVisit) void loadDetail(tableId);
  }

  useEffect(() => {
    if (preview) return;
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const poll = setInterval(() => document.visibilityState === "visible" && void refresh(), 20_000);
    const stop = connectRealtime({ url: realtimeUrl, getToken: floorTokenAction, onEvents: () => void refresh(), onResync: () => void refresh() });
    const back = () => void refresh();
    window.addEventListener("online", back);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
      stop();
      window.removeEventListener("online", back);
    };
  }, [preview, realtimeUrl, refresh]);

  return { data, now, failed, selectedId, detail, refresh, select };
}
