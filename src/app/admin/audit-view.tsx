"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getAuditAction } from "./actions";
import type { AuditData, AuditEntry } from "./admin-types";
import { filterChip } from "./admin-ui";

const PAGE = 15;
const when = (v: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(v));

type Who = "admin" | "staff" | "guest" | "system";
const whoOf = (e: AuditEntry): Who => (e.actorLabel.startsWith("admin:") ? "admin" : e.actorLabel.startsWith("guest:") ? "guest" : e.actorLabel.startsWith("system") ? "system" : "staff");
const WHO: Record<Who, { label: string; tone: string }> = {
  admin: { label: "Admin", tone: "bg-sky-100 text-sky-700" },
  staff: { label: "Tenant staff", tone: "bg-emerald-100 text-emerald-700" },
  guest: { label: "Guest", tone: "bg-amber-100 text-amber-700" },
  system: { label: "System", tone: "bg-zinc-100 text-zinc-600" },
};
const ACTIONS: Record<string, string> = {
  "admin.tenant_created": "Tenant created", "admin.tenant_edited": "Tenant details edited", "admin.tenant_suspended": "Tenant suspended", "admin.tenant_activated": "Tenant activated", "admin.tenant_cancelled": "Tenant removed from platform",
  "admin.plan_changed": "Plan changed", "admin.trial_extended": "Trial extended", "admin.fee_received": "Fees received", "admin.owner_pin_reset": "Owner PIN reset",
};
const nice = (a: string) => ACTIONS[a] ?? a.replace(/^admin\./, "").replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());
const actor = (e: AuditEntry) => {
  const l = e.actorLabel;
  if (l.startsWith("kds:")) return `Kitchen display (${l.split(":")[1] || "main"})`;
  return l.replace(/^(admin|staff|guest):/, "");
};
const hasData = (v: unknown) => v !== null && v !== undefined && !(typeof v === "object" && Object.keys(v as object).length === 0);
const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
const fieldName = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const record = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);

/** What changed, field by field, instead of raw data */
function Changes({ before, after }: { before: unknown; after: unknown }) {
  const a = record(before), b = record(after);
  if ((before != null && !a) || (after != null && !b)) return <dl className="space-y-1 text-xs"><div className="flex gap-2"><dt className="text-muted-foreground">Before</dt><dd className="min-w-0 break-words">{show(before)}</dd></div><div className="flex gap-2"><dt className="text-muted-foreground">After</dt><dd className="min-w-0 break-words">{show(after)}</dd></div></dl>;
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].filter((k) => JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k]));
  if (!keys.length) return <p className="text-xs text-muted-foreground">No values changed.</p>;
  return <dl className="space-y-1.5 text-xs">{keys.map((k) => <div key={k} className="grid gap-x-3 sm:grid-cols-[10rem_minmax(0,1fr)]"><dt className="text-muted-foreground">{fieldName(k)}</dt><dd className="min-w-0 break-words">{a && <span className="text-muted-foreground line-through decoration-muted-foreground/50">{show(a[k])}</span>}{a && b && " → "}{b && <span className="font-medium">{show(b[k])}</span>}</dd></div>)}</dl>;
}

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

  const filters: { key: "all" | Who; label: string; n: number }[] = [{ key: "all", label: "All", n: data.entries.length }, { key: "admin", label: "Admin", n: count("admin") }, { key: "staff", label: "Tenant staff", n: count("staff") }, { key: "guest", label: "Guests", n: count("guest") }, { key: "system", label: "System", n: count("system") }];

  return <>
    <div role="group" aria-label="Done by" className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">{filters.map((o) => <button key={o.key} type="button" aria-pressed={tab === o.key} onClick={() => { setTab(o.key); setPage(0); }} className={filterChip(tab === o.key)}>{o.label} {o.n}</button>)}</div>
    <Card><CardContent className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Search tenant, action or person" className="pl-8" aria-label="Search audit log" />
      </div>
      {shown.length ? <ul className="divide-y">{shown.map((e) => {
        const expandable = hasData(e.before) || hasData(e.after);
        const isOpen = open === e.id;
        const body = <>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{nice(e.action)}</span>
            {e.reason && <span className="block text-xs text-muted-foreground">{e.reason}</span>}
            <span className="block truncate text-xs text-muted-foreground">{e.tenantName} · {actor(e)}</span>
            <span className="block text-[11px] text-muted-foreground sm:hidden">{when(e.createdAt)}</span>
          </span>
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{when(e.createdAt)}</span>
          <Badge variant="secondary" className={`shrink-0 ${WHO[whoOf(e)].tone}`}>{WHO[whoOf(e)].label}</Badge>
          <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${expandable ? "" : "invisible"} ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
        </>;
        return <li key={e.id}>
          {expandable ? <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : e.id)} className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-[var(--admin-brand)]">{body}</button> : <div className="flex items-center gap-3 py-2.5">{body}</div>}
          {isOpen && <div className="mb-2.5 rounded-lg bg-muted p-3"><Changes before={e.before} after={e.after} /></div>}
        </li>;
      })}</ul> : <p className="py-14 text-center text-sm text-muted-foreground">{data.entries.length ? "Nothing matches. Try another filter or search." : "No activity recorded yet. Changes to tenants will show up here."}</p>}
      {rows.length > PAGE && <div className="flex items-center justify-between text-sm text-muted-foreground">
        <p>{current * PAGE + 1}–{Math.min(rows.length, (current + 1) * PAGE)} of {rows.length}</p>
        <div className="flex gap-2"><Button variant="outline" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</Button></div>
      </div>}
      {data.truncated && <p className="text-xs text-muted-foreground">Showing the latest 500 entries.</p>}
    </CardContent></Card>
    <p className="text-xs text-muted-foreground">PIN values are never stored. Plan and pricing edits are not logged yet.</p>
  </>;
}

export function AuditView({ preview }: { /** Sample entries for the design preview */ preview?: AuditData }) {
  const [state, setState] = useState<{ data: AuditData | null; error: string | null } | null>(preview ? { data: preview, error: null } : null);
  useEffect(() => { if (preview) return; let off = false; getAuditAction().then((r) => { if (!off) setState(r); }); return () => { off = true; }; }, [preview]);
  return <div className="space-y-4">
    <div className="md:pr-44"><h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Audit Logs</h1><p className="mt-1 text-sm text-muted-foreground">Who changed what, and when. Last 90 days.</p></div>
    {!state ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading audit log…</p>
      : state.error || !state.data ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error ?? "Audit log could not be loaded."}</p>
      : <Loaded data={state.data} />}
  </div>;
}
