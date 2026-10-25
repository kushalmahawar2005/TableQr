"use client";

import Link from "next/link";
import { Printer } from "lucide-react";
import { guideAction } from "../../../_components/guide-actions";
import { QR_SIZES, qrSize, type QrSize } from "../../_components/qr-print";

export function PrintBar({ count, size, outlet, back = { href: "/console/floor", label: "← Back to floor" }, noun = ["table", "tables"] }: { count: number; size: QrSize; outlet: string; back?: { href: string; label: string }; noun?: [string, string] }) {
  const { perPage } = qrSize(size);
  const sheets = Math.ceil(count / perPage);
  return (
    <header className="no-print sticky top-0 z-10 flex sm:top-14 flex-wrap items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3">
      <Link href={back.href} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-semibold hover:bg-neutral-50">{back.label}</Link>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{outlet} · QR posters</p>
        <p className="text-xs text-neutral-500">{count} {count === 1 ? noun[0] : noun[1]} · {sheets} A4 {sheets === 1 ? "sheet" : "sheets"} · cut along the dashed lines</p>
      </div>
      <nav aria-label="Print size" className="flex overflow-hidden rounded-lg border border-neutral-300 text-sm font-semibold">
        {QR_SIZES.map(({ id, label }) => <Link key={id} href={`?size=${id}`} aria-current={size === id ? "page" : undefined} className={`px-3 py-2 ${size === id ? "bg-neutral-900 text-white" : "hover:bg-neutral-50"}`}>{label}</Link>)}
      </nav>
      <button type="button" disabled={count === 0} onClick={() => { void guideAction(["qrPrinted"]); window.print(); }} className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Printer className="size-4" aria-hidden="true" />Print</button>
    </header>
  );
}
