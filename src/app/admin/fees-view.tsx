"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Clock, IndianRupee, Loader2, MessageCircle, Search, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { whatsAppTo } from "@/lib/support";
import type { FeesData, FeesTenant } from "@/server/fees";
import { confirmFeeAction, getFeesAction, recordFeePaymentAction, rejectFeeAction } from "./actions";
import type { AdminData } from "./admin-types";
import { FeeForm } from "./subscriptions-view";

// TableQR's own income: restaurants' fees, paid by hand. Guest bill money is not shown anywhere here.

const money = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const date = (v: string | null) => (v ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(v)) : "—");
const METHOD = { upi: "UPI", cash: "Cash", bank: "Bank" } as const;

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

function reminder(t: FeesTenant, upiId: string | null) {
  const pay = upiId ? ` Please pay to UPI ${upiId}` : " Please pay TableQR";
  return `Hi ${t.contactName}, your TableQR ${t.planName} plan for ${t.name} is ${money(t.monthlyPaise)} per month and ${t.access.state === "ok" ? `is due on ${date(t.access.endsAt)}` : "is overdue"}.${pay}, then tap "I have paid" in TableQR > My plan. Thank you!`;
}

export function FeesView({ data, upiId }: { data: AdminData; upiId: string | null }) {
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
  const history = fees.history.filter((h) => !query.trim() || h.tenantName.toLowerCase().includes(query.trim().toLowerCase()));
  const tenantFor = (id: string) => data.tenants.find((t) => t.id === id);

  return <div className="space-y-6">
    <div>
      <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Fees</h1>
      <p className="mt-1 text-sm text-muted-foreground">What restaurants pay TableQR. They pay you by UPI, cash or bank; you confirm it here.</p>
    </div>
    {!upiId && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Your UPI ID is not set, so restaurants see no Pay button. Add <span className="font-mono">TABLEQR_UPI_ID</span> in hPanel → Node.js → Environment variables.</p>}
    {notice && <p role={notice.ok ? "status" : "alert"} className={`rounded-lg p-3 text-sm ${notice.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{notice.text}</p>}

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
      <Stat icon={IndianRupee} label="Received this month" value={money(fees.receivedThisMonthPaise)} note={`Last month ${money(fees.receivedLastMonthPaise)}`} tone="#16c784" />
      <Stat icon={Clock} label="To check" value={String(fees.claims.length)} note="Owners said they paid" tone="#5b42f5" />
      <Stat icon={IndianRupee} label="Due this week or late" value={money(dueTotal)} note={`${fees.due.length} ${fees.due.length === 1 ? "restaurant" : "restaurants"}`} tone="#f08b18" />
      <Stat icon={XCircle} label="Paused for fees" value={String(fees.due.filter((t) => t.access.state === "blocked").length)} note="Stopped until they pay" tone="#ed5368" />
    </div>

    <Card>
      <CardHeader><CardTitle>Check these payments</CardTitle><CardDescription>The owner tapped “I have paid”. Find the money in your bank or UPI app, then confirm.</CardDescription></CardHeader>
      <CardContent>
        {fees.claims.length ? <ul className="divide-y">{fees.claims.map((c) => <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="font-medium">{c.tenant.name} <span className="font-normal text-muted-foreground">· {money(c.amountPaise)} for {c.months} {c.months === 1 ? "month" : "months"}</span></p>
            <p className="text-xs text-muted-foreground">{METHOD[c.method]}{c.reference ? ` · Ref ${c.reference}` : ""} · {c.claimedBy} · {date(c.createdAt)}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => rejectFeeAction(c.id), "Marked not received. The owner can try again.")}>Not received</Button>
            <Button size="sm" disabled={pending} onClick={() => run(() => confirmFeeAction(c.id), `Confirmed. ${c.tenant.name} is paid for ${c.months} ${c.months === 1 ? "month" : "months"}.`)}>{pending && <Loader2 className="animate-spin" />}<CircleCheck />Confirm</Button>
          </div>
        </li>)}</ul> : <p className="py-6 text-center text-sm text-muted-foreground">Nothing to check.</p>}
      </CardContent>
    </Card>

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
                <a href={whatsAppTo(t.contactPhone, reminder(t, upiId))} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-muted"><MessageCircle className="size-4" aria-hidden="true" />WhatsApp reminder</a>
                {admin && <Button size="sm" variant={recording === t.id ? "secondary" : "default"} onClick={() => setRecording(recording === t.id ? null : t.id)}>Record fees</Button>}
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
