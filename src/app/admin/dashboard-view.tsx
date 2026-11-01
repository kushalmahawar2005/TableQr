"use client";

import { useMemo, useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, XAxis, YAxis } from "recharts";
import { Ban, ChevronRight, CircleCheck, IndianRupee, Store, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AdminData, AdminTenant } from "./admin-types";
import { FEATURE_LABELS } from "@/lib/plan-features";
import { openAdminPage } from "./admin-nav";
import { Change, filterChip, Kpi } from "./admin-ui";

const DAY = 86_400_000;
const PLAN_COLORS = ["#2f7d5b", "#D86B45", "#c9a227", "#3d91ef", "#8a7fb8", "#9aa3b2"];
const growthConfig = { mrr: { label: "Income (₹)", color: "#2f7d5b" }, tenants: { label: "Tenants", color: "#D86B45" } } satisfies ChartConfig;
const KINDS: { kind: AttentionKind; label: string }[] = [{ kind: "request", label: "Requests" }, { kind: "payment", label: "Payments" }, { kind: "trial", label: "Trials" }, { kind: "suspended", label: "Suspended" }, { kind: "inactive", label: "No orders" }];

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
    if (tenant.feeClaim) items.push({ id: `${tenant.id}-claim`, kind: "payment", tenant, label: tenant.feeClaim.method === "cashfree" ? "Payment processing" : "Says they paid", detail: `₹${Math.round(tenant.feeClaim.amountPaise / 100).toLocaleString("en-IN")} · ${tenant.feeClaim.method === "cashfree" ? "Cashfree is confirming" : "check it in Fees"}`, tone: "amber", rank: -2, page: "Fees" });
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

  const [picked, setTab] = useState<"all" | AttentionKind>("all");
  const count = (kind: AttentionKind) => attention.filter((item) => item.kind === kind).length;
  // A filter empties once its last item is handled, so fall back to All
  const tab = picked !== "all" && count(picked) === 0 ? "all" : picked;
  const shownAttention = tab === "all" ? attention : attention.filter((item) => item.kind === tab);

  const top = useMemo(() => [...data.tenants].sort((a, b) => b.orders30d - a.orders30d || b.paidBills30dPaise - a.paidBills30dPaise).slice(0, 5), [data.tenants]);

  const plans = data.plans.map((plan, i) => ({ ...plan, fill: PLAN_COLORS[i % PLAN_COLORS.length] }));
  const planTotal = plans.reduce((sum, p) => sum + p.tenantCount, 0);
  const planConfig = Object.fromEntries(plans.map((p) => [p.code, { label: p.name, color: p.fill }])) satisfies ChartConfig;


  return <div className="space-y-4 sm:space-y-5">
    <div className="md:pr-44"><h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Welcome back, {name}</h1><p className="mt-1 text-sm text-muted-foreground">Here&apos;s how Tableeqr is doing.</p></div>

    {(waiting.claims > 0 || waiting.requests > 0) && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3">
      <p className="min-w-0 text-sm font-semibold">
        <span className="mr-2 inline-block size-2 rounded-full bg-amber-500 align-middle" aria-hidden="true" />
        {[waiting.claims > 0 && `${waiting.claims} ${waiting.claims === 1 ? "payment" : "payments"} to confirm`, waiting.requests > 0 && `${waiting.requests} ${waiting.requests === 1 ? "request" : "requests"} from tenants`].filter(Boolean).join(" · ")}
      </p>
      <button type="button" onClick={() => openAdminPage("Fees")} className="h-9 rounded-lg bg-[var(--admin-brand)] px-4 text-sm font-semibold text-white hover:bg-[var(--admin-brand-hover)]">Check now</button>
    </div>}

    <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
      <Kpi icon={IndianRupee} label="Monthly income" value={money(stats.mrrPaise)} hint="From paying tenants" />
      <Kpi icon={Store} label="Live tenants" value={String(stats.active)} hint={`${stats.trials} on free trial`} />
      <Kpi icon={UserPlus} label="New this month" value={String(stats.newThisMonth)} change={data.changes.tenants} hint="Joined in 30 days" />
      <Kpi icon={Ban} label="Stopped" value={String(stats.lost)} hint={stats.lost ? "Suspended or cancelled" : "No one has left"} />
    </div>

    <div className="grid items-stretch gap-4 xl:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
      <Card>
        <CardHeader className="grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <CardTitle>Monthly growth</CardTitle>
            <CardDescription className="mt-1 flex flex-wrap gap-x-4 gap-y-1"><span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-[#2f7d5b]" />Income</span><span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-[#D86B45]" />Tenants</span></CardDescription>
          </div>
          <Select value={months} onValueChange={(v) => v && setMonths(v)}>
            <SelectTrigger size="sm" aria-label="Growth range"><SelectValue>{`${months} months`}</SelectValue></SelectTrigger>
            <SelectContent><SelectItem value="6">6 months</SelectItem><SelectItem value="12">12 months</SelectItem></SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          <ChartContainer config={growthConfig} className="h-56 w-full sm:h-64 xl:h-[19rem]">
            <ComposedChart data={monthly} margin={{ left: -8, right: -8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis yAxisId="mrr" tickLine={false} axisLine={false} tickFormatter={(v: number) => `₹${v >= 1000 ? `${Math.round(v / 1000)}K` : v}`} />
              <YAxis yAxisId="tenants" orientation="right" tickLine={false} axisLine={false} allowDecimals={false} domain={[0, "dataMax + 1"]} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar yAxisId="mrr" dataKey="mrr" fill="var(--color-mrr)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Line yAxisId="tenants" dataKey="tenants" type="monotone" stroke="var(--color-tenants)" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Needs attention</CardTitle><CardDescription>{attention.length ? `${attention.length} ${attention.length === 1 ? "thing" : "things"} to follow up` : "Nothing to follow up"}</CardDescription></CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
          {attention.length > 0 && <div role="group" aria-label="Show" className="no-scrollbar flex gap-1.5 overflow-x-auto">
            <button type="button" aria-pressed={tab === "all"} onClick={() => setTab("all")} className={filterChip(tab === "all")}>All {attention.length}</button>
            {KINDS.filter((k) => count(k.kind) > 0).map((k) => <button key={k.kind} type="button" aria-pressed={tab === k.kind} onClick={() => setTab(k.kind)} className={filterChip(tab === k.kind)}>{k.label} {count(k.kind)}</button>)}
          </div>}
          {shownAttention.length ? <ul className="no-scrollbar -mx-2 max-h-72 space-y-0.5 overflow-y-auto">{shownAttention.map((item) => <li key={item.id}>
            <button type="button" onClick={() => openAdminPage(item.page ?? "Tenants", item.page ? undefined : item.tenant.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-[var(--admin-brand)]">
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.tenant.name}</p><p className="truncate text-xs text-muted-foreground">{item.detail}</p><Badge variant="secondary" className={`mt-1 hidden max-[380px]:inline-flex ${toneClass[item.tone]}`}>{item.label}</Badge></div>
              <Badge variant="secondary" className={`max-[380px]:hidden ${toneClass[item.tone]}`}>{item.label}</Badge>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          </li>)}</ul> : <div className="grid min-h-40 flex-1 place-items-center text-center text-sm text-muted-foreground"><div><CircleCheck className="mx-auto mb-2 size-6 text-emerald-700" aria-hidden="true" /><p className="font-semibold text-foreground">All good</p><p>Nothing needs you right now.</p></div></div>}
        </CardContent>
      </Card>
    </div>

    <section aria-label="All tenants together" className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border lg:grid-cols-4">
      {[
        { label: "Total orders", value: data.totals.orders.toLocaleString("en-IN"), change: data.changes.orders },
        { label: "Paid bills", value: money(data.totals.revenuePaise), change: data.changes.revenue },
        { label: "Outlets", value: data.totals.restaurants.toLocaleString("en-IN"), change: data.changes.restaurants },
        { label: "Tables", value: data.totals.tables.toLocaleString("en-IN"), change: null },
      ].map(({ label, value, change }) => <div key={label} className="min-w-0 bg-card p-3 sm:px-5 sm:py-4">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-lg font-bold tabular-nums">{value}{change != null && <Change value={change} />}</p>
      </div>)}
    </section>

    <div className="grid items-start gap-4 xl:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
      <Card>
        <CardHeader><CardTitle>Busiest tenants</CardTitle><CardDescription>Most orders in the last 30 days</CardDescription></CardHeader>
        <CardContent>
          {top.length ? <Table>
            <TableHeader><TableRow><TableHead>Tenant</TableHead><TableHead className="hidden md:table-cell">Plan</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="hidden text-right sm:table-cell">Paid bills</TableHead><TableHead className="hidden lg:table-cell">Status</TableHead></TableRow></TableHeader>
            <TableBody>{top.map((t) => <TableRow key={t.id}>
              <TableCell className="max-w-0 w-full"><button type="button" onClick={() => openAdminPage("Tenants", t.id)} className="block max-w-full text-left hover:underline focus-visible:outline-2 focus-visible:outline-[var(--admin-brand)]"><span className="block truncate font-semibold">{t.name}</span><span className="block truncate text-xs text-muted-foreground">{t.cities.join(", ") || t.contactName}</span></button></TableCell>
              <TableCell className="hidden md:table-cell"><Badge variant="secondary">{t.planName}</Badge></TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{t.orders30d.toLocaleString("en-IN")}</TableCell>
              <TableCell className="hidden text-right tabular-nums sm:table-cell">{money(t.paidBills30dPaise)}</TableCell>
              <TableCell className="hidden lg:table-cell"><Badge variant="secondary" className={`capitalize ${statusTone[t.status]}`}>{t.status}</Badge></TableCell>
            </TableRow>)}</TableBody>
          </Table> : <p className="py-10 text-center text-sm text-muted-foreground">No tenants yet. Add your first one from the Tenants page.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Tenants by plan</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-5 max-[380px]:flex-col">
          <div className="relative shrink-0">
            <ChartContainer config={planConfig} className="size-32">
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="code" />} />
                <Pie data={planTotal ? plans : [{ code: "none", name: "None", tenantCount: 1, fill: "var(--muted)" }]} dataKey="tenantCount" nameKey="code" innerRadius={42} outerRadius={62} strokeWidth={2}>
                  {(planTotal ? plans : [{ code: "none", fill: "var(--muted)" }]).map((p) => <Cell key={p.code} fill={p.fill} />)}
                </Pie>
              </PieChart>
            </ChartContainer>
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><p className="text-xl font-bold tabular-nums">{planTotal}</p></div>
          </div>
          <ul className="w-full min-w-0 space-y-2 text-sm">{plans.filter((p) => p.tenantCount > 0).map((p) => <li key={p.code} className="flex items-center gap-2"><i className="size-2.5 shrink-0 rounded-full" style={{ background: p.fill }} /><span className="min-w-0 flex-1 truncate">{p.name}</span><b className="tabular-nums">{p.tenantCount}</b></li>)}</ul>
        </CardContent>
      </Card>
    </div>
  </div>;
}
