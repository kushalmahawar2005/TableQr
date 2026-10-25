"use client";

import { useSyncExternalStore } from "react";
import { paperSaved, savePaper, subscribePaper, type PaperMm } from "./bill-print";

/** This device's receipt roll width; 80 mm until the device has chosen */
export const usePaper = (): PaperMm => useSyncExternalStore(subscribePaper, paperSaved, () => 80);

/** This device's receipt roll width, remembered on the device; every thermal slip it prints follows it */
export function PaperToggle({ className = "", label = "Receipt paper" }: { className?: string; label?: string }) {
  const mm = usePaper();
  return (
    <label className={`inline-flex items-center gap-2 text-sm ${className}`}>
      <span className="text-muted">{label}</span>
      <select value={mm} onChange={(e) => savePaper(Number(e.target.value) === 58 ? 58 : 80)} className="h-9 rounded-lg border border-line bg-background px-2 font-semibold">
        <option value={80}>80 mm</option>
        <option value={58}>58 mm</option>
      </select>
    </label>
  );
}
