"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { deliveryQueue, pendingManualDeliveryPayments } from "@/server/delivery/staff";
import { advanceDeliveryAction, confirmManualQrDeliveryPaymentAction } from "./actions";

type Row = Omit<Awaited<ReturnType<typeof deliveryQueue>>[number], "placedAt"> & { placedAt: string | null };
type PendingPayment = Omit<Awaited<ReturnType<typeof pendingManualDeliveryPayments>>[number], "claimedAt"> & { claimedAt: string | null };
const money = (paise: number | null) => `₹${((paise ?? 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function DeliveryQueueScreen({ rows, pendingPayments }: { rows: Row[]; pendingPayments: PendingPayment[] }) {
  const router = useRouter();
  const [pending, start] = useTransition(), [error, setError] = useState<string | null>(null);
  useEffect(() => { const timer = setInterval(() => { if (!document.hidden) router.refresh(); }, 12000); return () => clearInterval(timer); }, [router]);
  const active = rows.filter(row => row.status !== "delivered"), done = rows.filter(row => row.status === "delivered");
  return <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-7">
    <Link href="/console/orders" className="text-sm font-semibold text-brand-strong">← All orders</Link>
    <header><h1 className="text-2xl font-bold text-ink">Delivery orders</h1><p className="mt-1 text-sm text-muted">Review QR payment claims before preparation. Dispatch packed orders here and record cash-on-delivery in Billing.</p></header>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {pendingPayments.length > 0 && <section className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-ink sm:p-5">
      <div><h2 className="font-bold">UPI QR payments to verify · {pendingPayments.length}</h2><p className="mt-1 text-sm text-muted">Check the amount and transaction reference in the restaurant’s bank or UPI account before confirming. Confirmation marks the bill paid and sends the order to the kitchen.</p></div>
      {pendingPayments.map(claim => <article key={claim.id} className="space-y-3 rounded-xl border border-amber-200 bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{claim.name} · delivery</h3><a href={`tel:${claim.phone}`} className="mt-1 inline-block min-h-9 text-sm text-brand-strong">{claim.phone}</a></div><p className="text-lg font-bold">{money(claim.totalPaise)}</p></div>
        <p className="text-sm">{claim.address.line}, {claim.address.locality} · {claim.address.pincode}</p>
        <p className="text-sm">UPI reference: <strong className="font-mono">{claim.reference}</strong></p>
        <button type="button" disabled={pending} className="min-h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-brand-on disabled:opacity-50" onClick={() => {
          if (!window.confirm(`Confirm ₹${((claim.totalPaise ?? 0) / 100).toFixed(2)} received for reference ${claim.reference}? Check your UPI/bank account before confirming.`)) return;
          setError(null); start(async () => { try { const result = await confirmManualQrDeliveryPaymentAction(claim.id); if (!result.ok) setError(result.message); else router.refresh(); } catch { setError("Connection lost. Please try again."); } });
        }}>I verified this payment · place order</button>
      </article>)}
    </section>}
    {!active.length && <p className="rounded-2xl border border-line p-6 text-muted">No active delivery orders.</p>}
    {[...active, ...done].map(row => <article key={row.id} className="space-y-3 rounded-2xl border border-line bg-surface p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold text-ink">{row.name} · <span className="capitalize">{row.status}</span></h2><a href={`tel:${row.phone}`} className="mt-1 inline-block min-h-9 text-sm text-brand-strong">{row.phone}</a></div><div className="text-right"><p className="font-bold text-ink">{money(row.totalPaise)}</p><p className="text-sm text-muted">{row.paid === "paid" ? "Paid" : "Collect on delivery"}</p></div></div><p className="text-sm text-ink">{row.address.line}, {row.address.locality} · {row.address.pincode}</p>{row.address.instructions && <p className="text-sm text-muted">Instructions: {row.address.instructions}</p>}<div className="flex flex-wrap gap-3"><Link href={`/console/billing?session=${encodeURIComponent(row.sessionId ?? "")}`} className="min-h-11 rounded-xl border border-line px-4 py-3 text-sm font-semibold text-ink">Open bill / record payment</Link>{row.status !== "delivered" && <button type="button" disabled={pending} className="min-h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-brand-on disabled:opacity-50" onClick={() => { setError(null); start(async () => { try { const result = await advanceDeliveryAction(row.id, row.status === "placed" ? "dispatched" : "delivered"); if (!result.ok) setError(result.message); else router.refresh(); } catch { setError("Connection lost. Please try again."); } }); }}>{row.status === "placed" ? "Mark dispatched" : "Mark delivered"}</button>}</div></article>)}
  </main>;
}
