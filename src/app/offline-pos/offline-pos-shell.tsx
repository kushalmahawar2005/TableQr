"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PosTerminalScreen } from "@/app/(console)/console/(app)/pos/_components/pos-terminal-screen";
import { loadOfflinePosSnapshot, type OfflinePosSnapshot } from "@/lib/pos-offline-queue";

export function OfflinePosShell() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<OfflinePosSnapshot | null>(null);
  const [checking, setChecking] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (navigator.onLine) {
        try {
          const response = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(2500) });
          if (response.ok) {
            router.replace("/console/pos");
            return;
          }
        } catch {
          // The browser may still report online while this server cannot be reached.
        }
      }
      try {
        const cached = await loadOfflinePosSnapshot();
        if (!cancelled) {
          if (cached) setSnapshot(cached);
          else setMessage("No active offline POS session is saved on this device. Reconnect and open POS once.");
        }
      } catch {
        if (!cancelled) setMessage("Offline POS data could not be read from this device.");
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  if (checking || !snapshot) {
    return <main className="grid min-h-dvh place-items-center bg-paper px-5 text-center text-body text-muted">{checking ? "Opening saved POS…" : <div className="max-w-md"><h1 className="font-display text-title font-bold text-ink">Offline POS unavailable</h1><p className="mt-2">{message}</p><Link className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-ink px-4 font-semibold text-white" href="/console/login">Reconnect and sign in</Link></div>}</main>;
  }

  return <PosTerminalScreen initial={snapshot.data} initialSavedAt={snapshot.savedAt} initialIsServerFresh={false} startOffline outletId={snapshot.outletId} staffUserId={snapshot.staffUserId} sessionExpiresAt={snapshot.sessionExpiresAt} hi={snapshot.hi} realtimeUrl={null} />;
}
