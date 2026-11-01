"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Clock, IndianRupee, Loader2, MessageCircle, Phone, Search, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { whatsAppTo } from "@/lib/support";
import type { FeesData, FeesTenant } from "@/server/fees";
import { FEATURE_LABELS } from "@/lib/plan-features";
import { checkFeePaymentAction, confirmFeeAction, getFeesAction, markPlanRequestDoneAction, recordFeePaymentAction, rejectFeeAction } from "./actions";
import { openAdminPage } from "./admin-nav";
import { filterChip, Kpi } from "./admin-ui";
import type { AdminData } from "./admin-types";
import { FeeForm } from "./subscriptions-view";

// Tableeqr's own income. Cashfree plan fees and admin-recorded offline receipts live here;
// restaurant guest bill money is never shown here.

const money = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const date = (v: string | null) => (v ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(v)) : "—");
const METHOD = { cashfree: "Cashfree", upi: "UPI", cash: "Cash", bank: "Bank" } as const;
/** "just now", "12 min ago", "3 h ago", "2 days ago" */
const ago = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const linkBtn = buttonVariants({ variant: "outline" });
const dated = (v: string | null, now: number) => { if (!v) return "—"; const sameYear = new Date(v).getFullYear() === new Date(now).getFullYear(); return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: sameYear ? undefined : "numeric", timeZone: "Asia/Kolkata" }).format(new Date(v)); };

/** WhatsApp and call the restaurant's contact */
function Reach({ t, message }: { t: FeesTenant; message: string }) {
  return <>
    <a href={whatsAppTo(t.contactPhone, message)} target="_blank" rel="noopener noreferrer" className={linkBtn}><MessageCircle className="size-4" aria-hidden="true" />WhatsApp</a>
    <a href={`tel:+91${t.contactPhone.replace(/\D/g, "").slice(-10)}`} className={linkBtn}><Phone className="size-4" aria-hidden="true" />Call</a>
  </>;
}

/** "Due on 20 Oct", "Ended 2 days ago · stops in 1 day", "Paused" */
function dueText(t: FeesTenant, now: number) {
  const end = t.access.endsAt ? new Date(t.access.endsAt).getTime() : now;
  const days = Math.ceil((end - now) / 86_400_000);
  const what = t.access.reason === "trial" ? "Trial" : "Plan";
  if (t.access.state === "blocked") return { text: `${what} ended ${date(t.access.endsAt)} · paused`, tone: "bg-red-100 text-red-700" };
  if (t.access.state === "grace") return { text: `${what} ended ${date(t.access.endsAt)} · stops soon`, tone: "bg-red-100 text-red-700" };
  return { text: `${what} ends ${days <= 0 ? "today" : `in ${days} ${days === 1 ? "day" : "days"}`}`, tone: "bg-amber-100 text-amber-700" };
}

function reminder(t: FeesTenant) {
  return `Hi ${t.contactName}, your Tableeqr ${t.planName} plan for ${t.name} is ${money(t.monthlyPaise)} per month and ${t.access.state === "ok" ? `is due on ${date(t.access.endsAt)}` : "is overdue"}. Please open Tableeqr > My plan and pay securely through Cashfree. Thank you!`;
}

type Tab = "check" | "due" | "all";

export function FeesView({ data, preview }: { data: AdminData; /** Sample fees for the design preview */ preview?: FeesData }) {
  const router = useRouter();
  const [fees, setFees] = useState<FeesData | null>(preview ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [recording, setRecording] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Tab | null>(null);
  const [pending, start] = useTransition();
  const now = new Date(data.asOf).getTime();

  const load = () => getFeesAction().then((r) => { setFees(r.data); setLoadError(r.error); });
  // The admin refreshes every minute; asOf changes with it, so new payments show here too
  useEffect(() => { if (!preview) void load(); }, [data.asOf, preview]);

  const run = (task: () => Promise<{ error: string | null; message?: string }>, done: string) => {
    setNotice(null);
    start(async () => {
      const r = await task();
      if (r.error) return setNotice({ ok: false, text: r.error });
      setNotice({ ok: true, text: r.message ?? done });
      setRecording(null);
      await load();
      router.refresh();
    });
  };

  if (!fees) return <div className="grid min-h-[50vh] place-items-center text-sm text-muted-foreground">{loadError ?? <Loader2 className="size-5 animate-spin" aria-label="Loading" />}</div>;

  const dueTotal = fees.due.reduce((n, t) => n + t.monthlyPaise, 0);
  const waitingCount = fees.claims.length + fees.requests.length;
  const history = fees.history.filter((h) => !query.trim() || h.tenantName.toLowerCase().includes(query.trim().toLowerCase()));
  const tenantFor = (id: string) => data.tenants.find((t) => t.id === id);
  // Open on whatever needs the admin first; an emptied list falls through to the next
  const tab: Tab = picked && !(picked === "check" && !waitingCount) ? picked : waitingCount ? "check" : fees.due.length ? "due" : "all";
  const tabs: { key: Tab; label: string; count: number }[] = [{ key: "check", label: "To check", count: waitingCount }, { key: "due", label: "Due", count: fees.due.length }, { key: "all", label: "All fees", count: fees.history.length }];
  const planName = (code: string) => data.plans.find((p) => p.code === code)?.name ?? code;
  const months = (n: number) => (n === 12 ? "1 year" : `${n} ${n === 1 ? "month" : "months"}`);
  const sure = (question: string, go: () => void) => { if (window.confirm(question)) go(); };

  return <div className="space-y-4">
    <div className="md:pr-44">
      <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Fees</h1>
      <p className="mt-1 text-sm text-muted-foreground">What tenants pay Tableeqr.</p>
    </div>
    {notice && <p role={notice.ok ? "status" : "alert"} className={`rounded-lg p-3 text-sm ${notice.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{notice.text}</p>}

    <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
      <Kpi icon={IndianRupee} label="Received this month" value={money(fees.receivedThisMonthPaise)} hint={`Last month ${money(fees.receivedLastMonthPaise)}`} />
      <Kpi icon={Clock} label="To check" value={String(waitingCount)} hint={`${fees.claims.length} ${fees.claims.length === 1 ? "payment" : "payments"} · ${fees.requests.length} ${fees.requests.length === 1 ? "request" : "requests"}`} />
      <Kpi icon={IndianRupee} label="Due this week or late" value={money(dueTotal)} hint={`${fees.due.length} ${fees.due.length === 1 ? "tenant" : "tenants"}`} />
      <Kpi icon={XCircle} label="Paused for fees" value={String(fees.due.filter((t) => t.access.state === "blocked").length)} hint="Stopped until they pay" />
    </div>

    <div role="group" aria-label="Show" className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      {tabs.map((o) => <button key={o.key} type="button" aria-pressed={tab === o.key} onClick={() => setPicked(o.key)} className={filterChip(tab === o.key)}>{o.label} {o.count}</button>)}
    </div>

    {tab === "check" && <ul className="space-y-2">
      {fees.claims.map((c) => <li key={c.id} className="rounded-2xl border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="truncate font-semibold">{c.tenant.name}</p>
            <p className="text-xs text-muted-foreground">{ago(c.createdAt, now)} · {METHOD[c.method]} · {c.tenant.contactPhone}</p>
          </div>
          <p className="shrink-0 text-right"><span className="block font-display text-xl font-bold tabular-nums">{money(c.amountPaise)}</span><span className="block text-xs text-muted-foreground">for {months(c.months)}</span></p>
        </div>
        {c.planCode && <Badge variant="secondary" className="mt-2 bg-sky-100 text-sky-700">Upgrade to {planName(c.planCode)}</Badge>}
        <p className="mt-2 break-words text-xs text-muted-foreground">{c.reference ? <>Ref <span className="font-mono text-foreground">{c.reference}</span></> : c.method === "cashfree" ? "Waiting for Cashfree to confirm" : "No reference given"} · started by {c.claimedBy}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          {c.method === "cashfree" ? <>
            <Button variant="outline" className="col-span-2" disabled={pending} onClick={() => run(() => checkFeePaymentAction(c.id), "Payment status checked.")}>{pending ? <Loader2 className="animate-spin" /> : <Search />}Check payment now</Button>
            <Button variant="outline" disabled={pending} onClick={() => sure(`Mark ${money(c.amountPaise)} from ${c.tenant.name} as declined?`, () => run(() => rejectFeeAction(c.id), "Payment marked declined."))}><XCircle />Declined</Button>
            <Button disabled={pending} onClick={() => sure(`You checked in Cashfree or your bank that ${money(c.amountPaise)} from ${c.tenant.name} arrived?`, () => run(() => confirmFeeAction(c.id), `Payment marked received. ${c.tenant.name}'s plan has been updated.`))}><CircleCheck />Received</Button>
          </> : <>
            <Reach t={c.tenant} message={`Hi ${c.tenant.contactName}, this is Tableeqr about your ${money(c.amountPaise)} payment.`} />
            <Button variant="outline" disabled={pending} onClick={() => sure(`Mark ${money(c.amountPaise)} from ${c.tenant.name} as not received?`, () => run(() => rejectFeeAction(c.id), "Marked not received. The owner can try again."))}>Not received</Button>
            <Button disabled={pending} onClick={() => sure(`You checked that ${money(c.amountPaise)} from ${c.tenant.name} arrived?`, () => run(() => confirmFeeAction(c.id), `Confirmed. ${c.tenant.name} is paid for ${months(c.months)}${c.planCode ? ` and moved to ${planName(c.planCode)}` : ""}.`))}>{pending ? <Loader2 className="animate-spin" /> : <CircleCheck />}Confirm</Button>
          </>}
        </div>
      </li>)}
      {fees.requests.map((r) => {
        const what = r.feature && r.feature in FEATURE_LABELS ? FEATURE_LABELS[r.feature as keyof typeof FEATURE_LABELS].label : r.note ?? "Plan change";
        return <li key={r.id} className="rounded-2xl border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold">{r.tenant.name}</p>
              <p className="text-xs text-muted-foreground">{ago(r.createdAt, now)} · asked by {r.requestedBy} · {r.tenant.contactPhone}</p>
            </div>
            <Badge variant="secondary" className="shrink-0 bg-amber-100 text-amber-700">Request</Badge>
          </div>
          <p className="mt-2 text-sm font-semibold">{what}</p>
          {r.feature && r.note && <p className="text-sm text-muted-foreground">“{r.note}”</p>}
          <p className="mt-1 text-xs text-muted-foreground">Now on {r.tenant.planName} · {money(r.tenant.monthlyPaise)} a month</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <Reach t={r.tenant} message={`Hi ${r.tenant.contactName}, this is Tableeqr about your request: ${what}.`} />
            <Button variant="outline" onClick={() => openAdminPage("Tenants", r.tenant.id)}>Open tenant</Button>
            <Button disabled={pending} onClick={() => run(() => markPlanRequestDoneAction(r.id), "Marked done.")}><CircleCheck />Done</Button>
          </div>
        </li>;
      })}
    </ul>}

    {tab === "due" && (fees.due.length ? <ul className="space-y-2">{fees.due.map((t) => {
      const d = dueText(t, now);
      const admin = tenantFor(t.id);
      return <li key={t.id} className="rounded-2xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="min-w-0"><p className="truncate font-semibold">{t.name}</p><p className="text-xs text-muted-foreground">{t.planName} · {money(t.monthlyPaise)} a month · {t.contactPhone}</p><Badge variant="secondary" className={`mt-1.5 ${d.tone}`}>{d.text}</Badge></div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <a href={whatsAppTo(t.contactPhone, reminder(t))} target="_blank" rel="noopener noreferrer" className={linkBtn}><MessageCircle className="size-4" aria-hidden="true" />Remind</a>
            {admin && <Button variant={recording === t.id ? "secondary" : "default"} aria-expanded={recording === t.id} onClick={() => setRecording(recording === t.id ? null : t.id)}>Record fees</Button>}
          </div>
        </div>
        {admin && recording === t.id && <div className="mt-3 border-t pt-3"><FeeForm t={admin} pending={pending} onSave={(input) => run(() => recordFeePaymentAction(t.id, input), `Saved. ${t.name} is paid for ${months(input.months)}.`)} /></div>}
      </li>;
    })}</ul> : <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No one is due this week.</CardContent></Card>)}

    {tab === "all" && <Card>
      <CardContent className="space-y-3">
        <div className="relative"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tenant" className="pl-8" aria-label="Search fees" /></div>
        {history.length ? <>
          <ul className="divide-y lg:hidden">{history.map((h) => <li key={h.id} className="py-3">
            <div className="flex items-baseline justify-between gap-3"><p className="min-w-0 truncate text-sm font-semibold">{h.tenantName}</p><p className="shrink-0 text-sm font-semibold tabular-nums">{money(h.amountPaise)}</p></div>
            <p className="truncate text-xs text-muted-foreground">{dated(h.createdAt, now)} · {months(h.months)} · {METHOD[h.method]}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2"><Badge variant="secondary" className={h.status === "confirmed" ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-600"}>{h.status === "confirmed" ? "Received" : "Not received"}</Badge>{h.paidUntil && <span className="text-xs text-muted-foreground">Paid until {dated(h.paidUntil, now)}</span>}</div>
          </li>)}</ul>
          <div className="hidden lg:block"><Table><TableHeader><TableRow><TableHead>When</TableHead><TableHead>Tenant</TableHead><TableHead>For</TableHead><TableHead>How</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="pl-6">Paid until</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>{history.map((h) => <TableRow key={h.id}>
              <TableCell className="whitespace-nowrap">{dated(h.createdAt, now)}</TableCell>
              <TableCell className="max-w-64 truncate font-semibold">{h.tenantName}</TableCell>
              <TableCell>{months(h.months)}</TableCell>
              <TableCell className="max-w-56 truncate text-muted-foreground" title={h.reference ?? undefined}>{METHOD[h.method]}{h.reference ? ` · ${h.reference}` : ""}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{money(h.amountPaise)}</TableCell>
              <TableCell className="pl-6">{dated(h.paidUntil, now)}</TableCell>
              <TableCell><Badge variant="secondary" className={h.status === "confirmed" ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-600"}>{h.status === "confirmed" ? "Received" : "Not received"}</Badge></TableCell>
            </TableRow>)}</TableBody></Table></div>
        </> : <p className="py-10 text-center text-sm text-muted-foreground">{fees.history.length ? "No fees match." : "No fees yet. They appear when you confirm or record one."}</p>}
      </CardContent>
    </Card>}
  </div>;
}
