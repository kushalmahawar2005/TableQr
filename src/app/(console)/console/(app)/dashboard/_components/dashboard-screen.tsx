"use client";
import type { DutyRow } from "@/server/staff/duty";
import { WhoIsWorking } from "../../team/_components/who-is-working";

import { ArrowRight01Icon, Calendar03Icon, ChartHistogramIcon, CheckmarkCircle02Icon, Clock01Icon, DashboardSquare01Icon, Invoice01Icon, LockIcon, MenuRestaurantIcon, MoneyReceive01Icon, Note01Icon, RefreshIcon, UserGroupIcon, Wallet01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { deltaLabel, deltaOf, UPCOMING_WINDOW_MINUTES } from "@/domain/dashboard";
import type { DashboardData, RevenueTrend } from "@/server/staff/dashboard";
import { dashboardAction, revenueTrendAction } from "../actions";
import { createDashboardSync, startDashboardSync, type DashboardSync } from "./dashboard-sync";

// O1 Owner Dashboard. Read-only: every link goes to the screen that owns the action. Refreshing
// replaces the numbers in place; nothing else on screen resets.

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const card = "rounded-card border border-line bg-surface";

const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
/** ₹ with Indian grouping; paise only when there are any, so an amount is never rounded away */
export const money = (paise: number) =>
  `₹${paise % 100 === 0 ? rupees.format(paise / 100) : (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const timeIn = (at: number, timeZone: string) => new Intl.DateTimeFormat("en-IN", { timeZone, hour: "numeric", minute: "2-digit" }).format(at);
/** "Sun, 4 Oct" for an outlet date; formatted at UTC noon so no time zone can move the day */
const dayLabel = (date: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", ...opts }).format(new Date(`${date}T12:00:00Z`));

export type DashboardPreview = { refreshing?: boolean; error?: string };

export function DashboardScreen({ initial, initialTrend, preview, duty }: { initial: DashboardData; initialTrend: RevenueTrend; preview?: DashboardPreview; duty?: { rows: DutyRow[]; canChange: boolean } }) {
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
    <main className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption font-semibold text-muted">{dayLabel(data.date, { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 className="mt-1 font-display text-title font-bold text-ink">
            {data.greeting}
          </h1>
          <p className="mt-0.5 break-words text-body font-semibold text-muted">{data.outletName}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-caption text-muted tabular" aria-live="polite">
            Updated {timeIn(data.generatedAt, tz)}
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className={`inline-flex min-h-11 items-center gap-2 rounded-input border border-line bg-surface px-3.5 text-body font-semibold text-ink hover:border-ink/40 disabled:opacity-60 ${focus}`}
          >
            <HugeiconsIcon icon={RefreshIcon} size={18} className={refreshing ? "animate-spin" : ""} aria-hidden />
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </header>

      {shownError && (
        <p role="status" className="mt-4 rounded-input border border-warning/30 bg-[var(--state-held-soft)] px-3 py-2 text-body text-warning">
          {shownError}
        </p>
      )}

      {duty && <WhoIsWorking rows={duty.rows} canChange={duty.canChange} />}

      <nav aria-label="Quick links" className="mt-5 flex gap-2 overflow-x-auto pb-1">
        {([["/console/floor", "Open floor", DashboardSquare01Icon], ["/console/billing", "Take payment", Invoice01Icon], ["/console/orders", "See orders", Note01Icon], ["/console/reservations", "Reservations", Calendar03Icon], ["/console/reports", "Reports", ChartHistogramIcon], ["/console/reports/day-close", "Day close", Invoice01Icon]] as const).map(([href, label, icon]) => (
          <Link key={href} href={href} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-4 text-body font-semibold text-ink hover:border-ink/40 ${focus}`}>
            <HugeiconsIcon icon={icon} size={18} aria-hidden />
            {label}
          </Link>
        ))}
      </nav>

      <Kpis data={data} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-6">
          <Trend trend={trend} today={data.date} />
          <Operations data={data} />
        </div>
        <div className="grid min-w-0 content-start gap-6">
          <Attention data={data} />
          <TopItems data={data} />
        </div>
      </div>
    </main>
  );
}

function Delta({ today, yesterday }: { today: number; yesterday: number }) {
  const d = deltaOf(today, yesterday);
  const tone = d.kind === "up" ? "text-success" : d.kind === "down" ? "text-danger" : "text-muted";
  return (
    <p className="mt-1 text-caption text-muted">
      <span className={`font-semibold tabular ${tone}`}>{deltaLabel(d)}</span>
      {d.kind !== "no_baseline" && <span> vs yesterday</span>}
    </p>
  );
}

function Kpi({ label, value, icon, tone, children }: { label: string; value: ReactNode; icon: IconSvgElement; tone: string; children?: ReactNode }) {
  return (
    <div className={`${card} min-w-0 p-4 shadow-[0_1px_2px_rgb(31_41_55/0.04)]`}>
      <div className="flex items-start justify-between gap-3">
        <dt className="text-caption font-semibold text-muted">{label}</dt>
        <span className="grid size-9 shrink-0 place-items-center rounded-input" style={{ background: `color-mix(in srgb, ${tone} 14%, var(--surface))`, color: tone }} aria-hidden>
          <HugeiconsIcon icon={icon} size={19} />
        </span>
      </div>
      <dd className="mt-1">
        <span className="block font-display text-[26px] font-bold leading-8 text-ink tabular break-words">{value}</span>
        {children}
      </dd>
    </div>
  );
}

function Kpis({ data }: { data: DashboardData }) {
  const k = data.kpis;
  return (
    <dl aria-label="Today at a glance" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi label="Today's Sales" value={money(k.revenue.today)} icon={MoneyReceive01Icon} tone="#c9482b">
        <Delta today={k.revenue.today} yesterday={k.revenue.yesterday} />
        <p className="mt-2 text-caption text-muted">Money from paid bills</p>
        <p className="mt-0.5 text-caption text-muted tabular">
          GST {money(data.secondary.taxPaise)} · Service {money(data.secondary.serviceChargePaise)} · Tips {money(data.secondary.tipPaise)} <span className="sr-only">(tips are not part of sales)</span>
        </p>
      </Kpi>
      <Kpi label="Orders Today" value={k.orders.today} icon={Note01Icon} tone="#315e9e">
        <Delta today={k.orders.today} yesterday={k.orders.yesterday} />
      </Kpi>
      <Kpi label="Guests Served" value={k.covers.today} icon={UserGroupIcon} tone="#237a68">
        <Delta today={k.covers.today} yesterday={k.covers.yesterday} />
      </Kpi>
      <Kpi label="Average Bill" value={money(k.averageBill.today)} icon={Invoice01Icon} tone="#8a5a00">
        <Delta today={k.averageBill.today} yesterday={k.averageBill.yesterday} />
        <p className="mt-2 text-caption text-muted tabular">
          {k.paidBills} paid {k.paidBills === 1 ? "bill" : "bills"}
        </p>
      </Kpi>
      <Kpi
        icon={DashboardSquare01Icon}
        tone="#237a68"
        label="Tables in Use"
        value={
          <>
            {k.openTables.open} <span className="text-section font-semibold text-muted">/ {k.openTables.total} tables</span>
          </>
        }
      >
        <p className="mt-1 text-caption text-muted">Guests seated or bill asked</p>
      </Kpi>
      <Kpi label="Bookings Coming Up" value={k.upcomingReservations} icon={Calendar03Icon} tone="#315e9e">
        <p className="mt-1 text-caption text-muted">Next {UPCOMING_WINDOW_MINUTES} minutes</p>
      </Kpi>
      <Kpi label="Waiting List" value={k.waitlist} icon={Clock01Icon} tone="#a74608">
        <p className="mt-1 text-caption text-muted tabular">
          {data.operations.waitlist.waiting} waiting · {data.operations.waitlist.notified} called
        </p>
      </Kpi>
      <Kpi label="Unpaid Bills" value={money(k.outstandingPaise)} icon={Wallet01Icon} tone="#b83a3a">
        <p className="mt-1 text-caption text-muted">Still to collect from open tables</p>
      </Kpi>
    </dl>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={`${card} min-w-0 p-4 sm:p-5`} aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-section font-bold text-ink">{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function GoTo({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={`inline-flex min-h-11 items-center gap-1 rounded-input px-2 text-body font-semibold text-ink underline-offset-4 hover:underline ${focus}`}>
      {children}
      <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden />
    </Link>
  );
}

function Trend({ trend, today }: { trend: RevenueTrend; today: string }) {
  const max = Math.max(...trend.map((d) => d.revenuePaise), 0);
  const total = trend.reduce((n, d) => n + d.revenuePaise, 0);
  return (
    <Section title="Sales, Last 7 Days" action={<span className="text-caption text-muted tabular">{money(total)} total</span>}>
      {total === 0 && <p className="mb-2 rounded-input bg-ink/[0.04] px-3 py-2 text-body text-muted">No paid bills in the last 7 days. Sales will show up here as bills are paid.</p>}
      <ol className="flex h-44 items-end gap-1.5 sm:gap-3" aria-label="Net sales from paid bills per day">
        {trend.map((d) => {
          const isToday = d.date === today;
          const pct = max > 0 ? Math.round((d.revenuePaise / max) * 100) : 0;
          return (
            <li key={d.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
              <span className={`max-w-full truncate text-label tabular ${isToday ? "font-bold text-ink" : "text-muted"}`} title={money(d.revenuePaise)}>
                {d.revenuePaise > 0 ? money(d.revenuePaise) : "—"}
              </span>
              <span className="flex w-full max-w-10 flex-1 items-end rounded-t-[6px] bg-ink/[0.05]" aria-hidden>
                <span className={`block w-full rounded-t-[6px] ${isToday ? "bg-brand" : "bg-ink/25"}`} style={{ height: `${pct}%`, minHeight: d.revenuePaise > 0 ? 3 : 0 }} />
              </span>
              <span className={`text-label ${isToday ? "font-bold text-ink" : "text-muted"}`}>
                <span className="sr-only">{dayLabel(d.date, { weekday: "long", day: "numeric", month: "long" })}: {money(d.revenuePaise)}</span>
                <span aria-hidden>{isToday ? "Today" : dayLabel(d.date, { weekday: "short" })}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <li className="flex min-w-0 items-center justify-between gap-2 rounded-input bg-paper px-3 py-2">
      <span className="flex min-w-0 items-center gap-2 text-body text-ink">
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: tone }} aria-hidden />
        <span className="truncate">{label}</span>
      </span>
      <span className="font-semibold tabular text-ink">{value}</span>
    </li>
  );
}

function Operations({ data }: { data: DashboardData }) {
  const t = data.operations.tables;
  const up = data.operations.upcoming;
  return (
    <Section title="Operations">
      <div className="grid gap-5">
        <div>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-caption font-semibold text-muted">Tables · {t.total} active</h3>
            <GoTo href="/console/floor">Floor</GoTo>
          </div>
          <ul className="mt-1 grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
            <Count label="Available" value={t.available} tone="var(--state-available)" />
            <Count label="Reserved" value={t.reserved} tone="var(--state-reserved)" />
            <Count label="Seated" value={t.seated} tone="var(--state-seated)" />
            <Count label="Bill requested" value={t.billRequested} tone="var(--state-bill)" />
            <Count label="Blocked" value={t.blocked} tone="var(--state-blocked)" />
          </ul>
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-caption font-semibold text-muted">Waitlist</h3>
            <GoTo href="/console/waitlist">Waitlist</GoTo>
          </div>
          <ul className="mt-1 grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
            <Count label="Waiting" value={data.operations.waitlist.waiting} tone="var(--state-held)" />
            <Count label="Notified" value={data.operations.waitlist.notified} tone="var(--state-reserved)" />
          </ul>
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-caption font-semibold text-muted">Arriving in the next {UPCOMING_WINDOW_MINUTES} minutes</h3>
            <GoTo href="/console/reservations">Reservations</GoTo>
          </div>
          {up.length === 0 ? (
            <p className="mt-1 text-body text-muted">No reservations due in the next {UPCOMING_WINDOW_MINUTES} minutes.</p>
          ) : (
            <ul className="mt-1 divide-y divide-line">
              {up.slice(0, 6).map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 text-body">
                  <span className="min-w-0">
                    <span className="font-semibold tabular text-ink">{timeIn(r.startAt, data.timezone)}</span>
                    <span className="ml-2 break-words text-ink">{r.name ?? "Guest"}</span>
                  </span>
                  <span className="text-caption text-muted tabular">
                    {r.partySize} {r.partySize === 1 ? "guest" : "guests"}
                    {r.tables.length > 0 && ` · ${r.tables.join(" + ")}`}
                  </span>
                </li>
              ))}
              {up.length > 6 && <li className="py-2 text-caption text-muted">+{up.length - 6} more</li>}
            </ul>
          )}
        </div>
      </div>
    </Section>
  );
}

type Alert = { key: string; tone: "bad" | "warn" | "info"; icon: IconSvgElement; text: ReactNode; href?: string; linkLabel?: string };

/** The alerts in display order; exported for the tests */
export function alertsOf(data: DashboardData): Alert[] {
  const a = data.alerts;
  const out: Alert[] = [];
  for (const b of a.slowBills) {
    out.push({ key: `bill-${b.sessionId}`, tone: "bad", icon: Invoice01Icon, text: <><strong>{b.tableCode}</strong> · bill requested {b.waitedMinutes} min ago</>, href: "/console/floor", linkLabel: "Floor" });
  }
  for (const r of a.late) {
    out.push({
      key: `late-${r.id}`,
      tone: r.noShowEligible ? "bad" : "warn",
      icon: Clock01Icon,
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
  if (a.soldOut > 0) out.push({ key: "sold-out", tone: "warn", icon: MenuRestaurantIcon, text: <><strong>{a.soldOut}</strong> {a.soldOut === 1 ? "item" : "items"} sold out</>, href: "/console/menu", linkLabel: "Menu" });
  if (a.pendingRefunds.count > 0) {
    out.push({ key: "refunds", tone: "info", icon: MoneyReceive01Icon, text: <><strong>{a.pendingRefunds.count}</strong> pending {a.pendingRefunds.count === 1 ? "refund" : "refunds"} · {money(a.pendingRefunds.paise)}</> });
  }
  if (a.lowStock.length > 0) {
    out.push({ key: "low-stock", tone: "warn", icon: MenuRestaurantIcon, text: <><strong>{a.lowStock.length}</strong> running low: {a.lowStock.slice(0, 3).join(", ")}{a.lowStock.length > 3 ? "…" : ""}</>, href: "/console/inventory", linkLabel: "Inventory" });
  }
  if (a.blockedTables > 0) out.push({ key: "blocked", tone: "info", icon: LockIcon, text: <><strong>{a.blockedTables}</strong> {a.blockedTables === 1 ? "table" : "tables"} blocked</>, href: "/console/floor", linkLabel: "Floor" });
  return out;
}

const TONE = {
  bad: "bg-[var(--state-seated-soft)] text-danger",
  warn: "bg-[var(--state-held-soft)] text-warning",
  info: "bg-[var(--state-cleaning-soft)] text-info",
};

function Attention({ data }: { data: DashboardData }) {
  const alerts = alertsOf(data);
  return (
    <Section title="Needs attention" action={alerts.length > 0 ? <span className="text-caption font-semibold text-muted tabular">{alerts.length}</span> : undefined}>
      {alerts.length === 0 ? (
        <p className="flex items-center gap-2 text-body text-muted">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} className="text-success" aria-hidden />
          All good. Nothing needs your attention right now.
        </p>
      ) : (
        <ul className="grid gap-2">
          {alerts.map((al) => (
            <li key={al.key} className="flex min-w-0 items-center justify-between gap-2 rounded-input border border-line px-3 py-1.5">
              <span className="flex min-w-0 items-center gap-2.5 py-1 text-body text-ink">
                <span className={`grid size-8 shrink-0 place-items-center rounded-full ${TONE[al.tone]}`}>
                  <HugeiconsIcon icon={al.icon} size={16} aria-hidden />
                </span>
                <span className="min-w-0 break-words">{al.text}</span>
              </span>
              {al.href && <GoTo href={al.href}>{al.linkLabel}</GoTo>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function TopItems({ data }: { data: DashboardData }) {
  return (
    <Section title="Top 5 Dishes Today" action={<span className="text-caption text-muted">Most sold first</span>}>
      {data.topItems.length === 0 ? (
        <p className="text-body text-muted">No items sold yet today.</p>
      ) : (
        <>
          <ol className="divide-y divide-line">
            {data.topItems.map((it, i) => (
              <li key={it.itemId} className="flex items-baseline justify-between gap-3 py-2 text-body">
                <span className="flex min-w-0 items-baseline gap-2.5">
                  <span className="w-4 shrink-0 text-caption font-semibold text-muted tabular">{i + 1}</span>
                  <span className="min-w-0 break-words text-ink">{it.name}</span>
                </span>
                <span className="shrink-0 text-right tabular">
                  <span className="font-semibold text-ink">× {it.qty}</span>
                  <span className="ml-2 text-caption text-muted">{money(it.grossPaise)}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-caption text-muted">Amounts are gross line sales, before discounts and tax.</p>
        </>
      )}
    </Section>
  );
}
