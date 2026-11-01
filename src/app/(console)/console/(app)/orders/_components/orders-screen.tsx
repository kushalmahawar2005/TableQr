"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { Bike, Check, ChefHat, CircleCheck, Clock, Plus, Printer, Receipt, RefreshCw, Search, TriangleAlert } from "lucide-react";
import type { OrderRow } from "@/server/staff/orders-read";
import { VisitRecord } from "../../reservations/_components/visit-record";
import { servedAction } from "../actions";
import { placeLabel } from "@/domain/delivery";
import { placeEn } from "@/domain/rooms";
import { usePrint } from "@/components/print/print-provider";
import { orderSlipHtml } from "./order-slip-print";
import { columnHead, DetailHead, DetailSection, DetailSheet, EmptyQueue, ItemList, Pill, primaryButton, QueuePanel, RowSelect, rowCells, rowTone, secondaryButton, Segmented, StatCards, Stepper, UrgentTag, waitText } from "./orders-ui";

type Status = OrderRow["status"];
const STEPS: { key: Status; label: string }[] = [{ key: "placed", label: "Placed" }, { key: "accepted", label: "Accepted" }, { key: "preparing", label: "Cooking" }, { key: "ready", label: "Ready" }, { key: "served", label: "Served" }];
const TONE: Record<Status, string> = {
  placed: "bg-[var(--state-cleaning-soft)] text-[var(--state-cleaning-text)]",
  accepted: "bg-[var(--state-cleaning-soft)] text-[var(--state-cleaning-text)]",
  preparing: "bg-[var(--state-held-soft)] text-[var(--state-held-text)]",
  ready: "bg-[var(--state-available-soft)] text-[var(--state-available-text)]",
  served: "bg-[var(--state-paid-soft)] text-[var(--state-paid-text)]",
  cancelled: "bg-[var(--state-seated-soft)] text-[var(--state-seated-text)]",
};
const LABEL: Record<Status, string> = { placed: "New", accepted: "Accepted", preparing: "Cooking", ready: "Ready to serve", served: "Served", cancelled: "Cancelled" };
const ACTIVE: Status[] = ["placed", "accepted", "preparing", "ready"];
const FILTERS = [["active", "In progress"], ["served", "Served"], ["cancelled", "Cancelled"]] as const;
type Filter = (typeof FILTERS)[number][0];
/** An order nobody has picked up for this long is flagged */
const SLOW_MINUTES = 10;
const COLUMNS = "lg:grid-cols-[minmax(0,1.5fr)_96px_72px_minmax(0,1.3fr)_64px_124px]";

const money = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const clock = (v: string) => new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(v));
const ago = (mins: number) => (mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.floor(mins / 60)}h ${mins % 60}m ago`);

export function OrdersScreen({ orders, outlet, tabs }: { orders: OrderRow[]; outlet: string; /** Table orders and Delivery orders, when this role runs delivery */ tabs?: ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");
  // Chosen on purpose: opens the details on phones. Wide screens show the first order until then.
  const [picked, setPicked] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const printer = usePrint().manager;
  function printOrder(order: OrderRow) { void printer.print({ kind: "order_slip", subject: { type: "order", id: order.id }, build: (paper) => orderSlipHtml(slipOf(order), outlet, paper) }); }

  function serve(o: OrderRow) {
    setError(null);
    start(async () => {
      const res = await servedAction(o.readyLineIds);
      if (!res.ok) setError(res.message);
      router.refresh();
    });
  }

  // Stays live: ages tick every 20 seconds and the list is fetched again at the same time
  useEffect(() => {
    const t = setInterval(() => { setNow(Date.now()); router.refresh(); }, 20_000);
    return () => clearInterval(t);
  }, [router]);

  const inFilter = (o: OrderRow, f: Filter) => f === "active" ? ACTIVE.includes(o.status) : o.status === f;
  const minutes = (iso: string) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders
      .filter((o) => inFilter(o, filter) && (!q || o.table.toLowerCase().includes(q) || o.items.some((i) => i.name.toLowerCase().includes(q))))
      .sort((a, b) => (filter === "active" ? new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime() : new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime()));
  }, [orders, filter, query]);

  const active = orders.filter((o) => ACTIVE.includes(o.status));
  const slow = active.filter((o) => minutes(o.placedAt) >= SLOW_MINUTES && (o.status === "placed" || o.status === "accepted"));
  const served = orders.filter((o) => o.status === "served" && o.servedAt);
  const avgServe = served.length ? Math.round(served.reduce((n, o) => n + (new Date(o.servedAt!).getTime() - new Date(o.placedAt).getTime()) / 60_000, 0) / served.length) : null;
  const value = orders.filter((o) => o.status !== "cancelled").reduce((n, o) => n + o.totalPaise, 0);
  const count = (f: Filter) => orders.filter((o) => inFilter(o, f)).length;

  const titleOf = (o: OrderRow) => o.delivery ? o.delivery.name || "Guest" : o.takeaway ? placeLabel(o.table) : placeEn(o.table);
  const statusOf = (o: OrderRow) => (o.status === "ready" ? "Ready" : LABEL[o.status]);
  const selected = shown.find((o) => o.id === picked) ?? shown[0] ?? null;
  const urgent = (o: OrderRow) => (o.status === "placed" || o.status === "accepted") && minutes(o.placedAt) >= SLOW_MINUTES;
  const canServe = (o: OrderRow) => o.status === "ready" && o.readyLineIds.length > 0;

  return (
    <main className="mx-auto w-full max-w-[1440px] px-3 py-3 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-3 font-display text-lg font-bold leading-6 tracking-tight text-ink sm:text-[28px] sm:leading-8">Orders
            <span className="inline-flex items-center gap-1.5 rounded-md bg-sage px-2 py-0.5 text-xs font-semibold text-forest"><span className="size-1.5 animate-pulse rounded-full bg-[var(--state-available)]" aria-hidden="true" />Live</span>
          </h1>
          <p className="mt-1 text-sm font-medium text-muted">Track what is being prepared and what is ready to serve.</p>
        </div>
        <button type="button" onClick={() => start(() => router.refresh())} disabled={pending} className={secondaryButton}>
          <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} aria-hidden="true" />{pending ? "Refreshing" : "Refresh"}
        </button>
      </header>
      {tabs}

      <StatCards stats={[
        { icon: ChefHat, label: "In the kitchen", value: String(active.length), note: active.length ? "Orders not served yet" : "Nothing pending" },
        { icon: TriangleAlert, label: "Needs attention", value: String(slow.length), note: slow.length ? `Not picked up for ${SLOW_MINUTES}+ min` : "No delayed orders", tone: "accent" },
        { icon: Clock, label: "Average time to serve", value: avgServe === null ? "—" : `${avgServe} min`, note: served.length ? `From ${served.length} served ${served.length === 1 ? "order" : "orders"}` : "No served orders yet" },
        { icon: Receipt, label: "Order value", value: money(value), note: `${orders.length} ${orders.length === 1 ? "order" : "orders"} in total`, tone: "accent" },
      ]} />

      {error && <p role="alert" className="mt-4 rounded-input bg-danger/10 px-3 py-2 text-sm font-semibold text-danger">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 sm:mt-5">
        <Segmented label="Filter orders" value={filter} onChange={setFilter} options={FILTERS.map(([key, label]) => ({ key, label, count: count(key) }))} />
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search table or dish" aria-label="Search orders" className="h-11 w-full rounded-input border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none focus:border-forest focus-visible:ring-2 focus-visible:ring-forest/20" />
        </div>
      </div>

      <div className={`mt-4 grid items-start gap-4 ${selected ? "xl:grid-cols-[minmax(0,1fr)_340px]" : ""}`}>
        <QueuePanel
          title={filter === "active" ? "Current orders" : `${FILTERS.find(([key]) => key === filter)?.[1] ?? "Orders"} orders`}
          meta={`${shown.length} of ${orders.length} · ${filter === "active" ? "Oldest first" : "Newest first"}`}
          columns={shown.length > 0 && <div className={`${columnHead} ${COLUMNS}`}><span>Order</span><span>Status</span><span>Wait</span><span>Items</span><span>Total</span><span className="text-right">Action</span></div>}
        >
          {shown.length === 0 ? (
            <EmptyQueue icon={ChefHat} title={orders.length ? "No orders here" : "No orders yet"}>
              {orders.length ? (query ? "Nothing matches your search. Try a table number or a dish name." : "Switch to another tab to see the rest.") : "Orders from guests and waiters will appear here the moment they are placed."}
            </EmptyQueue>
          ) : (
            <ul>
              {shown.map((o) => {
                const isSlow = urgent(o);
                const took = o.servedAt ? Math.max(0, Math.round((new Date(o.servedAt).getTime() - new Date(o.placedAt).getTime()) / 60_000)) : null;
                const live = ACTIVE.includes(o.status);
                return (
                  <li key={o.id} className={`${rowCells} ${COLUMNS} ${rowTone(selected?.id === o.id, isSlow)}`}>
                    <RowSelect selected={selected?.id === o.id} onSelect={() => setPicked(o.id)}>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="min-w-0 truncate text-sm font-bold text-ink">{titleOf(o)}</span>
                        {o.delivery && <Bike className="size-3.5 text-muted" aria-label="Delivery" />}
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-xs font-medium text-muted"><span className="min-w-0 truncate">{o.roundNo > 1 ? `Round ${o.roundNo} · ` : ""}{clock(o.placedAt)}</span>{isSlow && <UrgentTag />}</span>
                    </RowSelect>
                    <span className="justify-self-end lg:justify-self-start"><Pill className={TONE[o.status]}>{o.status === "ready" && <Check className="size-3" aria-hidden="true" />}{statusOf(o)}</Pill></span>
                    <span className={`text-sm font-semibold tabular ${isSlow ? "text-danger" : "text-ink"}`}>{live ? waitText(minutes(o.placedAt)) : took !== null ? waitText(took) : "—"}</span>
                    <span className="col-start-1 row-start-3 truncate text-[13px] font-medium text-muted lg:col-auto lg:row-auto">{o.items.map((it) => `${it.qty}× ${it.name}`).join(", ") || "No items"}</span>
                    <span className="justify-self-end text-sm font-bold text-ink tabular lg:justify-self-start">{money(o.totalPaise)}</span>
                    <span className="relative z-10 col-span-2 mt-1.5 flex justify-end empty:hidden lg:col-auto lg:mt-0">
                      {canServe(o) ? <button type="button" disabled={pending} onClick={() => serve(o)} className={`print-hidden ${primaryButton}`}>Mark served</button>
                        : live ? <Link href="/console/kitchen" className={secondaryButton}>Open kitchen</Link> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {shown.length > 0 && filter === "active" && <p className="flex items-center gap-3 border-t border-line px-5 py-3 text-[13px] font-medium text-muted"><Plus className="size-4" aria-hidden="true" />New orders will appear here automatically</p>}
        </QueuePanel>

        {selected && (
          <DetailSheet label="Order details" open={picked === selected.id}>
            <DetailHead
              title={titleOf(selected)}
              badge={<Pill className={TONE[selected.status]}>{statusOf(selected)}</Pill>}
              sub={`${selected.roundNo > 1 ? `Round ${selected.roundNo} · ` : ""}Placed ${clock(selected.placedAt)} · ${ago(minutes(selected.placedAt))}`}
              onClose={() => setPicked(null)}
            />
            {selected.status !== "cancelled" && <Stepper steps={STEPS.map((s) => s.label)} stage={STEPS.findIndex((s) => s.key === selected.status)} complete={selected.status === "served"} label={`Progress: ${LABEL[selected.status]}`} />}
            <DetailSection title="Items"><ItemList items={selected.items} /></DetailSection>
            {selected.note && <p className="border-b border-line bg-[var(--state-held-soft)] px-5 py-2.5 text-sm text-[var(--state-held-text)]">Note: {selected.note}</p>}
            {urgent(selected) && <p className="border-b border-line bg-[var(--state-seated-soft)] px-5 py-2.5 text-[13px] font-semibold text-danger">Nobody has started this yet. Check the kitchen screen.</p>}
            {canServe(selected) && <p className="flex items-start gap-2.5 border-b border-line bg-sage px-5 py-3 text-[13px] text-muted"><CircleCheck className="mt-0.5 size-4 shrink-0 text-forest" aria-hidden="true" /><span><strong className="block text-sm font-bold text-forest">Ready for handover</strong>Mark served after handing to the guest.</span></p>}
            <DetailSection>
              <p className="text-xs font-medium text-muted">Order total</p>
              <p className="font-display text-2xl font-bold text-ink tabular">{money(selected.totalPaise)}</p>
            </DetailSection>
            {canServe(selected) && <DetailSection><button type="button" disabled={pending} onClick={() => serve(selected)} className={`print-hidden min-h-12 w-full ${primaryButton}`}><Check className="size-4" aria-hidden="true" />Mark served</button></DetailSection>}
            <DetailSection>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" onClick={() => printOrder(selected)} aria-label={`Print ${selected.takeaway ? "takeaway" : "table"} ${selected.table} order`} className={secondaryButton}><Printer className="size-4" aria-hidden="true" />Print</button>
                <VisitRecord sessionId={selected.sessionId} className="print-hidden rounded-input px-1 py-1 text-sm font-semibold text-forest underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-forest">View table record</VisitRecord>
              </div>
            </DetailSection>
          </DetailSheet>
        )}
      </div>
    </main>
  );
}

const slipOf = (order: OrderRow) => ({
  table: order.table,
  takeaway: order.takeaway,
  roundNo: order.roundNo,
  placedAt: order.placedAt,
  statusLabel: LABEL[order.status],
  items: order.items,
  note: order.note,
  totalPaise: order.totalPaise,
});
