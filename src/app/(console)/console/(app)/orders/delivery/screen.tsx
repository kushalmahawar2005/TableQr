"use client";
import { Banknote, Bike, Check, ChefHat, CircleCheck, Clock, MapPin, MessageCircle, Package, Phone, Receipt, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import type { RiderCard } from "@/server/delivery/riders";
import type { deliveryQueue, pendingManualDeliveryPayments } from "@/server/delivery/staff";
import { assignTeamRiderAction } from "../../../../../(staff)/rider/actions";
import { advanceDeliveryAction, assignDeliveryCourierAction, cancelDeliveryOrderAction, confirmManualQrDeliveryPaymentAction } from "./actions";

type Row = Omit<Awaited<ReturnType<typeof deliveryQueue>>[number], "placedAt"> & { placedAt: string | null };
type PendingPayment = Omit<Awaited<ReturnType<typeof pendingManualDeliveryPayments>>[number], "claimedAt"> & { claimedAt: string | null };
const money = (paise: number | null) => `₹${((paise ?? 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "");
const ago = (iso: string | null, now: number) => { if (!iso) return ""; const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000)); return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`; };
const digits = (phone: string | null) => (phone ?? "").replace(/\D/g, "");

/** Where an order is, from the kitchen's status and the delivery status together */
const STEPS = [
  { label: "Placed", icon: Receipt },
  { label: "Preparing", icon: ChefHat },
  { label: "Packed", icon: Package },
  { label: "On the way", icon: Bike },
  { label: "Delivered", icon: CircleCheck },
] as const;
function stageOf(row: Row) {
  if (row.status === "delivered") return 4;
  if (row.status === "dispatched") return 3;
  if (row.kitchenStatus === "ready" || row.kitchenStatus === "served") return 2;
  if (row.kitchenStatus === "accepted" || row.kitchenStatus === "preparing") return 1;
  return 0;
}
const STAGE_TONE = [
  "bg-[var(--state-held-soft)] text-[var(--state-held-text)]",
  "bg-[var(--state-held-soft)] text-[var(--state-held-text)]",
  "bg-[var(--state-bill-soft)] text-[var(--state-bill-text)]",
  "bg-[var(--state-cleaning-soft)] text-[var(--state-cleaning-text)]",
  "bg-[var(--state-available-soft)] text-[var(--state-available-text)]",
];

export function DeliveryQueueScreen({ rows, pendingPayments, canAssignCourier, outlet, tabs, riders = [] }: { rows: Row[]; pendingPayments: PendingPayment[]; canAssignCourier: boolean; outlet: string; tabs?: ReactNode; riders?: RiderCard[] }) {
  const router = useRouter();
  const [pending, start] = useTransition(), [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"active" | "delivered">("active");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => { setNow(Date.now()); if (!document.hidden) router.refresh(); }, 12000); return () => clearInterval(timer); }, [router]);

  const active = rows.filter(row => row.status !== "delivered"), done = rows.filter(row => row.status === "delivered");
  const shown = view === "active" ? active : done;
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) => {
    setError(null);
    start(async () => { try { const result = await fn(); if (!result.ok) setError(result.message ?? "Could not update. Please try again."); else { after?.(); router.refresh(); } } catch { setError("Connection lost. Please try again."); } });
  };
  const stats: [typeof Clock, string, string, string][] = [
    [ChefHat, "In the kitchen", String(active.filter(r => stageOf(r) <= 1).length), "Placed or being cooked"],
    [Package, "Ready to send", String(active.filter(r => stageOf(r) === 2).length), "Packed, waiting for a rider"],
    [Bike, "On the way", String(active.filter(r => r.status === "dispatched").length), `${done.length} delivered`],
    [Banknote, "Cash to collect", money(active.filter(r => r.paid !== "paid").reduce((n, r) => n + (r.totalPaise ?? 0), 0)), "From cash-on-delivery orders"],
  ];

  return <main className="mx-auto w-full max-w-[1560px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
    <header className="min-w-0">
      <p className="text-caption font-semibold text-muted">{outlet} · delivery desk</p>
      <h1 className="mt-1 flex items-center gap-3 font-display text-title font-bold text-ink">Orders
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--state-available-soft)] px-2.5 py-0.5 text-caption font-semibold text-[var(--state-available-text)]"><span className="size-1.5 animate-pulse rounded-full bg-[var(--state-available)]" aria-hidden="true" />Live</span>
      </h1>
      <p className="mt-1 text-body text-muted">Every home delivery from order to doorstep. Updates on its own.</p>
    </header>
    {tabs}

    <dl className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map(([Icon, label, value, hint]) => <div key={label} className="rounded-card border border-line bg-surface p-4">
        <dt className="flex items-center justify-between gap-2 text-caption font-semibold text-muted">{label}<span className="grid size-8 place-items-center rounded-lg bg-brand-soft text-brand-strong"><Icon className="size-4" aria-hidden="true" /></span></dt>
        <dd className="mt-2 font-display text-[28px] font-bold leading-none text-ink tabular">{value}</dd>
        <dd className="mt-1.5 text-caption text-muted">{hint}</dd>
      </div>)}
    </dl>

    {error && <p role="alert" className="mt-4 rounded-card border border-danger/30 bg-[var(--state-seated-soft)] p-4 text-body font-semibold text-danger">{error}</p>}

    {pendingPayments.length > 0 && <section className="mt-5 rounded-card border border-[var(--state-held)]/40 bg-[var(--state-held-soft)] p-4 sm:p-5">
      <h2 className="font-display text-section font-bold text-ink">UPI payments to check · {pendingPayments.length}</h2>
      <p className="mt-1 text-caption text-muted">Match the amount and reference in your bank or UPI app first. Confirming marks the bill paid and sends the order to the kitchen.</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {pendingPayments.map(claim => <article key={claim.id} className="rounded-card border border-line bg-surface p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="font-bold text-ink">{claim.name}</p><a href={`tel:${claim.phone}`} className="text-caption font-semibold text-brand-strong">{claim.phone}</a></div>
            <p className="font-display text-section font-bold text-ink tabular">{money(claim.totalPaise)}</p>
          </div>
          <p className="mt-2 text-caption text-muted">{claim.address.line}, {claim.address.locality} · {claim.address.pincode}</p>
          <p className="mt-2 text-body">UPI reference <strong className="font-mono">{claim.reference}</strong>{claim.claimedAt && <span className="text-caption text-muted"> · sent {clock(claim.claimedAt)}</span>}</p>
          <button type="button" disabled={pending} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-input bg-brand px-4 text-body font-semibold text-brand-on disabled:opacity-50" onClick={() => {
            if (!window.confirm(`Confirm ${money(claim.totalPaise)} received for reference ${claim.reference}? Check your UPI or bank app first.`)) return;
            run(() => confirmManualQrDeliveryPaymentAction(claim.id));
          }}><Check className="size-4" aria-hidden="true" />Payment received · send to kitchen</button>
        </article>)}
      </div>
    </section>}

    <div className="mt-5 flex flex-wrap items-center gap-2">
      {([["active", "Active", active.length], ["delivered", "Delivered", done.length]] as const).map(([key, label, n]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)} className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-body font-semibold transition-colors ${view === key ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink hover:border-ink/40"}`}>{label}<span className={`tabular ${view === key ? "text-white/70" : "text-muted"}`}>{n}</span></button>)}
    </div>

    {!shown.length && <div className="mt-4 rounded-card border border-dashed border-line p-10 text-center">
      <Bike className="mx-auto size-8 text-muted" aria-hidden="true" />
      <p className="mt-3 font-semibold text-ink">{view === "active" ? "No delivery orders right now" : "Nothing delivered yet"}</p>
      <p className="mt-1 text-caption text-muted">{view === "active" ? "New orders from your delivery page show up here by themselves." : "Delivered orders from the last few days are listed here."}</p>
    </div>}

    <div className="mt-4 grid gap-4 xl:grid-cols-2">
      {shown.map(row => <DeliveryCard key={row.id} row={row} now={now} pending={pending} canAssignCourier={canAssignCourier} run={run} riders={riders} />)}
    </div>
  </main>;
}

function DeliveryCard({ row, now, pending, canAssignCourier, run, riders }: { row: Row; now: number; pending: boolean; canAssignCourier: boolean; riders: RiderCard[]; run: (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) => void }) {
  const stage = stageOf(row);
  const [editRider, setEditRider] = useState(false);
  const [courier, setCourier] = useState({ name: row.courierName ?? "", phone: row.courierPhone ?? "" });
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const address = `${row.address.line}, ${row.address.locality} · ${row.address.pincode}`;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${row.address.line}, ${row.address.locality}, ${row.address.pincode}`)}`;
  const phone = digits(row.phone);
  const paid = row.paid === "paid";
  const live = row.status !== "delivered";

  return <article className="flex flex-col rounded-card border border-line bg-surface">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4 sm:p-5">
      <div className="min-w-0">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-bold ${STAGE_TONE[stage]}`}>{STEPS[stage].label}</span>
        <p className="mt-1.5 text-caption text-muted"><Clock className="mr-1 inline size-3.5 align-[-2px]" aria-hidden="true" />Placed {clock(row.placedAt)}{live && <> · {ago(row.placedAt, now)}</>}</p>
      </div>
      <div className="text-right">
        <p className="font-display text-title font-bold leading-none text-ink tabular">{money(row.totalPaise)}</p>
        <span className={`mt-1.5 inline-flex rounded-full px-2.5 py-0.5 text-caption font-bold ${paid ? "bg-[var(--state-available-soft)] text-[var(--state-available-text)]" : "bg-[var(--state-bill-soft)] text-[var(--state-bill-text)]"}`}>{paid ? "Paid" : "Collect cash"}</span>
      </div>
    </div>

    {/* Progress, from order to doorstep */}
    <ol className="flex items-start justify-between gap-1 px-4 pt-4 sm:px-5" aria-label={`Status: ${STEPS[stage].label}`}>
      {STEPS.map((step, i) => {
        const Icon = i < stage || stage === 4 ? Check : step.icon;
        const doneStep = i < stage || stage === 4, current = i === stage && stage !== 4;
        return <li key={step.label} className="relative flex flex-1 flex-col items-center text-center">
          {i > 0 && <span aria-hidden="true" className={`absolute top-4 right-1/2 h-0.5 w-full ${i <= stage ? "bg-[var(--state-available)]" : "bg-line"}`} />}
          <span className={`relative z-10 grid size-8 place-items-center rounded-full ${doneStep ? "bg-[var(--state-available)] text-white" : current ? "bg-brand text-brand-on ring-4 ring-brand/20" : "border border-line bg-surface text-muted"}`}><Icon className="size-4" aria-hidden="true" /></span>
          <span className={`mt-1.5 text-label leading-tight ${current ? "font-bold text-ink" : doneStep ? "font-medium text-ink" : "text-muted"}`}>{step.label}</span>
        </li>;
      })}
    </ol>

    <div className="grid gap-3 p-4 sm:p-5">
      {/* Customer */}
      <div className="flex flex-wrap items-center gap-3 rounded-input bg-paper p-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-strong"><UserRound className="size-5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1"><p className="font-bold text-ink">{row.name}</p><p className="text-caption text-muted tabular">{row.phone}</p></div>
        <a href={`tel:${row.phone}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-input border border-line bg-surface px-3 text-caption font-semibold text-ink hover:border-ink/40"><Phone className="size-4" aria-hidden="true" />Call</a>
        {phone && <a href={`https://wa.me/${phone}`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-1.5 rounded-input border border-line bg-surface px-3 text-caption font-semibold text-ink hover:border-ink/40"><MessageCircle className="size-4" aria-hidden="true" />WhatsApp</a>}
      </div>

      {/* Address */}
      <div className="flex items-start gap-3">
        <MapPin className="mt-0.5 size-5 shrink-0 text-brand-strong" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-body text-ink">{address}</p>
          {row.address.instructions && <p className="mt-0.5 text-caption text-muted">Note: {row.address.instructions}</p>}
        </div>
        <a href={mapUrl} target="_blank" rel="noreferrer" className="shrink-0 text-caption font-semibold text-brand-strong hover:underline">Open map</a>
      </div>

      {/* Items */}
      {row.items.length > 0 && <ul className="rounded-input border border-line">
        {row.items.map((item, i) => <li key={i} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0"><span className="min-w-8 rounded-md bg-ink/5 px-1.5 text-center text-caption font-bold tabular text-ink">{item.qty}×</span><span className="text-body text-ink">{item.name}</span></li>)}
      </ul>}

      {/* Rider: pick from the team (photo, free or busy), or type one from outside the team */}
      {row.courierName && !editRider ? <div className="flex flex-wrap items-center gap-3 rounded-input border border-line p-3">
        <RiderFace url={riders.find((r) => r.id === row.courierUserId)?.photoUrl ?? null} />
        <div className="min-w-0 flex-1"><p className="text-caption text-muted">{row.status === "delivered" ? "Delivered by" : "Rider"}</p><p className="font-semibold text-ink">{row.courierName}{riders.find((r) => r.id === row.courierUserId)?.vehicleNo && <span className="font-normal text-muted"> · {riders.find((r) => r.id === row.courierUserId)?.vehicleNo}</span>}</p></div>
        {row.courierPhone && <a href={`tel:${row.courierPhone}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-input border border-line px-3 text-caption font-semibold text-ink hover:border-ink/40"><Phone className="size-4" aria-hidden="true" />Call rider</a>}
        {live && <button type="button" onClick={() => setEditRider(true)} className="min-h-10 px-2 text-caption font-semibold text-brand-strong hover:underline">Change</button>}
      </div> : live ? <div className="rounded-input border border-dashed border-line p-3">
        <p className="text-caption font-semibold text-ink">Give this delivery to</p>
        {riders.length ? <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {riders.map((r) => <button key={r.id} type="button" disabled={pending || r.availability === "offline"} onClick={() => run(() => assignTeamRiderAction(row.id, r.id), () => setEditRider(false))}
            className={`flex items-center gap-2.5 rounded-input border p-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${r.id === row.courierUserId ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-ink/40"}`}>
            <span className="relative shrink-0"><RiderFace url={r.photoUrl} /><span aria-hidden="true" className={`absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full ring-2 ring-surface ${r.availability === "free" ? "bg-[var(--state-available)]" : r.availability === "busy" ? "bg-danger" : "bg-muted"}`} /></span>
            <span className="min-w-0"><span className="block truncate text-caption font-bold text-ink">{r.name}</span><span className={`block text-label font-semibold ${r.availability === "free" ? "text-[var(--state-available-text)]" : r.availability === "busy" ? "text-danger" : "text-muted"}`}>{r.availability === "free" ? "Free" : r.availability === "busy" ? `Busy · ${r.activeCount} ${r.activeCount === 1 ? "order" : "orders"}` : "Offline"}</span></span>
          </button>)}
        </div> : <p className="mt-1 text-caption text-muted">No riders on your team yet. Add one in Team with the Rider role.</p>}
        {canAssignCourier && <details className="mt-2">
          <summary className="cursor-pointer text-caption font-semibold text-brand-strong">Rider from outside the team</summary>
          <form className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={event => { event.preventDefault(); run(() => assignDeliveryCourierAction(row.id, courier.name, courier.phone), () => setEditRider(false)); }}>
            <label className="sr-only" htmlFor={`courier-name-${row.id}`}>Rider name</label>
            <input id={`courier-name-${row.id}`} value={courier.name} onChange={event => setCourier(c => ({ ...c, name: event.target.value }))} maxLength={80} autoComplete="name" placeholder="Rider name" className="min-h-11 min-w-0 rounded-input border border-line bg-surface px-3 text-body text-ink" />
            <label className="sr-only" htmlFor={`courier-phone-${row.id}`}>Rider phone</label>
            <input id={`courier-phone-${row.id}`} value={courier.phone} onChange={event => setCourier(c => ({ ...c, phone: event.target.value }))} maxLength={20} inputMode="tel" autoComplete="tel" placeholder="Rider phone" className="min-h-11 min-w-0 rounded-input border border-line bg-surface px-3 text-body text-ink" />
            <button type="submit" disabled={pending} className="min-h-11 rounded-input border border-line bg-surface px-4 text-body font-semibold text-ink disabled:opacity-50">Save</button>
          </form>
        </details>}
      </div> : null}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {live && <button type="button" disabled={pending || (row.status === "placed" && stage < 2) || (row.status === "dispatched" && !paid)} onClick={() => run(() => advanceDeliveryAction(row.id, row.status === "placed" ? "dispatched" : "delivered"))} className="inline-flex min-h-11 items-center gap-2 rounded-input bg-brand px-4 text-body font-semibold text-brand-on disabled:opacity-50">
          {row.status === "placed" ? <><Bike className="size-4" aria-hidden="true" />Send out for delivery</> : <><CircleCheck className="size-4" aria-hidden="true" />Mark delivered</>}
        </button>}
        <Link href={`/console/billing?session=${encodeURIComponent(row.sessionId ?? "")}`} className="inline-flex min-h-11 items-center gap-2 rounded-input border border-line px-4 text-body font-semibold text-ink hover:border-ink/40"><Receipt className="size-4" aria-hidden="true" />{paid ? "View bill" : "Bill · record cash"}</Link>
        {canAssignCourier && live && cancelReason === null && <button type="button" disabled={pending} onClick={() => setCancelReason("")} className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-input px-3 text-body font-semibold text-danger hover:bg-danger/5 disabled:opacity-50"><X className="size-4" aria-hidden="true" />Cancel</button>}
      </div>
      {live && row.status === "placed" && stage < 2 && <p className="-mt-1 text-caption text-muted">You can send it out once the kitchen marks every dish ready.</p>}
      {row.status === "dispatched" && !paid && <p className="-mt-1 text-caption font-semibold text-[var(--state-bill-text)]">Collect {money(row.totalPaise)} from the customer, record it in the bill, then mark delivered.</p>}

      {canAssignCourier && cancelReason !== null && <form className="grid gap-2 rounded-input border border-danger/40 p-3 sm:grid-cols-[1fr_auto_auto]" onSubmit={event => { event.preventDefault(); run(() => cancelDeliveryOrderAction(row.id, cancelReason), () => setCancelReason(null)); }}>
        <label className="text-caption font-semibold text-ink sm:col-span-3">Why cancel? Anything already paid is refunded.
          <input className="mt-1 min-h-11 w-full rounded-input border border-line bg-surface px-3 text-body font-normal" value={cancelReason} maxLength={200} onChange={event => setCancelReason(event.target.value)} placeholder="e.g. Customer not reachable, item out of stock" />
        </label>
        <button type="submit" disabled={pending || cancelReason.trim().length < 3} className="min-h-11 rounded-input bg-danger px-4 text-body font-semibold text-white disabled:opacity-50">Cancel and refund</button>
        <button type="button" disabled={pending} onClick={() => setCancelReason(null)} className="min-h-11 rounded-input border border-line px-4 text-body font-semibold text-ink">Keep order</button>
      </form>}
    </div>
  </article>;
}

function RiderFace({ url }: { url: string | null }) {
  // Staff photos live in the photo bucket, so this stays a plain image
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" className="size-10 shrink-0 rounded-full object-cover" /> : <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-strong"><Bike className="size-5" aria-hidden="true" /></span>;
}
