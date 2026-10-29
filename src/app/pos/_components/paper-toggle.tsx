"use client";

import { useSyncExternalStore } from "react";
import { paperSaved, savePaper, subscribePaper, type PaperMm } from "./bill-print";

/** This device's receipt roll width; 80 mm until the device has chosen */
export const usePaper = (): PaperMm => useSyncExternalStore(subscribePaper, paperSaved, () => 80);

/** What to set in the browser's print window so a slip prints clean; the page cannot switch these off for the browser */
export const PRINT_TIPS = "In the print window: turn Headers and footers off, set Margins to None, Scale to 100%, and choose your receipt printer. Pick the paper size that matches the roll (80 mm or 58 mm).";

/** This device's receipt roll width, remembered on the device; every thermal slip it prints follows it */
export function PaperToggle({ className = "", label = "Receipt paper" }: { className?: string; label?: string }) {
  const mm = usePaper();
  return (
    <span className={`inline-flex items-center gap-2 text-sm ${className}`}>
      <label className="inline-flex items-center gap-2 whitespace-nowrap">
        <span className="text-muted">{label}</span>
        <select value={mm} onChange={(e) => savePaper(Number(e.target.value) === 58 ? 58 : 80)} className="h-9 rounded-lg border border-line bg-background px-2 font-semibold">
          <option value={80}>80 mm</option>
          <option value={58}>58 mm</option>
        </select>
      </label>
      <details className="relative">
        <summary className="grid size-9 cursor-pointer list-none place-items-center rounded-lg border border-line font-semibold text-muted" aria-label="Printing tips">?</summary>
        <p className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-line bg-surface p-3 text-xs leading-relaxed text-ink shadow-lg">{PRINT_TIPS}</p>
      </details>
    </span>
  );
}
