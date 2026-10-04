import type { DashboardData, RevenueTrend } from "@/server/staff/dashboard";

// Live data for the O1 dashboard: polling only, no realtime. Operations refresh every minute and
// the 7-day trend every five minutes, each only while the tab is visible. Each stream keeps its own
// sequence number, so an older answer that arrives late never replaces a newer one.

export const OPS_POLL_MS = 60_000;
export const TREND_POLL_MS = 5 * 60_000;

type Result<T> = { ok: true; data: T } | { ok: false; code: string; message: string };
const FAILED = { ok: false as const, code: "failed", message: "Could not refresh the dashboard. Retrying." };

export function createDashboardSync(opts: {
  loadOps: () => Promise<Result<DashboardData>>;
  loadTrend: () => Promise<Result<RevenueTrend>>;
  onOps: (data: DashboardData) => void;
  onTrend: (data: RevenueTrend) => void;
  onError: (message: string) => void;
}) {
  let opsSeq = 0;
  let trendSeq = 0;
  async function ops() {
    const mine = ++opsSeq;
    const res = await opts.loadOps().catch(() => FAILED);
    if (mine !== opsSeq) return;
    if (res.ok) opts.onOps(res.data);
    else opts.onError(res.message);
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
  return () => {
    stopOps();
    stopTrend();
  };
}
