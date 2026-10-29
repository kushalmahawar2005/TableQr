"use client";
import { Banknote, Bike, Check, ChefHat, CircleCheck, Clock, MapPin, MessageCircle, Package, Phone, Receipt, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import type { RiderCard } from "@/server/delivery/riders";
import { LiveMap, type MapPoint } from "@/components/live-map";
import type { deliveryQueue, pendingManualDeliveryPayments } from "@/server/delivery/staff";
import { assignTeamRiderAction } from "../../../../../(staff)/rider/actions";
import { connectRealtime } from "@/lib/realtime-client";
import { advanceDeliveryAction, assignDeliveryCourierAction, cancelDeliveryOrderAction, confirmManualQrDeliveryPaymentAction, deliveryDeskTokenAction } from "./actions";

type Row = Omit<Awaited<ReturnType<typeof deliveryQueue>>[number], "placedAt" | "address"> & { placedAt: string | null; address: NonNullable<Awaited<ReturnType<typeof deliveryQueue>>[number]["address"]> };
type PendingPayment = Omit<Awaited<ReturnType<typeof pendingManualDeliveryPayments>>[number], "claimedAt"> & { claimedAt: string | null };
const money = (paise: number | null) => `₹${((paise ?? 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "");
const ago = (iso: string | null, now: number) => { if (!iso) return ""; const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000)); return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`; };
const digits = (phone: string | null) => (phone ?? "").replace(/\D/g, "");

/** Where an order is, from the kitchen's status and the delivery status together */
const DELIVERY_STEPS = [
  { label: "Placed", icon: Receipt },
  { label: "Preparing", icon: ChefHat },
  { label: "Packed", icon: Package },
  { label: "On the way", icon: Bike },
  { label: "Delivered", icon: CircleCheck },
] as const;
const PICKUP_STEPS = [
  { label: "Placed", icon: Receipt },
  { label: "Preparing", icon: ChefHat },
  { label: "Ready for pickup", icon: Package },
  { label: "Collected", icon: CircleCheck },
] as const;
const stepsFor = (row: Row) => row.serviceMode === "pickup" ? PICKUP_STEPS : DELIVERY_STEPS;
function stageOf(row: Row) {
  if (row.status === "collected") return 3;
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

export function DeliveryQueueScreen({ rows, pendingPayments, canAssignCourier, outlet, tabs, riders = [], realtimeUrl = null, availableModes }: { rows: Row[]; pendingPayments: PendingPayment[]; canAssignCourier: boolean; outlet: string; tabs?: ReactNode; riders?: RiderCard[]; realtimeUrl?: string | null; availableModes: { pickup: boolean; delivery: boolean } }) {
  const router = useRouter();
  const [pending, start] = useTransition(), [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"active" | "completed">("active");
  const hasPickup = availableModes.pickup || rows.some(row => row.serviceMode === "pickup") || pendingPayments.some(payment => payment.serviceMode === "pickup");
  const hasDelivery = availableModes.delivery || rows.some(row => row.serviceMode === "delivery") || pendingPayments.some(payment => payment.serviceMode === "delivery");
  const [mode, setMode] = useState<"all" | "pickup" | "delivery">(() => hasPickup && hasDelivery ? "all" : hasPickup ? "pickup" : hasDelivery ? "delivery" : "all");
  const [now, setNow] = useState(() => Date.now());
  // Rider dots move from live events without reloading the page
  const [moved, setMoved] = useState<Record<string, { lat: number; lng: number; at: number }>>({});
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (mode === "pickup" && !hasPickup) setMode(hasDelivery ? "delivery" : "all");
    else if (mode === "delivery" && !hasDelivery) setMode(hasPickup ? "pickup" : "all");
    else if (mode === "all" && hasPickup !== hasDelivery) setMode(hasPickup ? "pickup" : "delivery");
  }, [hasDelivery, hasPickup, mode]);
  // Any delivery or kitchen change reloads this screen's data once, a moment later, so a burst of
  // events is one reload. With the live connection down it falls back to checking every 12 s.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reload = () => { if (timer) return; timer = setTimeout(() => { timer = null; router.refresh(); }, 800); };
    const stop = connectRealtime({
      url: realtimeUrl,
      getToken: deliveryDeskTokenAction,
      pollMs: 12_000,
      onResync: () => { if (!document.hidden) router.refresh(); },
      onEvents: (events) => {
        let other = false;
        for (const e of events) {
          if (e.type === "rider.location" && e.data && typeof e.data.riderId === "string") {
            const d = e.data as { riderId: string; lat: number; lng: number; at: number };
            setMoved((m) => ({ ...m, [d.riderId]: { lat: d.lat, lng: d.lng, at: d.at } }));
          } else other = true;
        }
        if (other) reload();
      },
    });
    return () => { stop(); if (timer) clearTimeout(timer); };
  }, [router, realtimeUrl]);

  const modeRows = rows.filter(row => mode === "all" || row.serviceMode === mode);
  const visiblePendingPayments = pendingPayments.filter(payment => mode === "all" || payment.serviceMode === mode);
  const active = modeRows.filter(row => row.status !== "delivered" && row.status !== "collected" && row.status !== "cancelled");
  const done = modeRows.filter(row => row.status === "delivered" || row.status === "collected");
  const shown = view === "active" ? active : done;
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) => {
    setError(null);
    start(async () => { try { const result = await fn(); if (!result.ok) setError(result.message ?? "Could not update. Please try again."); else { after?.(); router.refresh(); } } catch { setError("Connection lost. Please try again."); } });
  };
  const stats: [typeof Clock, string, string, string][] = [
    [ChefHat, "In the kitchen", String(active.filter(r => stageOf(r) <= 1).length), "Placed or being prepared"],
    [Package, mode === "pickup" ? "Ready for pickup" : mode === "delivery" ? "Ready to send" : "Ready to go", String(active.filter(r => stageOf(r) === 2).length), mode === "pickup" ? "Waiting at the counter" : "Packed and waiting"],
    [Bike, mode === "pickup" ? "Collected" : "On the way", String(mode === "pickup" ? done.filter(r => r.serviceMode === "pickup").length : active.filter(r => r.status === "dispatched").length), `${done.length} completed`],
    [Banknote, "Payment due", money(active.filter(r => r.paid !== "paid").reduce((n, r) => n + (r.totalPaise ?? 0), 0)), "Record payment before handover"],
  ];

  return <main className="mx-auto w-full max-w-[1560px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
    <header className="min-w-0">
      <p className="text-caption font-semibold text-muted">{outlet} · guest orders</p>
      <h1 className="mt-1 flex items-center gap-3 font-display text-title font-bold text-ink">Orders
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--state-available-soft)] px-2.5 py-0.5 text-caption font-semibold text-[var(--state-available-text)]"><span className="size-1.5 animate-pulse rounded-full bg-[var(--state-available)]" aria-hidden="true" />Live</span>
      </h1>
      <p className="mt-1 text-body text-muted">{hasPickup && hasDelivery ? "Pickup and delivery orders in one live queue." : hasPickup ? "Guest pickup orders in one live queue." : "Guest delivery orders in one live queue."}</p>
    </header>
    {tabs}

    <dl className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map(([Icon, label, value, hint]) => <div key={label} className="rounded-card border border-line bg-surface p-4">
        <dt className="flex items-center justify-between gap-2 text-caption font-semibold text-muted">{label}<span className="grid size-8 place-items-center rounded-lg bg-brand-soft text-brand-strong"><Icon className="size-4" aria-hidden="true" /></span></dt>
        <dd className="mt-2 font-display text-[28px] font-bold leading-none text-ink tabular">{value}</dd>
        <dd className="mt-1.5 text-caption text-muted">{hint}</dd>
      </div>)}
    </dl>

    {(() => {
      // Riders sharing their location, and the doors of live orders that have a pin
      const points: MapPoint[] = [
        ...riders.map((r) => ({ r, at: moved[r.id] && (!r.location || moved[r.id].at > r.location.at) ? moved[r.id] : r.location })).filter(({ r, at }) => at && r.availability !== "offline").map(({ r, at }) => ({ id: `r-${r.id}`, kind: "rider" as const, lat: at!.lat, lng: at!.lng, photoUrl: r.photoUrl, label: r.name })),
        ...active.filter((r) => r.serviceMode === "delivery" && r.address.lat !== undefined && r.address.lng !== undefined).map((r) => ({ id: `h-${r.id}`, kind: "home" as const, lat: r.address.lat!, lng: r.address.lng!, label: r.name ?? "Customer" })),
      ];
      return mode !== "pickup" && points.length ? <section className="mt-5">
        <div className="mb-2 flex items-center justify-between gap-2"><h2 className="font-display text-section font-bold text-ink">Live map</h2><p className="text-caption text-muted">🛵 riders · 🏠 customers · updates by itself</p></div>
        <LiveMap className="h-72" points={points} />
      </section> : null;
    })()}

    {error && <p role="alert" className="mt-4 rounded-card border border-danger/30 bg-[var(--state-seated-soft)] p-4 text-body font-semibold text-danger">{error}</p>}

    {visiblePendingPayments.length > 0 && <section className="mt-5 rounded-card border border-[var(--state-held)]/40 bg-[var(--state-held-soft)] p-4 sm:p-5">
      <h2 className="font-display text-section font-bold text-ink">UPI payments to check · {visiblePendingPayments.length}</h2>
      <p className="mt-1 text-caption text-muted">Match the amount and reference in your bank or UPI app first. Confirming marks the bill paid and sends the order to the kitchen.</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {visiblePendingPayments.map(claim => <article key={claim.id} className="rounded-card border border-line bg-surface p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="font-bold text-ink">{claim.name}</p><a href={`tel:${claim.phone}`} className="text-caption font-semibold text-brand-strong">{claim.phone}</a></div>
            <p className="font-display text-section font-bold text-ink tabular">{money(claim.totalPaise)}</p>
          </div>
          <p className="mt-2 text-caption text-muted">{claim.serviceMode === "pickup" ? "Pickup at the counter" : `${claim.address?.line ?? ""}, ${claim.address?.locality ?? ""} · ${claim.address?.pincode ?? ""}`}</p>
          <p className="mt-2 text-body">UPI reference <strong className="font-mono">{claim.reference}</strong>{claim.claimedAt && <span className="text-caption text-muted"> · sent {clock(claim.claimedAt)}</span>}</p>
          <button type="button" disabled={pending} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-input bg-brand px-4 text-body font-semibold text-brand-on disabled:opacity-50" onClick={() => {
            if (!window.confirm(`Confirm ${money(claim.totalPaise)} received for reference ${claim.reference}? Check your UPI or bank app first.`)) return;
            run(() => confirmManualQrDeliveryPaymentAction(claim.id));
          }}><Check className="size-4" aria-hidden="true" />Payment received · send to kitchen</button>
        </article>)}
      </div>
    </section>}

    {hasPickup && hasDelivery && <div className="mt-5 flex flex-wrap items-center gap-2" aria-label="Filter guest order mode">
      {([["all", "All guest orders"], ["pickup", "Pickup / takeaway"], ["delivery", "Delivery"]] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={mode === key} onClick={() => setMode(key)} className={`inline-flex min-h-11 items-center rounded-full border px-4 text-body font-semibold transition-colors ${mode === key ? "border-brand bg-brand text-brand-on" : "border-line bg-surface text-ink hover:border-ink/40"}`}>{label}<span className={`ml-2 tabular ${mode === key ? "text-brand-on/70" : "text-muted"}`}>{rows.filter(r => (key === "all" || r.serviceMode === key) && r.status !== "cancelled").length}</span></button>)}
    </div>}

    <div className="mt-3 flex flex-wrap items-center gap-2">
      {([["active", "Active", active.length], ["completed", "Completed", done.length]] as const).map(([key, label, n]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)} className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-body font-semibold transition-colors ${view === key ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink hover:border-ink/40"}`}>{label}<span className={`tabular ${view === key ? "text-white/70" : "text-muted"}`}>{n}</span></button>)}
    </div>

    {!shown.length && <div className="mt-4 rounded-card border border-dashed border-line p-10 text-center">
      <Bike className="mx-auto size-8 text-muted" aria-hidden="true" />
      <p className="mt-3 font-semibold text-ink">{view === "active" ? "No guest orders right now" : "Nothing completed yet"}</p>
      <p className="mt-1 text-caption text-muted">{view === "active" ? `New ${mode === "pickup" ? "pickup" : mode === "delivery" ? "delivery" : "pickup and delivery"} orders appear here automatically.` : `Completed ${mode === "pickup" ? "pickup" : mode === "delivery" ? "delivery" : "pickup and delivery"} orders appear here.`}</p>
    </div>}

    <div className="mt-4 grid gap-4 xl:grid-cols-2">
      {shown.map(row => <DeliveryCard key={row.id} row={row} now={now} pending={pending} canAssignCourier={canAssignCourier} run={run} riders={riders} />)}
    </div>
  </main>;
}

function DeliveryCard({ row, now, pending, canAssignCourier, run, riders }: { row: Row; now: number; pending: boolean; canAssignCourier: boolean; riders: RiderCard[]; run: (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) => void }) {
  const stage = stageOf(row), steps = stepsFor(row), complete = row.status === "delivered" || row.status === "collected";
  const [editRider, setEditRider] = useState(false);
  const [courier, setCourier] = useState({ name: row.courierName ?? "", phone: row.courierPhone ?? "" });
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const address = `${row.address?.line ?? ""}, ${row.address?.locality ?? ""} · ${row.address?.pincode ?? ""}`;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${row.address?.line ?? ""}, ${row.address?.locality ?? ""}, ${row.address?.pincode ?? ""}`)}`;
  const phone = digits(row.phone);
  const paid = row.paid === "paid";
  const live = !complete && row.status !== "cancelled";
  const nextStatus = row.serviceMode === "pickup" ? "collected" as const : row.status === "placed" ? "dispatched" as const : "delivered" as const;
  const canFinish = row.status === "placed" && stage >= 2 && paid;

  return <article className="flex flex-col rounded-card border border-line bg-surface">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4 sm:p-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-bold ${STAGE_TONE[stage]}`}>{steps[Math.min(stage, steps.length - 1)].label}</span><span className="rounded-full bg-ink/5 px-2.5 py-0.5 text-caption font-semibold text-muted">{row.serviceMode === "pickup" ? "Pickup" : "Delivery"}</span></div>
        <p className="mt-1.5 text-caption text-muted"><Clock className="mr-1 inline size-3.5 align-[-2px]" aria-hidden="true" />Placed {clock(row.placedAt)}{live && <> · {ago(row.placedAt, now)}</>}</p>
      </div>
      <div className="text-right">
        <p className="font-display text-title font-bold leading-none text-ink tabular">{money(row.totalPaise)}</p>
        <span className={`mt-1.5 inline-flex rounded-full px-2.5 py-0.5 text-caption font-bold ${paid ? "bg-[var(--state-available-soft)] text-[var(--state-available-text)]" : "bg-[var(--state-bill-soft)] text-[var(--state-bill-text)]"}`}>{paid ? "Paid" : row.serviceMode === "pickup" ? "Pay at pickup" : "Payment due"}</span>
      </div>
    </div>

    {/* Progress follows the real pickup or delivery journey */}
    <ol className="flex items-start justify-between gap-1 px-4 pt-4 sm:px-5" aria-label={`Status: ${steps[Math.min(stage, steps.length - 1)].label}`}>
      {steps.map((step, i) => {
        const isDone = complete && i === steps.length - 1;
        const Icon = i < stage || isDone ? Check : step.icon;
        const doneStep = i < stage || isDone, current = i === stage && !isDone;
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

      {row.serviceMode === "pickup" ? <p className="flex items-center gap-2 rounded-input bg-paper p-3 text-body font-medium text-ink"><Package className="size-5 shrink-0 text-brand-strong" aria-hidden="true" />Guest will collect this order at the counter.</p> : <div className="flex items-start gap-3">
        <MapPin className="mt-0.5 size-5 shrink-0 text-brand-strong" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-body text-ink">{address}</p>
          {row.address.instructions && <p className="mt-0.5 text-caption text-muted">Note: {row.address.instructions}</p>}
        </div>
        <a href={mapUrl} target="_blank" rel="noreferrer" className="shrink-0 text-caption font-semibold text-brand-strong hover:underline">Open map</a>
      </div>}

      {/* Items */}
      {row.items.length > 0 && <ul className="rounded-input border border-line">
        {row.items.map((item, i) => <li key={i} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0"><span className="min-w-8 rounded-md bg-ink/5 px-1.5 text-center text-caption font-bold tabular text-ink">{item.qty}×</span><span className="text-body text-ink">{item.name}</span></li>)}
      </ul>}

      {row.serviceMode === "delivery" && row.paymentIssue && <p role="alert" className="rounded-input border border-[var(--state-held)]/40 bg-[var(--state-held-soft)] p-3 text-caption text-[var(--state-held-text)]"><b>Payment issue from rider:</b> {row.paymentIssue}</p>}
      {row.serviceMode === "delivery" && row.status === "dispatched" && row.deliveryPin && <p className="text-caption text-muted">Delivery PIN (if the customer can&apos;t find it): <b className="font-mono text-ink">{row.deliveryPin}</b></p>}
      {row.serviceMode === "delivery" && row.riderRating !== null && <p className="text-caption text-ink">Customer rated the rider <b className="text-[var(--state-held)]">{"★".repeat(row.riderRating)}</b>{row.riderRatingNote ? ` · “${row.riderRatingNote}”` : ""}</p>}
      {/* Rider: pick from the team (photo, free or busy), or type one from outside the team */}
      {row.serviceMode === "delivery" && row.courierName && !editRider ? <div className="flex flex-wrap items-center gap-3 rounded-input border border-line p-3">
        <RiderFace url={riders.find((r) => r.id === row.courierUserId)?.photoUrl ?? null} />
        <div className="min-w-0 flex-1"><p className="text-caption text-muted">{row.status === "delivered" ? "Delivered by" : "Rider"}</p><p className="font-semibold text-ink">{row.courierName}{riders.find((r) => r.id === row.courierUserId)?.vehicleNo && <span className="font-normal text-muted"> · {riders.find((r) => r.id === row.courierUserId)?.vehicleNo}</span>}</p></div>
        {row.courierPhone && <a href={`tel:${row.courierPhone}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-input border border-line px-3 text-caption font-semibold text-ink hover:border-ink/40"><Phone className="size-4" aria-hidden="true" />Call rider</a>}
        {live && <button type="button" onClick={() => setEditRider(true)} className="min-h-10 px-2 text-caption font-semibold text-brand-strong hover:underline">Change</button>}
      </div> : row.serviceMode === "delivery" && live ? <div className="rounded-input border border-dashed border-line p-3">
        <p className="text-caption font-semibold text-ink">Give this delivery to</p>
        {riders.length ? <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {riders.map((r) => <button key={r.id} type="button" disabled={pending || r.availability === "offline"} onClick={() => run(() => assignTeamRiderAction(row.id, r.id), () => setEditRider(false))}
            className={`flex items-center gap-2.5 rounded-input border p-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${r.id === row.courierUserId ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-ink/40"}`}>
            <span className="relative shrink-0"><RiderFace url={r.photoUrl} /><span aria-hidden="true" className={`absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full ring-2 ring-surface ${r.availability === "free" ? "bg-[var(--state-available)]" : r.availability === "busy" ? "bg-danger" : "bg-muted"}`} /></span>
            <span className="min-w-0"><span className="block truncate text-caption font-bold text-ink">{r.name}{r.verified && <span className="ml-1 text-[var(--state-available-text)]" title="Verified rider">✓</span>}</span><span className={`block text-label font-semibold ${r.availability === "free" ? "text-[var(--state-available-text)]" : r.availability === "busy" ? "text-danger" : "text-muted"}`}>{r.availability === "free" ? "Free" : r.availability === "busy" ? `Busy · ${r.activeCount} ${r.activeCount === 1 ? "order" : "orders"}` : "Offline"}</span></span>
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
        {live && <button type="button" disabled={pending || (row.status === "placed" && (stage < 2 || !paid)) || (row.status === "dispatched" && !paid)} onClick={() => run(() => advanceDeliveryAction(row.id, nextStatus))} className="inline-flex min-h-11 items-center gap-2 rounded-input bg-brand px-4 text-body font-semibold text-brand-on disabled:opacity-50">
          {row.serviceMode === "pickup" ? <><CircleCheck className="size-4" aria-hidden="true" />Mark collected</> : row.status === "placed" ? <><Bike className="size-4" aria-hidden="true" />Send out for delivery</> : <><CircleCheck className="size-4" aria-hidden="true" />Mark delivered</>}
        </button>}
        <Link href={`/console/billing?session=${encodeURIComponent(row.sessionId ?? "")}`} className="inline-flex min-h-11 items-center gap-2 rounded-input border border-line px-4 text-body font-semibold text-ink hover:border-ink/40"><Receipt className="size-4" aria-hidden="true" />{paid ? "View bill" : "Bill · record cash"}</Link>
        {canAssignCourier && live && cancelReason === null && <button type="button" disabled={pending} onClick={() => setCancelReason("")} className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-input px-3 text-body font-semibold text-danger hover:bg-danger/5 disabled:opacity-50"><X className="size-4" aria-hidden="true" />Cancel</button>}
      </div>
      {live && row.status === "placed" && stage < 2 && <p className="-mt-1 text-caption text-muted">{row.serviceMode === "pickup" ? "Tell the customer when every dish is ready for counter pickup." : "You can send it out once the kitchen marks every dish ready."}</p>}
      {live && row.status === "placed" && stage >= 2 && !paid && <p className="-mt-1 text-caption font-semibold text-[var(--state-bill-text)]">{row.serviceMode === "pickup" ? `Collect ${money(row.totalPaise)} at the counter, record it in Billing, then mark collected.` : `Record ${money(row.totalPaise)} in Billing before sending the order out.`}</p>}
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
