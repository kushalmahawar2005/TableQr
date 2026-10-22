import type { DashboardData, RevenueTrend } from "@/server/staff/dashboard";

// Live data for the O1 dashboard, in two layers:
// 1. Event-driven: when the realtime Worker is configured, dashboard-screen subscribes with a
//    staff-scoped token (dashboardTokenAction) and calls ops() on debounced outlet events.
// 2. Polling fallback (this file): operations refresh every 12s and the 7-day trend every five
//    minutes, each only while the tab is visible; returning to the tab refreshes at once.
// Each stream keeps its own sequence number, so an older answer that arrives late never
// replaces a newer one. The sync reports its own health so the header can honestly show
// "Polling" — and "Stale" after repeated failures — instead of pretending to be Live.

export const OPS_POLL_MS = 12_000;
export const TREND_POLL_MS = 5 * 60_000;

/** Fallback health only; the screen combines this with the realtime socket state */
export type PollHealth = "polling" | "stale";

type Result<T> = { ok: true; data: T } | { ok: false; code: string; message: string };
const FAILED = { ok: false as const, code: "failed", message: "Could not refresh the dashboard. Retrying." };

export function createDashboardSync(opts: {
  loadOps: () => Promise<Result<DashboardData>>;
  loadTrend: () => Promise<Result<RevenueTrend>>;
  onOps: (data: DashboardData) => void;
  onTrend: (data: RevenueTrend) => void;
  onError: (message: string) => void;
  onHealth?: (health: PollHealth) => void;
}) {
  let opsSeq = 0;
  let trendSeq = 0;
  let opsFailures = 0;
  async function ops() {
    const mine = ++opsSeq;
    const res = await opts.loadOps().catch(() => FAILED);
    if (mine !== opsSeq) return;
    if (res.ok) {
      opsFailures = 0;
      opts.onHealth?.("polling");
      opts.onOps(res.data);
    } else {
      opsFailures += 1;
      if (opsFailures >= 2) opts.onHealth?.("stale");
      opts.onError(res.message);
    }
  }
  async function trend() {
    const mine = ++trendSeq;
    const res = await opts.loadTrend().catch(() => FAILED);
    if (mine !== trendSeq) return;
    if (res.ok) opts.onTrend(res.data);
    else opts.onError(res.message);
  }
  return {
    ops,
    trend,
    /** The Refresh button: both streams now */
    all: () => Promise.all([ops(), trend()]).then(() => undefined),
  };
}

export type DashboardSync = ReturnType<typeof createDashboardSync>;

/** Starts both polls; returns a stop function */
export function startDashboardSync(
  sync: Pick<DashboardSync, "ops" | "trend">,
  opts: { every?: (fn: () => void, ms: number) => () => void; visible?: () => boolean; opsMs?: number; trendMs?: number } = {},
) {
  const visible = opts.visible ?? (() => typeof document === "undefined" || document.visibilityState === "visible");
  const injected = typeof opts.every === "function";
  const every =
    opts.every ??
    ((fn, ms) => {
      const id = setInterval(fn, ms);
      return () => clearInterval(id);
    });
  const stopOps = every(() => {
    if (visible()) void sync.ops();
  }, opts.opsMs ?? OPS_POLL_MS);
  const stopTrend = every(() => {
    if (visible()) void sync.trend();
  }, opts.trendMs ?? TREND_POLL_MS);
  // Real timers only: coming back to the tab refreshes operations at once instead of waiting
  // for the next poll tick. (Skipped when a caller injects its own timer, e.g. tests.)
  let onVisible: (() => void) | null = null;
  if (!injected && typeof document !== "undefined") {
    onVisible = () => {
      if (document.visibilityState === "visible") void sync.ops();
    };
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    stopOps();
    stopTrend();
    if (onVisible && typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
  };
}
