"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, IndianRupee, Layers, Loader2, Minus, Plus, Trophy, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { savePlanAction, type PlanInput } from "./actions";
import { FEATURE_KEYS, FEATURE_LABELS } from "@/lib/plan-features";
import type { AdminData, AdminPlan } from "./admin-types";
import { Kpi } from "./admin-ui";

const money = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const FEATURES = FEATURE_KEYS.map((key) => ({ key, ...FEATURE_LABELS[key] }));

function PlanDialog({ plan, onClose }: { plan: AdminPlan | "new" | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const editing = plan && plan !== "new" ? plan : null;

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => { const v = String(f.get(k) ?? "").trim(); return v === "" ? null : Number(v); };
    const input: PlanInput = {
      code: editing ? editing.code : String(f.get("code") ?? ""),
      name: String(f.get("name") ?? ""),
      priceRupees: num("price"),
      isPublic: f.get("isPublic") === "on",
      features: {
        ...Object.fromEntries(FEATURE_KEYS.map((k) => [k, f.get(k) === "on"])) as Record<(typeof FEATURE_KEYS)[number], boolean>,
        maxTables: num("maxTables"), maxStaff: num("maxStaff"), maxRooms: num("maxRooms"), poweredBy: f.get("poweredBy") === "on",
      },
    };
    setError(null);
    start(async () => {
      const r = await savePlanAction(input, editing ? "edit" : "create");
      if (r.error) setError(r.error); else { router.refresh(); onClose(); }
    });
  };

  const f = editing?.features;
  const check = (name: string, label: string, on: boolean, hint?: string) => <label key={name} title={hint} className="flex min-h-10 items-center gap-2.5 text-sm"><input type="checkbox" name={name} defaultChecked={on} className="size-4 shrink-0 accent-[var(--admin-brand)]" />{label}</label>;
  const heading = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";

  return <Sheet open={!!plan} onOpenChange={(open) => { if (!open) { setError(null); onClose(); } }}>
    <SheetContent className="w-full gap-0 overflow-y-auto bg-[var(--admin-bg)] data-[side=right]:sm:max-w-xl">
      <SheetHeader className="border-b bg-white p-4 sm:p-5"><SheetTitle className="pr-8 text-lg">{editing ? `Edit ${editing.name}` : "Add plan"}</SheetTitle><SheetDescription>{editing ? "A new price applies to new subscriptions only." : "A plan tenants can be put on."}</SheetDescription></SheetHeader>
      {plan && <form key={editing?.code ?? "new"} onSubmit={submit} className="flex flex-1 flex-col">
        <div className="flex-1 space-y-2 p-3 sm:p-4">
          <section className="space-y-3 rounded-xl border bg-card p-4">
            <p className={heading}>Name and price</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="plan-name">Plan name</Label><Input id="plan-name" name="name" defaultValue={editing?.name} required maxLength={40} /></div>
              {!editing && <div className="space-y-1.5"><Label htmlFor="plan-code">Plan code</Label><Input id="plan-code" name="code" required placeholder="e.g. growth" pattern="[a-z0-9_]{2,20}" /><p className="text-xs text-muted-foreground">Lowercase, cannot be changed later.</p></div>}
              <div className="space-y-1.5"><Label htmlFor="plan-price">Price per outlet a month (₹)</Label><Input id="plan-price" name="price" type="number" min={0} step="1" placeholder="Custom" defaultValue={editing?.monthlyPricePaise != null ? editing.monthlyPricePaise / 100 : ""} /></div>
            </div>
          </section>
          <section className="space-y-3 rounded-xl border bg-card p-4">
            <p className={heading}>Limits</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5"><Label htmlFor="plan-tables">Tables</Label><Input id="plan-tables" name="maxTables" type="number" min={1} placeholder="No limit" defaultValue={f?.maxTables ?? ""} /></div>
              <div className="space-y-1.5"><Label htmlFor="plan-staff">Staff</Label><Input id="plan-staff" name="maxStaff" type="number" min={1} placeholder="No limit" defaultValue={f?.maxStaff ?? ""} /></div>
              <div className="space-y-1.5"><Label htmlFor="plan-rooms">Rooms</Label><Input id="plan-rooms" name="maxRooms" type="number" min={1} placeholder="No limit" defaultValue={f?.maxRooms ?? ""} /></div>
            </div>
          </section>
          <fieldset className="rounded-xl border bg-card p-4"><legend className="sr-only">Included features</legend>
            <p className={`mb-1 ${heading}`}>Features</p>
            <div className="grid gap-x-4 sm:grid-cols-2">{FEATURES.map((x) => check(x.key, x.label, f?.[x.key] ?? false, x.hint))}{check("poweredBy", "Show “Powered by Tableeqr”", f?.poweredBy ?? false, "A small line on the guest page. Usually on for lower plans.")}</div>
          </fieldset>
          <section className="rounded-xl border bg-card px-4 py-2">{check("isPublic", "Available for new tenants", editing?.isPublic ?? true, "Turn off to hide this plan. Existing tenants on it are not affected.")}</section>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        </div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-white p-3 sm:p-4"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{editing ? "Save plan" : "Create plan"}</Button></div>
      </form>}
    </SheetContent>
  </Sheet>;
}

/** Only the limits that exist: "10 tables · 5 staff", or "No limits" */
const limits = (p: AdminPlan) => [p.features.dineIn && p.features.maxTables && `${p.features.maxTables} tables`, p.features.maxStaff && `${p.features.maxStaff} staff`, p.features.rooms && p.features.maxRooms && `${p.features.maxRooms} rooms`].filter(Boolean).join(" · ") || "No limits";

function PlanCard({ p, tenants, income, onEdit }: { p: AdminPlan; tenants: number; income: number; onEdit: () => void }) {
  const on = FEATURES.filter((x) => p.features[x.key]).length;
  return <article className="flex min-w-0 flex-col rounded-2xl border bg-card p-4">
    <h3 className="truncate font-display text-base font-bold">{p.name}</h3>
    <p className="mt-2 font-display text-2xl font-bold tracking-tight tabular-nums">{p.monthlyPricePaise != null ? money(p.monthlyPricePaise) : "Custom"}</p>
    <p className="text-xs text-muted-foreground">{p.monthlyPricePaise != null ? "per outlet a month" : "price agreed per tenant"}</p>
    <p className="mt-3 truncate text-xs font-medium">{limits(p)}</p>
    <div className="mt-2"><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[#2f7d5b]" style={{ width: `${Math.round((on / FEATURES.length) * 100)}%` }} /></div><p className="mt-1 text-xs text-muted-foreground">{on} of {FEATURES.length} features</p></div>
    <div className="mt-auto flex items-center justify-between gap-2 pt-3">
      <p className="min-w-0 truncate text-sm"><b className="tabular-nums">{tenants}</b> {tenants === 1 ? "tenant" : "tenants"}{income > 0 ? ` · ${money(income)}` : ""}</p>
      <Button variant="outline" size="sm" onClick={onEdit}>Edit</Button>
    </div>
  </article>;
}

/** Every plan side by side; the first column stays put when a phone scrolls sideways */
function ComparePlans({ plans }: { plans: AdminPlan[] }) {
  const cell = "px-3 py-2 text-center";
  const name = "sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium";
  return <div className="no-scrollbar overflow-x-auto rounded-2xl border bg-card">
    <table className="w-full min-w-max text-sm">
      <thead><tr className="border-b"><th scope="col" className={`${name} font-semibold`}>Feature</th>{plans.map((p) => <th key={p.code} scope="col" className={`${cell} whitespace-nowrap font-semibold`}>{p.name}</th>)}</tr></thead>
      <tbody className="divide-y">
        <tr><th scope="row" className={name}>Price</th>{plans.map((p) => <td key={p.code} className={`${cell} whitespace-nowrap tabular-nums`}>{p.monthlyPricePaise != null ? money(p.monthlyPricePaise) : "Custom"}</td>)}</tr>
        {FEATURES.map((x) => <tr key={x.key}><th scope="row" className={`${name} whitespace-nowrap`}>{x.label}</th>{plans.map((p) => <td key={p.code} className={cell}>{p.features[x.key] ? <Check className="mx-auto size-4 text-emerald-700" aria-label="Included" /> : <Minus className="mx-auto size-4 text-muted-foreground/50" aria-label="Not included" />}</td>)}</tr>)}
      </tbody>
    </table>
  </div>;
}

export function PlansView({ data }: { data: AdminData }) {
  const [dialog, setDialog] = useState<AdminPlan | "new" | null>(null);
  const [comparing, setComparing] = useState(false);
  const plans = [...data.plans].sort((a, b) => a.sortOrder - b.sortOrder);

  const stats = plans.map((p) => {
    const tenants = data.tenants.filter((t) => t.planCode === p.code);
    const paying = tenants.filter((t) => t.status === "active");
    return { p, tenants: tenants.length, paying: paying.length, income: paying.reduce((sum, t) => sum + (t.monthlyPricePaise ?? 0) * t.outletCount, 0) };
  });
  const popular = [...stats].sort((a, b) => b.tenants - a.tenants)[0];
  const totalIncome = stats.reduce((sum, s) => sum + s.income, 0);

  const card = (row: (typeof stats)[number]) => <PlanCard key={row.p.code} p={row.p} tenants={row.tenants} income={row.income} onEdit={() => setDialog(row.p)} />;
  const open = stats.filter((row) => row.p.isPublic);
  const hidden = stats.filter((row) => !row.p.isPublic);
  const grid = "grid gap-2 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4";

  return <div className="space-y-4">
    <div className="md:pr-44"><h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Plans &amp; Pricing</h1><p className="mt-1 text-sm text-muted-foreground">What each plan costs and what it includes.</p></div>

    <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
      <Kpi icon={Layers} label="Plans" value={String(plans.length)} hint={`${hidden.length} hidden`} />
      <Kpi icon={Users} label="Tenants on plans" value={String(data.tenants.length)} hint={`${data.tenants.filter((t) => t.status === "active").length} paying`} />
      <Kpi icon={IndianRupee} label="Monthly income" value={money(totalIncome)} hint="From paying tenants" />
      <Kpi icon={Trophy} label="Most popular" value={popular && popular.tenants ? popular.p.name : "—"} hint={popular && popular.tenants ? `${popular.tenants} ${popular.tenants === 1 ? "tenant" : "tenants"}` : "No tenants yet"} />
    </div>

    <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
      <Button variant="outline" aria-pressed={comparing} onClick={() => setComparing(!comparing)} disabled={!plans.length}>{comparing ? "Show plans" : "Compare plans"}</Button>
      <Button onClick={() => setDialog("new")}><Plus />Add plan</Button>
    </div>

    {!plans.length ? <Card><CardContent className="py-14 text-center"><p className="font-medium">No plans yet</p><p className="mt-1 text-sm text-muted-foreground">Add your first plan so tenants can be put on it.</p></CardContent></Card>
      : comparing ? <ComparePlans plans={plans} />
      : <>
        {open.length > 0 && <section className="space-y-2"><h2 className="text-sm font-semibold">For new tenants</h2><div className={grid}>{open.map(card)}</div></section>}
        {hidden.length > 0 && <section className="space-y-2"><h2 className="text-sm font-semibold">Hidden</h2><div className={grid}>{hidden.map(card)}</div></section>}
      </>}

    <p className="text-xs text-muted-foreground">A new price applies to new subscriptions only. Tenants already on the plan keep the price they agreed to. Custom plans are set per tenant in Tenants, then Manage.</p>
    <PlanDialog key={dialog === "new" ? "new" : dialog?.code ?? "none"} plan={dialog} onClose={() => setDialog(null)} />
  </div>;
}
