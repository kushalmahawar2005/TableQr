"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { connectRealtime, type RealtimeStatus } from "@/lib/realtime-client";
import type { DashboardData, RevenueTrend } from "@/server/staff/dashboard";
import type { DutyRow } from "@/server/staff/duty";
import { dashboardAction, dashboardTokenAction, revenueTrendAction } from "../actions";
import { CustomerRequests } from "./customer-requests";
import { DashboardHeader, type ConnState } from "./dashboard-header";
import { DashboardKpis, DashboardSecondaryStats } from "./dashboard-kpis";
import { createDashboardSync, startDashboardSync } from "./dashboard-sync";
import { money, THEME } from "./dashboard-shared";
import { KitchenOrders } from "./kitchen-orders";
import { LiveActivity } from "./live-activity";
import { LiveFloor } from "./live-floor";
import { alertsOf, NeedsAttention } from "./needs-attention";
import { QuickActions } from "./quick-actions";
import { RecentPayments } from "./recent-payments";
import { SalesPerformance } from "./sales-performance";
import { StaffOnDuty } from "./staff-on-duty";
import { TopDishes } from "./top-dishes";
import { UpcomingReservations } from "./upcoming-reservations";

/**
 * Owner dashboard (spec v2). This file is the shell: it owns the live data and the layout.
 * - Every panel lives in its own component under _components/ and sizes to its own content —
 *   columns are independent stacks, never forced to equal heights, so a small outlet's short
 *   panels never leave empty voids.
 * - Freshness: staff-scoped realtime events (floor/kitchen/tasks) trigger a debounced ops
 *   refetch when the Worker is configured; adaptive polling (12s ops, 5min trend, visible tab
 *   only) covers everything else. The header indicator reports the real state, never "Live"
 *   while only polling.
 */
export { alertsOf, money, THEME };
export { formatTimeAgo } from "./dashboard-shared";

/** Dev-board preview state only (see src/app/dev/o1): forces the banner states for review */
export type DashboardPreview = { refreshing?: boolean; error?: string };

export function DashboardScreen({
  initial,
  initialTrend,
  duty,
  setup,
  preview,
  realtimeUrl,
}: {
  initial: DashboardData;
  initialTrend: RevenueTrend;
  duty?: { rows: DutyRow[]; canChange?: boolean } | null;
  setup?: ReactNode;
  preview?: DashboardPreview;
  /** ws(s) URL of the realtime Worker; null when realtime is not configured */
  realtimeUrl?: string | null;
}) {
  const [data, setData] = useState(initial);
  const [trend, setTrend] = useState<RevenueTrend>(initialTrend);
  const [refreshing, setRefreshing] = useState(preview?.refreshing ?? false);
  const [refreshError, setRefreshError] = useState<string | null>(preview?.error ?? null);
  const [rt, setRt] = useState<RealtimeStatus | "off">(realtimeUrl ? "connecting" : "off");
  const [pollStale, setPollStale] = useState(false);
  const [everLive, setEverLive] = useState(false);

  const sync = useMemo(
    () =>
      createDashboardSync({
        loadOps: dashboardAction,
        loadTrend: revenueTrendAction,
        onOps: (next) => {
          setData(next);
          setRefreshError(null);
        },
        onTrend: setTrend,
        onError: setRefreshError,
        onHealth: (health) => setPollStale(health === "stale"),
      }),
    [],
  );

  // Polling fallback: adaptive intervals, visible tab only, no duplicates (single effect).
  useEffect(() => {
    if (preview) return;
    return startDashboardSync(sync);
  }, [sync, preview]);

  // Realtime: staff-scoped token (never a guest credential), outlet topics floor/kitchen/tasks.
  // Events only nudge a debounced ops refetch; on (re)connect a full snapshot resyncs, so a
  // missed event can never leave the dashboard permanently stale.
  const syncRef = useRef(sync);
  useEffect(() => {
    if (preview || !realtimeUrl) return;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const stop = connectRealtime({
      url: realtimeUrl,
      getToken: async () => {
        const res = await dashboardTokenAction().catch(() => null);
        return res?.ok ? res.data : null;
      },
      onEvents: () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => void syncRef.current.ops(), 600);
      },
      onResync: () => void syncRef.current.all(),
      onStatus: (s) => {
        setRt(s);
        if (s === "live") setEverLive(true);
      },
    });
    return () => {
      clearTimeout(debounce);
      stop();
    };
  }, [preview, realtimeUrl]);

  const conn: ConnState = pollStale
    ? "stale"
    : rt === "live"
      ? "live"
      : rt === "connecting" && everLive
        ? "reconnecting"
        : "polling";

  const refresh = async () => {
    if (preview || refreshing) return;
    setRefreshing(true);
    try {
      await sync.all();
    } finally {
      setRefreshing(false);
    }
  };

  const dutyData = duty ?? undefined;
  const showStaff = !!dutyData;

  return (
    <div className="dashboard-theme min-h-[calc(100dvh-4rem)] bg-dashboard-canvas sm:min-h-[calc(100dvh-4.5rem)]">
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
        <DashboardHeader data={data} conn={conn} refreshing={refreshing} onRefresh={refresh} />

        {refreshError && (
          <p className="rounded-input border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] font-semibold text-rose-700" role="alert">
            {refreshError} The numbers below may be from earlier.
          </p>
        )}

        {setup}

        <DashboardKpis data={data} trend={trend} />

        <QuickActions />

        <DashboardSecondaryStats data={data} />

        <NeedsAttention data={data} />

        {/* Match the reference's floor-first operations area while keeping each panel content-sized. */}
        <div className="grid items-start gap-5 xl:grid-cols-12">
          <div className="min-w-0 xl:col-span-6">
            <LiveFloor data={data} />
          </div>

          <div className="min-w-0 space-y-5 xl:col-span-3">
            {showStaff && <StaffOnDuty duty={dutyData} />}
            <KitchenOrders orders={data.operations.kitchenOrders} />
          </div>

          <div className="min-w-0 space-y-5 xl:col-span-3">
            <CustomerRequests initialRequests={data.operations.customerRequests} />
            <UpcomingReservations data={data} />
          </div>
        </div>

        <div className="grid items-start gap-5 xl:grid-cols-2 2xl:grid-cols-4">
          <RecentPayments payments={data.operations.recentPayments} timezone={data.timezone} />
          <SalesPerformance trend={trend} />
          <TopDishes data={data} />
          <LiveActivity feed={data.operations.activityFeed} />
        </div>
      </main>
    </div>
  );
}
