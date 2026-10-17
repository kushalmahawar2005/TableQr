"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Info, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAuditAction } from "./actions";
import type { AuditData, AuditEntry } from "./admin-types";

const PAGE = 15;
const when = (v: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(v));

type Who = "admin" | "staff" | "guest" | "system";
const whoOf = (e: AuditEntry): Who => (e.actorLabel.startsWith("admin:") ? "admin" : e.actorLabel.startsWith("guest:") ? "guest" : e.actorLabel.startsWith("system") ? "system" : "staff");
const WHO: Record<Who, { label: string; tone: string }> = {
  admin: { label: "You / admin team", tone: "bg-indigo-100 text-indigo-700" },
  staff: { label: "Restaurant staff", tone: "bg-emerald-100 text-emerald-700" },
  guest: { label: "Guest", tone: "bg-amber-100 text-amber-700" },
  system: { label: "System", tone: "bg-zinc-100 text-zinc-600" },
};
const ACTIONS: Record<string, string> = {
  "admin.tenant_created": "Tenant created", "admin.tenant_edited": "Tenant details edited", "admin.tenant_suspended": "Tenant suspended", "admin.tenant_activated": "Tenant activated",
  "admin.plan_changed": "Plan changed", "admin.trial_extended": "Trial extended", "admin.fee_received": "Fees received", "admin.owner_pin_reset": "Owner PIN reset",
};
const nice = (a: string) => ACTIONS[a] ?? a.replace(/^admin\./, "").replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());
const actor = (e: AuditEntry) => {
  const l = e.actorLabel;
  if (l.startsWith("kds:")) return `Kitchen display (${l.split(":")[1] || "main"})`;
  return l.replace(/^(admin|staff|guest):/, "");
};
const hasData = (v: unknown) => v !== null && v !== undefined && !(typeof v === "object" && Object.keys(v as object).length === 0);
const show = (v: unknown) => JSON.stringify(v, null, 2);

function Loaded({ data }: { data: AuditData }) {
  const [tab, setTab] = useState<"all" | Who>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  const count = (w: Who) => data.entries.filter((e) => whoOf(e) === w).length;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.entries.filter((e) => (tab === "all" || whoOf(e) === tab) && (!q || e.tenantName.toLowerCase().includes(q) || nice(e.action).toLowerCase().includes(q) || e.actorLabel.toLowerCase().includes(q) || (e.reason ?? "").toLowerCase().includes(q)));
  }, [data.entries, tab, query]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages - 1);
  const shown = rows.slice(current * PAGE, (current + 1) * PAGE);

  return <Card><CardContent className="space-y-4">
    <Tabs value={tab} onValueChange={(v) => { setTab(v as typeof tab); setPage(0); }}>
      <TabsList variant="line" className="h-auto flex-wrap justify-start gap-x-1 gap-y-1 group-data-horizontal/tabs:h-auto [&>*]:h-8">
        <TabsTrigger value="all">All ({data.entries.length})</TabsTrigger><TabsTrigger value="admin">Admin changes ({count("admin")})</TabsTrigger>
        <TabsTrigger value="staff">Restaurant staff ({count("staff")})</TabsTrigger><TabsTrigger value="guest">Guests ({count("guest")})</TabsTrigger><TabsTrigger value="system">System ({count("system")})</TabsTrigger>
      </TabsList>
    </Tabs>
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Search tenant, action or person…" className="pl-8" aria-label="Search audit log" />
    </div>
    {shown.length ? <Table>
      <TableHeader><TableRow><TableHead className="w-8" /><TableHead>When</TableHead><TableHead>What happened</TableHead><TableHead>Tenant</TableHead><TableHead>Done by</TableHead></TableRow></TableHeader>
      <TableBody>{shown.map((e) => {
        const expandable = hasData(e.before) || hasData(e.after);
        const isOpen = open === e.id;
        return <Fragment key={e.id}>
          <TableRow className={expandable ? "cursor-pointer" : undefined} onClick={() => expandable && setOpen(isOpen ? null : e.id)}>
            <TableCell>{expandable && (isOpen ? <ChevronDown className="size-4 text-muted-foreground" aria-label="Hide details" /> : <ChevronRight className="size-4 text-muted-foreground" aria-label="Show details" />)}</TableCell>
            <TableCell className="whitespace-nowrap text-muted-foreground">{when(e.createdAt)}</TableCell>
            <TableCell><p className="font-medium">{nice(e.action)}</p>{e.reason && <p className="text-xs text-muted-foreground">{e.reason}</p>}</TableCell>
            <TableCell>{e.tenantName}</TableCell>
            <TableCell><p className="text-sm">{actor(e)}</p><Badge variant="secondary" className={`mt-0.5 ${WHO[whoOf(e)].tone}`}>{WHO[whoOf(e)].label}</Badge></TableCell>
          </TableRow>
          {isOpen && <TableRow className="bg-muted/40 hover:bg-muted/40"><TableCell /><TableCell colSpan={4}>
            <div className="grid gap-3 sm:grid-cols-2">
              {([["Before", e.before], ["After", e.after]] as const).map(([label, v]) => <div key={label}><p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>{hasData(v) ? <pre className="max-h-48 overflow-auto rounded-lg border bg-white p-2 text-xs">{show(v)}</pre> : <p className="text-xs text-muted-foreground">—</p>}</div>)}
            </div>
          </TableCell></TableRow>}
        </Fragment>;
      })}</TableBody>
    </Table> : <p className="py-14 text-center text-sm text-muted-foreground">{data.entries.length ? "Nothing matches. Try another tab or search." : "No activity recorded yet. Changes you make to tenants will show up here."}</p>}
    {rows.length > PAGE && <div className="flex items-center justify-between text-sm text-muted-foreground">
      <p>{current * PAGE + 1}–{Math.min(rows.length, (current + 1) * PAGE)} of {rows.length}</p>
      <div className="flex gap-2"><Button variant="outline" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</Button></div>
    </div>}
    {data.truncated && <p className="text-xs text-muted-foreground">Showing the latest 500 entries.</p>}
  </CardContent></Card>;
}

export function AuditView() {
  const [state, setState] = useState<{ data: AuditData | null; error: string | null } | null>(null);
  useEffect(() => { let off = false; getAuditAction().then((r) => { if (!off) setState(r); }); return () => { off = true; }; }, []);
  return <div className="space-y-6">
    <div><h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Audit Logs</h1><p className="mt-1 text-sm text-muted-foreground">Who changed what, and when. Last 90 days.</p></div>
    <p className="flex items-start gap-2 rounded-lg border bg-white p-3 text-sm text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Your changes to tenants (suspend, plan, trial, edits, PIN resets) are recorded here from now on, along with what restaurant staff do (refunds, discounts, voids). PIN values are never stored. Plan and pricing edits are not logged yet.</p>
    {!state ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading audit log…</p>
      : state.error || !state.data ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error ?? "Audit log could not be loaded."}</p>
      : <Loaded data={state.data} />}
  </div>;
}
