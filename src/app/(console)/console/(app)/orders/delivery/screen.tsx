"use client";
import { Banknote, Bike, Check, ChefHat, CircleCheck, Clock, MapPin, MessageCircle, Package, Phone, Plus, Receipt, RefreshCw, Search, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import type { RiderCard } from "@/server/delivery/riders";
import { LiveMap, type MapPoint } from "@/components/live-map";
import type { deliveryQueue, pendingManualDeliveryPayments } from "@/server/delivery/staff";
import { assignTeamRiderAction } from "../../../../../(staff)/rider/actions";
import { connectRealtime } from "@/lib/realtime-client";
import { columnHead, DetailHead, DetailSection, DetailSheet, EmptyQueue, ItemList, Pill, primaryButton, QueuePanel, RowSelect, rowCells, rowTone, secondaryButton, Segmented, StatCards, Stepper, UrgentTag, waitText, type Stat } from "../_components/orders-ui";
import { advanceDeliveryAction, assignDeliveryCourierAction, cancelDeliveryOrderAction, confirmManualQrDeliveryPaymentAction, deliveryDeskTokenAction } from "./actions";

type Row = Omit<Awaited<ReturnType<typeof deliveryQueue>>[number], "placedAt" | "address"> & { placedAt: string | null; address: NonNullable<Awaited<ReturnType<typeof deliveryQueue>>[number]["address"]> };
type PendingPayment = Omit<Awaited<ReturnType<typeof pendingManualDeliveryPayments>>[number], "claimedAt"> & { claimedAt: string | null };
const money = (paise: number | null) => `₹${((paise ?? 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "");
const ago = (iso: string | null, now: number) => { if (!iso) return ""; const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000)); return `${waitText(m)} ago`; };
const digits = (phone: string | null) => (phone ?? "").replace(/\D/g, "");

/** Where an order is, from the kitchen's status and the delivery status together */
const DELIVERY_STEPS = ["Placed", "Preparing", "Packed", "On the way", "Delivered"] as const;
const PICKUP_STEPS = ["Placed", "Preparing", "Ready for pickup", "Collected"] as const;
const stepsFor = (row: Row) => row.serviceMode === "pickup" ? PICKUP_STEPS : DELIVERY_STEPS;
function stageOf(row: Row) {
  if (row.status === "collected") return 3;
  if (row.status === "delivered") return 4;
  if (row.status === "dispatched") return 3;
  if (row.kitchenStatus === "ready" || row.kitchenStatus === "served") return 2;
  if (row.kitchenStatus === "accepted" || row.kitchenStatus === "preparing") return 1;
  return 0;
}
const stageLabel = (row: Row) => { const steps = stepsFor(row); return steps[Math.min(stageOf(row), steps.length - 1)]; };
const isComplete = (row: Row) => row.status === "delivered" || row.status === "collected";
const isLive = (row: Row) => !isComplete(row) && row.status !== "cancelled";
const nextStatusOf = (row: Row) => row.serviceMode === "pickup" ? "collected" as const : row.status === "placed" ? "dispatched" as const : "delivered" as const;
/** Packed and paid, or out with the rider and paid: the order can move to its next step */
const canAdvance = (row: Row) => isLive(row) && row.paid === "paid" && (row.status === "dispatched" || (row.status === "placed" && stageOf(row) >= 2));
const paymentLabel = (row: Row) => row.paid === "paid" ? "Paid" : row.serviceMode === "pickup" ? "Pay at pickup" : "Payment due";
/** Still in the kitchen this long after it was placed */
const LATE_MINUTES = 20;
const COLUMNS = "lg:grid-cols-[minmax(0,1.5fr)_100px_72px_minmax(0,1.2fr)_64px_64px_120px]";
const STAGE_TONE = [
  "bg-[var(--state-held-soft)] text-[var(--state-held-text)]",
  "bg-[var(--state-held-soft)] text-[var(--state-held-text)]",
  "bg-[var(--state-bill-soft)] text-[var(--state-bill-text)]",
  "bg-[var(--state-cleaning-soft)] text-[var(--state-cleaning-text)]",
  "bg-[var(--state-available-soft)] text-[var(--state-available-text)]",
];

export function DeliveryQueueScreen({ rows, pendingPayments, canAssignCourier, tabs, riders = [], realtimeUrl = null, availableModes }: { rows: Row[]; pendingPayments: PendingPayment[]; canAssignCourier: boolean; tabs?: ReactNode; riders?: RiderCard[]; realtimeUrl?: string | null; availableModes: { pickup: boolean; delivery: boolean } }) {
  const router = useRouter();
  const [pending, start] = useTransition(), [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"active" | "completed">("active");
  const hasPickup = availableModes.pickup || rows.some(row => row.serviceMode === "pickup") || pendingPayments.some(payment => payment.serviceMode === "pickup");
  const hasDelivery = availableModes.delivery || rows.some(row => row.serviceMode === "delivery") || pendingPayments.some(payment => payment.serviceMode === "delivery");
  const [query, setQuery] = useState("");
  // Chosen on purpose: opens the details on phones. Wide screens show the first order until then.
  const [picked, setPicked] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [selectedMode, setMode] = useState<"all" | "pickup" | "delivery">(() => hasPickup && hasDelivery ? "all" : hasPickup ? "pickup" : hasDelivery ? "delivery" : "all");
  const [now, setNow] = useState(() => Date.now());
  // Rider dots move from live events without reloading the page
  const [moved, setMoved] = useState<Record<string, { lat: number; lng: number; at: number }>>({});
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const mode = hasPickup && hasDelivery ? selectedMode : hasPickup ? "pickup" : hasDelivery ? "delivery" : "all";
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
  const search = query.trim().toLowerCase();
  const shown = (view === "active" ? active : done).filter(row => !search || `${row.name ?? ""} ${row.phone ?? ""}`.toLowerCase().includes(search) || row.items.some(item => item.name.toLowerCase().includes(search)));
  const selected = shown.find(row => row.id === picked) ?? shown[0] ?? null;
  const minutesSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000)) : 0);
  const late = (row: Row) => isLive(row) && stageOf(row) <= 1 && minutesSince(row.placedAt) >= LATE_MINUTES;
  const riderAt = (r: RiderCard) => (moved[r.id] && (!r.location || moved[r.id].at > r.location.at) ? moved[r.id] : r.location);
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) => {
    setError(null);
    start(async () => { try { const result = await fn(); if (!result.ok) setError(result.message ?? "Could not update. Please try again."); else { after?.(); router.refresh(); } } catch { setError("Connection lost. Please try again."); } });
  };
  const paymentDue = active.filter(r => r.paid !== "paid").reduce((n, r) => n + (r.totalPaise ?? 0), 0);
  const stats: Stat[] = [
    { icon: ChefHat, label: "In the kitchen", value: String(active.filter(r => stageOf(r) <= 1).length), note: "Placed or being prepared" },
    { icon: Package, label: mode === "pickup" ? "Ready for pickup" : mode === "delivery" ? "Ready to send" : "Ready to go", value: String(active.filter(r => stageOf(r) === 2).length), note: mode === "pickup" ? "Waiting at the counter" : "Packed and waiting" },
    { icon: Bike, label: mode === "pickup" ? "Collected" : "On the way", value: String(mode === "pickup" ? done.filter(r => r.serviceMode === "pickup").length : active.filter(r => r.status === "dispatched").length), note: `${done.length} completed` },
    { icon: Banknote, label: "Payment due", value: money(paymentDue), note: "Record before handover", tone: paymentDue > 0 ? "warn" : "forest" },
  ];
  // Riders sharing their location, and the doors of live orders that have a pin
  const mapPoints: MapPoint[] = [
    ...riders.map((r) => ({ r, at: riderAt(r) })).filter(({ r, at }) => at && r.availability !== "offline").map(({ r, at }) => ({ id: `r-${r.id}`, kind: "rider" as const, lat: at!.lat, lng: at!.lng, photoUrl: r.photoUrl, label: r.name })),
    ...active.filter((r) => r.serviceMode === "delivery" && r.address.lat !== undefined && r.address.lng !== undefined).map((r) => ({ id: `h-${r.id}`, kind: "home" as const, lat: r.address.lat!, lng: r.address.lng!, label: r.name ?? "Customer" })),
  ];
  const hasMap = mode !== "pickup" && mapPoints.length > 0;
  const modeLabel = mode === "pickup" ? "pickup" : mode === "delivery" ? "delivery" : "pickup and delivery";

  return <main className="mx-auto w-full max-w-[1440px] px-3 py-3 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-3 font-display text-lg font-bold leading-6 tracking-tight text-ink sm:text-[28px] sm:leading-8">Orders
          <span className="inline-flex items-center gap-1.5 rounded-md bg-sage px-2 py-0.5 text-xs font-semibold text-forest"><span className="size-1.5 animate-pulse rounded-full bg-[var(--state-available)]" aria-hidden="true" />Live</span>
        </h1>
        <p className="mt-1 text-sm font-medium text-muted">{hasPickup && hasDelivery ? "Pickup and delivery orders in one live queue." : hasPickup ? "Guest pickup orders in one live queue." : "Guest delivery orders in one live queue."}</p>
      </div>
      <button type="button" onClick={() => start(() => router.refresh())} disabled={pending} className={secondaryButton}><RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} aria-hidden="true" />{pending ? "Refreshing" : "Refresh"}</button>
    </header>
    {tabs}

    <StatCards stats={stats} />

    {error && <p role="alert" className="mt-4 rounded-input border border-danger/30 bg-[var(--state-seated-soft)] p-3 text-sm font-semibold text-danger">{error}</p>}

    {visiblePendingPayments.length > 0 && <section className="mt-4 rounded-2xl border border-[var(--state-held)]/40 bg-[var(--state-held-soft)] p-4 sm:p-5">
      <h2 className="font-display text-[15px] font-bold text-ink">UPI payments to check · {visiblePendingPayments.length}</h2>
      <p className="mt-1 text-xs text-muted">Match the amount and reference in your bank or UPI app first. Confirming marks the bill paid and sends the order to the kitchen.</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {visiblePendingPayments.map(claim => <article key={claim.id} className="rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="font-bold text-ink">{claim.name}</p><a href={`tel:${claim.phone}`} className="text-xs font-semibold text-forest">{claim.phone}</a></div>
            <p className="font-display text-lg font-bold text-ink tabular">{money(claim.totalPaise)}</p>
          </div>
          <p className="mt-2 text-xs text-muted">{claim.serviceMode === "pickup" ? "Pickup at the counter" : `${claim.address?.line ?? ""}, ${claim.address?.locality ?? ""} · ${claim.address?.pincode ?? ""}`}</p>
          <p className="mt-2 text-sm">UPI reference <strong className="font-mono">{claim.reference}</strong>{claim.claimedAt && <span className="text-xs text-muted"> · sent {clock(claim.claimedAt)}</span>}</p>
          <button type="button" disabled={pending} className={`mt-3 ${primaryButton}`} onClick={() => {
            if (!window.confirm(`Confirm ${money(claim.totalPaise)} received for reference ${claim.reference}? Check your UPI or bank app first.`)) return;
            run(() => confirmManualQrDeliveryPaymentAction(claim.id));
          }}><Check className="size-4" aria-hidden="true" />Payment received · send to kitchen</button>
        </article>)}
      </div>
    </section>}

    <div className="mt-4 flex flex-wrap items-center gap-2 sm:mt-5">
      {hasPickup && hasDelivery && <Segmented label="Filter guest order mode" value={mode} onChange={setMode} options={([["all", "All"], ["pickup", "Pickup"], ["delivery", "Delivery"]] as const).map(([key, label]) => ({ key, label, count: rows.filter(r => (key === "all" || r.serviceMode === key) && r.status !== "cancelled").length }))} />}
      <Segmented label="Filter by progress" value={view} onChange={setView} options={[{ key: "active", label: "Active", count: active.length }, { key: "completed", label: "Completed", count: done.length }]} />
      <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
        <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or dish" aria-label="Search guest orders" className="h-10 w-full rounded-input border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none focus:border-forest focus-visible:ring-2 focus-visible:ring-forest/20" />
        </div>
        {mode !== "pickup" && <button type="button" aria-pressed={showMap} onClick={() => setShowMap(on => !on)} className={secondaryButton}><Bike className="size-4" aria-hidden="true" />Live map</button>}
      </div>
    </div>

    {mode !== "pickup" && showMap && <section className="mt-4">
      {hasMap ? <>
        <p className="mb-2 text-xs text-muted">🛵 riders · 🏠 customers · updates by itself</p>
        <LiveMap className="h-72" points={mapPoints} />
      </> : <p className="rounded-2xl border border-line bg-surface px-5 py-4 text-sm text-muted">Nothing to show yet. Riders sharing their location and customers with a map pin appear here.</p>}
    </section>}

    <div className={`mt-4 grid items-start gap-4 ${selected ? "xl:grid-cols-[minmax(0,1fr)_380px]" : ""}`}>
      <QueuePanel
        title={view === "active" ? "Current orders" : "Completed orders"}
        meta={`${shown.length} of ${(view === "active" ? active : done).length} · Newest first`}
        columns={shown.length > 0 && <div className={`${columnHead} ${COLUMNS}`}><span>Customer</span><span>Status</span><span>Wait</span><span>Items</span><span>Total</span><span>Payment</span><span className="text-right">Action</span></div>}
      >
        {!shown.length ? <EmptyQueue icon={Bike} title={search ? "No orders here" : view === "active" ? "No guest orders right now" : "Nothing completed yet"}>
          {search ? "Nothing matches your search. Try a name or a dish." : view === "active" ? `New ${modeLabel} orders appear here automatically.` : `Completed ${modeLabel} orders appear here.`}
        </EmptyQueue> : <ul>
          {shown.map(row => {
            const stage = stageOf(row), isLate = late(row), paid = row.paid === "paid", chosen = selected?.id === row.id;
            const billHref = `/console/billing?session=${encodeURIComponent(row.sessionId ?? "")}`;
            return <li key={row.id} className={`${rowCells} ${COLUMNS} ${rowTone(chosen, isLate, isLive(row) && stage === 0)}`}>
              <RowSelect selected={chosen} onSelect={() => setPicked(row.id)}>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><span className="min-w-0 truncate text-sm font-bold text-ink">{row.name ?? "Guest"}</span><span className="text-xs font-medium text-muted">{row.serviceMode === "pickup" ? "Pickup" : "Delivery"}</span></span>
                <span className="mt-0.5 flex items-center gap-2 text-xs font-medium text-muted tabular"><span className="min-w-0 truncate">{row.phone}</span>{isLate && <UrgentTag />}</span>
              </RowSelect>
              <span className="justify-self-end lg:justify-self-start"><Pill className={STAGE_TONE[Math.min(stage, STAGE_TONE.length - 1)]}>{stage === 2 && row.serviceMode === "pickup" ? "Ready" : stageLabel(row)}</Pill></span>
              <span className={`text-sm font-semibold tabular ${isLate ? "text-danger" : "text-ink"}`}>{isLive(row) ? waitText(minutesSince(row.placedAt)) : "—"}</span>
              <span className="col-start-1 row-start-3 truncate text-[13px] font-medium text-muted lg:col-auto lg:row-auto">{row.items.map(item => `${item.qty}× ${item.name}`).join(", ") || "No items"}</span>
              <span className="justify-self-end text-sm font-bold text-ink tabular lg:justify-self-start">{money(row.totalPaise)}</span>
              <span className="col-start-2 justify-self-end lg:col-auto lg:justify-self-start"><Pill className={paid ? "bg-[var(--state-available-soft)] text-[var(--state-available-text)]" : "bg-[var(--state-bill-soft)] text-[var(--state-bill-text)]"}>{paid ? "Paid" : "Due"}</Pill></span>
              <span className="relative z-10 col-span-2 mt-1.5 flex justify-end lg:col-auto lg:mt-0">
                {canAdvance(row) ? <button type="button" disabled={pending} onClick={() => run(() => advanceDeliveryAction(row.id, nextStatusOf(row)))} className={primaryButton}>{row.serviceMode === "pickup" ? "Collected" : row.status === "placed" ? "Send out" : "Delivered"}</button>
                  : !isLive(row) || !paid ? <Link href={billHref} className={`${secondaryButton} px-3`}>{paid ? "View bill" : "Bill · cash"}</Link>
                    : <Link href="/console/kitchen" className={`${secondaryButton} px-3`}>Open kitchen</Link>}
              </span>
            </li>;
          })}
        </ul>}
        {shown.length > 0 && view === "active" && <p className="flex items-center gap-3 border-t border-line px-5 py-3 text-[13px] font-medium text-muted"><Plus className="size-4" aria-hidden="true" />New orders will appear here automatically</p>}
      </QueuePanel>

      {selected && <DetailSheet label="Order details" open={picked === selected.id}>
        <DeliveryDetail key={selected.id} row={selected} now={now} pending={pending} canAssignCourier={canAssignCourier} run={run} riders={riders} riderAt={riderAt} onClose={() => setPicked(null)} />
      </DetailSheet>}
    </div>
  </main>;
}

function DeliveryDetail({ row, now, pending, canAssignCourier, run, riders, riderAt, onClose }: { row: Row; now: number; pending: boolean; canAssignCourier: boolean; riders: RiderCard[]; riderAt: (rider: RiderCard) => RiderCard["location"]; onClose: () => void; run: (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) => void }) {
  const stage = stageOf(row), steps = stepsFor(row), complete = isComplete(row);
  const [editRider, setEditRider] = useState(false);
  const [courier, setCourier] = useState({ name: row.courierName ?? "", phone: row.courierPhone ?? "" });
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const address = `${row.address?.line ?? ""}, ${row.address?.locality ?? ""} · ${row.address?.pincode ?? ""}`;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${row.address?.line ?? ""}, ${row.address?.locality ?? ""}, ${row.address?.pincode ?? ""}`)}`;
  const phone = digits(row.phone);
  const paid = row.paid === "paid";
  const live = isLive(row);
  const delivery = row.serviceMode === "delivery";
  const rider = riders.find((r) => r.id === row.courierUserId);
  const riderSpot = rider ? riderAt(rider) : null;
  const orderMap: MapPoint[] = delivery ? [
    ...(row.address.lat !== undefined && row.address.lng !== undefined ? [{ id: `h-${row.id}`, kind: "home" as const, lat: row.address.lat, lng: row.address.lng, label: row.name ?? "Customer" }] : []),
    ...(rider && riderSpot ? [{ id: `r-${rider.id}`, kind: "rider" as const, lat: riderSpot.lat, lng: riderSpot.lng, photoUrl: rider.photoUrl, label: rider.name }] : []),
  ] : [];

  return <>
    <DetailHead
      title={`${row.name ?? "Guest"} · ${delivery ? "Delivery" : "Pickup"}`}
      badge={<Pill className={STAGE_TONE[Math.min(stage, STAGE_TONE.length - 1)]}>{stageLabel(row)}</Pill>}
      sub={`Placed ${clock(row.placedAt)}${live ? ` · ${ago(row.placedAt, now)}` : ""}`}
      onClose={onClose}
    />

    {/* Progress follows the real pickup or delivery journey */}
    <Stepper steps={steps} stage={stage} complete={complete} label={`Status: ${stageLabel(row)}`} />

    <DetailSection>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sage text-forest"><UserRound className="size-5" aria-hidden="true" /></span>
        <div className="min-w-28 flex-1"><p title={row.name ?? undefined} className="truncate text-sm font-bold text-ink">{row.name}</p><p className="truncate text-xs text-muted tabular">{row.phone}</p></div>
        <a href={`tel:${row.phone}`} className={`${secondaryButton} !min-h-9 !px-2.5 text-xs`}><Phone className="size-3.5" aria-hidden="true" />Call</a>
        {phone && <a href={`https://wa.me/${phone}`} target="_blank" rel="noreferrer" className={`${secondaryButton} !min-h-9 !px-2.5 text-xs`}><MessageCircle className="size-3.5" aria-hidden="true" />WA</a>}
      </div>
      {!delivery ? <p className="mt-3 flex items-center gap-2 text-sm font-medium text-ink"><Package className="size-4 shrink-0 text-forest" aria-hidden="true" />Guest will collect this order at the counter.</p> : <div className="mt-3 flex items-start gap-2">
        <MapPin className="mt-0.5 size-4 shrink-0 text-forest" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-ink">{address}</p>
          {row.address.instructions && <p className="mt-0.5 text-xs text-muted">Note: {row.address.instructions}</p>}
        </div>
        <a href={mapUrl} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-semibold text-forest hover:underline">Map ↗</a>
      </div>}
    </DetailSection>

    <DetailSection title="Items"><ItemList items={row.items} /></DetailSection>

    {delivery && row.paymentIssue && <p role="alert" className="border-b border-line bg-[var(--state-held-soft)] px-5 py-2.5 text-xs text-[var(--state-held-text)]"><b>Payment issue from rider:</b> {row.paymentIssue}</p>}
    {delivery && row.status === "dispatched" && row.deliveryPin && <p className="border-b border-line px-5 py-2.5 text-xs text-muted">Delivery PIN (if the customer can&apos;t find it): <b className="font-mono text-ink">{row.deliveryPin}</b></p>}
    {delivery && row.riderRating !== null && <p className="border-b border-line px-5 py-2.5 text-xs text-ink">Customer rated the rider <b className="text-[var(--state-held)]">{"★".repeat(row.riderRating)}</b>{row.riderRatingNote ? ` · “${row.riderRatingNote}”` : ""}</p>}

    {/* Rider: pick from the team (photo, free or busy), or type one from outside the team */}
    {delivery && row.courierName && !editRider ? <DetailSection title={row.status === "delivered" ? "Delivered by" : "Rider"}>
      <div className="flex flex-wrap items-center gap-2.5">
        <RiderFace url={rider?.photoUrl ?? null} />
        <div className="min-w-28 flex-1"><p className="truncate text-sm font-bold text-ink">{row.courierName}</p>{rider ? <RiderState rider={rider} /> : <p className="text-xs text-muted">From outside the team</p>}</div>
        {row.courierPhone && <a href={`tel:${row.courierPhone}`} className={`${secondaryButton} !min-h-9 !px-2.5 text-xs`}><Phone className="size-3.5" aria-hidden="true" />Call</a>}
        {live && <button type="button" onClick={() => setEditRider(true)} className={`${secondaryButton} !min-h-9 !px-3 text-xs`}>Change</button>}
      </div>
    </DetailSection> : delivery && live ? <DetailSection title="Rider">
      {riders.length ? <ul className="grid gap-2.5">
        {riders.map((r) => <li key={r.id} className="flex items-center gap-2.5">
          <RiderFace url={r.photoUrl} />
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-ink">{r.name}{r.verified && <span className="ml-1 text-[var(--state-available-text)]" title="Verified rider">✓</span>}</p><RiderState rider={r} /></div>
          <button type="button" disabled={pending || r.availability === "offline"} onClick={() => run(() => assignTeamRiderAction(row.id, r.id), () => setEditRider(false))} className={`${secondaryButton} !min-h-9 !px-3 text-xs`}>Assign</button>
        </li>)}
      </ul> : <p className="text-xs text-muted">No riders on your team yet. Add one in Team with the Rider role.</p>}
      {canAssignCourier && <details className="mt-2">
        <summary className="cursor-pointer text-xs font-semibold text-forest">Rider from outside the team</summary>
        <form className="mt-2 grid gap-2" onSubmit={event => { event.preventDefault(); run(() => assignDeliveryCourierAction(row.id, courier.name, courier.phone), () => setEditRider(false)); }}>
          <label className="sr-only" htmlFor={`courier-name-${row.id}`}>Rider name</label>
          <input id={`courier-name-${row.id}`} value={courier.name} onChange={event => setCourier(c => ({ ...c, name: event.target.value }))} maxLength={80} autoComplete="name" placeholder="Rider name" className="min-h-11 min-w-0 rounded-input border border-line bg-surface px-3 text-sm text-ink" />
          <label className="sr-only" htmlFor={`courier-phone-${row.id}`}>Rider phone</label>
          <input id={`courier-phone-${row.id}`} value={courier.phone} onChange={event => setCourier(c => ({ ...c, phone: event.target.value }))} maxLength={20} inputMode="tel" autoComplete="tel" placeholder="Rider phone" className="min-h-11 min-w-0 rounded-input border border-line bg-surface px-3 text-sm text-ink" />
          <button type="submit" disabled={pending} className={secondaryButton}>Save</button>
        </form>
      </details>}
    </DetailSection> : null}

    <DetailSection>
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-xs font-medium text-muted">Order total</p><p className="font-display text-2xl font-bold text-ink tabular">{money(row.totalPaise)}</p></div>
        <Pill className={paid ? "bg-[var(--state-available-soft)] text-[var(--state-available-text)]" : "bg-[var(--state-bill-soft)] text-[var(--state-bill-text)]"}>{paymentLabel(row)}</Pill>
      </div>
    </DetailSection>

    {live && row.status === "placed" && stage < 2 && <p className="flex items-center gap-2 border-b border-line bg-paper px-5 py-2.5 text-xs text-muted"><Clock className="size-3.5 shrink-0" aria-hidden="true" />{delivery ? "Send out once kitchen marks every dish ready." : "Tell the customer when every dish is ready for counter pickup."}</p>}
    {live && row.status === "placed" && stage >= 2 && !paid && <p className="border-b border-line bg-[var(--state-bill-soft)] px-5 py-2.5 text-xs font-semibold text-[var(--state-bill-text)]">{delivery ? `Record ${money(row.totalPaise)} in Billing before sending the order out.` : `Collect ${money(row.totalPaise)} at the counter, record it in Billing, then mark collected.`}</p>}
    {row.status === "dispatched" && !paid && <p className="border-b border-line bg-[var(--state-bill-soft)] px-5 py-2.5 text-xs font-semibold text-[var(--state-bill-text)]">Collect {money(row.totalPaise)} from the customer, record it in the bill, then mark delivered.</p>}

    <DetailSection>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/console/billing?session=${encodeURIComponent(row.sessionId ?? "")}`} className={secondaryButton}><Receipt className="size-4" aria-hidden="true" />{paid ? "View bill" : "Bill · record cash"}</Link>
        {live && <button type="button" disabled={pending || !canAdvance(row)} onClick={() => run(() => advanceDeliveryAction(row.id, nextStatusOf(row)))} className={primaryButton}>
          {!delivery ? <><CircleCheck className="size-4" aria-hidden="true" />Mark collected</> : row.status === "placed" ? <><Bike className="size-4" aria-hidden="true" />Send out</> : <><CircleCheck className="size-4" aria-hidden="true" />Mark delivered</>}
        </button>}
        {canAssignCourier && live && cancelReason === null && <button type="button" disabled={pending} onClick={() => setCancelReason("")} className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-input px-2 text-sm font-semibold text-danger hover:bg-danger/5 disabled:opacity-50">Cancel</button>}
      </div>
      {canAssignCourier && cancelReason !== null && <form className="mt-3 grid gap-2 rounded-input border border-danger/40 p-3" onSubmit={event => { event.preventDefault(); run(() => cancelDeliveryOrderAction(row.id, cancelReason), () => setCancelReason(null)); }}>
        <label className="text-xs font-semibold text-ink">Why cancel? Anything already paid is refunded.
          <input className="mt-1 min-h-11 w-full rounded-input border border-line bg-surface px-3 text-sm font-normal" value={cancelReason} maxLength={200} onChange={event => setCancelReason(event.target.value)} placeholder="e.g. Customer not reachable, item out of stock" />
        </label>
        <button type="submit" disabled={pending || cancelReason.trim().length < 3} className="min-h-10 cursor-pointer rounded-input bg-danger px-4 text-sm font-semibold text-white disabled:opacity-50">Cancel and refund</button>
        <button type="button" disabled={pending} onClick={() => setCancelReason(null)} className={secondaryButton}>Keep order</button>
      </form>}
    </DetailSection>

    {delivery && <section>
      <div className="flex items-center justify-between gap-2 bg-paper px-5 py-2.5"><h3 className="text-[13px] font-bold text-muted">Delivery map</h3><a href={mapUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-forest hover:underline">Full map ↗</a></div>
      {orderMap.length > 0 ? <LiveMap key={row.id} className="h-48 !rounded-none !border-0" points={orderMap} /> : <p className="flex items-center gap-2 px-5 py-4 text-xs text-muted"><MapPin className="size-4 shrink-0" aria-hidden="true" />This customer did not share a map pin. Use Full map to find the address.</p>}
    </section>}
  </>;
}

function RiderState({ rider }: { rider: RiderCard }) {
  const tone = rider.availability === "free" ? "text-[var(--state-available-text)]" : rider.availability === "busy" ? "text-[var(--state-held-text)]" : "text-muted";
  return <p className={`text-xs font-semibold ${tone}`}>{rider.availability === "free" ? "Free" : rider.availability === "busy" ? `Busy · ${rider.activeCount} ${rider.activeCount === 1 ? "order" : "orders"}` : "Offline"}{rider.vehicleNo ? ` · ${rider.vehicleNo}` : ""}</p>;
}

function RiderFace({ url }: { url: string | null }) {
  // Staff photos live in the photo bucket, so this stays a plain image
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" className="size-9 shrink-0 rounded-full object-cover" /> : <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sage text-forest"><Bike className="size-4" aria-hidden="true" /></span>;
}
