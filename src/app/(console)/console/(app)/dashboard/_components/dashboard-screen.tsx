"use client";
import type { DutyRow, DutyStatus } from "@/server/staff/duty";
import { setDutyAction } from "../../team/actions";

import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Calendar,
  Check,
  CheckCircle2,
  ChefHat,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock,
  CreditCard,
  Droplets,
  FileText,
  Flame,
  Lock,
  Plus,
  Receipt,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  TrendingDown,
  TrendingUp,
  User,
  Users,
  Utensils,
  UtensilsCrossed,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { deltaLabel, deltaOf, UPCOMING_WINDOW_MINUTES } from "@/domain/dashboard";
import type { DashboardData, RevenueTrend, CustomerRequestItem, KitchenOrderItem } from "@/server/staff/dashboard";
import { dashboardAction, revenueTrendAction, resolveServiceRequestAction, checkInReservationAction } from "../actions";
import { createDashboardSync, startDashboardSync, type DashboardSync } from "./dashboard-sync";

// Legacy export kept for compatibility. The design tokens in src/app/globals.css are the
// source of truth; this screen consumes them through Tailwind token classes (ink, paper,
// surface, line, forest, terracotta, state-*), not through these constants.
export const THEME = {
  forestGreen: "#103B2C",
  forestGreenHover: "#174D39",
  warmCream: "#F7F5EF",
  surface: "#FFFFFF",
  terracotta: "#D86B45",
  softSage: "#DDE8DA",
  primaryText: "#17251F",
  mutedText: "#768078",
  border: "#E9E5DD",
} as const;

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest";
const cardClass = "rounded-card border border-line bg-surface p-5 sm:p-6";

const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
/** ₹ with Indian grouping; paise only when there are any, so an amount is never rounded away */
export const money = (paise: number) =>
  `₹${paise % 100 === 0 ? rupees.format(paise / 100) : (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const timeIn = (at: number, timeZone: string) => new Intl.DateTimeFormat("en-IN", { timeZone, hour: "numeric", minute: "2-digit" }).format(at);
/** "Wednesday, 21 October" for an outlet date; formatted at UTC noon so no time zone can move the day */
const dayLabel = (date: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", ...opts }).format(new Date(`${date}T12:00:00Z`));

/** Human-readable time ago: "2 min ago", "1 hour ago", "Yesterday" — never raw thousands of minutes */
export function formatTimeAgo(timestamp: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return new Date(timestamp).toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

export type DashboardPreview = { refreshing?: boolean; error?: string };

export function DashboardScreen({
  initial,
  initialTrend,
  preview,
  duty,
  setup,
}: {
  initial: DashboardData;
  initialTrend: RevenueTrend;
  preview?: DashboardPreview;
  duty?: { rows: DutyRow[]; canChange: boolean };
  setup?: ReactNode;
}) {
  const [data, setData] = useState(initial);
  const [trend, setTrend] = useState(initialTrend);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sync = useRef<DashboardSync | null>(null);

  useEffect(() => {
    if (preview) return;
    const s = createDashboardSync({
      loadOps: dashboardAction,
      loadTrend: revenueTrendAction,
      onOps: (d) => {
        setData(d);
        setError(null);
      },
      onTrend: setTrend,
      onError: setError,
    });
    sync.current = s;
    return startDashboardSync(s);
  }, [preview]);

  const refresh = async () => {
    if (!sync.current || busy) return;
    setBusy(true);
    await sync.current.all();
    setBusy(false);
  };

  const refreshing = preview?.refreshing ?? busy;
  const shownError = preview?.error ?? error;
  const tz = data.timezone;

  return (
    <div className="min-h-full bg-paper text-ink font-sans antialiased">
      <main className="mx-auto w-full max-w-[1540px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6 space-y-5">
        {/* ROW 1: Welcome Header */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="font-display text-2xl sm:text-[28px] font-bold tracking-tight text-ink">
              {data.greeting}, {data.outletName}!
            </h1>
            <p className="mt-1 text-sm font-medium text-muted">
              Here&apos;s what&apos;s happening at your restaurant today.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs font-semibold text-muted">
                {dayLabel(data.date, { weekday: "long", day: "numeric", month: "long" })}
              </p>
              <p className="text-[11px] font-medium text-muted tabular" aria-live="polite">
                Updated {timeIn(data.generatedAt, tz)}
              </p>
            </div>

            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              className={`inline-flex min-h-10 items-center gap-1.5 rounded-input border border-line bg-surface px-4 text-sm font-semibold text-ink hover:border-forest/40 hover:bg-paper disabled:opacity-60 transition-all cursor-pointer ${focusRing}`}
            >
              <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
              <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
            </button>
          </div>
        </header>

        {shownError && (
          <p role="status" className="rounded-input border border-terracotta/30 bg-terracotta/10 px-3.5 py-2 text-sm text-terracotta">
            {shownError}
          </p>
        )}

        {setup}

        {/* Needs attention first: waiting bills, late guests, stock — before the numbers */}
        <Attention data={data} />

        {/* KPI row: four headline numbers, then a quiet strip for the rest */}
        <Kpis data={data} />

        {/* Quick actions: one clean row */}
        <nav aria-label="Quick links" className="flex items-center gap-3 overflow-x-auto pb-1 no-scrollbar">
          {/* Primary Action Button */}
          <Link
            href="/console/floor"
            className={`inline-flex shrink-0 h-11 items-center gap-2 rounded-card bg-forest px-5 text-sm font-semibold text-white shadow-float hover:bg-forest-hover active:scale-[0.98] transition-all ${focusRing}`}
          >
            <Plus className="size-4 stroke-[2.5]" aria-hidden="true" />
            <span>Open Floor</span>
            <ChevronRight className="size-4 text-white/70" aria-hidden="true" />
          </Link>

          {/* Secondary actions */}
          {[
            { href: "/console/floor", label: "New Order", icon: ShoppingBag },
            { href: "/console/billing", label: "Take Payment", icon: CreditCard },
            { href: "/console/reservations", label: "Reservations", icon: Calendar },
            { href: "/console/orders", label: "View Orders", icon: FileText },
            { href: "/console/reports", label: "Reports", icon: BarChart3 },
            { href: "/console/reports/day-close", label: "Day Close", icon: Clock },
          ].map(({ href, label, icon: Icon }) => (
            <Link
              key={label}
              href={href}
              className={`inline-flex shrink-0 h-11 items-center gap-2.5 rounded-card border border-line bg-surface px-4.5 text-sm font-semibold text-ink hover:border-forest/40 hover:bg-paper active:scale-[0.98] transition-all ${focusRing}`}
            >
              <Icon className="size-4 text-terracotta" aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        {/* Main area: the floor is the job; everything else supports it from the rail */}
        <div className="grid grid-cols-1 gap-6 items-start xl:grid-cols-12">
          <div className="xl:col-span-8 min-w-0">
            <LiveFloor data={data} />
          </div>

          <div className="xl:col-span-4 flex min-w-0 flex-col gap-6">
            <CustomerRequests initialRequests={data.operations.customerRequests || []} />
            <KitchenOrders orders={data.operations.kitchenOrders || []} />
            <UpcomingReservations upcoming={data.operations.upcoming || []} timezone={data.timezone} />
            {duty && <StaffOnDuty duty={duty} />}
          </div>
        </div>

        {/* Money row: what came in, and the week behind it */}
        <div className="grid grid-cols-1 gap-6 items-start lg:grid-cols-2">
          <RecentPayments payments={data.operations.recentPayments || []} />
          <SalesPerformance trend={trend} today={data.date} kpis={data.kpis} />
        </div>

        {/* Quiet row: best sellers and the live feed, compact lists */}
        <div className="grid grid-cols-1 gap-6 items-start lg:grid-cols-2">
          <TopDishes topItems={data.topItems || []} />
          <LiveActivityFeed feed={data.operations.activityFeed || []} />
        </div>
      </main>
    </div>
  );
}

function Delta({ today, yesterday }: { today: number; yesterday: number }) {
  const d = deltaOf(today, yesterday);
  if (d.kind === "up") {
    return (
      <span className="flex items-center gap-1 text-[13px] font-bold text-emerald-700 tabular">
        <TrendingUp className="size-3.5 stroke-[2.5]" aria-hidden="true" />
        <span>+{d.pct}% vs yesterday</span>
      </span>
    );
  }
  if (d.kind === "down") {
    return (
      <span className="flex items-center gap-1 text-[13px] font-bold text-terracotta tabular">
        <TrendingDown className="size-3.5 stroke-[2.5]" aria-hidden="true" />
        <span>−{d.pct}% vs yesterday</span>
      </span>
    );
  }
  if (d.kind === "same") {
    return <span className="text-[13px] font-medium text-muted">No change vs yesterday</span>;
  }
  return <span className="text-[13px] font-medium text-muted">No change vs yesterday</span>;
}

function Kpis({ data }: { data: DashboardData }) {
  const k = data.kpis;
  const tablePct = k.openTables.total > 0 ? Math.round((k.openTables.open / k.openTables.total) * 100) : 0;
  const preparingCount = (data.operations.kitchenOrders || []).filter((o) => o.status === "preparing").length;
  const readyCount = (data.operations.kitchenOrders || []).filter((o) => o.status === "ready").length;
  const wl = data.operations.waitlist;

  const card = `group flex min-h-[136px] flex-col justify-between rounded-card border border-line bg-surface p-5 transition-colors hover:border-forest/40 ${focusRing}`;
  const stripCell = `block bg-surface p-4 transition-colors hover:bg-paper ${focusRing}`;

  return (
    <section aria-label="Key Performance Indicators">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Today's Sales */}
        <Link href="/console/billing" className={card}>
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-input bg-sage text-forest" aria-hidden="true">
              <Wallet className="size-5" />
            </span>
            <p className="text-sm font-semibold text-muted">Today&apos;s Sales</p>
          </div>
          <p className="mt-4 font-display text-[30px] font-bold leading-none tracking-tight text-ink tabular">{money(k.revenue.today)}</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted">Money from paid bills</span>
            <Delta today={k.revenue.today} yesterday={k.revenue.yesterday} />
          </div>
        </Link>

        {/* Orders Today (live preparing/ready counts stay as the sub-line) */}
        <Link href="/console/orders" className={card}>
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-input bg-terracotta/10 text-terracotta" aria-hidden="true">
              <FileText className="size-5" />
            </span>
            <p className="text-sm font-semibold text-muted">Orders Today</p>
          </div>
          <p className="mt-4 font-display text-[30px] font-bold leading-none tracking-tight text-ink tabular">{k.orders.today}</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted">
              {preparingCount > 0 || readyCount > 0
                ? `${preparingCount} preparing · ${readyCount} ready`
                : k.orders.today > 0 ? "Active orders placed" : "No active orders"}
            </span>
            <Delta today={k.orders.today} yesterday={k.orders.yesterday} />
          </div>
        </Link>

        {/* Guests Served */}
        <Link href="/console/reports" className={card}>
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-input bg-sage text-forest" aria-hidden="true">
              <Users className="size-5" />
            </span>
            <p className="text-sm font-semibold text-muted">Guests Served</p>
          </div>
          <p className="mt-4 font-display text-[30px] font-bold leading-none tracking-tight text-ink tabular">{k.covers.today}</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted">Guests at your tables today</span>
            <Delta today={k.covers.today} yesterday={k.covers.yesterday} />
          </div>
        </Link>

        {/* Average Bill */}
        <Link href="/console/billing" className={card}>
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-input bg-terracotta/10 text-terracotta" aria-hidden="true">
              <Receipt className="size-5" />
            </span>
            <p className="text-sm font-semibold text-muted">Average Bill</p>
          </div>
          <p className="mt-4 font-display text-[30px] font-bold leading-none tracking-tight text-ink tabular">{money(k.averageBill.today)}</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted">Per paid bill</span>
            <Delta today={k.averageBill.today} yesterday={k.averageBill.yesterday} />
          </div>
        </Link>
      </div>

      {/* Secondary numbers: one quiet strip, not four more poster cards */}
      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line lg:grid-cols-4">
        <Link href="/console/floor" className={stripCell}>
          <p className="text-xs font-semibold text-muted">Tables in Use</p>
          <p className="mt-1 text-xl font-bold text-ink tabular">
            {k.openTables.open} <span className="text-sm font-semibold text-muted">/ {k.openTables.total}</span>
          </p>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-forest transition-all duration-500" style={{ width: `${Math.min(100, tablePct)}%` }} />
            </div>
            <span className="text-xs font-bold text-muted tabular">{tablePct}%</span>
          </div>
        </Link>

        <Link href="/console/reservations" className={stripCell}>
          <p className="text-xs font-semibold text-muted">Bookings Coming Up</p>
          <p className="mt-1 text-xl font-bold text-ink tabular">{k.upcomingReservations}</p>
          <p className="mt-1 text-xs font-medium text-muted">Reservations still to arrive</p>
        </Link>

        <Link href="/console/waitlist" className={stripCell}>
          <p className="text-xs font-semibold text-muted">Waiting List</p>
          <p className="mt-1 text-xl font-bold text-ink tabular">{k.waitlist}</p>
          <p className="mt-1 text-xs font-medium text-muted">{wl.waiting} waiting · {wl.notified} notified</p>
        </Link>

        <Link href="/console/billing" className={stripCell}>
          <p className="text-xs font-semibold text-muted">Unpaid Bills</p>
          <p className="mt-1 text-xl font-bold text-ink tabular">{money(k.outstandingPaise)}</p>
          <p className="mt-1 text-xs font-medium text-muted">Still to collect</p>
        </Link>
      </div>
    </section>
  );
}

function LiveFloor({ data }: { data: DashboardData }) {
  const t = data.operations.tables;
  const tiles = data.operations.tableTiles || [];

  return (
    <div className={cardClass}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2 className="font-display text-section font-bold text-ink">Live Floor</h2>
          {/* Status counts: a coloured dot AND a word, never colour alone */}
          <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-ink">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ backgroundColor: "var(--state-available)" }} aria-hidden="true" />
              Available <strong className="tabular font-bold">{t.available}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ backgroundColor: "var(--state-seated)" }} aria-hidden="true" />
              Occupied <strong className="tabular font-bold">{t.seated + t.billRequested}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ backgroundColor: "var(--state-reserved)" }} aria-hidden="true" />
              Reserved <strong className="tabular font-bold">{t.reserved}</strong>
            </span>
            {t.blocked > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ backgroundColor: "var(--state-blocked)" }} aria-hidden="true" />
                Blocked <strong className="tabular font-bold">{t.blocked}</strong>
              </span>
            )}
          </div>
        </div>

        <Link
          href="/console/floor"
          className={`inline-flex min-h-10 items-center gap-1 rounded-input border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:border-forest/40 hover:bg-paper ${focusRing}`}
        >
          <span>View all</span>
          <ChevronRight className="size-3.5 text-muted" aria-hidden="true" />
        </Link>
      </div>

      {/* Table tiles: big enough to tap, words as well as colours */}
      <div className="mt-5">
        {tiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-input border border-dashed border-line p-8 text-center">
            <UtensilsCrossed className="size-7 text-muted/60" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-ink">No tables active on the floor</p>
            <Link
              href="/console/floor"
              className={`mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-input bg-forest px-4 text-sm font-semibold text-white transition-colors hover:bg-forest-hover ${focusRing}`}
            >
              Open Floor Plan
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
            {tiles.slice(0, 15).map((table) => {
              const isOccupied = table.state === "seated" || table.state === "bill_requested";
              const isBillReq = table.state === "bill_requested";
              const isReserved = table.state === "reserved" || table.state === "held";
              const isBlocked = table.state === "blocked";

              let stateVar = "available";
              let statusLabel = "Available";
              let Icon = Utensils;

              if (isBillReq) {
                stateVar = "bill";
                statusLabel = "Bill requested";
                Icon = Receipt;
              } else if (isOccupied) {
                stateVar = "seated";
                statusLabel = "Seated";
                Icon = User;
              } else if (isReserved) {
                stateVar = "reserved";
                statusLabel = table.state === "held" ? "Held" : "Reserved";
                Icon = Calendar;
              } else if (isBlocked) {
                stateVar = "blocked";
                statusLabel = "Blocked";
                Icon = Lock;
              }

              return (
                <Link
                  key={table.id}
                  href="/console/floor"
                  aria-label={`Table ${table.code}, ${statusLabel}, ${table.seats} seats`}
                  className={`group flex min-h-[104px] flex-col justify-between rounded-input border p-3 transition-shadow hover:shadow-float ${focusRing}`}
                  style={{
                    backgroundColor: `var(--state-${stateVar}-soft)`,
                    borderColor: `var(--state-${stateVar})`,
                    color: `var(--state-${stateVar}-text)`,
                  }}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="font-display text-base font-bold text-ink">{table.code}</span>
                  </div>

                  <div>
                    <p className="text-xs font-bold leading-tight">{statusLabel}</p>
                    <p className="mt-0.5 text-xs font-medium leading-tight text-ink/70">
                      {table.seats} seats
                      {isOccupied && table.runningPaise ? (
                        <>
                          {" · "}
                          <span className="font-bold text-ink tabular">{money(table.runningPaise)}</span>
                        </>
                      ) : null}
                      {isOccupied && table.guests ? ` · ${table.guests} guests` : ""}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StaffOnDuty({ duty }: { duty: { rows: DutyRow[]; canChange?: boolean } }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [selectedStaff, setSelectedStaff] = useState<DutyRow | null>(null);
  const [picked, setPicked] = useState<Record<string, { status: DutyStatus; at: number }>>({});
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setSelectedStaff(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedStaff(null);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const changeStatus = (id: string, status: DutyStatus) => {
    setPicked((p) => ({ ...p, [id]: { status, at: Date.now() } }));
    start(async () => {
      await setDutyAction(id, status);
      router.refresh();
    });
  };

  const rows = duty.rows.map((r) =>
    picked[r.id] && Date.now() - picked[r.id].at < 20_000 ? { ...r, status: picked[r.id].status } : r
  );

  const onDutyCount = rows.filter((r) => r.status === "on").length;
  const onBreakCount = rows.filter((r) => r.status === "break").length;
  const offCount = rows.filter((r) => r.status === "off").length;

  const visibleStaff = rows.slice(0, 5);
  const overflow = rows.length - 5;

  return (
    <div className="relative rounded-card border border-line bg-surface p-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">Staff on duty</h2>
          <p className="mt-0.5 text-xs font-medium text-muted">
            {onDutyCount} on duty · {onBreakCount} break · {offCount} off
          </p>
        </div>

        <Link
          href="/console/team"
          className="inline-flex items-center gap-1 inline-flex min-h-10 items-center gap-1 rounded-input border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:border-forest/40 hover:bg-paper"
        >
          <span>Manage</span>
        </Link>
      </div>

      {/* Staff avatars with a presence dot and name */}
      <div className="mt-3.5 flex items-center gap-3 overflow-x-auto pb-1 no-scrollbar">
        {rows.length === 0 ? (
          <p className="text-xs text-muted py-2">No staff assigned to this outlet.</p>
        ) : (
          <>
            {visibleStaff.map((staff) => {
              const initials = staff.name
                .trim()
                .split(/\s+/)
                .map((p) => p[0])
                .filter(Boolean)
                .slice(0, 2)
                .join("")
                .toUpperCase() || "S";

              const isOn = staff.status === "on";
              const isBreak = staff.status === "break";

              const dotColor = isOn
                ? "bg-emerald-500 ring-2 ring-white"
                : isBreak
                ? "bg-amber-500 ring-2 ring-white"
                : "bg-neutral-400 ring-2 ring-white";

              return (
                <button
                  key={staff.id}
                  type="button"
                  onClick={() => setSelectedStaff(staff)}
                  className="group flex flex-col items-center min-w-[56px] cursor-pointer text-center focus-visible:outline-2 focus-visible:outline-forest rounded-input p-1 hover:bg-paper transition-all"
                >
                  <div className="relative">
                    <div className="grid size-11 place-items-center rounded-full bg-neutral-100 font-display text-xs font-bold text-ink shadow-xs group-hover:scale-105 transition-transform border border-line">
                      {initials}
                    </div>
                    <span className={`absolute bottom-0 right-0 size-3 rounded-full ${dotColor}`} />
                  </div>
                  <span className="mt-1.5 max-w-[62px] truncate text-xs font-bold text-ink">
                    {staff.name.split(" ")[0]}
                  </span>
                  <span className="max-w-[62px] truncate text-[10px] font-medium capitalize text-muted">
                    {staff.roles[0] || "Staff"}
                  </span>
                </button>
              );
            })}

            {/* If only 1 or 2 staff members, show a clean invite shortcut */}
            {rows.length < 3 && (
              <Link
                href="/console/team"
                className="flex flex-col items-center justify-center min-w-[52px] text-center p-1 rounded-input hover:bg-paper transition-colors"
                title="Add staff member"
              >
                <div className="grid size-11 place-items-center rounded-full border border-dashed border-line text-muted hover:border-forest hover:text-forest transition-colors">
                  <Plus className="size-4" />
                </div>
                <span className="mt-1.5 text-[11px] font-semibold text-muted">Add</span>
              </Link>
            )}

            {overflow > 0 && (
              <Link
                href="/console/team"
                className="flex flex-col items-center justify-center min-w-[50px] text-center"
              >
                <div className="grid size-11 place-items-center rounded-full bg-neutral-100 border border-line text-xs font-bold text-muted hover:bg-neutral-200 transition-colors">
                  +{overflow}
                </div>
                <span className="mt-1.5 text-[11px] font-semibold text-muted">More</span>
              </Link>
            )}
          </>
        )}
      </div>

      {/* Selected Staff Duty Popover */}
      {selectedStaff && (
        <div
          ref={popoverRef}
          className="absolute right-4 top-16 z-50 w-64 rounded-card border border-line bg-surface p-4 shadow-modal"
        >
          <div className="flex items-start justify-between gap-2 border-b border-line pb-3">
            <div>
              <p className="text-sm font-bold text-ink">{selectedStaff.name}</p>
              <p className="text-xs font-medium capitalize text-muted">
                {selectedStaff.roles[0] || "Staff"} · {selectedStaff.online ? "App open" : "Offline"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedStaff(null)}
              className="rounded-full p-1 text-muted hover:bg-neutral-100 hover:text-ink cursor-pointer"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="py-2.5">
            <p className="text-xs font-semibold text-ink">Shift Status</p>
            {duty.canChange ? (
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {(["on", "break", "off"] as const).map((st) => {
                  const active = selectedStaff.status === st;
                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() => {
                        changeStatus(selectedStaff.id, st);
                        setSelectedStaff({ ...selectedStaff, status: st });
                      }}
                      className={`rounded-input py-1.5 text-xs font-semibold capitalize transition-all cursor-pointer ${
                        active
                          ? st === "on"
                            ? "bg-forest text-white shadow-xs"
                            : st === "break"
                            ? "bg-amber-600 text-white shadow-xs"
                            : "bg-neutral-700 text-white shadow-xs"
                          : "border border-line bg-surface text-muted hover:bg-paper"
                      }`}
                    >
                      {st === "on" ? "On Duty" : st === "break" ? "Break" : "Off"}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mt-1 text-xs font-semibold capitalize text-forest">
                {selectedStaff.status === "on" ? "On duty" : selectedStaff.status === "break" ? "On break" : "Off duty"}
              </p>
            )}
          </div>

          <div className="border-t border-line pt-2 text-right">
            <Link
              href="/console/team"
              className="text-xs font-semibold text-forest hover:underline"
            >
              View Full Profile →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function KitchenOrders({ orders }: { orders: KitchenOrderItem[] }) {
  const pendingCount = orders.filter((o) => o.status === "placed").length;
  const preparingCount = orders.filter((o) => o.status === "preparing").length;
  const readyCount = orders.filter((o) => o.status === "ready").length;
  const delayedCount = orders.filter((o) => o.elapsedMinutes > 15).length;

  return (
    <div className="rounded-card border border-line bg-surface p-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <ChefHat className="size-4.5 text-forest" />
          <h2 className="text-base font-bold text-ink">Kitchen Orders</h2>
        </div>
        <Link
          href="/console/kitchen"
          className="inline-flex items-center gap-1 inline-flex min-h-10 items-center gap-1 rounded-input border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:border-forest/40 hover:bg-paper"
        >
          <span>View all</span>
          <ChevronRight className="size-3.5 text-muted" />
        </Link>
      </div>

      {/* Status counts */}
      <div className="mt-3 flex items-center justify-between gap-2 text-xs font-semibold border-b border-line pb-3">
        <span className="flex items-center gap-1.5 text-terracotta">
          <ShoppingBag className="size-3.5" />
          <span>{pendingCount} Pending</span>
        </span>
        <span className="flex items-center gap-1.5 text-blue-700">
          <Utensils className="size-3.5" />
          <span>{preparingCount} Preparing</span>
        </span>
        <span className="flex items-center gap-1.5 text-emerald-700">
          <ChefHat className="size-3.5" />
          <span>{readyCount} Ready</span>
        </span>
        <span className="flex items-center gap-1 text-terracotta">
          <AlertTriangle className="size-3.5" />
          <span>{delayedCount} Delayed</span>
        </span>
      </div>

      {/* Order tickets */}
      <div className="mt-3 divide-y divide-line">
        {orders.length === 0 ? (
          <div className="py-4 text-center">
            <CheckCircle2 className="mx-auto size-5 text-emerald-600" />
            <p className="mt-1 text-xs font-semibold text-ink">Kitchen is caught up</p>
            <p className="text-[11px] text-muted">No active tickets in queue</p>
          </div>
        ) : (
          orders.slice(0, 4).map((ticket) => {
            const isDelayed = ticket.elapsedMinutes > 15;
            const statusConfig = {
              placed: { label: "Pending", bg: "bg-amber-50 text-amber-800 border-amber-200" },
              preparing: { label: "Preparing", bg: "bg-blue-50 text-blue-700 border-blue-200" },
              ready: { label: "Ready", bg: "bg-emerald-50 text-emerald-800 border-emerald-200" },
            }[ticket.status];

            const dotColor = isDelayed
              ? "bg-terracotta"
              : ticket.status === "ready"
              ? "bg-emerald-600"
              : ticket.status === "preparing"
              ? "bg-blue-600"
              : "bg-amber-500";

            return (
              <div key={ticket.id} className="flex items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`size-2 shrink-0 rounded-full ${dotColor}`} />
                  <span className="shrink-0 font-bold text-sm text-ink">
                    {ticket.tableCode}
                  </span>
                  <p className="truncate text-sm font-medium text-ink">
                    {ticket.items}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[11px] tabular ${isDelayed ? "font-bold text-terracotta" : "text-muted"}`}>
                    {ticket.elapsedMinutes} min
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${isDelayed ? "bg-rose-50 text-rose-700 border-rose-200" : statusConfig.bg}`}>
                    {isDelayed ? "Delayed" : statusConfig.label}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function CustomerRequests({ initialRequests }: { initialRequests: CustomerRequestItem[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [requests, setRequests] = useState(initialRequests);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  useEffect(() => {
    setRequests(initialRequests);
  }, [initialRequests]);

  const handleResolve = (id: string) => {
    setResolvingId(id);
    setRequests((prev) => prev.filter((r) => r.id !== id));
    start(async () => {
      await resolveServiceRequestAction(id);
      setResolvingId(null);
      router.refresh();
    });
  };

  const getKindDetails = (kind: string) => {
    switch (kind) {
      case "water":
        return { label: "Extra water", icon: Droplets, color: "text-sky-600 bg-sky-50", actionLabel: "Mark done" };
      case "cutlery":
        return { label: "Extra cutlery", icon: UtensilsCrossed, color: "text-amber-600 bg-amber-50", actionLabel: "Mark done" };
      case "call_waiter":
        return { label: "Waiter call", icon: Bell, color: "text-terracotta bg-terracotta/10", actionLabel: "Respond" };
      case "request_bill":
      case "pay_at_counter":
        return { label: "Bill requested", icon: Receipt, color: "text-emerald-700 bg-emerald-50", actionLabel: "Take bill" };
      case "clean_table":
        return { label: "Clean table", icon: Sparkles, color: "text-purple-600 bg-purple-50", actionLabel: "Mark done" };
      default:
        return { label: kind.replace("_", " "), icon: Bell, color: "text-neutral-700 bg-neutral-100", actionLabel: "Respond" };
    }
  };

  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <Bell className="size-4.5 text-terracotta" />
          <h2 className="text-base font-bold text-ink">Customer Requests</h2>
        </div>
        <Link
          href="/console/floor"
          className="inline-flex items-center gap-1 inline-flex min-h-10 items-center gap-1 rounded-input border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:border-forest/40 hover:bg-paper"
        >
          <span>View all</span>
        </Link>
      </div>

      <div className="mt-3 divide-y divide-line">
        {requests.length === 0 ? (
          <div className="py-4 text-center">
            <CheckCircle2 className="mx-auto size-5 text-emerald-600" />
            <p className="mt-1 text-xs font-semibold text-ink">No pending requests</p>
            <p className="text-[11px] text-muted">Guest requests will chime here</p>
          </div>
        ) : (
          requests.slice(0, 5).map((r) => {
            const { label, icon: Icon, color, actionLabel } = getKindDetails(r.kind);
            const isBill = r.kind === "request_bill" || r.kind === "pay_at_counter";
            return (
              <div key={r.id} className="flex items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="shrink-0 font-bold text-xs text-ink bg-neutral-100 px-1.5 py-0.5 rounded">
                    {r.tableCode}
                  </span>
                  <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${color}`}>
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">
                      {label}
                    </p>
                    <p className="text-[10px] text-muted tabular">
                      {r.elapsedMinutes === 0 ? "Just now" : `${r.elapsedMinutes} min ago`}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleResolve(r.id)}
                  disabled={resolvingId === r.id}
                  className={`inline-flex min-h-10 shrink-0 items-center rounded-input px-3 text-sm font-semibold transition-all cursor-pointer ${
                    isBill
                      ? "bg-forest text-white hover:bg-forest-hover"
                      : "border border-line bg-surface text-terracotta hover:border-terracotta hover:bg-terracotta/10"
                  }`}
                >
                  {resolvingId === r.id ? "Done..." : actionLabel}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function UpcomingReservations({ upcoming, timezone }: { upcoming: DashboardData["operations"]["upcoming"]; timezone: string }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [list, setList] = useState(upcoming);
  const [checkingInId, setCheckingInId] = useState<string | null>(null);

  useEffect(() => {
    setList(upcoming);
  }, [upcoming]);

  const handleCheckIn = (id: string) => {
    setCheckingInId(id);
    setList((prev) => prev.map((u) => (u.id === id ? { ...u, status: "arrived" } : u)));
    start(async () => {
      await checkInReservationAction(id);
      setCheckingInId(null);
      router.refresh();
    });
  };

  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <Calendar className="size-4.5 text-forest" />
          <h2 className="text-base font-bold text-ink">Upcoming Reservations</h2>
        </div>
        <Link
          href="/console/reservations"
          className="inline-flex items-center gap-1 inline-flex min-h-10 items-center gap-1 rounded-input border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:border-forest/40 hover:bg-paper"
        >
          <span>View all</span>
        </Link>
      </div>

      <div className="mt-3 divide-y divide-line">
        {list.length === 0 ? (
          <div className="py-4 text-center">
            <Calendar className="mx-auto size-5 text-muted/60" />
            <p className="mt-1 text-sm font-semibold text-ink">No reservations due</p>
            <p className="text-[11px] text-muted">Reservations scheduled for today appear here</p>
          </div>
        ) : (
          list.slice(0, 3).map((res) => {
            const timeStr = timeIn(res.startAt, timezone);
            const isArrived = res.status === "arrived";
            const tableCode = res.tables[0] || "TBD";

            return (
              <div key={res.id} className="flex items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-ink tabular">
                      {timeStr}
                    </span>
                    <span className="truncate text-xs font-semibold text-ink">{res.name ?? "Guest"}</span>
                    <span className="text-[11px] text-muted">
                      {res.partySize} guests
                    </span>
                    <span className="rounded bg-neutral-100 px-1.5 py-0.2 text-[10px] font-bold text-ink">
                      {tableCode}
                    </span>
                  </div>
                </div>

                {isArrived ? (
                  <span className="shrink-0 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                    Arrived
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleCheckIn(res.id)}
                    disabled={checkingInId === res.id}
                    className="inline-flex min-h-10 shrink-0 items-center rounded-input bg-forest px-3 text-sm font-semibold text-white hover:bg-forest-hover active:scale-95 disabled:opacity-50 cursor-pointer transition-all"
                  >
                    {checkingInId === res.id ? "Checking..." : "Check-in"}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function RecentPayments({ payments }: { payments: DashboardData["operations"]["recentPayments"] }) {
  return (
    <div className="rounded-card border border-line bg-surface p-5 h-full">
      <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
        <h2 className="text-base font-bold text-ink">Recent Payments</h2>
        <Link
          href="/console/billing"
          className="inline-flex items-center gap-1 inline-flex min-h-10 items-center gap-1 rounded-input border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:border-forest/40 hover:bg-paper"
        >
          <span>View all</span>
        </Link>
      </div>

      <div className="mt-3 divide-y divide-line">
        {payments.length === 0 ? (
          <div className="py-6 text-center">
            <Receipt className="mx-auto size-6 text-muted/60" />
            <p className="mt-1 text-xs font-semibold text-ink">No payments yet today</p>
            <p className="text-[11px] text-muted">Settled bills will appear here</p>
          </div>
        ) : (
          payments.slice(0, 5).map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--state-available-soft)] text-forest">
                  <Receipt className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-xs text-ink">
                      Table {p.tableCode}
                    </span>
                    <span className="font-bold text-sm text-ink tabular">
                      {money(p.amountPaise)}
                    </span>
                    <span className="rounded bg-neutral-100 px-1 py-0.2 text-[10px] font-bold uppercase text-muted">
                      {p.method}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted tabular">
                    {formatTimeAgo(p.createdAt)}
                  </p>
                </div>
              </div>

              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 shrink-0">
                <span className="size-1.5 rounded-full bg-emerald-600" />
                Paid
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SalesPerformance({ trend, today, kpis }: { trend: RevenueTrend; today: string; kpis: DashboardData["kpis"] }) {
  const total = trend.reduce((sum, d) => sum + d.revenuePaise, 0);
  const max = Math.max(...trend.map((d) => d.revenuePaise), 100);

  // SVG chart dimensions
  const width = 360;
  const height = 120;
  const paddingX = 16;
  const paddingY = 14;

  const points = trend.map((d, i) => {
    const x = paddingX + (i / Math.max(1, trend.length - 1)) * (width - paddingX * 2);
    const y = height - paddingY - (d.revenuePaise / max) * (height - paddingY * 2);
    return { x, y, date: d.date, val: d.revenuePaise };
  });

  let dPath = "";
  if (points.length > 0) {
    dPath = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const cx = (p0.x + p1.x) / 2;
      dPath += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
    }
  }

  const fillAreaPath = points.length > 0
    ? `${dPath} L ${points[points.length - 1]?.x ?? width} ${height} L ${points[0]?.x ?? 0} ${height} Z`
    : "";

  return (
    <div className="rounded-card border border-line bg-surface p-5 h-full flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
          <h2 className="font-display text-section font-bold text-ink">Sales, Last 7 Days</h2>
          <span className="text-xs font-semibold text-muted">Revenue by day</span>
        </div>

        {/* Area chart */}
        <div className="mt-3">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible" preserveAspectRatio="none">
            <defs>
              <linearGradient id="salesSplineGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#103B2C" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#103B2C" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            {fillAreaPath && <path d={fillAreaPath} fill="url(#salesSplineGrad)" />}
            {dPath && <path d={dPath} fill="none" stroke="#103B2C" strokeWidth="2.5" strokeLinecap="round" />}
            {points.map((p) => {
              const isToday = p.date === today;
              return (
                <circle
                  key={p.date}
                  cx={p.x}
                  cy={p.y}
                  r={isToday ? 4 : 2.5}
                  className={isToday ? "fill-[#103B2C] stroke-2 stroke-white" : "fill-white stroke-2 stroke-[#103B2C]"}
                />
              );
            })}
          </svg>

          {/* Day labels */}
          <div className="mt-1 flex justify-between px-2 text-[11px] font-medium text-muted">
            {trend.map((d) => (
              <span key={d.date} className={d.date === today ? "font-bold text-forest" : ""}>
                {d.date === today ? "Today" : dayLabel(d.date, { weekday: "short" }).slice(0, 3)}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Week totals, all from the data this panel already receives — nothing decorative */}
      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-left">
        <div>
          <p className="text-sm font-bold text-ink tabular leading-tight">{money(total || kpis.revenue.today)}</p>
          <p className="mt-0.5 text-[11px] font-medium text-muted">Total, last 7 days</p>
        </div>
        <div>
          <p className="text-sm font-bold text-ink tabular leading-tight">{money(kpis.averageBill.today || 0)}</p>
          <p className="mt-0.5 text-[11px] font-medium text-muted">Avg. Order Value</p>
        </div>
        <div>
          <p className="text-sm font-bold text-ink tabular leading-tight">{kpis.paidBills}</p>
          <p className="mt-0.5 text-[11px] font-medium text-muted">Paid Bills today</p>
        </div>
      </div>
    </div>
  );
}

function TopDishes({ topItems }: { topItems: DashboardData["topItems"] }) {
  const maxQty = Math.max(...topItems.map((it) => it.qty), 1);

  return (
    <div className={`${cardClass} h-full`}>
      <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
        <h2 className="font-display text-section font-bold text-ink">Top 5 Dishes Today</h2>
        <span className="text-xs font-semibold text-muted">Most sold</span>
      </div>

      <div className="mt-3 divide-y divide-line">
        {topItems.length === 0 ? (
          <div className="py-6 text-center">
            <UtensilsCrossed className="mx-auto size-6 text-muted/60" aria-hidden="true" />
            <p className="mt-1 text-sm font-semibold text-ink">No items sold yet today.</p>
            <p className="text-xs text-muted">Best sellers will rank here</p>
          </div>
        ) : (
          topItems.slice(0, 5).map((item, idx) => {
            const pct = Math.round((item.qty / maxQty) * 100);
            return (
              <div key={item.itemId} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sage font-display text-sm font-bold text-forest tabular" aria-hidden="true">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">{item.name}</p>
                      <p className="text-xs text-muted tabular">{item.qty} sold</p>
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-ink tabular">{money(item.grossPaise)}</span>
                </div>

                <div className="mt-2 pl-11">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-forest transition-all duration-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function LiveActivityFeed({ feed }: { feed: DashboardData["operations"]["activityFeed"] }) {
  return (
    <div className="rounded-card border border-line bg-surface p-5 h-full">
      <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-600" />
          </span>
          <h2 className="text-base font-bold text-ink">Live Activity Feed</h2>
        </div>
        <Link
          href="/console/orders"
          className="inline-flex items-center gap-1 inline-flex min-h-10 items-center gap-1 rounded-input border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:border-forest/40 hover:bg-paper"
        >
          <span>View all</span>
        </Link>
      </div>

      <div className="mt-3 divide-y divide-line max-h-[290px] overflow-y-auto pr-1">
        {feed.length === 0 ? (
          <div className="py-6 text-center">
            <Clock className="mx-auto size-6 text-muted/60" />
            <p className="mt-1 text-xs font-semibold text-ink">No activity yet</p>
            <p className="text-[11px] text-muted">Floor events will appear live</p>
          </div>
        ) : (
          feed.map((event) => {
            const timeLabel = formatTimeAgo(event.timestamp);
            const iconConfig = {
              payment: { icon: CreditCard, color: "text-forest bg-[var(--state-available-soft)]" },
              order: { icon: ShoppingBag, color: "text-terracotta bg-terracotta/10" },
              request: { icon: Bell, color: "text-amber-700 bg-[var(--state-held-soft)]" },
              reservation: { icon: Calendar, color: "text-forest bg-sage" },
            }[event.type];
            const Icon = iconConfig.icon;

            return (
              <div key={event.id} className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
                <span className="text-[10px] text-muted tabular shrink-0 w-10 text-right pt-0.5">
                  {timeLabel.replace(" ago", "")}
                </span>
                <span className={`grid size-6 shrink-0 place-items-center rounded-lg ${iconConfig.color}`}>
                  <Icon className="size-3" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-ink leading-tight">
                    {event.title}
                  </p>
                  <p className="text-[11px] text-muted leading-tight mt-0.5">
                    {event.subtitle}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={`${cardClass} min-w-0 p-5`} aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <h2 className="font-display text-base font-bold text-ink">{title}</h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function GoTo({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-1 text-xs font-semibold text-forest hover:underline underline-offset-4 ${focusRing}`}>
      {children}
      <ArrowRight className="size-3.5" aria-hidden="true" />
    </Link>
  );
}

type Alert = { key: string; tone: "bad" | "warn" | "info"; icon: typeof Clock; text: ReactNode; href?: string; linkLabel?: string };

/** The alerts in display order; exported for the tests */
export function alertsOf(data: DashboardData): Alert[] {
  const a = data.alerts;
  const out: Alert[] = [];
  for (const b of a.slowBills) {
    out.push({ key: `bill-${b.sessionId}`, tone: "bad", icon: Receipt, text: <><strong>{b.tableCode}</strong> · bill requested {b.waitedMinutes} min ago</>, href: "/console/floor", linkLabel: "Floor" });
  }
  for (const r of a.late) {
    out.push({
      key: `late-${r.id}`,
      tone: r.noShowEligible ? "bad" : "warn",
      icon: Clock,
      text: (
        <>
          <strong>{r.name ?? "Guest"}</strong> · {r.partySize} at {timeIn(r.startAt, data.timezone)} · {r.lateMinutes} min late
          {r.noShowEligible && " · No-show eligible"}
        </>
      ),
      href: "/console/reservations",
      linkLabel: "Reservations",
    });
  }
  if (a.soldOut > 0) out.push({ key: "sold-out", tone: "warn", icon: UtensilsCrossed, text: <><strong>{a.soldOut}</strong> {a.soldOut === 1 ? "item" : "items"} sold out</>, href: "/console/menu", linkLabel: "Menu" });
  if (a.pendingRefunds.count > 0) {
    out.push({ key: "refunds", tone: "info", icon: Wallet, text: <><strong>{a.pendingRefunds.count}</strong> pending {a.pendingRefunds.count === 1 ? "refund" : "refunds"} · {money(a.pendingRefunds.paise)}</> });
  }
  if (a.lowStock.length > 0) {
    out.push({ key: "low-stock", tone: "warn", icon: UtensilsCrossed, text: <><strong>{a.lowStock.length}</strong> running low: {a.lowStock.slice(0, 3).join(", ")}{a.lowStock.length > 3 ? "…" : ""}</>, href: "/console/inventory", linkLabel: "Inventory" });
  }
  if (a.blockedTables > 0) out.push({ key: "blocked", tone: "info", icon: Lock, text: <><strong>{a.blockedTables}</strong> {a.blockedTables === 1 ? "table" : "tables"} blocked</>, href: "/console/floor", linkLabel: "Floor" });
  return out;
}

const TONE_CLASSES = {
  bad: "bg-rose-50 text-rose-700 border-rose-200",
  warn: "bg-amber-50 text-amber-800 border-amber-200",
  info: "bg-emerald-50 text-emerald-800 border-emerald-200",
};

function Attention({ data }: { data: DashboardData }) {
  const alerts = alertsOf(data);
  return (
    <Section title="Needs Attention" action={alerts.length > 0 ? <span className="rounded-full bg-terracotta/10 px-2 py-0.5 text-xs font-bold text-terracotta tabular">{alerts.length}</span> : undefined}>
      {alerts.length === 0 ? (
        <p className="flex items-center gap-2 text-xs text-muted">
          <CheckCircle2 className="size-4 text-emerald-700" aria-hidden="true" />
          All good. Nothing needs your attention right now.
        </p>
      ) : (
        <ul className="grid gap-2">
          {alerts.map((al) => {
            const Icon = al.icon;
            return (
              <li key={al.key} className="flex min-w-0 items-center justify-between gap-2 rounded-input border border-line bg-surface px-3.5 py-2">
                <span className="flex min-w-0 items-center gap-2.5 text-sm text-ink">
                  <span className={`grid size-7 shrink-0 place-items-center rounded-lg border ${TONE_CLASSES[al.tone]}`}>
                    <Icon className="size-3.5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 break-words font-medium">{al.text}</span>
                </span>
                {al.href && <GoTo href={al.href}>{al.linkLabel}</GoTo>}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
