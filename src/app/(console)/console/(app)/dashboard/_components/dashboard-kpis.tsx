import type { Features } from "@/lib/plan-features";
import { BedDouble, Calendar, CreditCard, FileText, Receipt, Truck, Wallet } from "lucide-react";
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

  const showRooms = features?.rooms === true;
  const count = 4 + (features?.delivery === true ? 1 : 0) + (features?.dineIn === true ? 1 : 0) + (showRooms ? 1 : 0);
  const columns = count === 7 ? "xl:grid-cols-4" : count === 6 ? "xl:grid-cols-3 2xl:grid-cols-6" : count === 5 ? "xl:grid-cols-5" : "xl:grid-cols-4";
  const roomPct = k.rooms.total > 0 ? Math.round((k.rooms.occupied / k.rooms.total) * 100) : 0;

  const shell = `group relative flex min-h-[112px] flex-col justify-between rounded-2xl border p-3 transition-colors duration-200 sm:min-h-[148px] sm:p-5 ${focusRing}`;
  const card = `${shell} border-line bg-surface shadow-[0_1px_2px_rgba(25,37,30,0.035)] hover:border-forest/30 hover:shadow-[0_8px_24px_rgba(25,37,30,0.07)]`;
  // On phones the sales card fills a row, so an even count leaves the last card alone: let it fill its row too
  const lastCard = count % 2 === 0 ? `${card} col-span-2 xl:col-span-1` : card;
  const label = "text-[12px] font-semibold leading-4 text-muted sm:text-[13px]";
  const value = "font-display text-[24px] font-bold leading-none tracking-tight tabular sm:text-[30px]";
  const note = "mt-1 min-h-5 text-[11px] font-medium leading-4 text-muted sm:mt-2";
  const iconBox = "grid size-7 sm:size-9 shrink-0 place-items-center rounded-xl";
  const footer = "mt-2 hidden sm:flex min-h-6 items-center justify-between gap-2 border-t border-[var(--dashboard-footer-line)] pt-2 sm:mt-3 sm:min-h-7 sm:pt-2.5";
  const deltaBadge = "inline-flex shrink-0 items-center rounded-full bg-[var(--dashboard-badge)] px-2.5 py-1 [&>span]:text-[11px] [&>span]:leading-tight [&>span]:whitespace-nowrap";

  return (
    <section aria-label="Key Performance Indicators">
      <div className={`grid grid-cols-2 gap-2 sm:gap-4 ${columns}`}>
        <Link href="/console/billing" className={`${shell} col-span-2 border-forest bg-forest text-white hover:bg-forest-hover ${count === 7 ? "xl:col-span-2" : "xl:col-span-1"}`}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] font-semibold leading-4 text-white/80 sm:text-[13px]">Today&apos;s Sales</p>
            <span className={`${iconBox} bg-white/10 text-white`} aria-hidden="true"><Wallet className="size-[18px]" /></span>
          </div>
          <div className="mt-2 flex min-w-0 items-end justify-between gap-3">
            <div className="min-w-0">
              <p className={value}>{money(k.revenue.today)}</p>
              <p className="mt-1 text-[11px] font-medium leading-4 text-white/70 sm:mt-2">Money from paid bills</p>
            </div>
            <RevenueSparkline trend={trend} />
          </div>
          <div className="mt-2 hidden min-h-6 items-center justify-between gap-2 border-t border-white/15 pt-2 sm:mt-3 sm:flex sm:min-h-7 sm:pt-2.5">
            <span className="whitespace-nowrap text-[10px] font-medium text-white/70">Yesterday</span>
            <span className="inline-flex shrink-0 items-center rounded-full bg-white/10 px-2.5 py-1 [&>span]:text-[11px] [&>span]:leading-tight [&>span]:whitespace-nowrap"><Versus today={k.revenue.today} yesterday={k.revenue.yesterday} text={money(k.revenue.yesterday)} inverse /></span>
          </div>
        </Link>

        <Link href="/console/orders" className={card}>
          <div className="flex items-center justify-between gap-2">
            <p className={label}>Orders Today</p>
            <span className={`${iconBox} bg-terracotta/10 text-terracotta`} aria-hidden="true"><FileText className="size-[18px]" /></span>
          </div>
          <div className="mt-2">
            <p className={`${value} text-ink`}>{k.orders.today}</p>
            <p className={note}>
              {preparingCount > 0 || readyCount > 0 ? `${preparingCount} preparing · ${readyCount} ready` : k.orders.today > 0 ? "Active orders placed" : "No active orders"}
            </p>
          </div>
          <div className={footer}><span className="whitespace-nowrap text-[10px] font-medium text-muted">Yesterday</span><span className={deltaBadge}><Versus today={k.orders.today} yesterday={k.orders.yesterday} text={`${k.orders.yesterday} order${k.orders.yesterday === 1 ? "" : "s"}`} plain={k.orders.yesterday < 10} /></span></div>
        </Link>

        <Link href="/console/billing" className={card}>
          <div className="flex items-center justify-between gap-2">
            <p className={label}>Unpaid Bills</p>
            <span className={`${iconBox} bg-terracotta/10 text-terracotta`} aria-hidden="true"><Receipt className="size-[18px]" /></span>
          </div>
          <div className="mt-2">
            <p className={`${value} text-ink`}>{money(k.outstandingPaise)}</p>
            <p className={note}>Total amount due</p>
          </div>
          <div className={`${footer} justify-start`}><span className="text-[11px] font-medium text-muted">Across open bills</span></div>
        </Link>

        {features?.delivery === true && <Link href="/console/orders?view=delivery" className={card}>
          <div className="flex items-center justify-between gap-2">
            <p className={label}>Delivery Orders</p>
            <span className={`${iconBox} bg-sage text-forest`} aria-hidden="true"><Truck className="size-[18px]" /></span>
          </div>
          <div className="mt-2">
            <p className={`${value} text-ink`}>{k.delivery.active}</p>
            <p className={note}>{k.delivery.onTheWay} on the way · {money(k.delivery.cashToCollectPaise)} cash</p>
          </div>
          <div className={`${footer} justify-start`}><span className="text-[11px] font-medium text-muted">{k.delivery.deliveredToday} delivered today</span></div>
        </Link>}

        {features?.dineIn === true && <Link href="/console/floor" className={card}>
          <div className="flex items-center justify-between gap-2">
            <p className={label}>Tables in Use</p>
            <span className={`${iconBox} bg-terracotta/10 text-terracotta`} aria-hidden="true"><Receipt className="size-[18px]" /></span>
          </div>
          <div className="mt-2">
            <p className={`${value} text-ink`}>
            {k.openTables.open} <span className="text-base font-semibold text-muted">/ {k.openTables.total}</span>
            </p>
            <div className="mt-2 flex items-center gap-2 sm:mt-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line" role="img" aria-label={`${tablePct}% of tables in use`}>
              <div className="h-full rounded-full bg-forest transition-all duration-500" style={{ width: `${Math.min(100, tablePct)}%` }} />
              </div>
              <span className="text-xs font-bold text-muted tabular">{tablePct}%</span>
            </div>
          </div>
          <div className={`${footer} justify-start`}><span className="text-[11px] font-medium text-muted">{k.openTables.total > 0 ? "Current floor occupancy" : "Add tables on the Floor"}</span></div>
        </Link>}

        {showRooms && <Link href="/console/rooms" className={card}>
          <div className="flex items-center justify-between gap-2">
            <p className={label}>Rooms in Use</p>
            <span className={`${iconBox} bg-sage text-forest`} aria-hidden="true"><BedDouble className="size-[18px]" /></span>
          </div>
          <div className="mt-2">
            <p className={`${value} text-ink`}>{k.rooms.occupied} <span className="text-base font-semibold text-muted">/ {k.rooms.total}</span></p>
            <div className="mt-2 flex items-center gap-2 sm:mt-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line" role="img" aria-label={`${roomPct}% of rooms in use`}><div className="h-full rounded-full bg-forest transition-all duration-500" style={{ width: `${Math.min(100, roomPct)}%` }} /></div>
              <span className="text-xs font-bold text-muted tabular">{roomPct}%</span>
            </div>
          </div>
          <div className={`${footer} justify-start`}><span className="text-[11px] font-medium text-muted">{k.rooms.total > 0 ? `${k.rooms.cleaning} cleaning · ${k.rooms.available} ready` : "Add rooms to get started"}</span></div>
        </Link>}

        <Link href="/console/billing" className={lastCard}>
          <div className="flex items-center justify-between gap-2">
            <p className={label}>Average Bill</p>
            <span className={`${iconBox} bg-sage text-forest`} aria-hidden="true"><CreditCard className="size-[18px]" /></span>
          </div>
          <div className="mt-2">
            <p className={`${value} text-ink`}>{money(k.averageBill.today)}</p>
            <p className={note}>Per paid bill</p>
          </div>
          <div className={footer}><span className="whitespace-nowrap text-[10px] font-medium text-muted">Yesterday</span><span className={deltaBadge}><Versus today={k.averageBill.today} yesterday={k.averageBill.yesterday} text={money(k.averageBill.yesterday)} /></span></div>
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


/** Nothing yet today, or a small base: yesterday's plain figure says more than an alarming percentage */
function Versus({ today, yesterday, text, plain = false, inverse = false }: { today: number; yesterday: number; text: string; plain?: boolean; inverse?: boolean }) {
  if (yesterday > 0 && (today === 0 || plain)) return <span className={`font-medium tabular ${inverse ? "text-white/70" : "text-muted"}`}>{text}</span>;
  return <Delta today={today} yesterday={yesterday} compact inverse={inverse} />;
}

function RevenueSparkline({ trend }: { trend: RevenueTrend }) {
  const max = Math.max(...trend.map((day) => day.revenuePaise), 0);
  if (max === 0) return null;

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
    <svg className="mb-0.5 h-8 w-[72px] shrink-0 overflow-visible sm:w-[104px]" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Revenue trend for the last 7 days: ${trend.map((day) => `${dayLabel(day.date, { weekday: "short" })} ${money(day.revenuePaise)}`).join(", ")}`}>
      <path d={area} fill="currentColor" className="text-white" opacity="0.12" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white" />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill="currentColor" className="text-white" />
    </svg>
  );
}
