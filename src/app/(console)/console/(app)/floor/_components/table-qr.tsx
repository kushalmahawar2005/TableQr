"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Copy, Download, ExternalLink, Loader2, Printer, X } from "lucide-react";
import { tableQrAction } from "../actions";
import { QR_SIZES, downloadSvg, posterHtml, printPoster, type QrSize } from "./qr-print";

type Qr = NonNullable<Extract<Awaited<ReturnType<typeof tableQrAction>>, { ok: true }>["qr"]>;
const act = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-input border border-line bg-surface px-3 text-body font-semibold text-ink hover:border-ink/40 focus-visible:outline-2 focus-visible:outline-forest";

/** A table's QR: a preview in the panel, tap it to see it big, then print (A6/A5/A4), download or copy the link. */
export function TableQr({ tableId, canSheet = false }: { tableId: string; canSheet?: boolean }) {
  const [state, setState] = useState<{ id: string; qr: Qr | null; error: string | null } | null>(null);
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState<QrSize>("a6");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let off = false;
    tableQrAction(tableId).then((r) => { if (!off) setState({ id: tableId, qr: r.ok ? r.qr : null, error: r.ok ? null : r.message }); });
    return () => { off = true; };
  }, [tableId]);

  const cur = state && state.id === tableId ? state : null;
  const qr = cur?.qr ?? null;
  const copy = async () => { if (!qr) return; try { await navigator.clipboard.writeText(qr.url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); } };
  const print = () => qr && printPoster(posterHtml({ outlet: qr.outletName, table: qr.tableCode, svg: qr.svg, joinCode: qr.joinCode, size }));

  return (
    <section aria-label="Table QR" className="mt-5 border-t border-line pt-4">
      <h3 className="text-caption font-bold tracking-wide text-muted uppercase">QR code</h3>
      {!cur ? (
        <p className="mt-2 flex items-center gap-2 text-body text-muted"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Loading…</p>
      ) : cur.error ? (
        <p role="alert" className="mt-2 text-body text-danger">{cur.error}</p>
      ) : !qr ? (
        <p className="mt-2 text-body text-muted">This table has no live QR yet. It is created when the floor plan is published.</p>
      ) : (
        <div className="mt-2 flex items-start gap-3">
          <button type="button" onClick={() => setOpen(true)} aria-label={`Show the QR for table ${qr.tableCode} bigger`} title="Tap to enlarge" className="group relative size-28 shrink-0 overflow-hidden rounded-input border border-line bg-white p-1.5 focus-visible:outline-2 focus-visible:outline-forest">
            <span className="block size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qr.svg }} />
            <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-label font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Enlarge</span>
          </button>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <button type="button" onClick={() => setOpen(true)} className={act}><Printer className="size-4" aria-hidden="true" />Print or enlarge</button>
            <button type="button" onClick={copy} className={act}>{copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}{copied ? "Link copied" : "Copy link"}</button>
          </div>
        </div>
      )}

      {open && qr && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`QR for table ${qr.tableCode}`} onClick={() => setOpen(false)} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
          <div className="no-scrollbar max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-[1.25rem] border border-line bg-surface p-5 text-ink shadow-modal" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-caption font-semibold text-muted">{qr.outletName}</p><h2 className="font-display text-title font-bold">Table {qr.tableCode}</h2></div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" autoFocus className="grid size-10 place-items-center rounded-input text-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-forest"><X className="size-5" aria-hidden="true" /></button>
            </div>
            <div className="mx-auto mt-4 aspect-square w-full max-w-[300px] rounded-card border border-line bg-white p-3 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qr.svg }} />
            {qr.joinCode && <p className="mt-3 text-center text-body text-muted">Join code <b className="tracking-[0.2em] text-ink">{qr.joinCode}</b></p>}
            <p className="mt-1 break-all text-center text-caption text-muted">{qr.url}</p>

            <fieldset className="mt-4">
              <legend className="text-caption font-bold tracking-wide text-muted uppercase">Print size</legend>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {QR_SIZES.map((s) => (
                  <label key={s.id} className={`cursor-pointer rounded-input border p-2 text-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink ${size === s.id ? "border-ink bg-ink/5" : "border-line"}`}>
                    <input type="radio" name="qr-size" value={s.id} checked={size === s.id} onChange={() => setSize(s.id)} className="sr-only" />
                    <span className="block text-body font-semibold">{s.label}</span>
                    <span className="block text-label text-muted">{s.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={print} className="col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-input bg-ink px-4 text-button font-semibold text-white hover:bg-forest-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"><Printer className="size-4" aria-hidden="true" />Print</button>
              <button type="button" onClick={() => downloadSvg(qr.svg, `qr-table-${qr.tableCode}.svg`)} className={act}><Download className="size-4" aria-hidden="true" />Download</button>
              <button type="button" onClick={copy} className={act}>{copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}{copied ? "Copied" : "Copy link"}</button>
              <a href={qr.url} target="_blank" rel="noreferrer noopener" className={act}><ExternalLink className="size-4" aria-hidden="true" />Test the link</a>
              {canSheet && <Link href={`/console/floor/editor/qr-sheet?size=${size}`} className={act}>Print all tables</Link>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
