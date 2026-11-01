"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, Download, IndianRupee, Lightbulb, Loader2, Receipt, Store, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAnalyticsAction } from "./actions";
import type { AdminData, AnalyticsData, AnalyticsRange } from "./admin-types";

const money = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const short = (paise: number) => { const r = paise / 100; return r >= 100_000 ? `₹${(r / 100_000).toFixed(1)}L` : r >= 1000 ? `₹${(r / 1000).toFixed(1)}K` : `₹${Math.round(r)}`; };
const day = (v: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(v));
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const change = (now: number, before: number) => (before === 0 ? (now === 0 ? 0 : null) : Math.round(((now - before) / before) * 100));

const trendCfg = { sales: { label: "Sales (₹)", color: "#a78bfa" }, orders: { label: "Orders", color: "#5b42f5" } } satisfies ChartConfig;
const hourCfg = { orders: { label: "Orders", color: "#5b42f5" } } satisfies ChartConfig;
const growthCfg = { total: { label: "Total tenants", color: "#16c784" }, added: { label: "Added", color: "#3d91ef" } } satisfies ChartConfig;

function Kpi({ icon: Icon, label, value, now, before, tone, period }: { icon: typeof Users; label: string; value: string; now: number; before: number; tone: string; period: string }) {
  const c = change(now, before);
  return <Card size="sm"><CardContent className="flex items-center gap-3">
    <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: `${tone}1f`, color: tone }}><Icon className="size-5" aria-hidden="true" /></span>
    <div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="truncate text-2xl font-bold leading-tight">{value}</p>
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">{c !== null ? <span className={`flex items-center font-semibold ${c < 0 ? "text-red-600" : "text-emerald-600"}`}>{c < 0 ? <ArrowDownRight className="size-3" /> : <ArrowUpRight className="size-3" />}{Math.abs(c)}%</span> : <span className="font-semibold text-emerald-600">New</span>} vs previous {period}</p></div>
  </CardContent></Card>;
}

function BarList({ rows, empty }: { rows: { key: string; label: string; sub: string; value: number; text: string }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return rows.length ? <ul className="space-y-3.5">{rows.map((r, i) => <li key={r.key} className="space-y-1.5">
    <div className="flex items-baseline justify-between gap-3 text-sm"><span className="min-w-0 truncate"><span className="mr-2 text-xs text-muted-foreground">{i + 1}</span><span className="font-medium">{r.label}</span> <span className="text-xs text-muted-foreground">{r.sub}</span></span><span className="shrink-0 font-medium">{r.text}</span></div>
    <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-[#5b42f5]" style={{ width: `${Math.max(3, (r.value / max) * 100)}%` }} /></div>
  </li>)}</ul> : <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>;
}

function Loaded({ a, tenants, plans, range }: { a: AnalyticsData; tenants: AdminData["tenants"]; plans: AdminData["plans"]; range: AnalyticsRange }) {
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
  }).sort((x, y) => y.value - x.value), [plans, tenants]);

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

  return <>
    <Card><CardContent className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><Lightbulb className="size-4 text-amber-500" aria-hidden="true" />What stands out</h2>
      <ul className="space-y-1.5 text-sm text-muted-foreground">{insights.map((x) => <li key={x}>• {x}</li>)}</ul>
    </CardContent></Card>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
      <Kpi icon={IndianRupee} label="Restaurant sales" value={money(t.salesPaise)} now={t.salesPaise} before={t.previousSalesPaise} tone="#5b42f5" period={period} />
      <Kpi icon={Receipt} label="Orders" value={t.orders.toLocaleString("en-IN")} now={t.orders} before={t.previousOrders} tone="#16c784" period={period} />
      <Kpi icon={Store} label="Tenants with orders" value={String(t.activeTenants)} now={t.activeTenants} before={t.previousActiveTenants} tone="#f08b18" period={period} />
      <Kpi icon={Users} label="Average bill" value={t.paidBills ? money(Math.round(t.salesPaise / t.paidBills)) : "—"} now={t.paidBills ? t.salesPaise / t.paidBills : 0} before={t.previousPaidBills ? t.previousSalesPaise / t.previousPaidBills : 0} tone="#ed5368" period={period} />
    </div>

    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3"><div><CardTitle>Sales &amp; orders</CardTitle><CardDescription>Day by day, last {period}</CardDescription></div><Button variant="outline" size="sm" onClick={exportCsv}><Download />Export</Button></CardHeader>
      <CardContent>
        <ChartContainer config={trendCfg} className="h-64 w-full">
          <ComposedChart data={a.daily.map((d) => ({ label: day(d.date), sales: Math.round(d.salesPaise / 100), orders: d.orders }))} margin={{ left: -8, right: -8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={28} />
            <YAxis yAxisId="s" tickLine={false} axisLine={false} />
            <YAxis yAxisId="o" orientation="right" tickLine={false} axisLine={false} allowDecimals={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar yAxisId="s" dataKey="sales" fill="var(--color-sales)" radius={[3, 3, 0, 0]} />
            <Line yAxisId="o" dataKey="orders" type="monotone" stroke="var(--color-orders)" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </Card>

    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
      <Card>
        <CardHeader><CardTitle>Busiest hours</CardTitle><CardDescription>{hasOrders ? `Orders peak around ${hourLabel(peakHour)} (India time)` : "Orders by time of day (India time)"}</CardDescription></CardHeader>
        <CardContent>
          <ChartContainer config={hourCfg} className="h-52 w-full">
            <BarChart data={a.byHour.map((n, h) => ({ label: hourLabel(h), orders: n, peak: h === peakHour && hasOrders }))} margin={{ left: -16, right: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} interval={2} />
              <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="orders" radius={[3, 3, 0, 0]}>{a.byHour.map((_, h) => <Cell key={h} fill={h === peakHour && hasOrders ? "#5b42f5" : "#c4b8fb"} />)}</Bar>
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Busiest days</CardTitle><CardDescription>{hasOrders ? `${WEEKDAYS[peakDay]} gets the most orders` : "Orders by day of the week"}</CardDescription></CardHeader>
        <CardContent>
          <ChartContainer config={hourCfg} className="h-52 w-full">
            <BarChart data={a.byWeekday.map((n, d) => ({ label: WEEKDAYS[d], orders: n }))} margin={{ left: -16, right: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="orders" radius={[3, 3, 0, 0]}>{a.byWeekday.map((_, d) => <Cell key={d} fill={d === peakDay && hasOrders ? "#5b42f5" : "#c4b8fb"} />)}</Bar>
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>

    <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <Card><CardHeader><CardTitle>Top tenants</CardTitle><CardDescription>By restaurant sales, last {period}</CardDescription></CardHeader><CardContent>
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
              <XAxis dataKey="label" tickLine={false} axisLine={false} interval={1} />
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
            <div className="flex justify-between text-sm"><span>{s.label}</span><span className="font-medium">{s.n} <span className="text-xs font-normal text-muted-foreground">({pct}%){i > 0 && prev - s.n > 0 ? ` · ${prev - s.n} dropped` : ""}</span></span></div>
            <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-[#16c784]" style={{ width: `${pct}%` }} /></div>
          </li>; })}</ul>
        </CardContent>
      </Card>
    </div>

    <Card><CardHeader><CardTitle>SMS codes</CardTitle><CardDescription>{a.otp.total} requested in the last {period}, {a.otp.previousTotal} in the period before</CardDescription></CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <dl className="space-y-2 text-sm">
          {([["Table and booking", a.otp.tableAndBooking], ["Delivery and pickup", a.otp.delivery], ["Customer sign-in", a.otp.account], ["Staff invitations", a.otp.staff]] as const).map(([label, value]) => <div key={label} className="flex justify-between"><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold">{value}</dd></div>)}
        </dl>
        <div className="space-y-2 text-sm">{a.otp.topTenants.length ? a.otp.topTenants.map((tenant) => <div key={tenant.id} className="flex justify-between gap-3"><span className="truncate">{tenant.name}</span><b>{tenant.codes}</b></div>) : <p className="text-muted-foreground">No codes requested in this period.</p>}</div>
      </CardContent>
    </Card>
    <Card><CardHeader><CardTitle>Subscription income by plan</CardTitle><CardDescription>Monthly income from paying tenants</CardDescription></CardHeader><CardContent>
      <BarList empty="No plans yet." rows={byPlan.map((p) => ({ ...p, text: `${money(p.value)} / month` }))} />
    </CardContent></Card>
  </>;
}

export function AnalyticsView({ data }: { data: AdminData }) {
  const [range, setRange] = useState<AnalyticsRange>(30);
  const [state, setState] = useState<{ range: AnalyticsRange; data: AnalyticsData | null; error: string | null } | null>(null);

  useEffect(() => {
    let off = false;
    getAnalyticsAction(range).then((r) => { if (!off) setState({ range, ...r }); });
    return () => { off = true; };
  }, [range]);

  const ready = state && state.range === range ? state : null;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Analytics</h1><p className="mt-1 text-sm text-muted-foreground">How your platform and your restaurants are doing.</p></div>
      <Tabs value={String(range)} onValueChange={(v) => setRange(Number(v) as AnalyticsRange)}><TabsList><TabsTrigger value="7">7 days</TabsTrigger><TabsTrigger value="30">30 days</TabsTrigger><TabsTrigger value="90">90 days</TabsTrigger></TabsList></Tabs>
    </div>
    {!ready ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading analytics…</p>
      : ready.error || !ready.data ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{ready.error ?? "Analytics could not be loaded."}</p>
      : <Loaded a={ready.data} tenants={data.tenants} plans={data.plans} range={range} />}
  </div>;
}
