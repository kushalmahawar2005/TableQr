"use client";

import { useMemo, useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Ban, IndianRupee, LayoutGrid, Receipt, Store, TrendingUp, UserPlus, Wallet, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AdminData, AdminTenant } from "./admin-types";
import { FEATURE_LABELS } from "@/lib/plan-features";
import { openAdminPage } from "./admin-nav";

const DAY = 86_400_000;
const PLAN_COLORS = ["#5b42f5", "#16c784", "#f59d18", "#ed5368", "#3d91ef", "#e875b1"];
const growthConfig = { mrr: { label: "MRR (₹)", color: "#a78bfa" }, tenants: { label: "Active tenants", color: "#3d91ef" } } satisfies ChartConfig;

const money = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const shortDate = (value: string | number | Date) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(value));
const ago = (value: string, now: number) => {
  const days = Math.floor((now - new Date(value).getTime()) / DAY);
  return days < 1 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};

type AttentionKind = "request" | "trial" | "payment" | "suspended" | "inactive";
type Attention = { id: string; kind: AttentionKind; tenant: AdminTenant; label: string; detail: string; tone: "red" | "amber" | "zinc"; rank: number; page?: string };

function attentionItems(tenants: AdminTenant[], now: number): Attention[] {
  const items: Attention[] = [];
  for (const tenant of tenants) {
    if (tenant.feeClaim) items.push({ id: `${tenant.id}-claim`, kind: "payment", tenant, label: "Says they paid", detail: `₹${Math.round(tenant.feeClaim.amountPaise / 100).toLocaleString("en-IN")} · check it in Fees`, tone: "amber", rank: -2, page: "Fees" });
    for (const r of tenant.requests) items.push({ id: r.id, kind: "request", tenant, label: "Asked for upgrade", detail: `${r.feature && r.feature in FEATURE_LABELS ? FEATURE_LABELS[r.feature as keyof typeof FEATURE_LABELS].label : "Plan change"} · ${ago(r.createdAt, now)}`, tone: "amber", rank: -1 });
    if (tenant.subscriptionStatus === "past_due") items.push({ id: `${tenant.id}-due`, kind: "payment", tenant, label: "Payment overdue", detail: tenant.renewalAt ? `Was due ${shortDate(tenant.renewalAt)}` : "Subscription is past due", tone: "red", rank: 0 });
    if (tenant.status === "suspended") items.push({ id: `${tenant.id}-sus`, kind: "suspended", tenant, label: "Suspended", detail: "Tenant cannot take orders", tone: "red", rank: 1 });
    if (tenant.status === "trial" && tenant.trialEndsAt) {
      const days = Math.ceil((new Date(tenant.trialEndsAt).getTime() - now) / DAY);
      if (days <= 7) items.push({ id: `${tenant.id}-trial`, kind: "trial", tenant, label: days < 0 ? "Trial ended" : "Trial ending", detail: days < 0 ? `Ended ${-days} ${-days === 1 ? "day" : "days"} ago` : days === 0 ? "Ends today" : `Ends in ${days} ${days === 1 ? "day" : "days"}`, tone: "amber", rank: 2 });
    }
    if ((tenant.status === "active" || tenant.status === "trial") && tenant.orders30d === 0 && now - new Date(tenant.createdAt).getTime() > 7 * DAY) {
      items.push({ id: `${tenant.id}-idle`, kind: "inactive", tenant, label: "No orders in 30 days", detail: tenant.lastOrderAt ? `Last order ${ago(tenant.lastOrderAt, now)}` : "Has never taken an order", tone: "zinc", rank: 3 });
    }
  }
  return items.sort((a, b) => a.rank - b.rank);
}

const statusTone: Record<string, string> = { active: "bg-emerald-100 text-emerald-700", trial: "bg-amber-100 text-amber-700", suspended: "bg-red-100 text-red-700", cancelled: "bg-zinc-100 text-zinc-600" };
const toneClass = { red: "bg-red-100 text-red-700", amber: "bg-amber-100 text-amber-700", zinc: "bg-zinc-100 text-zinc-600" };

function Kpi({ icon: Icon, label, value, hint, change, tone }: { icon: typeof Store; label: string; value: string; hint?: string; change?: number | null; tone: string }) {
  return <Card size="sm">
    <CardContent className="flex items-center gap-4">
      <span className="grid size-12 shrink-0 place-items-center rounded-xl" style={{ background: `${tone}1f`, color: tone }}><Icon className="size-6" aria-hidden="true" /></span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-2xl font-bold tracking-tight">{value}</p>
        {change != null ? <p className={`mt-0.5 flex items-center gap-0.5 text-xs font-semibold ${change < 0 ? "text-red-600" : "text-emerald-600"}`}>{change < 0 ? <ArrowDownRight className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}{Math.abs(change)}% <span className="font-normal text-muted-foreground">vs last month</span></p>
          : hint ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </CardContent>
  </Card>;
}

export function DashboardView({ data, name }: { data: AdminData; name: string }) {
  const now = new Date(data.asOf).getTime();

  const stats = useMemo(() => {
    const active = data.tenants.filter((t) => t.status === "active");
    const trials = data.tenants.filter((t) => t.status === "trial");
    const mrrPaise = active.reduce((sum, t) => sum + (t.monthlyPricePaise ?? 0) * t.outletCount, 0);
    const newThisMonth = data.tenants.filter((t) => now - new Date(t.createdAt).getTime() <= 30 * DAY).length;
    const lost = data.tenants.filter((t) => t.status === "suspended" || t.status === "cancelled").length;
    return { active: active.length, trials: trials.length, mrrPaise, newThisMonth, lost };
  }, [data.tenants, now]);

  const attention = useMemo(() => attentionItems(data.tenants, now), [data.tenants, now]);
  const waiting = { claims: data.tenants.filter((t) => t.feeClaim).length, requests: data.tenants.reduce((n, t) => n + t.requests.length, 0) };

  const [months, setMonths] = useState("12");
  const monthly = useMemo(() => {
    const ref = new Date(now);
    const count = Number(months);
    return Array.from({ length: count }, (_, i) => {
      const end = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - (count - 1 - i) + 1, 1);
      const live = data.tenants.filter((t) => t.status === "active" && new Date(t.createdAt).getTime() < end);
      return {
        label: new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(new Date(end - 1)),
        tenants: live.length,
        mrr: Math.round(live.reduce((sum, t) => sum + (t.monthlyPricePaise ?? 0) * t.outletCount, 0) / 100),
      };
    });
  }, [data.tenants, now, months]);

  const [tab, setTab] = useState<"all" | AttentionKind>("all");
  const count = (kind: AttentionKind) => attention.filter((item) => item.kind === kind).length;
  const shownAttention = tab === "all" ? attention : attention.filter((item) => item.kind === tab);

  const top = useMemo(() => [...data.tenants].sort((a, b) => b.orders30d - a.orders30d || b.paidBills30dPaise - a.paidBills30dPaise).slice(0, 5), [data.tenants]);

  const plans = data.plans.map((plan, i) => ({ ...plan, fill: PLAN_COLORS[i % PLAN_COLORS.length] }));
  const planTotal = plans.reduce((sum, p) => sum + p.tenantCount, 0);
  const planConfig = Object.fromEntries(plans.map((p) => [p.code, { label: p.name, color: p.fill }])) satisfies ChartConfig;

  return <div className="space-y-6">
    <div><h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Welcome back, {name} 👋</h1><p className="mt-1 text-sm text-muted-foreground">Here&apos;s how your TableQR business is doing.</p></div>

    {(waiting.claims > 0 || waiting.requests > 0) && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#5b42f5]/40 bg-[#5b42f5]/10 px-4 py-3">
      <p className="text-sm font-medium">
        <span className="mr-1.5 inline-block size-2 animate-pulse rounded-full bg-[#5b42f5] align-middle" aria-hidden="true" />
        {[waiting.claims > 0 && `${waiting.claims} ${waiting.claims === 1 ? "payment" : "payments"} to confirm`, waiting.requests > 0 && `${waiting.requests} ${waiting.requests === 1 ? "request" : "requests"} from restaurants`].filter(Boolean).join(" · ")}
        <span className="ml-1 font-normal text-muted-foreground">Restaurants are waiting for you.</span>
      </p>
      <button type="button" onClick={() => openAdminPage("Fees")} className="h-9 rounded-lg bg-[#5b42f5] px-4 text-sm font-semibold text-white hover:bg-[#4a33e0]">Check now</button>
    </div>}

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
      <Kpi icon={IndianRupee} label="Monthly recurring revenue" value={money(stats.mrrPaise)} hint="From active subscriptions" tone="#5b42f5" />
      <Kpi icon={Store} label="Active tenants" value={String(stats.active)} hint={`${stats.trials} on trial`} tone="#16c784" />
      <Kpi icon={UserPlus} label="New this month" value={String(stats.newThisMonth)} change={data.changes.tenants} tone="#3d91ef" />
      <Kpi icon={Ban} label="Suspended / cancelled" value={String(stats.lost)} hint={stats.lost ? "Tenants to win back" : "No lost tenants"} tone="#ed5368" />
    </div>

    <div className="grid items-start gap-4 xl:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div><CardTitle>Monthly growth</CardTitle><CardDescription>MRR and active tenants, estimated from current subscriptions</CardDescription></div>
            <Select value={months} onValueChange={(v) => v && setMonths(v)}>
              <SelectTrigger size="sm" aria-label="Growth range"><SelectValue>{`Last ${months} months`}</SelectValue></SelectTrigger>
              <SelectContent><SelectItem value="6">Last 6 months</SelectItem><SelectItem value="12">Last 12 months</SelectItem></SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            <ChartContainer config={growthConfig} className="h-64 w-full">
              <ComposedChart data={monthly} margin={{ left: -8, right: -8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis yAxisId="mrr" tickLine={false} axisLine={false} tickFormatter={(v: number) => `₹${v >= 1000 ? `${Math.round(v / 1000)}K` : v}`} />
                <YAxis yAxisId="tenants" orientation="right" tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar yAxisId="mrr" dataKey="mrr" fill="var(--color-mrr)" radius={[4, 4, 0, 0]} />
                <Line yAxisId="tenants" dataKey="tenants" type="monotone" stroke="var(--color-tenants)" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Platform usage</CardTitle><CardDescription>Across all tenants</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
            {[
              { icon: Receipt, label: "Total orders", value: data.totals.orders.toLocaleString("en-IN"), change: data.changes.orders, tone: "#5b42f5" },
              { icon: Wallet, label: "Paid bills value", value: money(data.totals.revenuePaise), change: data.changes.revenue, tone: "#16c784" },
              { icon: Store, label: "Active restaurants", value: data.totals.restaurants.toLocaleString("en-IN"), change: data.changes.restaurants, tone: "#f08b18" },
              { icon: LayoutGrid, label: "Tables", value: data.totals.tables.toLocaleString("en-IN"), change: null, tone: "#3d91ef" },
            ].map(({ icon: Icon, label, value, change, tone }) => <div key={label} className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg" style={{ background: `${tone}1f`, color: tone }}><Icon className="size-5" aria-hidden="true" /></span>
              <div className="min-w-0"><p className="truncate text-xs text-muted-foreground">{label}</p><p className="text-base font-bold">{value}</p>{change != null && <p className={`flex items-center text-[11px] font-semibold ${change < 0 ? "text-red-600" : "text-emerald-600"}`}>{change < 0 ? <ArrowDownRight className="size-3" /> : <ArrowUpRight className="size-3" />}{Math.abs(change)}%</p>}</div>
            </div>)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Top tenants by orders</CardTitle><CardDescription>Highest orders in the last 30 days</CardDescription></CardHeader>
          <CardContent>
            {top.length ? <Table>
              <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Tenant</TableHead><TableHead>Plan</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Paid bills</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>{top.map((t, i) => <TableRow key={t.id}>
                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                <TableCell><p className="font-medium">{t.name}</p><p className="text-xs text-muted-foreground">{t.cities.join(", ") || t.contactName}</p></TableCell>
                <TableCell><Badge variant="secondary">{t.planName}</Badge></TableCell>
                <TableCell className="text-right font-medium">{t.orders30d.toLocaleString("en-IN")}</TableCell>
                <TableCell className="text-right">{money(t.paidBills30dPaise)}</TableCell>
                <TableCell><Badge variant="secondary" className={statusTone[t.status]}>{t.status}</Badge></TableCell>
              </TableRow>)}</TableBody>
            </Table> : <p className="py-10 text-center text-sm text-muted-foreground">No tenants yet. Add your first restaurant from the Tenants page.</p>}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-amber-600" aria-hidden="true" />Needs attention{attention.length > 0 && <Badge className="bg-red-100 text-red-700" variant="secondary">{attention.length}</Badge>}</CardTitle>
            <CardDescription>Tenants that need a follow-up</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
              <TabsList variant="line" className="h-auto w-full flex-wrap justify-start gap-x-1 gap-y-1 group-data-horizontal/tabs:h-auto [&>*]:h-8">
                <TabsTrigger value="all">All ({attention.length})</TabsTrigger>
                <TabsTrigger value="request">Requests ({count("request")})</TabsTrigger>
                <TabsTrigger value="trial">Trial ({count("trial")})</TabsTrigger>
                <TabsTrigger value="payment">Payment ({count("payment")})</TabsTrigger>
                <TabsTrigger value="suspended">Suspended ({count("suspended")})</TabsTrigger>
                <TabsTrigger value="inactive">Inactive ({count("inactive")})</TabsTrigger>
              </TabsList>
            </Tabs>
            {shownAttention.length ? <ul className="-mx-2 space-y-1">{shownAttention.slice(0, 8).map((item) => <li key={item.id}>
              <button type="button" onClick={() => openAdminPage(item.page ?? "Tenants", item.page ? undefined : item.tenant.id)} className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-[#5b42f5]">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.tenant.name}</p><p className="truncate text-xs text-muted-foreground">{item.detail}</p></div>
                <Badge variant="secondary" className={toneClass[item.tone]}>{item.label}</Badge>
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>)}</ul> : <div className="grid h-40 place-items-center text-center text-sm text-muted-foreground"><div><TrendingUp className="mx-auto mb-2 size-6 text-emerald-600" aria-hidden="true" /><p className="font-medium text-foreground">All good</p><p>Nothing needs your attention here.</p></div></div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Plan distribution</CardTitle><CardDescription>Active tenants by plan</CardDescription></CardHeader>
          <CardContent className="flex flex-col items-center gap-5 sm:flex-row xl:flex-col 2xl:flex-row">
            <div className="relative shrink-0">
              <ChartContainer config={planConfig} className="size-40">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="code" />} />
                  <Pie data={planTotal ? plans : [{ code: "none", name: "None", tenantCount: 1, fill: "#eef0f4" }]} dataKey="tenantCount" nameKey="code" innerRadius={48} outerRadius={72} strokeWidth={2}>
                    {(planTotal ? plans : [{ code: "none", fill: "#eef0f4" }]).map((p) => <Cell key={p.code} fill={p.fill} />)}
                  </Pie>
                </PieChart>
              </ChartContainer>
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><p className="text-xl font-bold">{planTotal}</p><p className="text-[10px] text-muted-foreground">Active</p></div></div>
            </div>
            <ul className="w-full space-y-2.5 text-sm">{plans.map((p) => <li key={p.code} className="flex items-center gap-2"><i className="size-2.5 rounded-full" style={{ background: p.fill }} /><span className="flex-1">{p.name}</span><b>{p.tenantCount}</b><span className="w-10 text-right text-xs text-muted-foreground">{planTotal ? Math.round((p.tenantCount / planTotal) * 100) : 0}%</span></li>)}</ul>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>;
}
