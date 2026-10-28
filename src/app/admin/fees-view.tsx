"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Clock, IndianRupee, Loader2, MessageCircle, Phone, Search, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { whatsAppTo } from "@/lib/support";
import type { FeesData, FeesTenant } from "@/server/fees";
import { FEATURE_LABELS } from "@/lib/plan-features";
import { confirmFeeAction, getFeesAction, markPlanRequestDoneAction, recordFeePaymentAction, rejectFeeAction } from "./actions";
import { openAdminPage } from "./admin-nav";
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

/** WhatsApp and call the restaurant's contact */
function Reach({ t, message }: { t: FeesTenant; message: string }) {
  return <>
    <a href={whatsAppTo(t.contactPhone, message)} target="_blank" rel="noopener noreferrer" className={linkBtn}><MessageCircle className="size-4" aria-hidden="true" />WhatsApp</a>
    <a href={`tel:+91${t.contactPhone.replace(/\D/g, "").slice(-10)}`} className={linkBtn}><Phone className="size-4" aria-hidden="true" />Call</a>
  </>;
}

function Stat({ icon: Icon, label, value, note, tone }: { icon: typeof IndianRupee; label: string; value: string; note: string; tone: string }) {
  return <Card size="sm"><CardContent className="flex items-center gap-3">
    <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: `${tone}1f`, color: tone }}><Icon className="size-5" aria-hidden="true" /></span>
    <div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="truncate text-2xl font-bold leading-tight">{value}</p><p className="truncate text-[11px] text-muted-foreground">{note}</p></div>
  </CardContent></Card>;
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

export function FeesView({ data }: { data: AdminData }) {
  const router = useRouter();
  const [fees, setFees] = useState<FeesData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [recording, setRecording] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pending, start] = useTransition();
  const now = new Date(data.asOf).getTime();

  const load = () => getFeesAction().then((r) => { setFees(r.data); setLoadError(r.error); });
  useEffect(() => { void load(); }, []);

  const run = (task: () => Promise<{ error: string | null }>, done: string) => {
    setNotice(null);
    start(async () => {
      const r = await task();
      if (r.error) return setNotice({ ok: false, text: r.error });
      setNotice({ ok: true, text: done });
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

  return <div className="space-y-6">
    <div>
      <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Fees</h1>
      <p className="mt-1 text-sm text-muted-foreground">What restaurants pay Tableeqr. Cashfree confirms online payments automatically; offline receipts can still be recorded here.</p>
    </div>
    {notice && <p role={notice.ok ? "status" : "alert"} className={`rounded-lg p-3 text-sm ${notice.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{notice.text}</p>}

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
      <Stat icon={IndianRupee} label="Received this month" value={money(fees.receivedThisMonthPaise)} note={`Last month ${money(fees.receivedLastMonthPaise)}`} tone="#16c784" />
      <Stat icon={Clock} label="To check" value={String(fees.claims.length + fees.requests.length)} note={`${fees.claims.length} paid · ${fees.requests.length} ${fees.requests.length === 1 ? "request" : "requests"}`} tone="#5b42f5" />
      <Stat icon={IndianRupee} label="Due this week or late" value={money(dueTotal)} note={`${fees.due.length} ${fees.due.length === 1 ? "restaurant" : "restaurants"}`} tone="#f08b18" />
      <Stat icon={XCircle} label="Paused for fees" value={String(fees.due.filter((t) => t.access.state === "blocked").length)} note="Stopped until they pay" tone="#ed5368" />
    </div>

    {/* Everything a restaurant is waiting on, first and highlighted */}
    {waitingCount === 0 ? <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-700 dark:text-emerald-300">
      <CircleCheck className="size-4" aria-hidden="true" />All caught up. No payments or requests waiting.
    </div> : <section aria-label="Waiting for you" className="rounded-2xl border border-[#5b42f5]/50 bg-[#5b42f5]/[0.06] p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="relative flex size-2.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-[#5b42f5] opacity-60" /><span className="relative inline-flex size-2.5 rounded-full bg-[#5b42f5]" /></span>
        <h2 className="text-base font-semibold">Payments and requests in progress</h2>
        <Badge className="bg-[#5b42f5] text-white">{waitingCount}</Badge>
        <p className="w-full text-sm text-muted-foreground sm:ml-2 sm:w-auto">Cashfree payments settle automatically; manual receipts and requests still need your action.</p>
      </div>
      <ul className="mt-4 space-y-3">
        {fees.claims.map((c) => <li key={c.id} className="rounded-xl border border-l-4 border-l-emerald-500 bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary" className="bg-emerald-100 text-emerald-700">Payment</Badge>{c.planCode && <Badge variant="secondary" className="bg-[#5b42f5]/15 text-[#5b42f5] dark:text-[#a99bff]">Upgrade to {data.plans.find((p) => p.code === c.planCode)?.name ?? c.planCode}</Badge>}<span className="text-xs text-muted-foreground">{ago(c.createdAt, now)}</span></div>
              <p className="text-lg font-semibold leading-tight">{c.tenant.name}</p>
              <p className="text-2xl font-bold tracking-tight">{money(c.amountPaise)} <span className="text-sm font-normal text-muted-foreground">for {c.months === 12 ? "1 year" : `${c.months} ${c.months === 1 ? "month" : "months"}`} · {METHOD[c.method]}</span></p>
              <p className="text-sm text-muted-foreground">{c.reference ? <>Ref <span className="font-mono text-foreground">{c.reference}</span></> : c.method === "cashfree" ? "Waiting for Cashfree confirmation" : "No reference given"} · started by {c.claimedBy}</p>
              <p className="text-xs text-muted-foreground">{c.tenant.planName} plan · {c.tenant.contactName} · {c.tenant.contactPhone}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {c.method === "cashfree" ? <Badge variant="secondary" className="bg-blue-100 text-blue-700">Cashfree is confirming automatically</Badge> : <>
                <Reach t={c.tenant} message={`Hi ${c.tenant.contactName}, this is Tableeqr about your ${money(c.amountPaise)} payment.`} />
                <Button variant="outline" disabled={pending} onClick={() => run(() => rejectFeeAction(c.id), "Marked not received. The owner can try again.")}>Not received</Button>
                <Button disabled={pending} className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => run(() => confirmFeeAction(c.id), `Confirmed. ${c.tenant.name} is paid for ${c.months} ${c.months === 1 ? "month" : "months"}${c.planCode ? ` and moved to ${data.plans.find((p) => p.code === c.planCode)?.name ?? c.planCode}` : ""}.`)}>{pending ? <Loader2 className="animate-spin" /> : <CircleCheck />}Confirm payment</Button>
              </>}
            </div>
          </div>
        </li>)}
        {fees.requests.map((r) => {
          const what = r.feature && r.feature in FEATURE_LABELS ? FEATURE_LABELS[r.feature as keyof typeof FEATURE_LABELS].label : r.note ?? "Plan change";
          return <li key={r.id} className="rounded-xl border border-l-4 border-l-[#5b42f5] bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary" className="bg-[#5b42f5]/15 text-[#5b42f5] dark:text-[#a99bff]">Request</Badge><span className="text-xs text-muted-foreground">{ago(r.createdAt, now)}</span></div>
                <p className="text-lg font-semibold leading-tight">{r.tenant.name}</p>
                <p className="text-base font-medium">{what}</p>
                {r.feature && r.note && <p className="text-sm text-muted-foreground">“{r.note}”</p>}
                <p className="text-xs text-muted-foreground">Asked by {r.requestedBy} · {r.tenant.planName} plan · {money(r.tenant.monthlyPaise)}/month · {r.tenant.contactName} · {r.tenant.contactPhone}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Reach t={r.tenant} message={`Hi ${r.tenant.contactName}, this is Tableeqr about your request: ${what}.`} />
                <Button variant="outline" onClick={() => openAdminPage("Tenants", r.tenant.id)}>Open restaurant</Button>
                <Button disabled={pending} onClick={() => run(() => markPlanRequestDoneAction(r.id), "Marked done.")}><CircleCheck />Done</Button>
              </div>
            </div>
          </li>;
        })}
      </ul>
    </section>}

    <Card>
      <CardHeader><CardTitle>Due this week or late</CardTitle><CardDescription>Send a reminder on WhatsApp, or record the fees when they pay you.</CardDescription></CardHeader>
      <CardContent>
        {fees.due.length ? <ul className="divide-y">{fees.due.map((t) => {
          const d = dueText(t, now);
          const admin = tenantFor(t.id);
          return <li key={t.id} className="space-y-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0"><p className="font-medium">{t.name} <span className="font-normal text-muted-foreground">· {t.planName} · {money(t.monthlyPaise)}/month</span></p><p className="text-xs text-muted-foreground">{t.contactName} · {t.contactPhone}</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className={d.tone}>{d.text}</Badge>
                <a href={whatsAppTo(t.contactPhone, reminder(t))} target="_blank" rel="noopener noreferrer" className={linkBtn}><MessageCircle className="size-4" aria-hidden="true" />WhatsApp reminder</a>
                {admin && <Button variant={recording === t.id ? "secondary" : "default"} onClick={() => setRecording(recording === t.id ? null : t.id)}>Record fees</Button>}
              </div>
            </div>
            {admin && recording === t.id && <FeeForm t={admin} pending={pending} onSave={(input) => run(() => recordFeePaymentAction(t.id, input), `Saved. ${t.name} is paid for ${input.months} ${input.months === 1 ? "month" : "months"}.`)} />}
          </li>;
        })}</ul> : <p className="py-6 text-center text-sm text-muted-foreground">No one is due this week.</p>}
      </CardContent>
    </Card>

    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div><CardTitle>All fees</CardTitle><CardDescription>Every payment confirmed or turned down</CardDescription></div>
        <div className="relative w-full sm:w-64"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search restaurant…" className="pl-8" aria-label="Search fees" /></div>
      </CardHeader>
      <CardContent>
        {history.length ? <Table><TableHeader><TableRow><TableHead>When</TableHead><TableHead>Restaurant</TableHead><TableHead>For</TableHead><TableHead>How</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Paid until</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>{history.map((h) => <TableRow key={h.id}>
            <TableCell className="whitespace-nowrap">{date(h.createdAt)}</TableCell>
            <TableCell className="font-medium">{h.tenantName}</TableCell>
            <TableCell>{h.months} {h.months === 1 ? "month" : "months"}</TableCell>
            <TableCell className="text-muted-foreground">{METHOD[h.method]}{h.reference ? ` · ${h.reference}` : ""}</TableCell>
            <TableCell className="text-right font-medium">{money(h.amountPaise)}</TableCell>
            <TableCell>{date(h.paidUntil)}</TableCell>
            <TableCell><Badge variant="secondary" className={h.status === "confirmed" ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-600"}>{h.status === "confirmed" ? "Received" : "Not received"}</Badge></TableCell>
          </TableRow>)}</TableBody></Table>
          : <p className="py-10 text-center text-sm text-muted-foreground">{fees.history.length ? "No fees match." : "No fees yet. They appear when you confirm or record one."}</p>}
      </CardContent>
    </Card>
  </div>;
}
