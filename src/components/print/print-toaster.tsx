"use client";

import { AlertTriangle, Check, Loader2, Printer, X } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import type { PrintManager } from "@/lib/print/manager";

/** What the last print honestly did, with what to do next. Appears only after something was printed. */
export function PrintToaster({ manager }: { manager: PrintManager }) {
  const { last, busy, unsent } = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);

  // A print that went through fades away on its own; a failure stays until it is dealt with
  useEffect(() => {
    if (!last || last.status === "failed" || last.status === "queued") return;
    const timer = setTimeout(() => manager.dismiss(), last.duplicate ? 3000 : 9000);
    return () => clearTimeout(timer);
  }, [last, manager]);

  if (!last || last.background && last.status !== "failed") return null;
  const failed = last.status === "failed";
  const working = last.status === "queued" || busy;
  const action = "rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-50";
  return (
    <div role={failed ? "alert" : "status"} aria-live={failed ? "assertive" : "polite"} className="print:hidden pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-md rounded-card border border-line bg-surface p-3.5 shadow-[0_8px_30px_rgb(0_0_0/0.14)]">
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${failed ? "bg-rose-50 text-rose-700" : "bg-sage text-forest"}`} aria-hidden="true">
            {working ? <Loader2 className="size-4 animate-spin" /> : failed ? <AlertTriangle className="size-4" /> : last.status === "confirmed" ? <Check className="size-4" /> : <Printer className="size-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">{failed ? "Could not print" : last.status === "confirmed" ? "Printed" : working ? "Printing…" : "Sent to print"}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{last.message}</p>
            {last.usedFallback && !failed && <p className="mt-1 text-xs text-muted">The printer&apos;s own connection was not available, so browser print was used.</p>}
            {unsent > 0 && <p className="mt-1 text-xs text-muted">{unsent} print {unsent === 1 ? "record is" : "records are"} waiting to be saved. They will go when the connection is back.</p>}
            {!working && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {failed && last.retryable && <button type="button" className={action} onClick={() => void manager.retry()}>Try again</button>}
                {failed && last.transport !== "browser" && <button type="button" className={action} onClick={() => void manager.useBrowser()}>Use browser print</button>}
                {!failed && !last.duplicate && <button type="button" className={action} onClick={() => void manager.printAgain()}>Print again</button>}
              </div>
            )}
          </div>
          <button type="button" aria-label="Dismiss" className="grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-ink/5" onClick={() => manager.dismiss()}><X className="size-4" aria-hidden="true" /></button>
        </div>
      </div>
    </div>
  );
}
