"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { deliveryQueue, pendingManualDeliveryPayments } from "@/server/delivery/staff";
import { advanceDeliveryAction, assignDeliveryCourierAction, cancelDeliveryOrderAction, confirmManualQrDeliveryPaymentAction } from "./actions";

type Row = Omit<Awaited<ReturnType<typeof deliveryQueue>>[number], "placedAt"> & { placedAt: string | null };
type PendingPayment = Omit<Awaited<ReturnType<typeof pendingManualDeliveryPayments>>[number], "claimedAt"> & { claimedAt: string | null };
const money = (paise: number | null) => `₹${((paise ?? 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function DeliveryQueueScreen({ rows, pendingPayments, canAssignCourier }: { rows: Row[]; pendingPayments: PendingPayment[]; canAssignCourier: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition(), [error, setError] = useState<string | null>(null);
  const [couriers, setCouriers] = useState<Record<string, { name: string; phone: string }>>({});
  const [cancelling, setCancelling] = useState<{ id: string; reason: string } | null>(null);
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
    {[...active, ...done].map(row => {
      const courier = couriers[row.id] ?? { name: row.courierName ?? "", phone: row.courierPhone ?? "" };
      return <article key={row.id} className="space-y-3 rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold text-ink">{row.name} · <span className="capitalize">{row.status}</span></h2><a href={`tel:${row.phone}`} className="mt-1 inline-block min-h-9 text-sm text-brand-strong">{row.phone}</a></div><div className="text-right"><p className="font-bold text-ink">{money(row.totalPaise)}</p><p className="text-sm text-muted">{row.paid === "paid" ? "Paid" : "Collect on delivery"}</p></div></div>
        <p className="text-sm text-ink">{row.address.line}, {row.address.locality} · {row.address.pincode}</p>{row.address.instructions && <p className="text-sm text-muted">Instructions: {row.address.instructions}</p>}
        {canAssignCourier && row.status !== "delivered" ? <form className="grid gap-2 rounded-xl bg-canvas p-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={event => { event.preventDefault(); setError(null); start(async () => { try { const result = await assignDeliveryCourierAction(row.id, courier.name, courier.phone); if (!result.ok) setError(result.message); else router.refresh(); } catch { setError("Connection lost. Please try again."); } }); }}>
          <label className="sr-only" htmlFor={`courier-name-${row.id}`}>Rider name</label><input id={`courier-name-${row.id}`} value={courier.name} onChange={event => setCouriers(current => ({ ...current, [row.id]: { ...courier, name: event.target.value } }))} maxLength={80} autoComplete="name" placeholder="Rider name" className="min-h-11 min-w-0 rounded-xl border border-line bg-surface px-3 text-sm text-ink" />
          <label className="sr-only" htmlFor={`courier-phone-${row.id}`}>Rider phone</label><input id={`courier-phone-${row.id}`} value={courier.phone} onChange={event => setCouriers(current => ({ ...current, [row.id]: { ...courier, phone: event.target.value } }))} maxLength={20} inputMode="tel" autoComplete="tel" placeholder="Rider phone" className="min-h-11 min-w-0 rounded-xl border border-line bg-surface px-3 text-sm text-ink" />
          <button type="submit" disabled={pending} className="min-h-11 rounded-xl border border-line px-4 text-sm font-semibold text-ink disabled:opacity-50">{row.courierName ? "Update rider" : "Assign rider"}</button>
          <p className="text-xs text-muted sm:col-span-3">Only an owner or manager can assign a rider. The customer can call this number once the order is on the way.</p>
        </form> : row.courierName && <p className="text-sm text-muted">{row.status === "delivered" ? "Delivered by" : "Rider"} {row.courierName}{row.courierPhone && <> · <a href={`tel:${row.courierPhone}`} className="text-brand-strong">{row.courierPhone}</a></>}</p>}
        <div className="flex flex-wrap gap-3"><Link href={`/console/billing?session=${encodeURIComponent(row.sessionId ?? "")}`} className="min-h-11 rounded-xl border border-line px-4 py-3 text-sm font-semibold text-ink">Open bill / record payment</Link>{row.status !== "delivered" && <button type="button" disabled={pending} className="min-h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-brand-on disabled:opacity-50" onClick={() => { setError(null); start(async () => { try { const result = await advanceDeliveryAction(row.id, row.status === "placed" ? "dispatched" : "delivered"); if (!result.ok) setError(result.message); else router.refresh(); } catch { setError("Connection lost. Please try again."); } }); }}>{row.status === "placed" ? "Mark dispatched" : "Mark delivered"}</button>}{canAssignCourier && row.status !== "delivered" && cancelling?.id !== row.id && <button type="button" disabled={pending} className="min-h-11 rounded-xl border border-danger px-4 text-sm font-semibold text-danger disabled:opacity-50" onClick={() => setCancelling({ id: row.id, reason: "" })}>Cancel order</button>}</div>
        {canAssignCourier && cancelling?.id === row.id && <form className="grid gap-2 rounded-xl border border-danger/40 bg-canvas p-3 sm:grid-cols-[1fr_auto_auto]" onSubmit={event => { event.preventDefault(); setError(null); start(async () => { try { const result = await cancelDeliveryOrderAction(row.id, cancelling.reason); if (!result.ok) setError(result.message); else { setCancelling(null); router.refresh(); } } catch { setError("Connection lost. Please try again."); } }); }}><label className="text-sm font-semibold sm:col-span-3">Why is this delivery cancelled? Anything already paid is refunded.<input className="mt-1 w-full rounded-xl border border-line px-3 py-2 font-normal" value={cancelling.reason} maxLength={200} onChange={event => setCancelling({ id: row.id, reason: event.target.value })} placeholder="e.g. Customer unreachable, kitchen out of stock" /></label><button type="submit" disabled={pending || cancelling.reason.trim().length < 3} className="min-h-11 rounded-xl bg-danger px-4 text-sm font-semibold text-white disabled:opacity-50">Yes, cancel and refund</button><button type="button" disabled={pending} className="min-h-11 rounded-xl border border-line px-4 text-sm font-semibold" onClick={() => setCancelling(null)}>Keep order</button></form>}
      </article>;
    })}
  </main>;
}
