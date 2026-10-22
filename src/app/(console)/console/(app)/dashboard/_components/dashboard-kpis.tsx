import { Calendar, CreditCard, FileText, Receipt, Users, Wallet } from "lucide-react";
import Link from "next/link";
import type { DashboardData } from "@/server/staff/dashboard";
import { Delta, focusRing, money } from "./dashboard-shared";

/**
 * Five headline KPIs (spec §7), each a link to the screen that owns the number, plus one quiet
 * strip for the counts in between. No sparklines or decoration: a trend shows only when real
 * yesterday data exists (Delta handles that).
 */
export function DashboardKpis({ data }: { data: DashboardData }) {
  const k = data.kpis;
  const tablePct = k.openTables.total > 0 ? Math.round((k.openTables.open / k.openTables.total) * 100) : 0;
  const preparingCount = (data.operations.kitchenOrders || []).filter((o) => o.status === "preparing").length;
  const readyCount = (data.operations.kitchenOrders || []).filter((o) => o.status === "ready").length;
  const wl = data.operations.waitlist;

  const card = `group flex min-h-[132px] flex-col justify-between rounded-card border border-line bg-surface p-4 sm:p-5 transition-colors hover:border-forest/40 ${focusRing}`;
  const stripCell = `block bg-surface p-4 transition-colors hover:bg-paper ${focusRing}`;
  const iconBox = "grid size-10 shrink-0 place-items-center rounded-input";

  return (
    <section aria-label="Key Performance Indicators">
      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 xl:grid-cols-5">
        <Link href="/console/billing" className={card}>
          <div className="flex items-center gap-2.5">
            <span className={`${iconBox} bg-sage text-forest`} aria-hidden="true"><Wallet className="size-5" /></span>
            <p className="text-[13px] font-semibold text-muted">Today&apos;s Sales</p>
          </div>
          <p className="mt-3 font-display text-[28px] font-bold leading-none tracking-tight text-ink tabular">{money(k.revenue.today)}</p>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="text-xs font-medium text-muted">Money from paid bills</span>
            <Delta today={k.revenue.today} yesterday={k.revenue.yesterday} />
          </div>
        </Link>

        <Link href="/console/orders" className={card}>
          <div className="flex items-center gap-2.5">
            <span className={`${iconBox} bg-terracotta/10 text-terracotta`} aria-hidden="true"><FileText className="size-5" /></span>
            <p className="text-[13px] font-semibold text-muted">Orders Today</p>
          </div>
          <p className="mt-3 font-display text-[28px] font-bold leading-none tracking-tight text-ink tabular">{k.orders.today}</p>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="text-xs font-medium text-muted">
              {preparingCount > 0 || readyCount > 0 ? `${preparingCount} preparing · ${readyCount} ready` : k.orders.today > 0 ? "Active orders placed" : "No active orders"}
            </span>
            <Delta today={k.orders.today} yesterday={k.orders.yesterday} />
          </div>
        </Link>

        <Link href="/console/reports" className={card}>
          <div className="flex items-center gap-2.5">
            <span className={`${iconBox} bg-sage text-forest`} aria-hidden="true"><Users className="size-5" /></span>
            <p className="text-[13px] font-semibold text-muted">Guests Served</p>
          </div>
          <p className="mt-3 font-display text-[28px] font-bold leading-none tracking-tight text-ink tabular">{k.covers.today}</p>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="text-xs font-medium text-muted">Guests at your tables today</span>
            <Delta today={k.covers.today} yesterday={k.covers.yesterday} />
          </div>
        </Link>

        <Link href="/console/floor" className={card}>
          <div className="flex items-center gap-2.5">
            <span className={`${iconBox} bg-terracotta/10 text-terracotta`} aria-hidden="true"><Receipt className="size-5" /></span>
            <p className="text-[13px] font-semibold text-muted">Tables in Use</p>
          </div>
          <p className="mt-3 font-display text-[28px] font-bold leading-none tracking-tight text-ink tabular">
            {k.openTables.open} <span className="text-base font-semibold text-muted">/ {k.openTables.total}</span>
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line" role="img" aria-label={`${tablePct}% of tables in use`}>
              <div className="h-full rounded-full bg-forest transition-all duration-500" style={{ width: `${Math.min(100, tablePct)}%` }} />
            </div>
            <span className="text-xs font-bold text-muted tabular">{tablePct}%</span>
          </div>
        </Link>

        <Link href="/console/billing" className={`${card} min-[480px]:col-span-2 xl:col-span-1`}>
          <div className="flex items-center gap-2.5">
            <span className={`${iconBox} bg-sage text-forest`} aria-hidden="true"><CreditCard className="size-5" /></span>
            <p className="text-[13px] font-semibold text-muted">Average Bill</p>
          </div>
          <p className="mt-3 font-display text-[28px] font-bold leading-none tracking-tight text-ink tabular">{money(k.averageBill.today)}</p>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="text-xs font-medium text-muted">Per paid bill</span>
            <Delta today={k.averageBill.today} yesterday={k.averageBill.yesterday} />
          </div>
        </Link>
      </div>

      {/* Secondary numbers: one quiet divided strip, links to the screens that own them */}
      <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-card border border-line bg-line">
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
        <Link href="/console/billing" className={stripCell}>
          <p className="text-xs font-semibold text-muted">Unpaid Bills</p>
          <p className="mt-1 text-xl font-bold text-ink tabular">{money(k.outstandingPaise)}</p>
          <p className="mt-0.5 hidden text-xs font-medium text-muted sm:block">Still to collect</p>
        </Link>
      </div>
    </section>
  );
}
