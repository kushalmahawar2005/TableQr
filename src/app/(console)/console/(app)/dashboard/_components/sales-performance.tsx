"use client";
import { ArrowRight, BarChart3 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { RevenueTrend } from "@/server/staff/dashboard";
import { Panel, dayLabel, focusRing, money } from "./dashboard-shared";

/** 7-day revenue, drawn from real trend data only; an all-zero week gets text, not a fake chart */
export function SalesPerformance({ trend }: { trend: RevenueTrend }) {
  const [hover, setHover] = useState<number | null>(null);
  const chart = useMemo(() => {
    const W = 560;
    const H = 150;
    const PAD_X = 8;
    const PAD_TOP = 20;
    const PAD_BOT = 24;
    const iw = W - PAD_X * 2;
    const ih = H - PAD_TOP - PAD_BOT;
    const max = Math.max(...trend.map((d) => d.revenuePaise), 1);
    const pts = trend.map((d, i) => ({
      x: PAD_X + (trend.length === 1 ? iw / 2 : (i / (trend.length - 1)) * iw),
      y: PAD_TOP + ih - (d.revenuePaise / max) * ih,
      ...d,
    }));
    const path =
      pts.length === 0
        ? ""
        : `M${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L")}`;
    const area = pts.length === 0 ? "" : `${path} L${pts[pts.length - 1].x.toFixed(1)},${(H - PAD_BOT).toFixed(1)} L${pts[0].x.toFixed(1)},${(H - PAD_BOT).toFixed(1)} Z`;
    return { W, H, PAD_BOT, pts, path, area };
  }, [trend]);

  const totalPaise = trend.reduce((sum, d) => sum + d.revenuePaise, 0);
  const active = hover != null ? chart.pts[hover] : null;

  return (
    <Panel
      title="Sales Performance"
      labelledBy="Sales, Last 7 Days"
      action={
        <Link href="/console/reports" className={`inline-flex min-h-10 items-center gap-1 rounded-input px-2 text-xs font-semibold text-muted transition-colors hover:text-forest ${focusRing}`}>
          <span>View report</span>
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      }
    >
      <div className="flex items-baseline gap-2">
        <p className="font-display text-2xl font-bold tracking-tight text-ink tabular">{money(totalPaise)}</p>
        <p className="text-xs font-medium text-muted">Total, last 7 days</p>
      </div>

      <div className="relative mt-4">
        {totalPaise === 0 ? (
          <p className="flex items-center gap-2 py-2 text-[13px] font-medium text-muted">
            <BarChart3 className="size-4 shrink-0 text-muted/60" aria-hidden="true" />
            No sales recorded in the last 7 days — the chart fills in as bills are paid.
          </p>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${chart.W} ${chart.H}`}
              className="block h-auto w-full"
              role="img"
              aria-label={`Revenue, last 7 days. ${trend.map((d) => `${dayLabel(d.date, { weekday: "short" })} ${money(d.revenuePaise)}`).join(", ")}.`}
            >
              <defs>
                <linearGradient id="salesArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#103B2C" stopOpacity="0.16" />
                  <stop offset="100%" stopColor="#103B2C" stopOpacity="0" />
                </linearGradient>
              </defs>
              {chart.pts.map((p, i) => (
                <line key={i} x1={p.x} x2={p.x} y1={10} y2={chart.H - chart.PAD_BOT} stroke="#E9E5DD" strokeDasharray="3 4" />
              ))}
              <path d={chart.area} fill="url(#salesArea)" />
              <path d={chart.path} fill="none" stroke="#103B2C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {chart.pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={hover === i ? 6 : 4} fill="#103B2C" stroke="#FFFFFF" strokeWidth="2" />
              ))}
              {chart.pts.map((p, i) => (
                <text key={i} x={p.x} y={chart.H - 6} textAnchor="middle" fontSize="11" fontWeight="600" fill="#768078">
                  {dayLabel(p.date, { weekday: "short" })}
                </text>
              ))}
              {chart.pts.map((p, i) => (
                <rect
                  key={i}
                  x={p.x - 36}
                  y={0}
                  width={72}
                  height={chart.H - chart.PAD_BOT}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  tabIndex={0}
                  className="cursor-pointer focus-visible:outline-none"
                  aria-label={`${dayLabel(p.date, { weekday: "long" })}: ${money(p.revenuePaise)}`}
                />
              ))}
            </svg>
            {active && (
              <div
                className="absolute top-0 -translate-x-1/2 rounded-input bg-ink px-2.5 py-1.5 text-center text-white shadow-modal"
                style={{ left: `${(active.x / chart.W) * 100}%` }}
              >
                <p className="text-[13px] leading-none font-bold tabular">{money(active.revenuePaise)}</p>
                <p className="mt-1 text-[10px] leading-none font-medium text-white/70">{dayLabel(active.date, { weekday: "short" })}</p>
              </div>
            )}
          </>
        )}
      </div>

      <ul className="sr-only">
        {trend.map((d) => (
          <li key={d.date}>{dayLabel(d.date, { weekday: "long", day: "numeric", month: "long" })}: {money(d.revenuePaise)}</li>
        ))}
      </ul>

      <div className="mt-4 border-t border-line pt-3.5">
        <Link href="/console/reports" className={`inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-forest transition-colors hover:underline underline-offset-4 ${focusRing}`}>
          <span>View sales reports</span>
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </Panel>
  );
}
