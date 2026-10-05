"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CircleCheck, IndianRupee, Info, Loader2, Search, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getPaymentsAction } from "./actions";
import type { AdminPayment, PaymentsData } from "./admin-types";

const money = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const when = (v: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(v));
const day = (v: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(v));
const chart = { collected: { label: "Collected (₹)", color: "#5b42f5" } } satisfies ChartConfig;

const STATUS: Record<AdminPayment["status"], { label: string; tone: string }> = {
  success: { label: "Paid", tone: "bg-emerald-100 text-emerald-700" },
  failed: { label: "Failed", tone: "bg-red-100 text-red-700" },
  pending: { label: "In progress", tone: "bg-amber-100 text-amber-700" },
  initiated: { label: "In progress", tone: "bg-amber-100 text-amber-700" },
  refunded: { label: "Refunded", tone: "bg-zinc-100 text-zinc-600" },
};
const METHOD: Record<string, string> = { upi: "UPI", card: "Card", wallet: "Wallet", cash: "Cash" };
type Tab = "all" | "success" | "failed" | "pending" | "refunded";
const TABS: { value: Tab; label: string }[] = [{ value: "all", label: "All" }, { value: "success", label: "Paid" }, { value: "failed", label: "Failed" }, { value: "pending", label: "In progress" }, { value: "refunded", label: "Refunded" }];
const PAGE = 10;

function Stat({ icon: Icon, label, value, note, tone, change }: { icon: typeof IndianRupee; label: string; value: string; note: string; tone: string; change?: number | null }) {
  return <Card size="sm"><CardContent className="flex items-center gap-3">
    <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: `${tone}1f`, color: tone }}><Icon className="size-5" aria-hidden="true" /></span>
    <div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="truncate text-2xl font-bold leading-tight">{value}</p>
      <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">{change != null && <span className={`flex items-center font-semibold ${change < 0 ? "text-red-600" : "text-emerald-600"}`}>{change < 0 ? <ArrowDownRight className="size-3" /> : <ArrowUpRight className="size-3" />}{Math.abs(change)}%</span>}{note}</p></div>
  </CardContent></Card>;
}

function Loaded({ data }: { data: PaymentsData }) {
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const total = data.counts.success + data.counts.failed + data.counts.pending + data.counts.refunded;
  const successRate = total ? Math.round((data.counts.success / total) * 100) : null;
  const change = data.previousCollectedPaise ? Math.round(((data.collectedPaise - data.previousCollectedPaise) / data.previousCollectedPaise) * 100) : null;
  const methodTotal = data.byMethod.reduce((sum, m) => sum + m.paise, 0);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.payments.filter((p) => {
      const kind = p.status === "initiated" ? "pending" : p.status;
      return (tab === "all" || kind === tab) && (!q || p.tenantName.toLowerCase().includes(q) || p.outletName.toLowerCase().includes(q));
    });
  }, [data.payments, tab, query]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages - 1);
  const shown = rows.slice(current * PAGE, (current + 1) * PAGE);
  const countOf = (t: Tab) => t === "all" ? data.payments.length : data.payments.filter((p) => (p.status === "initiated" ? "pending" : p.status) === t).length;

  return <>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
      <Stat icon={IndianRupee} label="Money collected" value={money(data.collectedPaise)} note="last 30 days" tone="#5b42f5" change={change} />
      <Stat icon={CircleCheck} label="Successful payments" value={String(data.counts.success)} note={successRate !== null ? `${successRate}% success rate` : "No payments yet"} tone="#16c784" />
      <Stat icon={AlertTriangle} label="Failed payments" value={String(data.counts.failed)} note={data.counts.failed ? "Check the reason below" : "Nothing failed"} tone="#ed5368" />
      <Stat icon={Undo2} label="Refunded" value={money(data.refundedPaise)} note={data.pendingRefunds ? `${data.pendingRefunds} still pending` : "No pending refunds"} tone="#f08b18" />
    </div>

    <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
      <Card>
        <CardHeader><CardTitle>Collected per day</CardTitle><CardDescription>Successful payments, last 30 days</CardDescription></CardHeader>
        <CardContent>
          <ChartContainer config={chart} className="h-56 w-full">
            <BarChart data={data.daily.map((d) => ({ label: day(d.date), collected: Math.round(d.collectedPaise / 100) }))} margin={{ left: -8, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="collected" fill="var(--color-collected)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>How guests pay</CardTitle><CardDescription>Share of money collected</CardDescription></CardHeader>
        <CardContent>
          {data.byMethod.length ? <ul className="space-y-4">{data.byMethod.map((m) => { const pct = methodTotal ? Math.round((m.paise / methodTotal) * 100) : 0; return <li key={m.method} className="space-y-1.5">
            <div className="flex justify-between text-sm"><span className="font-medium">{METHOD[m.method] ?? m.method}</span><span className="text-muted-foreground">{money(m.paise)} · {pct}%</span></div>
            <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-[#5b42f5]" style={{ width: `${pct}%` }} /></div>
          </li>; })}</ul> : <p className="py-10 text-center text-sm text-muted-foreground">No successful payments yet.</p>}
        </CardContent>
      </Card>
    </div>

    <Card>
      <CardContent className="space-y-4">
        <Tabs value={tab} onValueChange={(v) => { setTab(v as Tab); setPage(0); }}>
          <TabsList variant="line" className="h-auto flex-wrap justify-start gap-x-1 gap-y-1 group-data-horizontal/tabs:h-auto [&>*]:h-8">{TABS.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label} ({countOf(t.value)})</TabsTrigger>)}</TabsList>
        </Tabs>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Search tenant or outlet…" className="pl-8" aria-label="Search payments" />
        </div>
        {shown.length ? <Table>
          <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Restaurant</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="pl-6">Status</TableHead></TableRow></TableHeader>
          <TableBody>{shown.map((p) => <TableRow key={p.id}>
            <TableCell className="whitespace-nowrap text-muted-foreground">{when(p.createdAt)}</TableCell>
            <TableCell><p className="font-medium">{p.tenantName}</p><p className="text-xs text-muted-foreground">{p.outletName}</p></TableCell>
            <TableCell>{METHOD[p.method] ?? p.method}<p className="text-xs capitalize text-muted-foreground">{p.channel}</p></TableCell>
            <TableCell className="text-right"><p className="font-medium">{money(p.amountPaise + p.tipPaise)}</p>{p.tipPaise > 0 && <p className="text-xs text-muted-foreground">incl. {money(p.tipPaise)} tip</p>}</TableCell>
            <TableCell className="pl-6"><Badge variant="secondary" className={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>{p.status === "failed" && p.failureReason && <p className="mt-1 max-w-48 text-xs text-red-600">{p.failureReason}</p>}</TableCell>
          </TableRow>)}</TableBody>
        </Table> : <p className="py-12 text-center text-sm text-muted-foreground">{data.payments.length ? "No payments match. Try another tab or search." : "No payments in the last 30 days."}</p>}
        {rows.length > PAGE && <div className="flex items-center justify-between text-sm text-muted-foreground">
          <p>{current * PAGE + 1}–{Math.min(rows.length, (current + 1) * PAGE)} of {rows.length}</p>
          <div className="flex gap-2"><Button variant="outline" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</Button></div>
        </div>}
        {data.payments.length >= 300 && <p className="text-xs text-muted-foreground">Showing the latest 300 payments.</p>}
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Recent refunds</CardTitle><CardDescription>Money returned to guests</CardDescription></CardHeader>
      <CardContent>
        {data.refunds.length ? <ul className="divide-y">{data.refunds.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
          <span><span className="font-medium">{r.tenantName}</span> <span className="text-muted-foreground">· {r.reason}</span></span>
          <span className="flex items-center gap-3"><span className="text-xs text-muted-foreground">{when(r.createdAt)}</span><span className="w-16 text-right font-medium">{money(r.amountPaise)}</span>
            <Badge variant="secondary" className={r.status === "success" ? "bg-emerald-100 text-emerald-700" : r.status === "failed" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}>{r.status === "success" ? "Returned" : r.status === "failed" ? "Failed" : "Pending"}</Badge></span>
        </li>)}</ul> : <p className="py-6 text-center text-sm text-muted-foreground">No refunds yet.</p>}
      </CardContent>
    </Card>
  </>;
}

export function PaymentsView() {
  const [state, setState] = useState<{ data: PaymentsData | null; error: string | null } | null>(null);
  useEffect(() => { let off = false; getPaymentsAction().then((r) => { if (!off) setState(r); }); return () => { off = true; }; }, []);

  return <div className="space-y-6">
    <div><h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Payments</h1><p className="mt-1 text-sm text-muted-foreground">Payments made by restaurant guests, across all tenants.</p></div>
    <p className="flex items-start gap-2 rounded-lg border bg-white p-3 text-sm text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />This is the restaurants&apos; money (guests paying their bills), not your subscription income. You see amounts only, never guest details.</p>
    {!state ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading payments…</p>
      : state.error || !state.data ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error ?? "Payments could not be loaded."}</p>
      : <Loaded data={state.data} />}
  </div>;
}
