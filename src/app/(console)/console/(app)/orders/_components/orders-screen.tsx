"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { Bike, Check, ChefHat, Clock, Printer, Receipt, RefreshCw, Search, Utensils, TriangleAlert } from "lucide-react";
import type { OrderRow } from "@/server/staff/orders-read";
import { VisitRecord } from "../../reservations/_components/visit-record";
import { servedAction } from "../actions";
import { placeEn } from "@/domain/rooms";
import { usePrint } from "@/components/print/print-provider";
import { orderSlipHtml } from "./order-slip-print";

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

const money = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const clock = (v: string) => new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(v));
const ago = (mins: number) => (mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.floor(mins / 60)}h ${mins % 60}m ago`);

export function OrdersScreen({ orders, outlet, tabs }: { orders: OrderRow[]; outlet: string; /** Table orders and Delivery orders, when this role runs delivery */ tabs?: ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");
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

  return (
    <main className="mx-auto w-full max-w-[1560px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption font-semibold text-muted">{outlet} · live order queue</p>
          <h1 className="mt-1 flex items-center gap-3 font-display text-title font-bold text-ink">Orders
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--state-available-soft)] px-2.5 py-0.5 text-caption font-semibold text-[var(--state-available-text)]"><span className="size-1.5 animate-pulse rounded-full bg-[var(--state-available)]" aria-hidden="true" />Live</span>
          </h1>
          <p className="mt-1 text-body text-muted">Track what is being prepared and what is ready to serve.</p>
        </div>
        <button type="button" onClick={() => start(() => router.refresh())} disabled={pending} className="inline-flex min-h-11 items-center gap-2 rounded-input border border-line bg-surface px-3.5 text-body font-semibold text-ink hover:border-ink/40 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-ink">
          <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} aria-hidden="true" />{pending ? "Refreshing" : "Refresh"}
        </button>
      </header>
      {tabs}

      <dl className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([
          [Utensils, "In the kitchen", String(active.length), active.length ? "Orders not served yet" : "Nothing pending", "#a74608"],
          [TriangleAlert, "Needs attention", String(slow.length), slow.length ? `Not picked up for ${SLOW_MINUTES}+ min` : "No delayed orders", slow.length ? "#b83a3a" : "#237a68"],
          [Clock, "Average time to serve", avgServe === null ? "—" : `${avgServe} min`, served.length ? `From ${served.length} served ${served.length === 1 ? "order" : "orders"}` : "No served orders yet", "#315e9e"],
          [Receipt, "Order value", money(value), `${orders.length} ${orders.length === 1 ? "order" : "orders"} in total`, "#c9482b"],
        ] as const).map(([Icon, label, v, note, tone]) => (
          <div key={label} className="rounded-card border border-line bg-surface p-4 shadow-[0_1px_2px_rgb(31_41_55/0.04)]">
            <div className="flex items-start justify-between gap-2"><dt className="text-caption font-semibold text-muted">{label}</dt><span className="grid size-9 shrink-0 place-items-center rounded-input" style={{ background: `color-mix(in srgb, ${tone} 14%, var(--surface))`, color: tone }}><Icon className="size-[18px]" aria-hidden="true" /></span></div>
            <dd className="mt-1 font-display text-[26px] leading-8 font-bold tabular text-ink">{v}</dd>
            <p className="mt-0.5 truncate text-caption text-muted">{note}</p>
          </div>
        ))}
      </dl>

      <div className="mt-6 flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-2.5 sm:p-3">
        {error && <p role="alert" className="w-full rounded-input bg-danger/10 px-3 py-2 text-body font-semibold text-danger">{error}</p>}
        <div role="tablist" aria-label="Filter orders" className="flex max-w-full gap-2 overflow-x-auto">
          {FILTERS.map(([key, label]) => (
            <button key={key} role="tab" aria-selected={filter === key} onClick={() => setFilter(key)} className={`min-h-11 shrink-0 rounded-full border px-4 text-body font-semibold focus-visible:outline-2 focus-visible:outline-ink ${filter === key ? "border-ink bg-ink text-white" : "border-line bg-surface text-muted hover:text-ink"}`}>
              {label} <span className="tabular opacity-70">{count(key)}</span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full min-w-48 sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search table or dish" aria-label="Search orders" className="h-11 w-full rounded-input border border-line bg-surface pl-9 pr-3 text-body text-ink outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-ink/20" />
        </div>
      </div>

      {shown.length === 0 ? (
        <section className="mt-5 rounded-card border border-dashed border-line bg-surface px-6 py-14 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-brand-soft text-brand"><ChefHat className="size-7" aria-hidden="true" /></span>
          <h2 className="mt-4 font-display text-section font-bold text-ink">{orders.length ? "No orders here" : "No orders yet"}</h2>
          <p className="mx-auto mt-1 max-w-md text-body text-muted">{orders.length ? (query ? "Nothing matches your search. Try a table number or a dish name." : "Switch to another tab to see the rest.") : "Orders from guests and waiters will appear here the moment they are placed."}</p>
        </section>
      ) : (
        <div className="mt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-section font-bold text-ink">{filter === "active" ? "Current orders" : `${FILTERS.find(([key]) => key === filter)?.[1] ?? "Orders"} orders`}</h2>
            <p className="text-caption text-muted">Showing {shown.length} of {orders.length} · newest updates automatically</p>
          </div>
        <ul className="grid grid-cols-2 gap-2 sm:gap-3 lg:gap-4">
          {shown.map((o) => {
            const age = minutes(o.placedAt);
            const isSlow = (o.status === "placed" || o.status === "accepted") && age >= SLOW_MINUTES;
            const stepIndex = STEPS.findIndex((s) => s.key === o.status);
            const took = o.servedAt ? Math.max(0, Math.round((new Date(o.servedAt).getTime() - new Date(o.placedAt).getTime()) / 60_000)) : null;
            return (
              <li key={o.id} className={`min-w-0 overflow-hidden rounded-card border bg-surface shadow-[0_1px_2px_rgb(31_41_55/0.04)] ${isSlow ? "border-danger/50" : "border-line"}`}>
                <div className={`h-1 ${o.status === "ready" ? "bg-[var(--state-available)]" : isSlow ? "bg-danger" : o.status === "preparing" ? "bg-[var(--state-held)]" : "bg-ink/10"}`} aria-hidden="true" />
                <div className="min-w-0 p-2.5 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2 sm:flex-nowrap sm:gap-3">
                  <div className="min-w-0">
                    <p className="break-words font-display text-body font-bold text-ink sm:text-section">{o.delivery ? <><span className="mr-1 inline-flex items-center gap-1 rounded-full bg-brand-soft px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-wide text-brand-strong uppercase sm:mr-2 sm:px-2 sm:text-label"><Bike className="size-3.5" aria-hidden="true" />Delivery</span>{o.delivery.name || "Guest"}</> : o.takeaway ? `Takeaway ${o.table}` : placeEn(o.table)}{o.roundNo > 1 && <span className="ml-1 text-caption font-semibold text-muted sm:ml-2 sm:text-body">· Round {o.roundNo}</span>}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted tabular"><span>Placed {clock(o.placedAt)}</span><span aria-hidden="true">·</span><span className={isSlow ? "font-semibold text-danger" : ""}>{ago(age)}</span>{took !== null && <><span aria-hidden="true">·</span><span>Served in {took} min</span></>}</p>
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold sm:gap-1.5 sm:px-2.5 sm:text-caption ${TONE[o.status]}`}><span className={`size-1.5 rounded-full ${o.status === "ready" ? "bg-[var(--state-available)]" : o.status === "cancelled" ? "bg-[var(--state-seated)]" : "bg-current"}`} aria-hidden="true" />{LABEL[o.status]}</span>
                </div>

                {o.status !== "cancelled" && (
                  <ol className="mt-3 flex items-center gap-1" aria-label={`Progress: ${LABEL[o.status]}`}>
                    {STEPS.map((s, i) => (
                      <li key={s.key} className="flex flex-1 items-center gap-1">
                        <span className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] ${i <= stepIndex ? "bg-[var(--state-available)] text-white" : "bg-ink/10 text-muted"}`}>{i < stepIndex || o.status === "served" ? <Check className="size-3" aria-hidden="true" /> : i + 1}</span>
                        <span className={`hidden text-label sm:block ${i === stepIndex ? "font-semibold text-ink" : "text-muted"}`}>{s.label}</span>
                        {i < STEPS.length - 1 && <span className={`h-px flex-1 ${i < stepIndex ? "bg-[var(--state-available)]" : "bg-ink/10"}`} aria-hidden="true" />}
                      </li>
                    ))}
                  </ol>
                )}

                <ul className="mt-3 divide-y divide-line rounded-input border border-line bg-ink/[0.02] sm:mt-4">
                  {o.items.length ? o.items.map((it, i) => <li key={i} className="flex min-w-0 items-center gap-2 px-2 py-2 text-caption sm:gap-3 sm:px-3 sm:py-2.5 sm:text-body"><span className="grid size-6 shrink-0 place-items-center rounded-md bg-surface text-[10px] font-bold tabular text-ink sm:size-7 sm:text-caption">{it.qty}×</span><span className="min-w-0 truncate font-medium text-ink">{it.name}</span></li>) : <li className="px-2 py-2 text-caption text-muted sm:px-3 sm:text-body">No items</li>}
                </ul>
                {o.note && <p className="mt-2 rounded-input bg-[var(--state-held-soft)] px-3 py-1.5 text-body text-[var(--state-held-text)]">Note: {o.note}</p>}
                {isSlow && <p className="mt-2 text-caption font-semibold text-danger">Nobody has started this yet. Check the kitchen screen.</p>}

                <div className="mt-3 grid grid-cols-2 items-center gap-2 border-t border-line pt-3 sm:mt-4 sm:flex sm:flex-wrap sm:justify-between sm:gap-3">
                  <span className="col-span-2 sm:col-span-1"><span className="block text-caption text-muted">Order total</span><span className="font-display text-section font-bold tabular text-ink">{money(o.totalPaise)}</span></span>
                  {o.status === "ready" && o.readyLineIds.length > 0 && (
                    <button type="button" disabled={pending} onClick={() => serve(o)} className="print-hidden min-h-11 w-full rounded-input bg-brand px-2 text-caption font-semibold text-white shadow-sm hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50 sm:ml-auto sm:w-auto sm:px-4 sm:text-body">
                      Mark served
                    </button>
                  )}
                  <button type="button" onClick={() => printOrder(o)} aria-label={`Print ${o.takeaway ? "takeaway" : "table"} ${o.table} order`} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-input border border-line bg-surface px-2 text-caption font-semibold text-ink hover:border-ink/40 focus-visible:outline-2 focus-visible:outline-ink sm:w-auto sm:px-3 sm:text-body">
                    <Printer className="size-4" aria-hidden="true" />Print
                  </button>
                  <VisitRecord sessionId={o.sessionId} className="print-hidden col-span-2 rounded-input px-2 py-1 text-caption font-semibold text-ink underline underline-offset-4 hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-ink sm:col-span-1 sm:text-body">View table record</VisitRecord>
                </div>
                </div>
              </li>
            );
          })}
        </ul>
        </div>
      )}
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
