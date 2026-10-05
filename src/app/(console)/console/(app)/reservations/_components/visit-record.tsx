"use client";

import { useState, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { detailAction } from "@/server/staff/pos-actions";
import type { PosBillDetail } from "@/server/staff/pos-read";

const money = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const time = (ms: number) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(ms);
const METHOD: Record<string, string> = { upi: "UPI", card: "Card", wallet: "Wallet", cash: "Cash" };
const LINE: Record<string, string> = { voided: "Removed", cancelled: "Cancelled" };

/** Wrap a row: tapping it opens the full record of that visit: who sat, what was ordered and how it was paid. */
export function VisitRecord({ sessionId, className, children }: { sessionId: string; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ data: PosBillDetail | null; error: string | null } | null>(null);

  const show = async () => {
    setOpen(true);
    setState(null);
    try {
      const r = await detailAction(sessionId);
      setState(r.ok ? { data: r.data, error: null } : { data: null, error: r.error });
    } catch {
      setState({ data: null, error: "The record could not be loaded." });
    }
  };

  const d = state?.data ?? null;
  const rounds = d ? [...new Set(d.lines.map((l) => l.roundNo))].sort((a, b) => a - b) : [];
  const nameOf = (id: string | null) => d?.people.find((p) => p.id === id)?.name ?? "Table";

  return (
    <>
      <button type="button" onClick={() => void show()} className={className} aria-haspopup="dialog" title="Open the full record">
        {children}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Visit record" onClick={() => setOpen(false)} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
          <div className="no-scrollbar max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-[1.25rem] border border-line bg-surface p-5 text-ink shadow-modal" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-caption font-semibold text-muted">Visit record</p>
                <h2 className="font-display text-title font-bold">{d ? `Table ${d.tableCode}` : "Loading…"}</h2>
                {d && <p className="mt-0.5 text-body text-muted capitalize">{d.status === "closed" ? "Finished" : d.status === "bill_requested" ? "Bill asked" : "Eating now"}{d.bill ? ` · bill ${d.bill.status}` : ""}</p>}
              </div>
              <button type="button" autoFocus aria-label="Close" onClick={() => setOpen(false)} className="grid size-10 place-items-center rounded-input text-muted hover:bg-ink/5 hover:text-ink"><X className="size-5" aria-hidden="true" /></button>
            </div>

            {!state && <p className="mt-6 flex items-center gap-2 text-body text-muted"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Loading the record…</p>}
            {state?.error && <p role="alert" className="mt-6 rounded-input bg-[var(--state-seated-soft)] p-3 text-body text-danger">{state.error}</p>}

            {d && (
              <div className="mt-5 space-y-5">
                <section>
                  <h3 className="text-caption font-bold tracking-wide text-muted uppercase">Who was there</h3>
                  <p className="mt-1 text-body">{d.people.length ? d.people.map((p) => p.name).join(", ") : "No guest names recorded"}</p>
                </section>

                <section>
                  <h3 className="text-caption font-bold tracking-wide text-muted uppercase">What they ordered</h3>
                  {d.lines.length === 0 ? <p className="mt-1 text-body text-muted">Nothing was ordered.</p> : (
                    <div className="mt-2 space-y-3">
                      {rounds.map((r) => (
                        <div key={r}>
                          <p className="text-caption font-semibold text-muted">Round {r}</p>
                          <ul className="mt-1 divide-y divide-line rounded-input border border-line">
                            {d.lines.filter((l) => l.roundNo === r).map((l) => (
                              <li key={l.id} className="flex items-start justify-between gap-3 px-3 py-2 text-body">
                                <span className={LINE[l.status] ? "text-muted line-through" : ""}>
                                  <b>{l.qty}</b> × {l.name}
                                  <span className="block text-caption text-muted no-underline">for {nameOf(l.participantId)}{LINE[l.status] ? ` · ${LINE[l.status]}` : ""}</span>
                                </span>
                                <span className="shrink-0 tabular">{money(l.qty * l.unitPricePaise)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {d.bill && (
                  <section>
                    <h3 className="text-caption font-bold tracking-wide text-muted uppercase">Bill</h3>
                    <dl className="mt-1 space-y-1 text-body">
                      <div className="flex justify-between"><dt className="text-muted">Items</dt><dd className="tabular">{money(d.bill.subtotalPaise)}</dd></div>
                      <div className="flex justify-between"><dt className="text-muted">Tax</dt><dd className="tabular">{money(d.bill.taxPaise)}</dd></div>
                      {d.bill.serviceChargePaise > 0 && <div className="flex justify-between"><dt className="text-muted">Service charge</dt><dd className="tabular">{money(d.bill.serviceChargePaise)}</dd></div>}
                      <div className="flex justify-between border-t border-line pt-1 font-bold"><dt>Total</dt><dd className="tabular">{money(d.bill.totalPaise)}</dd></div>
                    </dl>
                  </section>
                )}

                <section>
                  <h3 className="text-caption font-bold tracking-wide text-muted uppercase">How it was paid</h3>
                  {d.payments.length === 0 ? <p className="mt-1 text-body text-muted">No payment recorded.</p> : (
                    <ul className="mt-2 divide-y divide-line rounded-input border border-line">
                      {d.payments.map((p) => (
                        <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-body">
                          <span><b>{METHOD[p.method] ?? p.method}</b><span className="block text-caption text-muted capitalize">{p.status} · {time(p.createdAt)}{p.channel === "counter" ? " · at the counter" : ""}</span></span>
                          <span className="shrink-0 tabular">{money(p.amountPaise + p.tipPaise)}{p.tipPaise > 0 && <span className="block text-caption text-muted">incl. {money(p.tipPaise)} tip</span>}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
