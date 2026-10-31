"use client";
import { useState } from "react";
import type { PosBillDetail } from "@/server/staff/pos-read";
import * as actions from "@/server/staff/pos-actions";

// Payment history with refunds, on the POS bill. The server decides what is refundable; this only
// shows it and asks. A refund is never taken back, so it asks to confirm in the page, with a
// manager PIN when the signed-in role is not a manager or owner.

const button = "min-h-11 rounded-xl border border-line bg-surface px-4 py-3 text-sm font-semibold disabled:opacity-40";
// Its own classes: the shared button sets a white surface that would hide the white label
const danger = "min-h-11 rounded-xl border border-danger bg-danger px-4 py-3 text-sm font-semibold text-white disabled:opacity-40";
const field = "min-h-11 w-full rounded-xl border border-line bg-surface p-3";
const money = (n: number) => `₹${(n / 100).toFixed(2)}`;
const STATUS = { pending: "Pending", success: "Refunded", failed: "Failed" } as const;
const TONE = { pending: "text-warning", success: "text-success", failed: "text-danger" } as const;

type Payment = PosBillDetail["payments"][number];

export function RefundPanel({ payments, needsApproval, disabled, hi, onChanged }: { payments: Payment[]; needsApproval: boolean; disabled: boolean; hi: boolean; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmManualRefund, setConfirmManualRefund] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  const reset = () => { setOpen(null); setAmount(""); setReason(""); setPhone(""); setPin(""); setConfirming(false); setConfirmManualRefund(null); setRequestId(null); };
  const approval = needsApproval ? { phone, pin } : undefined;
  const call = async (fn: () => Promise<{ ok: true; data: { status: string } } | { ok: false; error: string }>, done: (status: string) => string) => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await fn();
      if (!r.ok) setNote({ tone: "bad", text: r.error });
      else { setNote({ tone: r.data.status === "failed" ? "bad" : "ok", text: done(r.data.status) }); reset(); await onChanged(); }
    } catch {
      setNote({ tone: "bad", text: "Connection lost. Check the payment before trying again." });
    } finally { setBusy(false); }
  };

  const paise = Math.round(Number(amount) * 100);
  const selected = payments.find((p) => p.id === open);
  const valid = !!selected && Number.isFinite(paise) && paise > 0 && paise <= selected.refund.refundablePaise && reason.trim().length >= 3 && (!needsApproval || (phone.length >= 10 && /^\d{4}$/.test(pin)));
  const submit = () => {
    if (!selected || !valid) return;
    const id = requestId ?? crypto.randomUUID();
    setRequestId(id);
    void call(() => actions.refundAction({ paymentId: selected.id, amountPaise: paise, reason, requestId: id, approval }), (st) => st === "success" ? "Refund done." : st === "pending" ? selected.channel === "manual_qr" ? "Refund is pending. Return the money from the restaurant UPI account, then record it here." : "Refund sent. It stays pending until the gateway confirms it." : "The gateway refused the refund. Nothing was refunded.");
  };

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="font-bold">{hi ? "भुगतान इतिहास" : "Payment history"}</h3>
      {note && <p role="status" className={`mt-2 rounded-xl border px-3 py-2 text-sm ${note.tone === "ok" ? "border-success/30 text-success" : "border-danger/30 text-danger"}`}>{note.text}</p>}
      {payments.length === 0 && <p className="mt-2 text-sm text-muted">No payments yet.</p>}
      {payments.map((p) => (
        <section key={p.id} aria-label={`Payment ${p.method} ${money(p.amountPaise)}`} className="mt-3 border-t border-line pt-3 text-sm">
          <p className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{p.method} · {p.channel === "counter" ? "counter" : p.channel === "manual_qr" ? "restaurant QR · staff verified" : "online"}</span><span className="tabular-nums">{money(p.amountPaise + p.tipPaise)} · {p.status}</span></p>
          {p.status === "success" && (
            <dl className="mt-1 grid grid-cols-3 gap-2 text-xs text-muted">
              <div><dt>Refunded</dt><dd className="tabular-nums text-ink">{money(p.refund.refundedPaise)}</dd></div>
              <div><dt>Pending</dt><dd className="tabular-nums text-ink">{money(p.refund.pendingPaise)}</dd></div>
              <div><dt>Refundable</dt><dd className="tabular-nums text-ink">{money(p.refund.refundablePaise)}</dd></div>
            </dl>
          )}
          {p.refund.refunds.map((r) => (
            <p key={r.id} className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="tabular-nums">Refund {money(r.amountPaise)} · <span className={`font-semibold ${TONE[r.status]}`}>{STATUS[r.status]}</span></span>
              {r.status === "pending" && (
                p.channel === "manual_qr" && !r.sent ? (
                  <button type="button" className={button} disabled={disabled || busy} onClick={() => setConfirmManualRefund(r.id)}>Record UPI refund</button>
                ) : (
                  <button type="button" className={button} disabled={disabled || busy} onClick={() => void call(() => (r.sent ? actions.checkRefundAction(r.id) : actions.processRefundAction(r.id, approval)), (st) => (st === "success" ? "Refund done." : st === "failed" ? "The gateway refused the refund." : "Still pending at the gateway."))}>
                    {r.sent ? "Check status" : "Send refund"}
                  </button>
                )
              )}
              {confirmManualRefund === r.id && <div className="mt-2 w-full rounded-xl border border-warning/30 bg-warning/5 p-3">
                <p className="text-xs">Only confirm after you have returned {money(r.amountPaise)} to the guest from the restaurant UPI account.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className={danger} disabled={disabled || busy} onClick={() => void call(() => actions.processRefundAction(r.id, approval), (st) => st === "success" ? "UPI refund recorded as returned." : st === "failed" ? "Refund could not be recorded." : "Refund is still pending.")}>Yes, money returned</button>
                  <button type="button" className={button} disabled={busy} onClick={() => setConfirmManualRefund(null)}>Cancel</button>
                </div>
                {needsApproval && <p className="mt-2 text-xs text-muted">Manager PIN approval is required for this action.</p>}
              </div>}
            </p>
          ))}
          {p.refund.refundablePaise > 0 && open !== p.id && (
            <button type="button" className={`${button} mt-2`} disabled={disabled || busy} onClick={() => { reset(); setOpen(p.id); setAmount((p.refund.refundablePaise / 100).toFixed(2)); }}>Refund…</button>
          )}
          {open === p.id && (
            <form className="mt-3 grid gap-2" onSubmit={(e) => { e.preventDefault(); if (valid) setConfirming(true); }}>
              <label className="grid gap-1 text-xs font-semibold">Refund amount (₹)
                <input className={field} inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setConfirming(false); }} aria-invalid={!!amount && !valid} />
              </label>
              {!!amount && paise > p.refund.refundablePaise && <p role="alert" className="text-xs text-danger">That is more than the {money(p.refund.refundablePaise)} left to refund.</p>}
              <label className="grid gap-1 text-xs font-semibold">Reason
                <input className={field} maxLength={200} value={reason} onChange={(e) => { setReason(e.target.value); setConfirming(false); }} />
              </label>
              {needsApproval && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1 text-xs font-semibold">Manager phone<input className={field} inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
                  <label className="grid gap-1 text-xs font-semibold">Manager PIN<input className={field} inputMode="numeric" type="password" autoComplete="new-password" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value)} /></label>
                </div>
              )}
              {p.channel === "counter" && <p className="text-xs text-muted">Counter payment: hand the money back yourself. This records that it was returned.</p>}
              {p.channel === "manual_qr" && <p className="text-xs text-muted">Return the money from the restaurant UPI account. It will stay pending until you record the return here.</p>}
              {!confirming ? (
                <div className="flex gap-2"><button type="submit" className={button} disabled={!valid || busy}>Review refund</button><button type="button" className={button} onClick={reset}>Cancel</button></div>
              ) : (
                <div className="grid gap-2 rounded-xl border border-danger/30 p-3">
                  <p className="text-sm font-semibold">Refund {money(paise)} on this payment? This cannot be undone.</p>
                  <div className="flex gap-2"><button type="button" className={danger} disabled={busy} onClick={submit}>{busy ? "Refunding…" : "Confirm refund"}</button><button type="button" className={button} disabled={busy} onClick={() => setConfirming(false)}>Back</button></div>
                </div>
              )}
            </form>
          )}
        </section>
      ))}
    </div>
  );
}
