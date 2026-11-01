"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { Download, IndianRupee, Loader2, Receipt, Store, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { getAnalyticsAction } from "./actions";
import type { AdminData, AnalyticsData, AnalyticsRange } from "./admin-types";
import { filterChip, Kpi } from "./admin-ui";

const money = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const short = (paise: number) => { const r = paise / 100; return r >= 100_000 ? `₹${(r / 100_000).toFixed(1)}L` : r >= 1000 ? `₹${(r / 1000).toFixed(1)}K` : `₹${Math.round(r)}`; };
const day = (v: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(v));
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const change = (now: number, before: number) => (before === 0 ? (now === 0 ? 0 : null) : Math.round(((now - before) / before) * 100));

const GREEN = "#2f7d5b";
const QUIET_BAR = "#a9c9b8";
const trendCfg = { sales: { label: "Sales (₹)", color: GREEN }, orders: { label: "Orders", color: "#D86B45" } } satisfies ChartConfig;
const hourCfg = { orders: { label: "Orders", color: GREEN } } satisfies ChartConfig;
const growthCfg = { total: { label: "Total tenants", color: GREEN }, added: { label: "Added", color: "#D86B45" } } satisfies ChartConfig;
type Section = "sales" | "tenants" | "money";
const SECTIONS: { key: Section; label: string }[] = [{ key: "sales", label: "Sales" }, { key: "tenants", label: "Tenants" }, { key: "money", label: "Income and SMS" }];

function BarList({ rows, empty }: { rows: { key: string; label: string; sub: string; value: number; text: string }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return rows.length ? <ul className="space-y-3.5">{rows.map((r, i) => <li key={r.key} className="space-y-1.5">
    <div className="flex items-baseline justify-between gap-3 text-sm"><span className="min-w-0 truncate"><span className="mr-2 text-xs text-muted-foreground">{i + 1}</span><span className="font-medium">{r.label}</span> <span className="text-xs text-muted-foreground">{r.sub}</span></span><span className="shrink-0 font-medium">{r.text}</span></div>
    <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-[#2f7d5b]" style={{ width: `${Math.max(3, (r.value / max) * 100)}%` }} /></div>
  </li>)}</ul> : <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>;
}

function Loaded({ a, tenants, plans, range, section }: { a: AnalyticsData; tenants: AdminData["tenants"]; plans: AdminData["plans"]; range: AnalyticsRange; section: Section }) {
  const period = `${range} days`;
  const t = a.totals;

  const peakHour = a.byHour.indexOf(Math.max(...a.byHour));
  const peakDay = a.byWeekday.indexOf(Math.max(...a.byWeekday));
  const hasOrders = a.totals.orders > 0;
  const quiet = Math.max(0, tenants.filter((x) => x.status === "active" || x.status === "trial").length - t.activeTenants);

  const monthly = useMemo(() => {
    const ref = new Date(a.daily[a.daily.length - 1].date);
    return Array.from({ length: 12 }, (_, i) => {
      const startM = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - (11 - i), 1);
      const endM = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - (11 - i) + 1, 1);
      return {
        label: new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(new Date(startM)),
        total: tenants.filter((x) => new Date(x.createdAt).getTime() < endM).length,
        added: tenants.filter((x) => { const c = new Date(x.createdAt).getTime(); return c >= startM && c < endM; }).length,
      };
    });
  }, [tenants, a.daily]);

  const byPlan = useMemo(() => plans.map((p) => {
    const list = tenants.filter((x) => x.planCode === p.code && x.status === "active");
    return { key: p.code, label: p.name, sub: `${list.length} ${list.length === 1 ? "tenant" : "tenants"}`, value: list.reduce((sum, x) => sum + (x.monthlyPricePaise ?? 0) * x.outletCount, 0) };
  }).filter((p) => p.value > 0).sort((x, y) => y.value - x.value), [plans, tenants]);

  const f = a.funnel;
  const steps = [
    { label: "Signed up", n: f.tenants }, { label: "Added an outlet", n: f.withOutlet }, { label: "Added tables", n: f.withTables },
    { label: "Added menu items", n: f.withMenu }, { label: "Got first order", n: f.withOrders }, { label: "Got a paid bill", n: f.withPaidBill },
  ];

  const insights = [
    hasOrders ? (() => { const c = change(t.salesPaise, t.previousSalesPaise); return c === null ? `Sales are ${short(t.salesPaise)} in the last ${period}, with nothing in the period before.` : `Sales ${c >= 0 ? "went up" : "went down"} ${Math.abs(c)}% compared to the previous ${period} (${short(t.salesPaise)}).`; })() : `No orders in the last ${period} yet.`,
    hasOrders && `Busiest time is around ${hourLabel(peakHour)}, and ${WEEKDAYS[peakDay]} is the busiest day.`,
    quiet > 0 && `${quiet} ${quiet === 1 ? "tenant has" : "tenants have"} had no orders in the last ${period}. A quick call may help.`,
    f.tenants > f.withOrders && `${f.tenants - f.withOrders} ${f.tenants - f.withOrders === 1 ? "tenant has" : "tenants have"} signed up but never received an order.`,
  ].filter(Boolean) as string[];

  const exportCsv = () => {
    const rows = a.daily.map((d) => `${d.date},${d.orders},${Math.round(d.salesPaise / 100)}`);
    const url = URL.createObjectURL(new Blob([["Date,Orders,Sales (INR)", ...rows].join("\n")], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: `analytics-${range}d.csv` }).click();
    URL.revokeObjectURL(url);
  };

  const against = "vs period before";
  const sinceBefore = (now: number, before: number) => change(now, before);
  const hint = (now: number, before: number) => (sinceBefore(now, before) === null ? "New this period" : undefined);
  const average = t.paidBills ? t.salesPaise / t.paidBills : 0;
  const averageBefore = t.previousPaidBills ? t.previousSalesPaise / t.previousPaidBills : 0;

  return <>
    <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
      <Kpi icon={IndianRupee} label="Total sales" value={money(t.salesPaise)} change={sinceBefore(t.salesPaise, t.previousSalesPaise)} against={against} hint={hint(t.salesPaise, t.previousSalesPaise)} />
      <Kpi icon={Receipt} label="Orders" value={t.orders.toLocaleString("en-IN")} change={sinceBefore(t.orders, t.previousOrders)} against={against} hint={hint(t.orders, t.previousOrders)} />
      <Kpi icon={Store} label="Tenants with orders" value={String(t.activeTenants)} change={sinceBefore(t.activeTenants, t.previousActiveTenants)} against={against} hint={hint(t.activeTenants, t.previousActiveTenants)} />
      <Kpi icon={Users} label="Average bill" value={t.paidBills ? money(Math.round(average)) : "—"} change={sinceBefore(average, averageBefore)} against={against} hint={hint(average, averageBefore)} />
    </div>

    <section aria-label="What stands out" className="rounded-2xl border bg-card p-4">
      <ul className="space-y-1.5 text-sm">{insights.map((x) => <li key={x} className="flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[#D86B45]" aria-hidden="true" />{x}</li>)}</ul>
    </section>

    {section === "sales" && <>
      <Card>
        <CardHeader className="grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0"><CardTitle>Sales and orders</CardTitle><CardDescription className="mt-1 flex flex-wrap gap-x-4 gap-y-1"><span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-[#2f7d5b]" />Sales</span><span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-[#D86B45]" />Orders</span></CardDescription></div>
          <Button variant="outline" size="sm" onClick={exportCsv}><Download />Export</Button>
        </CardHeader>
        <CardContent>
          <ChartContainer config={trendCfg} className="h-56 w-full sm:h-64">
            <ComposedChart data={a.daily.map((d) => ({ label: day(d.date), sales: Math.round(d.salesPaise / 100), orders: d.orders }))} margin={{ left: -8, right: -8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis yAxisId="s" tickLine={false} axisLine={false} tickFormatter={(v: number) => (v >= 1000 ? `₹${Number((v / 1000).toFixed(1))}K` : `₹${v}`)} />
              <YAxis yAxisId="o" orientation="right" tickLine={false} axisLine={false} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar yAxisId="s" dataKey="sales" fill="var(--color-sales)" radius={[3, 3, 0, 0]} maxBarSize={28} />
              <Line yAxisId="o" dataKey="orders" type="monotone" stroke="var(--color-orders)" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
        <Card>
          <CardHeader><CardTitle>Busiest hours</CardTitle><CardDescription>{hasOrders ? `Peak around ${hourLabel(peakHour)}, India time` : "Orders by time of day, India time"}</CardDescription></CardHeader>
          <CardContent>
            <ChartContainer config={hourCfg} className="h-48 w-full sm:h-52">
              <BarChart data={a.byHour.map((n, h) => ({ label: hourLabel(h), orders: n }))} margin={{ left: -16, right: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="orders" radius={[3, 3, 0, 0]}>{a.byHour.map((_, h) => <Cell key={h} fill={h === peakHour && hasOrders ? GREEN : QUIET_BAR} />)}</Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Busiest days</CardTitle><CardDescription>{hasOrders ? `${WEEKDAYS[peakDay]} gets the most orders` : "Orders by day of the week"}</CardDescription></CardHeader>
          <CardContent>
            <ChartContainer config={hourCfg} className="h-48 w-full sm:h-52">
              <BarChart data={a.byWeekday.map((n, d) => ({ label: WEEKDAYS[d], orders: n }))} margin={{ left: -16, right: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="orders" radius={[3, 3, 0, 0]}>{a.byWeekday.map((_, d) => <Cell key={d} fill={d === peakDay && hasOrders ? GREEN : QUIET_BAR} />)}</Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </>}

    {section === "tenants" && <>
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card><CardHeader><CardTitle>Top tenants</CardTitle><CardDescription>By sales in the last {period}</CardDescription></CardHeader><CardContent>
          <BarList empty="No sales in this period." rows={a.topTenants.map((x) => ({ key: x.id, label: x.name, sub: `${x.orders} orders`, value: x.salesPaise || x.orders, text: x.salesPaise ? money(x.salesPaise) : `${x.orders} orders` }))} />
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Top cities</CardTitle><CardDescription>Where the sales come from</CardDescription></CardHeader><CardContent>
          <BarList empty="No sales in this period." rows={a.topCities.map((x) => ({ key: x.city, label: x.city, sub: `${x.orders} orders`, value: x.salesPaise || x.orders, text: x.salesPaise ? money(x.salesPaise) : `${x.orders} orders` }))} />
        </CardContent></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader><CardTitle>Tenant growth</CardTitle><CardDescription>Total tenants at the end of each month</CardDescription></CardHeader>
          <CardContent>
            <ChartContainer config={growthCfg} className="h-56 w-full">
              <AreaChart data={monthly} margin={{ left: -16, right: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area dataKey="total" type="monotone" stroke="var(--color-total)" fill="var(--color-total)" fillOpacity={0.14} strokeWidth={2} />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Getting started</CardTitle><CardDescription>How far new tenants get after signing up</CardDescription></CardHeader>
          <CardContent>
            <ul className="space-y-3">{steps.map((s, i) => { const pct = f.tenants ? Math.round((s.n / f.tenants) * 100) : 0; const prev = i ? steps[i - 1].n : s.n; return <li key={s.label} className="space-y-1">
              <div className="flex justify-between gap-3 text-sm"><span className="min-w-0 truncate">{s.label}</span><span className="shrink-0 font-semibold tabular-nums">{s.n} <span className="text-xs font-normal text-muted-foreground">{pct}%{i > 0 && prev - s.n > 0 ? ` · ${prev - s.n} dropped` : ""}</span></span></div>
              <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-[#2f7d5b]" style={{ width: `${pct}%` }} /></div>
            </li>; })}</ul>
          </CardContent>
        </Card>
      </div>
    </>}

    {section === "money" && <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <Card><CardHeader><CardTitle>Income by plan</CardTitle><CardDescription>Each month, from paying tenants</CardDescription></CardHeader><CardContent>
        <BarList empty="No paying tenants yet." rows={byPlan.map((p) => ({ ...p, text: money(p.value) }))} />
      </CardContent></Card>
      <Card><CardHeader><CardTitle>SMS codes</CardTitle><CardDescription>{a.otp.total} in the last {period}, {a.otp.previousTotal} in the period before</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <dl className="space-y-2 text-sm">
            {([["Table and booking", a.otp.tableAndBooking], ["Delivery and pickup", a.otp.delivery], ["Customer sign-in", a.otp.account], ["Staff invitations", a.otp.staff]] as const).map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>)}
          </dl>
          <div className="space-y-2 border-t pt-3 text-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Most codes</p>{a.otp.topTenants.length ? a.otp.topTenants.map((tenant) => <div key={tenant.id} className="flex justify-between gap-3"><span className="truncate">{tenant.name}</span><b className="tabular-nums">{tenant.codes}</b></div>) : <p className="text-muted-foreground">No codes requested in this period.</p>}</div>
        </CardContent>
      </Card>
    </div>}
  </>;
}

export function AnalyticsView({ data, preview }: { data: AdminData; /** Sample numbers for the design preview */ preview?: AnalyticsData }) {
  const [range, setRange] = useState<AnalyticsRange>(30);
  const [section, setSection] = useState<Section>("sales");
  const [state, setState] = useState<{ range: AnalyticsRange; data: AnalyticsData | null; error: string | null } | null>(null);

  useEffect(() => {
    if (preview) return;
    let off = false;
    getAnalyticsAction(range).then((r) => { if (!off) setState({ range, ...r }); });
    return () => { off = true; };
  }, [range, preview]);

  const ready = preview ? { data: preview, error: null } : state && state.range === range ? state : null;

  return <div className="space-y-4">
    <div className="md:pr-44"><h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Analytics</h1><p className="mt-1 text-sm text-muted-foreground">How Tableeqr and your tenants are doing.</p></div>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div role="group" aria-label="Section" className="no-scrollbar flex gap-1.5 overflow-x-auto">{SECTIONS.map((o) => <button key={o.key} type="button" aria-pressed={section === o.key} onClick={() => setSection(o.key)} className={filterChip(section === o.key)}>{o.label}</button>)}</div>
      <div role="group" aria-label="Period" className="flex rounded-full border bg-card p-0.5">{([7, 30, 90] as const).map((d) => <button key={d} type="button" aria-pressed={range === d} onClick={() => setRange(d)} className={`h-8 rounded-full px-3 text-xs font-semibold ${range === d ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{d} days</button>)}</div>
    </div>
    {!ready ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading analytics…</p>
      : ready.error || !ready.data ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{ready.error ?? "Analytics could not be loaded."}</p>
      : <Loaded a={ready.data} tenants={data.tenants} plans={data.plans} range={range} section={section} />}
  </div>;
}
