"use client";

import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronDown, type LucideIcon } from "lucide-react";

// The small pieces every admin screen shares, so they all read the same way.

/** A pill that filters a list */
export const filterChip = (on: boolean) => `h-9 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-[var(--admin-brand)] ${on ? "border-transparent bg-[var(--admin-brand)] text-white" : "bg-card text-muted-foreground hover:text-foreground"}`;

/** One CSV cell. A name like =1+1 must stay text when the file opens in Excel or Sheets. */
export function csvCell(value: string | number) {
  const raw = String(value);
  const text = /^[=@\t\r]|^[+-](?![\d ]+$)/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export const Change = ({ value }: { value: number }) => <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${value < 0 ? "text-red-600" : "text-emerald-700"}`}>{value < 0 ? <ArrowDownRight className="size-3.5" aria-hidden="true" /> : <ArrowUpRight className="size-3.5" aria-hidden="true" />}{Math.abs(value)}%</span>;

export function Kpi({ icon: Icon, label, value, hint, change, against = "vs last month" }: { icon: LucideIcon; label: string; value: string; hint?: string; change?: number | null; against?: string }) {
  return <div className="min-w-0 rounded-2xl border bg-card p-3 sm:p-5">
    <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-muted-foreground sm:text-[13px]">{label}</p><Icon className="size-5 shrink-0 text-[var(--admin-brand)]" aria-hidden="true" /></div>
    <p className="mt-2 truncate font-display text-2xl font-bold leading-none tracking-tight tabular-nums sm:text-3xl">{value}</p>
    {change != null ? <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground"><Change value={change} /><span className="truncate">{against}</span></p> : hint ? <p className="mt-1.5 truncate text-[11px] font-medium text-muted-foreground">{hint}</p> : null}
  </div>;
}

/** One line of a side panel: its current value shows closed, its form opens under it */
export function ManageRow({ title, note, open, onToggle, children }: { title: string; note: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return <section className="overflow-hidden rounded-xl border bg-card">
    <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--admin-brand)]">
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{title}</span><span className="block truncate text-xs text-muted-foreground">{note}</span></span>
      <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
    </button>
    {open && <div className="space-y-4 border-t p-4">{children}</div>}
  </section>;
}
