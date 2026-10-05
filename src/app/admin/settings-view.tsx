"use client";

import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSettingsAction } from "./actions";
import type { SettingsData } from "./admin-types";

const ROLE = { super_admin: "Super admin", support: "Support" } as const;
const ROLE_HELP = { super_admin: "Can change tenants, plans and settings", support: "Can view everything, cannot make changes" } as const;
const when = (v: string | null) => v ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(v)) : "Never";
const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

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
