"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, EyeOff, IndianRupee, Layers, Loader2, Pencil, Plus, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { savePlanAction, type PlanInput } from "./actions";
import { FEATURE_KEYS, FEATURE_LABELS } from "@/lib/plan-features";
import type { AdminData, AdminPlan } from "./admin-types";

const money = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const TONES = ["#5b42f5", "#16c784", "#f08b18", "#ed5368", "#3d91ef", "#e875b1"];

const FEATURES = FEATURE_KEYS.map((key) => ({ key, ...FEATURE_LABELS[key] }));

function Stat({ icon: Icon, label, value, note, tone }: { icon: typeof Layers; label: string; value: string; note: string; tone: string }) {
  return <Card size="sm"><CardContent className="flex items-center gap-3">
    <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: `${tone}1f`, color: tone }}><Icon className="size-5" aria-hidden="true" /></span>
    <div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="truncate text-2xl font-bold leading-tight">{value}</p><p className="truncate text-[11px] text-muted-foreground">{note}</p></div>
  </CardContent></Card>;
}

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
  const check = (name: string, label: string, on: boolean, hint?: string) => <label key={name} className="flex items-start gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={on} className="mt-0.5 size-4 accent-[#5b42f5]" /><span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span></label>;

  return <Dialog open={!!plan} onOpenChange={(open) => { if (!open) { setError(null); onClose(); } }}>
    <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>{editing ? `Edit ${editing.name}` : "Add plan"}</DialogTitle><DialogDescription>{editing ? "Price changes apply to new subscriptions. Existing tenants keep the price they agreed to." : "Create a new plan that tenants can be put on."}</DialogDescription></DialogHeader>
      {plan && <form key={editing?.code ?? "new"} onSubmit={submit} className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="plan-name">Plan name</Label><Input id="plan-name" name="name" defaultValue={editing?.name} required maxLength={40} /></div>
          {!editing && <div className="space-y-1.5"><Label htmlFor="plan-code">Plan code</Label><Input id="plan-code" name="code" required placeholder="e.g. growth" pattern="[a-z0-9_]{2,20}" /><p className="text-xs text-muted-foreground">Lowercase, cannot be changed later.</p></div>}
          <div className="space-y-1.5"><Label htmlFor="plan-price">Price per outlet / month (₹)</Label><Input id="plan-price" name="price" type="number" min={0} step="1" defaultValue={editing?.monthlyPricePaise != null ? editing.monthlyPricePaise / 100 : ""} /><p className="text-xs text-muted-foreground">Leave empty for custom pricing.</p></div>
          <div className="space-y-1.5"><Label htmlFor="plan-tables">Max tables</Label><Input id="plan-tables" name="maxTables" type="number" min={1} defaultValue={f?.maxTables ?? ""} /><p className="text-xs text-muted-foreground">Empty = unlimited.</p></div>
          <div className="space-y-1.5"><Label htmlFor="plan-staff">Max staff</Label><Input id="plan-staff" name="maxStaff" type="number" min={1} defaultValue={f?.maxStaff ?? ""} /><p className="text-xs text-muted-foreground">Empty = unlimited.</p></div>
          <div className="space-y-1.5"><Label htmlFor="plan-rooms">Max rooms</Label><Input id="plan-rooms" name="maxRooms" type="number" min={1} defaultValue={f?.maxRooms ?? ""} /><p className="text-xs text-muted-foreground">Hotel plans only. Empty = unlimited.</p></div>
        </div>
        <fieldset className="space-y-2.5"><legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Included features</legend>
          <div className="grid gap-2.5 sm:grid-cols-2">{FEATURES.map((x) => check(x.key, x.label, f?.[x.key] ?? false, x.hint))}</div>
          {check("poweredBy", "Show “Powered by Tableeqr”", f?.poweredBy ?? false, "A small line on the guest page. Usually on for lower plans.")}
        </fieldset>
        {check("isPublic", "Available for new tenants", editing?.isPublic ?? true, "Turn off to hide this plan. Existing tenants on it are not affected.")}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{editing ? "Save plan" : "Create plan"}</Button></div>
      </form>}
    </DialogContent>
  </Dialog>;
}

export function PlansView({ data }: { data: AdminData }) {
  const [dialog, setDialog] = useState<AdminPlan | "new" | null>(null);
  const plans = [...data.plans].sort((a, b) => a.sortOrder - b.sortOrder);

  const stats = plans.map((p) => {
    const tenants = data.tenants.filter((t) => t.planCode === p.code);
    const paying = tenants.filter((t) => t.status === "active");
    return { p, tenants: tenants.length, paying: paying.length, income: paying.reduce((sum, t) => sum + (t.monthlyPricePaise ?? 0) * t.outletCount, 0) };
  });
  const popular = [...stats].sort((a, b) => b.tenants - a.tenants)[0];
  const totalIncome = stats.reduce((sum, s) => sum + s.income, 0);

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Plans &amp; Pricing</h1><p className="mt-1 text-sm text-muted-foreground">What each plan costs and what it includes.</p></div>
      <Button onClick={() => setDialog("new")}><Plus />Add plan</Button>
    </div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
      <Stat icon={Layers} label="Plans" value={String(plans.length)} note={`${plans.filter((p) => !p.isPublic).length} hidden`} tone="#5b42f5" />
      <Stat icon={Users} label="Tenants on plans" value={String(data.tenants.length)} note={`${data.tenants.filter((t) => t.status === "active").length} paying`} tone="#16c784" />
      <Stat icon={IndianRupee} label="Monthly income" value={money(totalIncome)} note="From paying tenants" tone="#f08b18" />
      <Stat icon={Layers} label="Most popular" value={popular && popular.tenants ? popular.p.name : "—"} note={popular && popular.tenants ? `${popular.tenants} ${popular.tenants === 1 ? "tenant" : "tenants"}` : "No tenants yet"} tone="#ed5368" />
    </div>

    {plans.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">{stats.map(({ p, tenants, income }, i) => {
      const tone = TONES[i % TONES.length];
      return <Card key={p.code} className="flex flex-col">
        <CardContent className="flex flex-1 flex-col gap-4">
          <div className="flex items-start justify-between gap-2">
            <div><div className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: tone }} /><h2 className="text-base font-semibold">{p.name}</h2></div><p className="mt-0.5 text-xs text-muted-foreground">{p.code}</p></div>
            {!p.isPublic && <Badge variant="secondary" className="gap-1 bg-zinc-100 text-zinc-600"><EyeOff className="size-3" />Hidden</Badge>}
          </div>
          <div><p className="text-3xl font-bold tracking-tight">{p.monthlyPricePaise != null ? money(p.monthlyPricePaise) : "Custom"}</p><p className="text-xs text-muted-foreground">{p.monthlyPricePaise != null ? "per outlet / month" : "price agreed per tenant"}</p></div>
          {p.code === "custom" && <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">Features and price are picked for each restaurant. Open the restaurant in Tenants, then Manage. The list below is only the starting point.</p>}
          <div className="rounded-lg bg-muted/60 p-3 text-sm"><p><span className="font-semibold">{tenants}</span> {tenants === 1 ? "tenant" : "tenants"} · <span className="font-semibold">{money(income)}</span> / month</p></div>
          <ul className="space-y-1.5 text-sm">
            {p.features.dineIn && <li className="flex justify-between"><span className="text-muted-foreground">Tables</span><span className="font-medium">{p.features.maxTables ? `Up to ${p.features.maxTables}` : "Unlimited"}</span></li>}
            <li className="flex justify-between"><span className="text-muted-foreground">Staff</span><span className="font-medium">{p.features.maxStaff ? `Up to ${p.features.maxStaff}` : "Unlimited"}</span></li>
            {p.features.rooms && <li className="flex justify-between"><span className="text-muted-foreground">Rooms</span><span className="font-medium">{p.features.maxRooms ? `Up to ${p.features.maxRooms}` : "Unlimited"}</span></li>}
          </ul>
          <ul className="space-y-1.5 border-t pt-3 text-sm">{FEATURES.map((x) => { const on = p.features[x.key]; return <li key={x.key} className={`flex items-center gap-2 ${on ? "" : "text-muted-foreground"}`}>{on ? <Check className="size-4 text-emerald-600" aria-label="Included" /> : <X className="size-4 text-zinc-300" aria-label="Not included" />}{x.label}</li>; })}</ul>
          <Button variant="outline" className="mt-auto" onClick={() => setDialog(p)}><Pencil />Edit plan</Button>
        </CardContent>
      </Card>;
    })}</div> : <Card><CardContent className="py-14 text-center"><p className="font-medium">No plans yet</p><p className="mt-1 text-sm text-muted-foreground">Add your first plan so tenants can be put on it.</p><Button className="mt-4" onClick={() => setDialog("new")}><Plus />Add plan</Button></CardContent></Card>}

    <p className="text-xs text-muted-foreground">Changing a plan&apos;s price affects new subscriptions only. Tenants already on the plan keep the price they agreed to.</p>
    <PlanDialog key={dialog === "new" ? "new" : dialog?.code ?? "none"} plan={dialog} onClose={() => setDialog(null)} />
  </div>;
}
