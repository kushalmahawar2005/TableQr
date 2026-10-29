import { RefreshCw } from "lucide-react";
import type { DashboardData } from "@/server/staff/dashboard";
import { dayLabel, focusRing, timeIn } from "./dashboard-shared";

/** What the header may honestly say about freshness — never "Live" while only polling */
export type ConnState = "live" | "reconnecting" | "polling" | "stale";

const CONN_META: Record<ConnState, { label: string; dot: string; text: string }> = {
  live: { label: "Live", dot: "bg-emerald-600", text: "text-emerald-700" },
  reconnecting: { label: "Reconnecting…", dot: "bg-amber-500 animate-pulse", text: "text-amber-700" },
  polling: { label: "Polling", dot: "bg-neutral-400", text: "text-muted" },
  stale: { label: "Offline · showing last data", dot: "bg-rose-500", text: "text-rose-700" },
};

export function DashboardHeader({
  data,
  conn,
  refreshing,
  onRefresh,
}: {
  data: DashboardData;
  conn: ConnState;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const meta = CONN_META[conn];
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-[28px]">
          {data.greeting}, {data.outletName}!
        </h1>
        <p className="mt-1 text-sm font-medium text-muted">Here&apos;s what&apos;s happening at your business today.</p>
      </div>

      <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-start">
        <div className="text-left sm:text-right">
          <p className="text-xs font-semibold text-muted">{dayLabel(data.date, { weekday: "long", day: "numeric", month: "long" })}</p>
          <p className="mt-0.5 flex items-center justify-start gap-1.5 text-[11px] font-medium text-muted tabular sm:justify-end" aria-live="polite">
            <span className={`size-1.5 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
            <span className={`font-semibold ${meta.text}`}>{meta.label}</span>
            <span aria-hidden="true">·</span>
            <span>Updated {timeIn(data.generatedAt, data.timezone)}</span>
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className={`inline-flex min-h-10 items-center gap-1.5 rounded-input border border-line bg-surface px-4 text-sm font-semibold text-ink transition-all hover:border-forest/40 hover:bg-paper disabled:opacity-60 cursor-pointer ${focusRing}`}
        >
          <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
          <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
        </button>
      </div>
    </header>
  );
}
