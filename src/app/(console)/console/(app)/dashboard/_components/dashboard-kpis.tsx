import type { Features } from "@/lib/plan-features";
import { Calendar, CreditCard, FileText, Receipt, Truck, Wallet } from "lucide-react";
import Link from "next/link";
import type { DashboardData, RevenueTrend } from "@/server/staff/dashboard";
import { Delta, dayLabel, focusRing, money } from "./dashboard-shared";

/**
 * Five headline KPIs, each linked to its source screen. The sales sparkline uses the same real
 * seven-day data as the main sales panel.
 */
export function DashboardKpis({ data, trend, features }: { data: DashboardData; trend: RevenueTrend; features?: Features }) {
  const k = data.kpis;
  const tablePct = k.openTables.total > 0 ? Math.round((k.openTables.open / k.openTables.total) * 100) : 0;
  const preparingCount = (data.operations.kitchenOrders || []).filter((o) => o.status === "preparing").length;
  const readyCount = (data.operations.kitchenOrders || []).filter((o) => o.status === "ready").length;

  const card = `group relative flex min-h-[140px] flex-col justify-between rounded-2xl border border-line bg-surface p-3 shadow-[0_1px_2px_rgba(25,37,30,0.035)] transition-all duration-200 hover:-translate-y-0.5 hover:border-forest/30 hover:shadow-[0_8px_24px_rgba(25,37,30,0.07)] sm:min-h-[168px] sm:p-5 ${focusRing}`;
  const iconBox = "grid size-9 shrink-0 place-items-center rounded-xl";
  const footer = "mt-2 flex min-h-6 items-center justify-between gap-2 border-t border-[var(--dashboard-footer-line)] pt-2 sm:mt-3 sm:min-h-7 sm:pt-2.5";
  const deltaBadge = "inline-flex shrink-0 items-center rounded-full bg-[var(--dashboard-badge)] px-2.5 py-1 [&>span]:text-[11px] [&>span]:leading-tight [&>span]:whitespace-nowrap";

  return (
    <section aria-label="Key Performance Indicators">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-6">
        <Link href="/console/billing" className={`${card} col-span-2 bg-gradient-to-br from-surface via-surface to-[var(--dashboard-sales-tint)]`}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-muted">Today&apos;s Sales</p>
            <span className={`${iconBox} bg-sage text-forest`} aria-hidden="true"><Wallet className="size-[18px]" /></span>
          </div>
          <div className="mt-2 flex min-w-0 items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display text-[30px] font-bold leading-none tracking-tight text-ink tabular sm:text-[34px]">{money(k.revenue.today)}</p>
              <p className="mt-1 text-xs font-medium text-muted sm:mt-2">Money from paid bills</p>
            </div>
            <RevenueSparkline trend={trend} />
          </div>
          <div className={footer}>
            <span className="text-[11px] font-medium text-muted">Compared with yesterday</span>
            <span className={deltaBadge}><Delta today={k.revenue.today} yesterday={k.revenue.yesterday} compact /></span>
          </div>
        </Link>

        <Link href="/console/orders" className={`${card} xl:col-span-1`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-semibold leading-4 text-muted sm:text-[13px]">Orders Today</p>
            <span className={`${iconBox} bg-terracotta/10 text-terracotta`} aria-hidden="true"><FileText className="size-[18px]" /></span>
          </div>
          <div className="mt-2">
            <p className="font-display text-[30px] font-bold leading-none tracking-tight text-ink tabular sm:text-[32px]">{k.orders.today}</p>
            <p className="mt-1 min-h-7 text-xs font-medium leading-4 text-muted sm:mt-2 sm:min-h-8">
              {preparingCount > 0 || readyCount > 0 ? `${preparingCount} preparing · ${readyCount} ready` : k.orders.today > 0 ? "Active orders placed" : "No active orders"}
            </p>
          </div>
          <div className={footer}><span className="whitespace-nowrap text-[10px] font-medium text-muted">Yesterday</span><span className={deltaBadge}><Delta today={k.orders.today} yesterday={k.orders.yesterday} compact /></span></div>
        </Link>

        <Link href="/console/billing" className={`${card} xl:col-span-1`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-semibold leading-4 text-muted sm:text-[13px]">Unpaid Bills</p>
            <span className={`${iconBox} bg-terracotta/10 text-terracotta`} aria-hidden="true"><Receipt className="size-[18px]" /></span>
          </div>
          <div className="mt-2">
            <p className="font-display text-[26px] font-bold leading-none tracking-tight text-ink tabular sm:text-[30px]">{money(k.outstandingPaise)}</p>
            <p className="mt-1 min-h-7 text-xs font-medium leading-4 text-muted sm:mt-2 sm:min-h-8">Total amount due</p>
          </div>
          <div className={`${footer} justify-start`}><span className="text-[11px] font-medium text-muted">Across open bills</span></div>
        </Link>

        {features?.delivery === true && <Link href="/console/orders?view=delivery" className={`${card} xl:col-span-1`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-semibold leading-4 text-muted sm:text-[13px]">Delivery Orders</p>
            <span className={`${iconBox} bg-sage text-forest`} aria-hidden="true"><Truck className="size-[18px]" /></span>
          </div>
          <div className="mt-2">
            <p className="font-display text-[30px] font-bold leading-none tracking-tight text-ink tabular sm:text-[32px]">{k.delivery.active}</p>
            <p className="mt-1 min-h-7 text-xs font-medium leading-4 text-muted sm:mt-2 sm:min-h-8">{k.delivery.onTheWay} on the way · {money(k.delivery.cashToCollectPaise)} cash</p>
          </div>
          <div className={`${footer} justify-start`}><span className="text-[11px] font-medium text-muted">{k.delivery.deliveredToday} delivered today</span></div>
        </Link>}

        {features?.dineIn === true && <Link href="/console/floor" className={`${card} xl:col-span-1`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-semibold leading-4 text-muted sm:text-[13px]">Tables in Use</p>
            <span className={`${iconBox} bg-terracotta/10 text-terracotta`} aria-hidden="true"><Receipt className="size-[18px]" /></span>
          </div>
          <div className="mt-2">
            <p className="font-display text-[30px] font-bold leading-none tracking-tight text-ink tabular sm:text-[32px]">
            {k.openTables.open} <span className="text-base font-semibold text-muted">/ {k.openTables.total}</span>
            </p>
            <div className="mt-2 flex items-center gap-2 sm:mt-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line" role="img" aria-label={`${tablePct}% of tables in use`}>
              <div className="h-full rounded-full bg-forest transition-all duration-500" style={{ width: `${Math.min(100, tablePct)}%` }} />
              </div>
              <span className="text-xs font-bold text-muted tabular">{tablePct}%</span>
            </div>
          </div>
          <div className={`${footer} justify-start`}><span className="text-[11px] font-medium text-muted">Current floor occupancy</span></div>
        </Link>}

        <Link href="/console/billing" className={`${card} xl:col-span-1`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-muted">Average Bill</p>
            <span className={`${iconBox} bg-sage text-forest`} aria-hidden="true"><CreditCard className="size-[18px]" /></span>
          </div>
          <div className="mt-2">
            <p className="font-display text-[30px] font-bold leading-none tracking-tight text-ink tabular sm:text-[32px]">{money(k.averageBill.today)}</p>
            <p className="mt-1 min-h-7 text-xs font-medium leading-4 text-muted sm:mt-2 sm:min-h-8">Per paid bill</p>
          </div>
          <div className={footer}><span className="whitespace-nowrap text-[10px] font-medium text-muted">Yesterday</span><span className={deltaBadge}><Delta today={k.averageBill.today} yesterday={k.averageBill.yesterday} compact /></span></div>
        </Link>
      </div>

    </section>
  );
}

/** Lower-priority operational counts sit at the bottom of the dashboard, under the main panels. */
export function DashboardSecondaryStats({ data, features }: { data: DashboardData; features?: Features }) {
  const k = data.kpis;
  const wl = data.operations.waitlist;
  if (features && !features.reservations) return null;
  const stripCell = `block bg-surface p-4 transition-colors hover:bg-paper ${focusRing}`;

  return (
    <section aria-label="Additional dashboard metrics">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line">
        <Link href="/console/reservations" className={stripCell}>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted"><Calendar className="size-3.5" aria-hidden="true" />Bookings Coming Up</p>
          <p className="mt-1 text-xl font-bold text-ink tabular">{k.upcomingReservations}</p>
          <p className="mt-0.5 hidden text-xs font-medium text-muted sm:block">Reservations still to arrive</p>
        </Link>
        <Link href="/console/waitlist" className={stripCell}>
          <p className="text-xs font-semibold text-muted">Waiting List</p>
          <p className="mt-1 text-xl font-bold text-ink tabular">{k.waitlist}</p>
          <p className="mt-0.5 hidden text-xs font-medium text-muted sm:block">{wl.waiting} waiting · {wl.notified} notified</p>
        </Link>
      </div>
    </section>
  );
}


function RevenueSparkline({ trend }: { trend: RevenueTrend }) {
  const max = Math.max(...trend.map((day) => day.revenuePaise), 0);
  if (max === 0) {
    return <span className="max-w-20 text-right text-[10px] font-medium leading-4 text-muted">No recent sales trend</span>;
  }

  const width = 104;
  const height = 42;
  const inset = 3;
  const points = trend.map((day, index) => {
    const x = inset + (index / Math.max(1, trend.length - 1)) * (width - inset * 2);
    const y = height - inset - (day.revenuePaise / max) * (height - inset * 2);
    return [x, y] as const;
  });
  const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${points.at(-1)?.[0].toFixed(1)},${height - inset} L${points[0][0].toFixed(1)},${height - inset} Z`;
  const last = points.at(-1)!;

  return (
    <svg className="mb-0.5 h-10 w-[88px] shrink-0 overflow-visible sm:w-[104px]" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Revenue trend for the last 7 days: ${trend.map((day) => `${dayLabel(day.date, { weekday: "short" })} ${money(day.revenuePaise)}`).join(", ")}`}>
      <path d={area} fill="currentColor" className="text-sage" opacity="0.9" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-forest" />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill="currentColor" className="text-forest" />
    </svg>
  );
}
