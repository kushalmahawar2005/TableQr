"use client";

import { subscriptionQuote } from "@/lib/subscription-pricing";
import { CommercialForm } from "./commercial-form";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowUpRight, ChevronLeft, ChevronRight, CircleCheck, Clock, Download, IndianRupee, Loader2, RotateCcw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { changeTenantPlanAction, extendTrialAction, recordFeePaymentAction, type FeeMethod } from "./actions";
import type { AdminData, AdminTenant } from "./admin-types";
import { openAdminPage } from "./admin-nav";
import { csvCell, filterChip, Kpi, ManageRow } from "./admin-ui";

const DAY = 86_400_000;
const SOON_DAYS = 14;
const money = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const date = (v: string | null) => v ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(v)) : "—";

type Kind = "active" | "trial" | "expiring" | "expired" | "pending" | "cancelled";
const KIND: Record<Kind, { label: string; tone: string }> = {
  active: { label: "Active", tone: "bg-emerald-100 text-emerald-700" },
  trial: { label: "Free trial", tone: "bg-sky-100 text-sky-700" },
  expiring: { label: "Ending soon", tone: "bg-amber-100 text-amber-700" },
  expired: { label: "Expired", tone: "bg-red-100 text-red-700" },
  pending: { label: "Payment pending", tone: "bg-red-100 text-red-700" },
  cancelled: { label: "Cancelled", tone: "bg-zinc-100 text-zinc-600" },
};
const TABS: { value: "all" | Kind; label: string }[] = [
  { value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "trial", label: "Free trial" }, { value: "expiring", label: "Ending soon" },
  { value: "expired", label: "Expired" }, { value: "pending", label: "Payment pending" }, { value: "cancelled", label: "Cancelled" },
];
type SortKey = "newest" | "renewal" | "amount";
const SORTS: Record<SortKey, string> = { newest: "Newest first", renewal: "Next payment first", amount: "Highest amount" };

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 py-1.5 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 truncate text-right font-medium">{children}</dd></div>;
}

const FEE_METHODS: Record<FeeMethod, string> = { upi: "UPI", cash: "Cash", bank: "Bank transfer" };

/** The restaurant paid its fee by hand: how many months, how much, and how */
export function FeeForm({ t, pending, onSave }: { t: AdminTenant; pending: boolean; onSave: (input: { months: number; amountRupees: number; method: FeeMethod; reference: string }) => void }) {
  const [months, setMonths] = useState(1);
  const [amount, setAmount] = useState(String(Math.round((perMonth(t) * 1) / 100)));
  const [method, setMethod] = useState<FeeMethod>("upi");
  const [reference, setReference] = useState("");
  const pickMonths = (m: number) => { setMonths(m); setAmount(String(Math.round((t.subscriptionFee ? subscriptionQuote(t.subscriptionFee.perOutletPaise,t.subscriptionFee.outletCount,m,t.subscriptionFee.addonPaise).totalPaise : perMonth(t)*m) / 100))); };
  return <div className="space-y-2">
    <p className="text-sm font-semibold">Fees received</p>
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

/** Everything about one subscription: what they pay, then the actions, opened one at a time */
function SubscriptionSheet({ row, plans, now, onClose }: { row: { t: AdminTenant; kind: Kind } | null; plans: AdminData["plans"]; now: number; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>("payment");
  const toggle = (name: string) => setOpen((current) => (current === name ? null : name));
  const run = (task: () => Promise<{ error: string | null }>, done: string) => {
    setError(null); setNotice(null);
    start(async () => { const r = await task(); if (r.error) setError(r.error); else { setNotice(done); router.refresh(); } });
  };
  const t = row?.t, kind = row?.kind;
  const w = t ? when(nextDate(t), now) : null;
  return <Sheet open={!!row} onOpenChange={(next) => { if (!next) onClose(); }}>
    <SheetContent className="w-full gap-0 overflow-y-auto bg-[var(--admin-bg)] data-[side=right]:sm:max-w-xl">
      {t && kind && w && <>
        <SheetHeader className="border-b bg-white p-4 sm:p-5">
          <SheetTitle className="flex flex-wrap items-center gap-2 pr-8 text-lg">{t.name}<Badge variant="secondary" className={KIND[kind].tone}>{KIND[kind].label}</Badge></SheetTitle>
          <SheetDescription className="truncate">{t.contactEmail ?? t.contactPhone}</SheetDescription>
        </SheetHeader>
        <div className="space-y-2 p-3 sm:p-4">
          {error && <p role="alert" className="sticky top-0 z-10 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {notice && <p role="status" className="sticky top-0 z-10 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
          <div className="grid grid-cols-2 gap-2">
            <div className="min-w-0 rounded-xl border bg-card p-3"><p className="text-[11px] text-muted-foreground">A month</p><p className="mt-1 truncate text-lg font-bold tabular-nums">{kind === "trial" ? "Free" : money(perMonth(t))}</p></div>
            <div className="min-w-0 rounded-xl border bg-card p-3"><p className="text-[11px] text-muted-foreground">{kind === "trial" ? "Trial ends" : "Next payment"}</p><p className="mt-1 truncate text-lg font-bold">{kind === "cancelled" ? "—" : date(nextDate(t))}</p><p className={`truncate text-[11px] ${w.late ? "text-red-600" : "text-muted-foreground"}`}>{kind === "cancelled" ? "" : w.text}</p></div>
          </div>
          {t.status !== "cancelled" && <ManageRow title="Record a payment" note="They paid you? Save it here" open={open === "payment"} onToggle={() => toggle("payment")}>
            <FeeForm t={t} pending={pending} onSave={(input) => run(() => recordFeePaymentAction(t.id, input), `Saved. Paid for ${input.months} ${input.months === 1 ? "month" : "months"}.`)} />
            <p className="text-xs text-muted-foreground">The paid months start when the current period ends.</p>
          </ManageRow>}
          <ManageRow title="Plan" note={t.planName} open={open === "plan"} onToggle={() => toggle("plan")}>
            <Select value={t.planCode} onValueChange={(v) => v && v !== t.planCode && run(() => changeTenantPlanAction(t.id, v), "Plan changed.")}>
              <SelectTrigger className="w-full" aria-label="Change plan"><SelectValue>{t.planName}</SelectValue></SelectTrigger>
              <SelectContent>{plans.map((p) => <SelectItem key={p.code} value={p.code}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
            {(kind === "trial" || kind === "expired") && t.status === "trial" && <Button variant="outline" className="w-full" disabled={pending} onClick={() => run(() => extendTrialAction(t.id, 7), "Trial extended by 7 days.")}>{pending && <Loader2 className="animate-spin" />}Give 7 more days</Button>}
          </ManageRow>
          <ManageRow title="Setup and add-ons" note="Category, outlets, add-ons, setup fee" open={open === "setup"} onToggle={() => toggle("setup")}>
            <CommercialForm tenantId={t.id} />
          </ManageRow>
          <ManageRow title="Details" note={t.subscriptionId ? `sub_${t.subscriptionId.slice(-8)}` : "No subscription ID yet"} open={open === "details"} onToggle={() => toggle("details")}>
            <dl className="divide-y">
              <Field label="Subscription ID">{t.subscriptionId ? `sub_${t.subscriptionId.slice(-8)}` : "—"}</Field>
              <Field label="Outlets">{t.outletCount}{t.monthlyPricePaise ? ` × ${money(t.monthlyPricePaise)}` : ""}</Field>
              <Field label="Billing cycle"><span className="capitalize">{t.billingCycle ?? "—"}</span></Field>
              <Field label="Started">{date(t.subscriptionStart ?? t.createdAt)}</Field>
            </dl>
          </ManageRow>
          <Button variant="ghost" className="w-full" onClick={() => { onClose(); openAdminPage("Tenants", t.id); }}>Open tenant<ArrowUpRight /></Button>
        </div>
      </>}
    </SheetContent>
  </Sheet>;
}

export function SubscriptionsView({ data }: { data: AdminData }) {
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
  const selected = rows.find((r) => r.t.id === selectedId) ?? null;
  const filtered = !!query || tab !== "all" || plan !== "all";
  const pageIds = shown.map((r) => r.t.id);
  const allChecked = pageIds.length > 0 && pageIds.every((id) => checked.has(id));

  const toggle = (id: string) => setChecked((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setChecked((c) => { const n = new Set(c); for (const id of pageIds) { if (allChecked) n.delete(id); else n.add(id); } return n; });
  const reset = () => { setQuery(""); setTab("all"); setPlan("all"); setPage(0); };

  const exportCsv = () => {
    const list = checked.size ? all.filter((r) => checked.has(r.t.id)) : all;
    const lines = list.map(({ t, kind }) => [t.name, t.planName, Math.round(perMonth(t) / 100), t.billingCycle ?? "", t.subscriptionStart?.slice(0, 10) ?? "", nextDate(t)?.slice(0, 10) ?? "", KIND[kind].label].map(csvCell).join(","));
    const url = URL.createObjectURL(new Blob([["Tenant,Plan,Amount per month (INR),Billing cycle,Start date,Next renewal,Status", ...lines].join("\n")], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: "subscriptions.csv" }).click();
    URL.revokeObjectURL(url);
  };

  return <div className="space-y-4">
    <div className="md:pr-44"><h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Subscriptions</h1><p className="mt-1 text-sm text-muted-foreground">Who is paying, how much, and when the next payment is due.</p></div>

    <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
      <Kpi icon={IndianRupee} label="Coming in a month" value={money(activeIncome)} hint={`${rows.length} subscriptions`} />
      <Kpi icon={CircleCheck} label="Active" value={String(count("active") + count("expiring"))} hint={`${pct(count("active") + count("expiring"))}% of total`} />
      <Kpi icon={Clock} label="Ending soon" value={String(count("expiring") + count("trial"))} hint={`Within ${SOON_DAYS} days or on trial`} />
      <Kpi icon={AlertCircle} label="Need action" value={String(count("expired") + count("pending"))} hint="Expired or payment pending" />
    </div>

    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Status" className="no-scrollbar -mx-4 flex min-w-0 flex-1 basis-full gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:basis-0 sm:px-0">
        {TABS.filter((o) => o.value === "all" || o.value === tab || count(o.value) > 0).map((o) => <button key={o.value} type="button" aria-pressed={tab === o.value} onClick={() => { setTab(o.value); setPage(0); }} className={filterChip(tab === o.value)}>{o.label} {o.value === "all" ? rows.length : count(o.value)}</button>)}
      </div>
      <Button variant="outline" className="w-full sm:w-auto" onClick={exportCsv} disabled={!all.length}><Download />{checked.size ? `Export ${checked.size}` : "Export"}</Button>
    </div>

    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full lg:w-auto lg:min-w-64 lg:flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Search tenant or plan" className="pl-8" aria-label="Search subscriptions" />
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto [&_[data-slot=select-trigger]]:w-full sm:[&_[data-slot=select-trigger]]:w-auto">
            <Select value={plan} onValueChange={(v) => { if (v) { setPlan(v); setPage(0); } }}>
              <SelectTrigger aria-label="Plan filter"><SelectValue>{plan === "all" ? "All plans" : data.plans.find((p) => p.code === plan)?.name}</SelectValue></SelectTrigger>
              <SelectContent><SelectItem value="all">All plans</SelectItem>{data.plans.map((p) => <SelectItem key={p.code} value={p.code}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => v && setSort(v as SortKey)}>
              <SelectTrigger aria-label="Sort"><SelectValue>{SORTS[sort]}</SelectValue></SelectTrigger>
              <SelectContent>{(Object.keys(SORTS) as SortKey[]).map((k) => <SelectItem key={k} value={k}>{SORTS[k]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {filtered && <Button variant="ghost" size="sm" onClick={reset}><RotateCcw />Reset</Button>}
        </div>

        {shown.length ? <>
          <ul className="divide-y lg:hidden">{shown.map(({ t, kind }) => {
            const w = when(nextDate(t), now);
            return <li key={t.id} className="flex items-start gap-3 py-3">
              <input type="checkbox" aria-label={`Select ${t.name}`} checked={checked.has(t.id)} onChange={() => toggle(t.id)} className="mt-1 size-4 shrink-0 accent-[var(--admin-brand)]" />
              <button type="button" onClick={() => setSelectedId(t.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-[var(--admin-brand)]">
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2"><span className="truncate text-sm font-semibold">{t.name}</span><span className="shrink-0 text-sm font-semibold tabular-nums">{kind === "trial" ? "Free" : money(perMonth(t))}</span></span>
                  <span className="block truncate text-xs text-muted-foreground">{t.planName}{kind === "cancelled" ? "" : ` · ${kind === "trial" ? "Trial ends" : "Next payment"} ${date(nextDate(t))}`}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5"><Badge variant="secondary" className={KIND[kind].tone}>{KIND[kind].label}</Badge>{kind !== "cancelled" && w.text && <span className={`text-xs ${w.late ? "text-red-600" : "text-muted-foreground"}`}>{w.text}</span>}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>;
          })}</ul>
          <div className="hidden lg:block"><Table>
            <TableHeader><TableRow>
              <TableHead className="w-8"><input type="checkbox" aria-label="Select all on page" checked={allChecked} onChange={toggleAll} className="size-4 accent-[var(--admin-brand)]" /></TableHead>
              <TableHead>Tenant</TableHead><TableHead>Plan</TableHead><TableHead className="text-right">A month</TableHead><TableHead className="pl-6">Next payment</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Open</span></TableHead>
            </TableRow></TableHeader>
            <TableBody>{shown.map(({ t, kind }) => {
              const w = when(nextDate(t), now);
              return <TableRow key={t.id} className="cursor-pointer" onClick={() => setSelectedId(t.id)}>
                <TableCell onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${t.name}`} checked={checked.has(t.id)} onChange={() => toggle(t.id)} className="size-4 accent-[var(--admin-brand)]" /></TableCell>
                <TableCell className="max-w-72"><p className="truncate font-semibold">{t.name}</p><p className="truncate text-xs text-muted-foreground">{t.contactEmail ?? t.contactPhone}</p></TableCell>
                <TableCell><Badge variant="secondary">{t.planName}</Badge></TableCell>
                <TableCell className="text-right"><p className="font-semibold tabular-nums">{kind === "trial" ? "Free" : money(perMonth(t))}</p><p className="text-xs capitalize text-muted-foreground">{t.billingCycle ?? ""}</p></TableCell>
                <TableCell className="pl-6">{kind === "cancelled" ? <span className="text-muted-foreground">—</span> : <><p className="font-medium">{date(nextDate(t))}</p><p className={`text-xs ${w.late ? "text-red-600" : "text-muted-foreground"}`}>{w.late && kind !== "pending" ? "Expired " : ""}{w.text}</p></>}</TableCell>
                <TableCell><Badge variant="secondary" className={KIND[kind].tone}>{KIND[kind].label}</Badge></TableCell>
                <TableCell className="w-8 text-right"><button type="button" aria-label={`Open ${t.name}`} onClick={(e) => { e.stopPropagation(); setSelectedId(t.id); }} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--admin-brand)]"><ChevronRight className="size-4" /></button></TableCell>
              </TableRow>;
            })}</TableBody>
          </Table></div>
        </> : <p className="py-14 text-center text-sm text-muted-foreground">{rows.length ? "No subscriptions match. Try another search." : "No subscriptions yet. They appear when you add a tenant."}</p>}

        {all.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <p>{current * pageSize + 1}–{Math.min(all.length, (current + 1) * pageSize)} of {all.length}</p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)}><ChevronLeft /></Button>
            {Array.from({ length: pages }, (_, i) => i).filter((i) => i === 0 || i === pages - 1 || Math.abs(i - current) <= 1).map((i, idx, arr) => <span key={i} className="flex items-center gap-1">{idx > 0 && i - arr[idx - 1] > 1 && <span aria-hidden="true">…</span>}<Button variant={i === current ? "default" : "outline"} size="icon-sm" aria-current={i === current ? "page" : undefined} onClick={() => setPage(i)}>{i + 1}</Button></span>)}
            <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}><ChevronRight /></Button>
          </div>
          <label className="hidden items-center gap-2 sm:flex">Rows per page
            <Select value={String(pageSize)} onValueChange={(v) => { if (v) { setPageSize(Number(v)); setPage(0); } }}>
              <SelectTrigger size="sm" aria-label="Rows per page"><SelectValue>{pageSize}</SelectValue></SelectTrigger>
              <SelectContent>{[10, 25, 50].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
            </Select>
          </label>
        </div>}
      </CardContent>
    </Card>

    <SubscriptionSheet key={selectedId ?? "closed"} row={selected} plans={data.plans} now={now} onClose={() => setSelectedId(null)} />
  </div>;
}
