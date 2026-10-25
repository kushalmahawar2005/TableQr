"use client";

import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { checkRealtimeAction, getSettingsAction } from "./actions";
import type { RealtimeCheck } from "@/server/realtime/check";
import type { SettingsData } from "./admin-types";

const ROLE = { super_admin: "Super admin", support: "Support" } as const;
const ROLE_HELP = { super_admin: "Can change tenants, plans and settings", support: "Can view everything, cannot make changes" } as const;
const when = (v: string | null) => v ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(v)) : "Never";
const STEP = { settings: "Settings present", worker: "Live-updates service answers", connect: "A screen can connect", publish: "An update can be sent", delivery: "The screen receives it" } as const;
const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

/** Proves live updates work end to end; the settings being present proves nothing on its own */
function RealtimeTest() {
  const [state, setState] = useState<{ data: RealtimeCheck | null; error: string | null } | "running" | null>(null);
  const run = () => { setState("running"); checkRealtimeAction().then(setState, () => setState({ data: null, error: "The check could not run." })); };
  return <Card>
    <CardHeader><CardTitle>Live updates</CardTitle><CardDescription>Sends a test update through the live-updates service and waits for a screen to receive it. Touches no restaurant.</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      <button type="button" onClick={run} disabled={state === "running"} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#5b42f5] px-4 text-sm font-medium text-white disabled:opacity-60">
        {state === "running" && <Loader2 className="size-4 animate-spin" />}Run check
      </button>
      {state && state !== "running" && (state.error || !state.data
        ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error ?? "The check could not run."}</p>
        : <div role="status" className="space-y-2">
          <p className={state.data.ok ? "text-sm font-medium text-emerald-700" : "text-sm font-medium text-red-700"}>{state.data.ok ? "Live updates work end to end." : "Live updates are not working. Screens fall back to refreshing every few seconds."}</p>
          <ul className="divide-y">{state.data.steps.map((x) => <li key={x.name} className="flex items-center gap-3 py-2 text-sm">
            {x.ok ? <CircleCheck className="size-5 shrink-0 text-emerald-600" aria-label="OK" /> : <CircleAlert className="size-5 shrink-0 text-red-600" aria-label="Failed" />}
            <span className="flex-1">{STEP[x.name]}</span><span className="text-muted-foreground">{x.ok && x.ms !== undefined ? `${x.ms} ms` : x.ok ? "" : "Failed"}</span>
          </li>)}</ul>
        </div>)}
    </CardContent>
  </Card>;
}

function Loaded({ data }: { data: SettingsData }) {
  const problems = data.system.filter((x) => !x.ok).length;
  return <>
    <Card>
      <CardHeader><CardTitle>Your account</CardTitle><CardDescription>The account you are signed in with</CardDescription></CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        <span className="grid size-14 place-items-center rounded-full bg-[#5b42f5] text-lg font-bold text-white">{initials(data.me.name)}</span>
        <div className="min-w-0 flex-1"><p className="text-lg font-semibold">{data.me.name}</p><p className="text-sm text-muted-foreground">{data.me.email}</p></div>
        <div className="text-right"><Badge variant="secondary" className="bg-indigo-100 text-indigo-700">{ROLE[data.me.role]}</Badge><p className="mt-1 text-xs text-muted-foreground">{ROLE_HELP[data.me.role]}</p></div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Admin team</CardTitle><CardDescription>People who can sign in to this admin panel</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <Table>
          <TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Last sign-in</TableHead></TableRow></TableHeader>
          <TableBody>{data.team.map((m) => <TableRow key={m.id}>
            <TableCell><div className="flex items-center gap-2.5"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#5b42f5]/10 text-xs font-bold text-[#5b42f5]">{initials(m.name)}</span><div className="min-w-0"><p className="truncate font-medium">{m.name}{m.email === data.me.email && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}</p><p className="truncate text-xs text-muted-foreground">{m.email}</p></div></div></TableCell>
            <TableCell>{ROLE[m.role]}</TableCell>
            <TableCell><Badge variant="secondary" className={m.isActive ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-600"}>{m.isActive ? "Active" : "Disabled"}</Badge></TableCell>
            <TableCell className="text-muted-foreground">{when(m.lastLoginAt)}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
        <p className="text-xs text-muted-foreground">To add another admin, run <code className="rounded bg-muted px-1 py-0.5">npm run db:admin</code> on the server. Passwords are never shown or stored in plain text.</p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2">System health{problems > 0 && <Badge variant="secondary" className="bg-amber-100 text-amber-700">{problems} to check</Badge>}</CardTitle><CardDescription>Whether the important services are set up. Secret values are never shown.</CardDescription></CardHeader>
      <CardContent><ul className="divide-y">{data.system.map((x) => <li key={x.label} className="flex items-center gap-3 py-3 text-sm">
        {x.ok ? <CircleCheck className="size-5 shrink-0 text-emerald-600" aria-label="OK" /> : <CircleAlert className="size-5 shrink-0 text-amber-600" aria-label="Needs attention" />}
        <span className="flex-1 font-medium">{x.label}</span><span className={x.ok ? "text-muted-foreground" : "font-medium text-amber-700"}>{x.detail}</span>
      </li>)}</ul></CardContent>
    </Card>

    <RealtimeTest />
  </>;
}

export function SettingsView() {
  const [state, setState] = useState<{ data: SettingsData | null; error: string | null } | null>(null);
  useEffect(() => { let off = false; getSettingsAction().then((r) => { if (!off) setState(r); }); return () => { off = true; }; }, []);
  return <div className="space-y-6">
    <div><h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Settings</h1><p className="mt-1 text-sm text-muted-foreground">Your account, your admin team and the health of the platform.</p></div>
    {!state ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading settings…</p>
      : state.error || !state.data ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error ?? "Settings could not be loaded."}</p>
      : <Loaded data={state.data} />}
  </div>;
}
