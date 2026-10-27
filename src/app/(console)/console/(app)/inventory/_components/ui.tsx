"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

// Shared pieces of the inventory screens: the look of fields and buttons, money and dates, and the
// sheet that holds every form.

export const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
export const card = "rounded-2xl border border-line bg-surface";
export const field = `h-11 w-full rounded-xl border border-line bg-surface px-3 text-body text-ink placeholder:text-muted ${focus}`;
export const primary = `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-ink px-4 text-button font-semibold text-paper disabled:opacity-50 ${focus}`;
export const quiet = `inline-flex min-h-9 items-center justify-center rounded-lg border border-line px-3 text-caption font-semibold text-ink hover:bg-ink/[0.05] disabled:opacity-50 ${focus}`;
export const label = "grid gap-1 text-caption font-semibold text-muted";
export const th = "px-3 py-3 font-medium";
export const rs = (paise: number) => `${paise < 0 ? "−" : ""}₹${Math.abs(Math.round(paise / 100)).toLocaleString("en-IN")}`;
export const when = (at: number) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(at);
export const day = (date: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
/** Today in India, YYYY-MM-DD, for date inputs */
export const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export function Sheet({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`max-h-[92dvh] w-full ${wide ? "max-w-3xl" : "max-w-md"} overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 outline-none sm:rounded-2xl`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-section font-bold text-ink">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`grid size-9 place-items-center rounded-lg text-muted hover:bg-ink/5 ${focus}`}>
            <HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

/** Save rows as a CSV file the owner can open in Excel */
export function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const text = rows.map((r) => r.map((v) => {
    const s = v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
