"use client";

import { subscriptionQuote } from "@/lib/subscription-pricing";
import { CommercialForm } from "./commercial-form";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ChevronLeft, ChevronRight, CircleCheck, Clock, Download, FileText, Loader2, RotateCcw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { changeTenantPlanAction, extendTrialAction, recordFeePaymentAction, type FeeMethod } from "./actions";
import type { AdminData, AdminTenant } from "./admin-types";

const DAY = 86_400_000;
const SOON_DAYS = 14;
const money = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const date = (v: string | null) => v ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(v)) : "—";
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

type Kind = "active" | "trial" | "expiring" | "expired" | "pending" | "cancelled";
const KIND: Record<Kind, { label: string; tone: string }> = {
  active: { label: "Active", tone: "bg-emerald-100 text-emerald-700" },
  trial: { label: "Free trial", tone: "bg-sky-100 text-sky-700" },
  expiring: { label: "Expiring", tone: "bg-amber-100 text-amber-700" },
  expired: { label: "Expired", tone: "bg-red-100 text-red-700" },
  pending: { label: "Payment pending", tone: "bg-red-100 text-red-700" },
  cancelled: { label: "Cancelled", tone: "bg-zinc-100 text-zinc-600" },
};
const TABS: { value: "all" | Kind; label: string }[] = [
  { value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "trial", label: "Trial" }, { value: "expiring", label: "Expiring" },
  { value: "expired", label: "Expired" }, { value: "pending", label: "Pending" }, { value: "cancelled", label: "Cancelled" },
];
type SortKey = "newest" | "renewal" | "amount";
const SORTS: Record<SortKey, string> = { newest: "Newest first", renewal: "Renewal soonest", amount: "Highest amount" };

const nextDate = (t: AdminTenant) => (t.status === "trial" ? t.trialEndsAt : t.renewalAt);
const perMonth = (t: AdminTenant) => t.subscriptionFee?.totalPaise ?? (t.monthlyPricePaise ?? 0) * t.outletCount;

function kindOf(t: AdminTenant, now: number): Kind {
  if (t.status === "suspended" || t.status === "cancelled" || t.subscriptionStatus === "cancelled") return "cancelled";
  const end = nextDate(t);
  const days = end ? Math.ceil((new Date(end).getTime() - now) / DAY) : null;
  if (t.subscriptionStatus === "past_due") return "pending";
  if (days !== null && days < 0) return "expired";
  if (t.status === "trial") return "trial";
  if (days !== null && days <= SOON_DAYS) return "expiring";
  return "active";
}

/** "in 38 days", "3 days ago", "today" */
function when(value: string | null, now: number) {
  if (!value) return { text: "", late: false };
  const days = Math.ceil((new Date(value).getTime() - now) / DAY);
  if (days < 0) return { text: `${-days} ${-days === 1 ? "day" : "days"} ago`, late: true };
  if (days === 0) return { text: "today", late: false };
  return { text: `in ${days} ${days === 1 ? "day" : "days"}`, late: false };
}

function Stat({ icon: Icon, label, value, note, tone }: { icon: typeof FileText; label: string; value: string; note: string; tone: string }) {
  return <Card size="sm"><CardContent className="flex items-center gap-3">
    <span className="grid size-12 shrink-0 place-items-center rounded-xl" style={{ background: `${tone}1f`, color: tone }}><Icon className="size-6" aria-hidden="true" /></span>
    <div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-bold leading-tight">{value}</p><p className="truncate text-[11px] text-muted-foreground">{note}</p></div>
  </CardContent></Card>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 px-3.5 py-2 text-sm odd:bg-muted/60"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 truncate text-right font-medium">{children}</dd></div>;
}

const FEE_METHODS: Record<FeeMethod, string> = { upi: "UPI", cash: "Cash", bank: "Bank transfer" };

/** The restaurant paid its fee by hand: how many months, how much, and how */
export function FeeForm({ t, pending, onSave }: { t: AdminTenant; pending: boolean; onSave: (input: { months: number; amountRupees: number; method: FeeMethod; reference: string }) => void }) {
  const [months, setMonths] = useState(1);
  const [amount, setAmount] = useState(String(Math.round((perMonth(t) * 1) / 100)));
  const [method, setMethod] = useState<FeeMethod>("upi");
  const [reference, setReference] = useState("");
  const pickMonths = (m: number) => { setMonths(m); setAmount(String(Math.round((t.subscriptionFee ? subscriptionQuote(t.subscriptionFee.perOutletPaise,t.subscriptionFee.outletCount,m,t.subscriptionFee.addonPaise).totalPaise : perMonth(t)*m) / 100))); };
  return <div className="space-y-2 rounded-lg border p-3">
    <p className="text-sm font-semibold">Fees received</p>
    <p className="text-xs text-muted-foreground">They paid you? Save it here. The paid months start when the current period ends.</p>
    <div className="grid grid-cols-4 gap-1.5">{[1, 3, 6, 12].map((m) => <Button key={m} type="button" size="sm" variant={months === m ? "default" : "outline"} aria-pressed={months === m} onClick={() => pickMonths(m)}>{m} mo</Button>)}</div>
    <div className="grid grid-cols-2 gap-2">
      <label className="space-y-1 text-xs text-muted-foreground">Amount (₹)<Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 8))} /></label>
      <label className="space-y-1 text-xs text-muted-foreground">Paid by
        <Select value={method} onValueChange={(m) => m && setMethod(m as FeeMethod)}>
          <SelectTrigger className="w-full" aria-label="Paid by"><SelectValue>{FEE_METHODS[method]}</SelectValue></SelectTrigger>
          <SelectContent>{(Object.keys(FEE_METHODS) as FeeMethod[]).map((m) => <SelectItem key={m} value={m}>{FEE_METHODS[m]}</SelectItem>)}</SelectContent>
        </Select>
      </label>
    </div>
    <Input value={reference} onChange={(e) => setReference(e.target.value.slice(0, 60))} placeholder="UPI reference (optional)" aria-label="UPI reference" />
    <Button className="w-full" disabled={pending || amount === ""} onClick={() => onSave({ months, amountRupees: Number(amount), method, reference })}>{pending && <Loader2 className="animate-spin" />}Save payment</Button>
  </div>;
}

export function SubscriptionsView({ data }: { data: AdminData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | Kind>("all");
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const now = new Date(data.asOf).getTime();

  const rows = useMemo(() => data.tenants.map((t) => ({ t, kind: kindOf(t, now) })), [data.tenants, now]);
  const count = (k: Kind) => rows.filter((r) => r.kind === k).length;
  const activeIncome = rows.filter((r) => r.kind === "active" || r.kind === "expiring").reduce((sum, r) => sum + perMonth(r.t), 0);
  const pct = (n: number) => (rows.length ? Math.round((n / rows.length) * 100) : 0);

  const all = useMemo(() => {
    const q = query.trim().toLowerCase();
    const end = (t: AdminTenant) => new Date(nextDate(t) ?? "9999-12-31").getTime();
    return rows.filter((r) => (tab === "all" || r.kind === tab) && (plan === "all" || r.t.planCode === plan) && (!q || r.t.name.toLowerCase().includes(q) || r.t.planName.toLowerCase().includes(q)))
      .sort((a, b) => sort === "renewal" ? end(a.t) - end(b.t) : sort === "amount" ? perMonth(b.t) - perMonth(a.t) : new Date(b.t.createdAt).getTime() - new Date(a.t.createdAt).getTime());
  }, [rows, tab, query, plan, sort]);

  const pages = Math.max(1, Math.ceil(all.length / pageSize));
  const current = Math.min(page, pages - 1);
  const shown = all.slice(current * pageSize, (current + 1) * pageSize);
  const selected = (all.find((r) => r.t.id === selectedId) ?? shown[0]) ?? null;
  const filtered = !!query || tab !== "all" || plan !== "all";
  const pageIds = shown.map((r) => r.t.id);
  const allChecked = pageIds.length > 0 && pageIds.every((id) => checked.has(id));

  const toggle = (id: string) => setChecked((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setChecked((c) => { const n = new Set(c); for (const id of pageIds) { if (allChecked) n.delete(id); else n.add(id); } return n; });
  const reset = () => { setQuery(""); setTab("all"); setPlan("all"); setPage(0); };

  const run = (task: () => Promise<{ error: string | null }>, done: string) => {
    setError(null); setNotice(null);
    start(async () => { const r = await task(); if (r.error) setError(r.error); else { setNotice(done); router.refresh(); } });
  };

  const exportCsv = () => {
    const list = checked.size ? all.filter((r) => checked.has(r.t.id)) : all;
    const cell = (v: string | number) => { const t = String(v); return /[",\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t; };
    const lines = list.map(({ t, kind }) => [t.name, t.planName, Math.round(perMonth(t) / 100), t.billingCycle ?? "", t.subscriptionStart?.slice(0, 10) ?? "", nextDate(t)?.slice(0, 10) ?? "", KIND[kind].label].map(cell).join(","));
    const url = URL.createObjectURL(new Blob([["Tenant,Plan,Amount per month (INR),Billing cycle,Start date,Next renewal,Status", ...lines].join("\n")], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: "subscriptions.csv" }).click();
    URL.revokeObjectURL(url);
  };

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Subscriptions</h1><p className="mt-1 text-sm text-muted-foreground">Who is paying, how much, and when the next payment is due.</p></div>
      <Button variant="outline" onClick={exportCsv} disabled={!all.length}><Download />{checked.size ? `Export ${checked.size} selected` : "Export"}</Button>
    </div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
      <Stat icon={FileText} label="Total subscriptions" value={String(rows.length)} note={`${money(activeIncome)} / month coming in`} tone="#3d91ef" />
      <Stat icon={CircleCheck} label="Active" value={String(count("active") + count("expiring"))} note={`${pct(count("active") + count("expiring"))}% of total`} tone="#16c784" />
      <Stat icon={Clock} label="Expiring soon" value={String(count("expiring") + count("trial"))} note={`In the next ${SOON_DAYS} days or on free trial`} tone="#f08b18" />
      <Stat icon={AlertCircle} label="Expired / pending" value={String(count("expired") + count("pending"))} note={`${pct(count("expired") + count("pending"))}% of total`} tone="#ed5368" />
    </div>

    <div className="grid items-start gap-4 2xl:grid-cols-[1fr_340px] [&>*]:min-w-0">
      <Card className="min-w-0">
        <CardContent className="space-y-4">
          <Tabs value={tab} onValueChange={(v) => { setTab(v as typeof tab); setPage(0); }}>
            <TabsList variant="line" className="h-auto flex-wrap justify-start gap-x-1 gap-y-1 group-data-horizontal/tabs:h-auto [&>*]:h-8">{TABS.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label} ({t.value === "all" ? rows.length : count(t.value)})</TabsTrigger>)}</TabsList>
          </Tabs>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-44 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Search tenant or plan…" className="pl-8" aria-label="Search subscriptions" />
            </div>
            <Select value={plan} onValueChange={(v) => { if (v) { setPlan(v); setPage(0); } }}>
              <SelectTrigger aria-label="Plan filter"><SelectValue>{plan === "all" ? "All plans" : data.plans.find((p) => p.code === plan)?.name}</SelectValue></SelectTrigger>
              <SelectContent><SelectItem value="all">All plans</SelectItem>{data.plans.map((p) => <SelectItem key={p.code} value={p.code}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => v && setSort(v as SortKey)}>
              <SelectTrigger aria-label="Sort"><SelectValue>{SORTS[sort]}</SelectValue></SelectTrigger>
              <SelectContent>{(Object.keys(SORTS) as SortKey[]).map((k) => <SelectItem key={k} value={k}>{SORTS[k]}</SelectItem>)}</SelectContent>
            </Select>
            {filtered && <Button variant="ghost" size="sm" onClick={reset}><RotateCcw />Reset</Button>}
          </div>

          {shown.length ? <Table>
            <TableHeader><TableRow>
              <TableHead className="w-8"><input type="checkbox" aria-label="Select all on page" checked={allChecked} onChange={toggleAll} className="size-4 accent-[#5b42f5]" /></TableHead>
              <TableHead>Tenant</TableHead><TableHead>Plan</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="pl-6">Next renewal</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>{shown.map(({ t, kind }) => {
              const w = when(nextDate(t), now);
              return <TableRow key={t.id} data-state={selected?.t.id === t.id ? "selected" : undefined} className="cursor-pointer" onClick={() => setSelectedId(t.id)}>
                <TableCell onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${t.name}`} checked={checked.has(t.id)} onChange={() => toggle(t.id)} className="size-4 accent-[#5b42f5]" /></TableCell>
                <TableCell><div className="flex items-center gap-2.5"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#5b42f5] text-xs font-bold text-white">{initials(t.name)}</span><div className="min-w-0"><p className="truncate font-medium">{t.name}</p><p className="truncate text-xs text-muted-foreground">{t.contactEmail ?? t.contactPhone}</p></div></div></TableCell>
                <TableCell><Badge variant="secondary">{t.planName}</Badge></TableCell>
                <TableCell className="text-right"><p className="font-medium">{kind === "trial" ? "Free" : money(perMonth(t))}</p><p className="text-xs capitalize text-muted-foreground">{t.billingCycle ?? ""}</p></TableCell>
                <TableCell className="pl-6">{kind === "cancelled" ? <span className="text-muted-foreground">—</span> : <><p className="font-medium">{date(nextDate(t))}</p><p className={`text-xs ${w.late ? "text-red-600" : "text-muted-foreground"}`}>{w.late && kind !== "pending" ? "Expired " : ""}{w.text}</p></>}</TableCell>
                <TableCell><Badge variant="secondary" className={KIND[kind].tone}>{KIND[kind].label}</Badge></TableCell>
              </TableRow>;
            })}</TableBody>
          </Table> : <p className="py-14 text-center text-sm text-muted-foreground">{rows.length ? "No subscriptions match. Try another tab or search." : "No subscriptions yet. They appear when you add a tenant."}</p>}

          {all.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <p>Showing {current * pageSize + 1}–{Math.min(all.length, (current + 1) * pageSize)} of {all.length}</p>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)}><ChevronLeft /></Button>
              {Array.from({ length: pages }, (_, i) => i).filter((i) => i === 0 || i === pages - 1 || Math.abs(i - current) <= 1).map((i, idx, arr) => <span key={i} className="flex items-center gap-1">{idx > 0 && i - arr[idx - 1] > 1 && <span aria-hidden="true">…</span>}<Button variant={i === current ? "default" : "outline"} size="icon-sm" aria-current={i === current ? "page" : undefined} onClick={() => setPage(i)}>{i + 1}</Button></span>)}
              <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}><ChevronRight /></Button>
            </div>
            <label className="flex items-center gap-2">Rows
              <Select value={String(pageSize)} onValueChange={(v) => { if (v) { setPageSize(Number(v)); setPage(0); } }}>
                <SelectTrigger size="sm" aria-label="Rows per page"><SelectValue>{pageSize}</SelectValue></SelectTrigger>
                <SelectContent>{[10, 25, 50].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </label>
          </div>}
        </CardContent>
      </Card>

      <Card className="2xl:sticky 2xl:top-4">
        <CardContent className="space-y-4">
          {selected ? (() => {
            const { t, kind } = selected;
            const w = when(nextDate(t), now);
            return <>
              <div className="flex items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#5b42f5] text-sm font-bold text-white">{initials(t.name)}</span>
                <div className="min-w-0 flex-1"><p className="truncate font-semibold">{t.name}</p><p className="truncate text-xs text-muted-foreground">{t.contactEmail ?? t.contactPhone}</p></div>
                <Badge variant="secondary" className={KIND[kind].tone}>{KIND[kind].label}</Badge>
              </div>
              <dl className="overflow-hidden rounded-xl border">
                <Field label="Plan">{t.planName}</Field>
                <Field label="Subscription ID">{t.subscriptionId ? `sub_${t.subscriptionId.slice(-8)}` : "—"}</Field>
                <Field label="Amount">{kind === "trial" ? "Free trial" : `${money(perMonth(t))} / month`}</Field>
                <Field label="Outlets">{t.outletCount}{t.monthlyPricePaise ? ` × ${money(t.monthlyPricePaise)}` : ""}</Field>
                <Field label="Billing cycle"><span className="capitalize">{t.billingCycle ?? "—"}</span></Field>
                <Field label="Started">{date(t.subscriptionStart ?? t.createdAt)}</Field>
                <Field label={kind === "trial" ? "Trial ends" : "Next renewal"}>{date(nextDate(t))}{w.text ? ` (${w.text})` : ""}</Field>
              </dl>
              {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
              {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Change plan</p>
                <Select value={t.planCode} onValueChange={(v) => v && v !== t.planCode && run(() => changeTenantPlanAction(t.id, v), "Plan changed.")}>
                  <SelectTrigger className="w-full" aria-label="Change plan"><SelectValue>{t.planName}</SelectValue></SelectTrigger>
                  <SelectContent>{data.plans.map((p) => <SelectItem key={p.code} value={p.code}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
                {(kind === "trial" || kind === "expired") && t.status === "trial" && <Button className="w-full" disabled={pending} onClick={() => run(() => extendTrialAction(t.id, 7), "Trial extended by 7 days.")}>{pending && <Loader2 className="animate-spin" />}Give 7 more days</Button>}
              </div>
              <CommercialForm key={`commercial-${t.id}`} tenantId={t.id} />
              {t.status !== "cancelled" && <FeeForm key={t.id} t={t} pending={pending} onSave={(input) => run(() => recordFeePaymentAction(t.id, input), `Saved. Paid for ${input.months} ${input.months === 1 ? "month" : "months"}.`)} />}
            </>;
          })() : <p className="py-10 text-center text-sm text-muted-foreground">Select a subscription to see its details.</p>}
        </CardContent>
      </Card>
    </div>
  </div>;
}
