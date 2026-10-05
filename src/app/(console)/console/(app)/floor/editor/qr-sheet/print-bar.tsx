"use client";

import Link from "next/link";
import { Printer } from "lucide-react";

const SIZES = [["a6", "Small (A6)"], ["a5", "Medium (A5)"], ["a4", "Large (A4)"]] as const;

export function PrintBar({ count, size, outlet, single }: { count: number; size: string; outlet: string; single: boolean }) {
  return (
    <header className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3">
      <Link href="/console/floor" className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-semibold hover:bg-neutral-50">← Back to floor</Link>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{outlet} · QR posters</p>
        <p className="text-xs text-neutral-500">{count} {count === 1 ? "table" : "tables"} · one poster per page{single ? "" : ""}</p>
      </div>
      <nav aria-label="Print size" className="flex overflow-hidden rounded-lg border border-neutral-300 text-sm font-semibold">
        {SIZES.map(([id, label]) => <Link key={id} href={`?size=${id}`} aria-current={size === id ? "page" : undefined} className={`px-3 py-2 ${size === id ? "bg-neutral-900 text-white" : "hover:bg-neutral-50"}`}>{label}</Link>)}
      </nav>
      <button type="button" disabled={count === 0} onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Printer className="size-4" aria-hidden="true" />Print</button>
    </header>
  );
}
