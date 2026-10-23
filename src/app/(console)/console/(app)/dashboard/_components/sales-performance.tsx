"use client";
import { ArrowRight, BarChart3 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { RevenueTrend } from "@/server/staff/dashboard";
import { Panel, dayLabel, focusRing, money } from "./dashboard-shared";

const compactMoney = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** The last seven outlet-local days of paid sales. Bar heights always come from real totals. */
export function SalesPerformance({ trend }: { trend: RevenueTrend }) {
  const [hover, setHover] = useState<number | null>(null);
  const totalPaise = trend.reduce((sum, day) => sum + day.revenuePaise, 0);
  const maxPaise = Math.max(...trend.map((day) => day.revenuePaise), 1);
  const today = trend.at(-1)?.date;
  const active = hover == null ? null : trend[hover];

  return (
    <Panel
      title="Sales, Last 7 Days"
      labelledBy="Sales, Last 7 Days"
      action={<p className="whitespace-nowrap text-sm font-medium text-muted tabular sm:text-base">{money(totalPaise)} total</p>}
    >
      {totalPaise === 0 ? (
        <p className="flex items-center gap-2 py-2 text-[13px] font-medium text-muted">
          <BarChart3 className="size-4 shrink-0 text-muted/60" aria-hidden="true" />
          No sales recorded in the last 7 days — the chart fills in as bills are paid.
        </p>
      ) : (
        <div className="relative" onMouseLeave={() => setHover(null)}>
          <ul
            className="grid items-end gap-1.5 sm:gap-3"
            style={{ gridTemplateColumns: `repeat(${trend.length}, minmax(0, 1fr))` }}
            aria-label="Sales for the last 7 days"
          >
            {trend.map((day, index) => {
              const amount = day.revenuePaise;
              const isToday = day.date === today;
              const height = amount > 0 ? Math.max(3, (amount / maxPaise) * 100) : 0;
              const label = isToday ? "Today" : dayLabel(day.date, { weekday: "short" });
              return (
                <li
                  key={day.date}
                  className="group flex min-w-0 flex-col items-center"
                  onMouseEnter={() => setHover(index)}
                  onFocus={() => setHover(index)}
                  onBlur={() => setHover(null)}
                  tabIndex={0}
                  aria-label={`${dayLabel(day.date, { weekday: "long" })}: ${money(amount)}`}
                >
                  <span className={`mb-2 h-4 max-w-full truncate text-center text-[9px] tabular sm:text-[11px] ${isToday ? "font-bold text-ink" : "font-medium text-muted"}`}>
                    {amount > 0 ? compactMoney.format(amount / 100) : "—"}
                  </span>
                  <span className="flex h-32 w-full max-w-12 items-end overflow-hidden rounded-t-md sm:h-40" style={{ backgroundColor: "var(--dashboard-chart-track)" }}>
                    {amount > 0 && (
                      <span
                        className={`block w-full rounded-t-md transition-[height] duration-300 ${isToday ? "bg-forest" : ""}`}
                        style={{ height: `${height}%`, backgroundColor: isToday ? undefined : `var(${index === trend.length - 2 ? "--dashboard-chart-previous" : "--dashboard-chart-bar"})` }}
                      />
                    )}
                  </span>
                  <span className={`mt-2 text-[10px] sm:text-xs ${isToday ? "font-bold text-ink" : "font-medium text-muted"}`}>{label}</span>
                </li>
              );
            })}
          </ul>

          {active && (
            <div
              className="pointer-events-none absolute top-5 z-10 -translate-x-1/2 rounded-input bg-ink px-2.5 py-1.5 text-center text-white shadow-modal"
              style={{ left: `${((hover! + 0.5) / trend.length) * 100}%` }}
              aria-hidden="true"
            >
              <p className="text-[13px] font-bold leading-none tabular">{money(active.revenuePaise)}</p>
              <p className="mt-1 text-[10px] font-medium leading-none text-white/70">{active.date === today ? "Today" : dayLabel(active.date, { weekday: "short" })}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 border-t border-line pt-3.5">
        <Link href="/console/reports" className={`inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-forest transition-colors hover:underline underline-offset-4 ${focusRing}`}>
          <span>View sales reports</span>
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </Panel>
  );
}
