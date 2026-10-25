"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { loadDevicePrefs, unsentStorage } from "@/lib/print/device-prefs";
import { PrintManager, refusal, type JobReport, type JobResult, type PrintRequest, type PrintRun, type SetupData } from "@/lib/print/manager";
import { paperSaved } from "@/lib/print/runtime";
import { PrintToaster } from "./print-toaster";

// Gives a screen printing: the outlet's printers (loaded once), this device's choice, and one
// manager per outlet that every Print button talks to. Each surface passes its own way of loading
// the printers and reporting a job, because staff and kitchen wall screens sign in differently.

type Loaded = { ok: true; data: SetupData } | { ok: false; message?: string };
type Reported = { ok: true; data: JobResult } | { ok: false; message: string };

type Ctx = { manager: PrintManager; setup: SetupData | null; reload: () => void };
const PrintContext = createContext<Ctx | null>(null);

export function PrintProvider({ outletId, loadSetup, report, children }: {
  /** The outlet this screen belongs to; keeps one restaurant's saved prints and printer choices apart from another's on a shared device */
  outletId: string;
  loadSetup: () => Promise<Loaded>;
  report: (report: JobReport) => Promise<Reported>;
  children: ReactNode;
}) {
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [manager] = useState(() => new PrintManager({
    prefs: () => loadDevicePrefs(outletId),
    paperSaved,
    storage: unsentStorage(outletId) as never,
    report: async () => null,
  }));
  useEffect(() => {
    manager.setReporter(async (r) => {
      const res = await report(r);
      if (!res.ok) throw refusal(res.message);
      return res.data;
    });
  }, [manager, report]);

  const load = useRef(loadSetup);
  useEffect(() => { load.current = loadSetup; }, [loadSetup]);
  const reload = useMemo(() => () => {
    void load.current().then((r) => {
      if (r.ok && r.data.outletId === outletId) { manager.setSetup(r.data); setSetup(r.data); }
    }).catch(() => undefined);
  }, [outletId, manager]);

  useEffect(() => {
    reload();
    void manager.flush();
    const online = () => void manager.flush();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [manager, reload]);

  const value = useMemo(() => ({ manager, setup, reload }), [manager, setup, reload]);
  return <PrintContext.Provider value={value}>{children}<PrintToaster manager={manager} /></PrintContext.Provider>;
}

/** Without a provider (a preview page, a test) slips still print, through the browser, without a record */
let standalone: PrintManager | null = null;
const fallbackManager = () => (standalone ??= new PrintManager({ prefs: () => ({ receiptPrinterId: null, kitchenPrinterId: null }), paperSaved, report: async () => null }));

export function usePrint() {
  const ctx = useContext(PrintContext);
  const manager = ctx?.manager ?? fallbackManager();
  return {
    print: (req: PrintRequest): Promise<PrintRun> => manager.print(req),
    manager,
    setup: ctx?.setup ?? null,
    reload: ctx?.reload ?? (() => undefined),
  };
}

export const useLastPrint = (manager: PrintManager) => useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);
