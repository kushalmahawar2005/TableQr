"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpRight, ArrowDownRight, Ban, ChevronLeft, ChevronRight, Download, FlaskConical, Loader2, Plus, RotateCcw, Search, Store, Users, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { changeTenantPlanAction, extendTrialAction, getTenantDetailAction, resetOwnerPinAction, setTenantKitchenAction, setTenantStatusAction, setTenantTableLimitAction, updateTenantAction } from "./actions";
import { CreateTenantDialog } from "./create-tenant-dialog";
import type { AdminData, AdminTenant, TenantDetail } from "./admin-types";

const detailChart = { orders: { label: "Orders", color: "#5b42f5" }, revenue: { label: "Revenue (₹)", color: "#a78bfa" } } satisfies ChartConfig;
const shortDay = (v: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(v));

function UsageBar({ label, used, max }: { label: string; used: number; max: number | null }) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return <div className="space-y-1"><div className="flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="font-medium">{used}{max ? ` / ${max}` : " · no limit"}</span></div>{max ? <div className="h-1.5 rounded-full bg-muted"><div className={`h-full rounded-full ${pct >= 90 ? "bg-red-500" : "bg-[#5b42f5]"}`} style={{ width: `${pct}%` }} /></div> : null}</div>;
}

function attentionFor(t: AdminTenant, now: number) {
  const DAY = 86_400_000;
  const out: string[] = [];
  if (t.subscriptionStatus === "past_due") out.push("Payment is overdue");
  if (t.status === "suspended") out.push("Tenant is suspended");
  if (t.status === "trial" && t.trialEndsAt) { const d = Math.ceil((new Date(t.trialEndsAt).getTime() - now) / DAY); if (d <= 7) out.push(d < 0 ? "Trial has ended" : `Trial ends in ${d} ${d === 1 ? "day" : "days"}`); }
  if ((t.status === "active" || t.status === "trial") && t.orders30d === 0 && now - new Date(t.createdAt).getTime() > 7 * DAY) out.push("No orders in the last 30 days");
  return out;
}


const statusTone: Record<string, string> = { active: "bg-emerald-100 text-emerald-700", trial: "bg-amber-100 text-amber-700", suspended: "bg-red-100 text-red-700", cancelled: "bg-zinc-100 text-zinc-600" };
const money = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const date = (value: string | null) => value ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value)) : "—";
type Health = "Healthy" | "Good" | "At risk" | "Inactive" | "New";
const healthTone: Record<Health, string> = { Healthy: "bg-emerald-100 text-emerald-700", Good: "bg-green-50 text-green-700", "At risk": "bg-amber-100 text-amber-700", Inactive: "bg-red-100 text-red-700", New: "bg-sky-100 text-sky-700" };
const HEALTHS: Health[] = ["Healthy", "Good", "At risk", "Inactive", "New"];
/** Healthy: 30+ orders and an order in the last 3 days. Good: orders in the last 7 days. At risk: orders earlier but quiet for 7+ days. Inactive: none in 30 days. New: joined under 7 days ago with no orders. */
function healthOf(t: AdminTenant, now: number): Health {
  const DAY = 86_400_000;
  const sinceLast = t.lastOrderAt ? (now - new Date(t.lastOrderAt).getTime()) / DAY : Infinity;
  if (t.orders30d === 0) return now - new Date(t.createdAt).getTime() < 7 * DAY ? "New" : "Inactive";
  if (sinceLast <= 3 && t.orders30d >= 30) return "Healthy";
  if (sinceLast <= 7) return "Good";
  return "At risk";
}
const mrr = (t: AdminTenant) => t.status === "active" ? (t.monthlyPricePaise ?? 0) * t.outletCount : 0;

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-3 py-2 text-sm"><dt className="shrink-0 text-muted-foreground">{label}</dt><dd className="min-w-0 break-words text-right font-medium">{children}</dd></div>;
}

function TenantSheet({ tenant, plans, now, onClose }: { tenant: AdminTenant | null; plans: AdminData["plans"]; now: number; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [tab, setTab] = useState("overview");
  const [loaded, setLoaded] = useState<{ id: string; detail: TenantDetail | null; error: string | null } | null>(null);
  const tenantId = tenant?.id;
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    getTenantDetailAction(tenantId).then((r) => { if (!cancelled) setLoaded({ id: tenantId, detail: r.detail, error: r.error }); });
    return () => { cancelled = true; };
  }, [tenantId]);
  const current = loaded && loaded.id === tenantId ? loaded : null;
  const detail = current?.detail ?? null;
  const detailError = current?.error ?? null;

  const run = (task: () => Promise<{ error: string | null }>, done?: string, close = false) => {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await task();
      if (result.error) return setError(result.error);
      router.refresh();
      if (done) setNotice(done);
      if (close) onClose();
    });
  };
  const busy = pending && <Loader2 className="animate-spin" />;

  return <Sheet open={!!tenant} onOpenChange={(open) => { if (!open) { setError(null); setNotice(null); setPin(""); setTab("overview"); onClose(); } }}>
    <SheetContent className="w-full overflow-y-auto bg-[var(--admin-bg)] data-[side=right]:sm:max-w-3xl">
      {tenant && <>
        <SheetHeader className="border-b bg-white p-5">
          <div className="flex items-center gap-4 pr-8">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#5b42f5] text-sm font-bold text-white">{tenant.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <SheetTitle className="flex flex-wrap items-center gap-2 text-lg">{tenant.name}<Badge variant="secondary" className={`capitalize ${statusTone[tenant.status]}`}>{tenant.status}</Badge></SheetTitle>
              <SheetDescription className="truncate">{[tenant.contactEmail ?? tenant.contactPhone, tenant.cities.join(", ")].filter(Boolean).join(" · ")}</SheetDescription>
            </div>
            <Badge variant="secondary">{tenant.planName}</Badge>
          </div>
        </SheetHeader>
        <Tabs value={tab} className="gap-0" onValueChange={(v) => { setTab(String(v)); setError(null); setNotice(null); }}>
          <TabsList variant="line" className="h-11 w-full justify-start border-b bg-white px-4"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="outlets">Outlets</TabsTrigger><TabsTrigger value="staff">Staff</TabsTrigger><TabsTrigger value="edit">Edit</TabsTrigger><TabsTrigger value="manage">Manage</TabsTrigger></TabsList>
          <div className="space-y-4 p-4">
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {[["Orders (30d)", tenant.orders30d.toLocaleString("en-IN")], ["Paid bill value (30d)", money(tenant.paidBills30dPaise)], ["Outlets", String(tenant.outletCount)]].map(([k, v]) => <div key={k} className="rounded-xl border bg-white p-3.5"><p className="text-[11px] text-muted-foreground">{k}</p><p className="mt-1 text-xl font-bold">{v}</p></div>)}
            </div>
            {detailError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{detailError}</p>}
            {!detail && !detailError && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading details…</p>}
            {detail && <section className="rounded-xl border bg-white p-4"><h3 className="mb-2 text-sm font-semibold">Orders &amp; revenue (30 days)</h3>
              <ChartContainer config={detailChart} className="h-48 w-full">
                <ComposedChart data={detail.daily.map((d) => ({ label: shortDay(d.date), orders: d.orders, revenue: Math.round(d.revenuePaise / 100) }))} margin={{ left: -16, right: -16 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={28} />
                  <YAxis yAxisId="r" tickLine={false} axisLine={false} />
                  <YAxis yAxisId="o" orientation="right" tickLine={false} axisLine={false} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar yAxisId="r" dataKey="revenue" fill="var(--color-revenue)" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="o" dataKey="orders" type="monotone" stroke="var(--color-orders)" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ChartContainer>
            </section>}
            <div className="grid gap-4 sm:grid-cols-2">
              <section className="rounded-xl border bg-white p-4"><h3 className="mb-1 text-sm font-semibold">Tenant details</h3>
                <dl className="divide-y"><Detail label="Contact">{tenant.contactName}</Detail><Detail label="Phone">{tenant.contactPhone}</Detail><Detail label="Email">{tenant.contactEmail ?? "—"}</Detail><Detail label="Last order">{date(tenant.lastOrderAt)}</Detail><Detail label="Joined">{date(tenant.createdAt)}</Detail></dl>
              </section>
              {detail ? <section className="space-y-3 rounded-xl border bg-white p-4"><h3 className="text-sm font-semibold">Usage vs plan limits</h3>
                <UsageBar label="Tables" used={detail.usage.tables} max={detail.usage.maxTables} />
                <UsageBar label="Staff" used={detail.usage.staff} max={detail.usage.maxStaff} />
                <UsageBar label="Outlets" used={detail.usage.outlets} max={null} />
                <p className="flex justify-between text-xs"><span className="text-muted-foreground">QR codes</span><span className="font-medium">{detail.usage.qrCodes}</span></p>
                <p className="flex justify-between text-xs"><span className="text-muted-foreground">Menu items</span><span className="font-medium">{detail.usage.menuItems}</span></p>
              </section> : <div className="rounded-xl border bg-white p-4" />}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <section className="rounded-xl border bg-white p-4"><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">Needs attention{attentionFor(tenant, now).length > 0 && <Badge variant="secondary" className="bg-amber-100 text-amber-700">{attentionFor(tenant, now).length}</Badge>}</h3>
                {attentionFor(tenant, now).length ? <ul className="space-y-1.5 text-sm">{attentionFor(tenant, now).map((a) => <li key={a} className="text-amber-700">• {a}</li>)}</ul> : <p className="text-sm text-emerald-700">✓ All good</p>}
              </section>
              {detail && <section className="space-y-2 rounded-xl border bg-white p-4"><h3 className="flex items-center justify-between text-sm font-semibold">Setup progress<span className="text-xs font-medium text-muted-foreground">{detail.setup.percent}%</span></h3>
                <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${detail.setup.percent}%` }} /></div>
                <ul className="space-y-1 pt-1 text-xs">{detail.setup.steps.map((st) => <li key={st.label} className={st.done ? "" : "text-muted-foreground"}>{st.done ? "✓" : "○"} {st.label}</li>)}</ul>
              </section>}
            </div>
            {detail && <section className="rounded-xl border bg-white p-4"><h3 className="mb-2 text-sm font-semibold">Recent activity</h3>
              {detail.activity.length ? <ul className="space-y-2">{detail.activity.map((a) => <li key={a.id} className="flex items-center justify-between gap-3 text-sm"><span><span className="font-medium">{a.title}</span> <span className="text-muted-foreground">· {a.description}</span></span><time dateTime={a.createdAt} className="shrink-0 text-xs text-muted-foreground">{date(a.createdAt)}</time></li>)}</ul> : <p className="text-sm text-muted-foreground">No activity yet.</p>}
            </section>}
            <div className="grid gap-4 sm:grid-cols-2">
              <section className="rounded-xl border bg-white p-4"><h3 className="mb-1 text-sm font-semibold">Plan &amp; billing</h3>
                <p className="text-lg font-bold">{tenant.planName}</p>
                <p className="text-sm text-muted-foreground">{tenant.monthlyPricePaise ? `${money(tenant.monthlyPricePaise)} / outlet / month` : "Custom pricing"}{tenant.billingCycle ? ` · ${tenant.billingCycle}` : ""}</p>
                <p className="mt-2 text-xs text-muted-foreground">{tenant.status === "trial" ? "Trial ends" : "Next renewal"}: <span className="font-medium text-foreground">{date(tenant.status === "trial" ? tenant.trialEndsAt : tenant.renewalAt)}</span></p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setTab("manage")}>Change plan</Button>
              </section>
              <section className="rounded-xl border bg-white p-4 sm:col-span-2">
                <form
                  className="flex flex-wrap items-end justify-between gap-3"
                  onSubmit={(e) => { e.preventDefault(); const n = Number(new FormData(e.currentTarget).get("tableLimit")); run(() => setTenantTableLimitAction(tenant.id, n), "Table limit saved."); }}
                >
                  <div>
                    <h3 className="text-sm font-semibold">Tables allowed</h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">The owner cannot add more tables than this on the floor plan; they are asked to upgrade.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input key={tenant.id + String(tenant.tableLimit)} name="tableLimit" type="number" min={1} max={500} defaultValue={tenant.tableLimit ?? ""} placeholder="No limit" className="w-24" aria-label="Tables allowed" />
                    <Button size="sm" type="submit" disabled={pending}>Save</Button>
                  </div>
                </form>
              </section>
              <section className="rounded-xl border bg-white p-4 sm:col-span-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">Kitchen screen</h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {tenant.kitchenDisplay ? "On: the Kitchen staff role and the wall kitchen screen are available." : "Off: no Kitchen role or wall screen. Managers still use the Kitchen board in the console."}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {tenant.kitchenOverride === null ? `Following the ${tenant.planName} plan (${tenant.kitchenFromPlan ? "included" : "not included"}).` : `Set by admin. The ${tenant.planName} plan alone would ${tenant.kitchenFromPlan ? "include" : "not include"} it.`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Kitchen screen">
                    <Button size="sm" variant={tenant.kitchenDisplay ? "default" : "outline"} disabled={pending || tenant.kitchenDisplay} onClick={() => run(() => setTenantKitchenAction(tenant.id, true), "Kitchen screen turned on.")}>On</Button>
                    <Button size="sm" variant={!tenant.kitchenDisplay ? "default" : "outline"} disabled={pending || !tenant.kitchenDisplay} onClick={() => run(() => setTenantKitchenAction(tenant.id, false), "Kitchen screen turned off.")}>Off</Button>
                    {tenant.kitchenOverride !== null && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setTenantKitchenAction(tenant.id, null), "Kitchen screen follows the plan again.")}>Use plan</Button>}
                  </div>
                </div>
              </section>
              <section className="rounded-xl border bg-white p-4"><h3 className="mb-2 text-sm font-semibold">Quick actions</h3>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setTab("edit")}>Edit details</Button>
                  <Button variant="outline" size="sm" onClick={() => setTab("manage")}>Reset owner PIN</Button>
                  {tenant.status === "trial" && <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => extendTrialAction(tenant.id, 7), "Trial extended by 7 days.")}>Extend trial</Button>}
                  {tenant.status === "suspended" || tenant.status === "cancelled"
                    ? <Button size="sm" disabled={pending} onClick={() => run(() => setTenantStatusAction(tenant.id, "active"), "Tenant activated.")}>Activate</Button>
                    : <Button variant="destructive" size="sm" disabled={pending} onClick={() => { if (window.confirm(`Suspend ${tenant.name}? Their staff will lose access.`)) run(() => setTenantStatusAction(tenant.id, "suspended"), "Tenant suspended."); }}>Suspend</Button>}
                </div>
              </section>
            </div>
          </TabsContent>

          <TabsContent value="outlets" className="rounded-xl border bg-white p-4">
            {detail ? <Table><TableHeader><TableRow><TableHead>Outlet</TableHead><TableHead>Code</TableHead><TableHead>City</TableHead><TableHead className="text-right">Tables</TableHead></TableRow></TableHeader>
              <TableBody>{detail.outlets.map((o) => <TableRow key={o.id}><TableCell className="font-medium">{o.name}</TableCell><TableCell>{o.code}</TableCell><TableCell className="text-muted-foreground">{o.city}</TableCell><TableCell className="text-right">{o.tables}</TableCell></TableRow>)}</TableBody></Table>
              : <p className="text-sm text-muted-foreground">{detailError ?? "Loading…"}</p>}
          </TabsContent>

          <TabsContent value="staff" className="rounded-xl border bg-white p-4">
            {detail ? <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead>Phone</TableHead><TableHead className="pl-6">Status</TableHead></TableRow></TableHeader>
              <TableBody>{detail.staff.map((m, i) => <TableRow key={`${m.id}-${i}`}><TableCell className="font-medium">{m.name}</TableCell><TableCell className="capitalize">{m.role}</TableCell><TableCell className="text-muted-foreground">{m.phone}</TableCell><TableCell><Badge variant="secondary" className={m.isActive ? statusTone.active : statusTone.cancelled}>{m.isActive ? "Active" : "Inactive"}</Badge></TableCell></TableRow>)}</TableBody></Table>
              : <p className="text-sm text-muted-foreground">{detailError ?? "Loading…"}</p>}
          </TabsContent>

          <TabsContent value="edit" className="rounded-xl border bg-white p-4">
            <form key={tenant.id} className="space-y-3" onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(() => updateTenantAction(tenant.id, { name: String(f.get("name")), contactName: String(f.get("contactName")), contactPhone: String(f.get("contactPhone")), contactEmail: String(f.get("contactEmail")) }), "Details saved.");
            }}>
              {[["name", "Company name", tenant.name], ["contactName", "Contact person", tenant.contactName], ["contactPhone", "Phone", tenant.contactPhone], ["contactEmail", "Email", tenant.contactEmail ?? ""]].map(([name, label, value]) => <div key={name} className="space-y-1.5"><Label htmlFor={`edit-${name}`}>{label}</Label><Input id={`edit-${name}`} name={name} defaultValue={value} /></div>)}
              <Button type="submit" disabled={pending}>{busy}Save changes</Button>
            </form>
          </TabsContent>

          <TabsContent value="manage" className="space-y-6 rounded-xl border bg-white p-4">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Plan</h3>
              <Select value={tenant.planCode} onValueChange={(v) => v && v !== tenant.planCode && run(() => changeTenantPlanAction(tenant.id, v), "Plan changed.")}>
                <SelectTrigger className="w-full" aria-label="Change plan"><SelectValue>{tenant.planName}</SelectValue></SelectTrigger>
                <SelectContent>{plans.map((p) => <SelectItem key={p.code} value={p.code}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Reset owner PIN</h3>
              <div className="flex gap-2">
                <Input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="New 4-digit PIN" aria-label="New owner PIN" />
                <Button variant="outline" disabled={pending || pin.length !== 4} onClick={() => run(() => resetOwnerPinAction(tenant.id, pin), "Owner PIN reset.")}>Reset</Button>
              </div>
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Access</h3>
              <div className="flex flex-wrap gap-2">
                {tenant.status === "trial" && <Button variant="outline" disabled={pending} onClick={() => run(() => extendTrialAction(tenant.id, 7), "Trial extended by 7 days.")}>{busy}Extend trial 7 days</Button>}
                {tenant.status === "suspended" || tenant.status === "cancelled"
                  ? <Button disabled={pending} onClick={() => run(() => setTenantStatusAction(tenant.id, "active"), "Tenant activated.")}>{busy}Activate tenant</Button>
                  : <Button variant="destructive" disabled={pending} onClick={() => { if (window.confirm(`Suspend ${tenant.name}? Their staff will lose access.`)) run(() => setTenantStatusAction(tenant.id, "suspended"), "Tenant suspended."); }}>{busy}Suspend tenant</Button>}
              </div>
            </section>
          </TabsContent>

          </div>
        </Tabs>
      </>}
    </SheetContent>
  </Sheet>;
}

type SortKey = "name" | "outletCount" | "mrr" | "orders30d" | "createdAt";

function csvCell(value: string | number) { const text = String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }

export function TenantsView({ data }: { data: AdminData }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [plan, setPlan] = useState("all");
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "createdAt", dir: -1 });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [city, setCity] = useState("all");
  const [health, setHealth] = useState("all");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const now = new Date(data.asOf).getTime();

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data.tenants.length, active: 0, trial: 0, suspended: 0, cancelled: 0 };
    for (const t of data.tenants) c[t.status]++;
    return c;
  }, [data.tenants]);

  const all = useMemo(() => {
    const q = query.trim().toLowerCase();
    const value = (t: AdminTenant): string | number => sort.key === "mrr" ? mrr(t) : sort.key === "name" ? t.name.toLowerCase() : t[sort.key];
    return data.tenants.filter((t) =>
      (status === "all" || t.status === status) && (plan === "all" || t.planCode === plan) &&
      (city === "all" || t.cities.includes(city)) && (health === "all" || healthOf(t, now) === health) &&
      (!q || [t.name, t.contactName, t.contactEmail ?? "", t.contactPhone, ...t.cities].some((v) => v.toLowerCase().includes(q))))
      .sort((a, b) => (value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : 0) * sort.dir);
  }, [data.tenants, query, status, plan, city, health, sort, now]);
  const cities = useMemo(() => [...new Set(data.tenants.flatMap((t) => t.cities))].sort(), [data.tenants]);

  const pages = Math.max(1, Math.ceil(all.length / pageSize));
  const current = Math.min(page, pages - 1);
  const rows = all.slice(current * pageSize, (current + 1) * pageSize);
  const toggleSort = (key: SortKey) => { setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "name" ? 1 : -1 })); setPage(0); };
  const sortHead = (key: SortKey, label: string, right = false, extra = "") => <TableHead className={`${right ? "text-right" : ""} ${extra}`} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
    <button type="button" onClick={() => toggleSort(key)} className={`inline-flex items-center gap-1 hover:text-foreground ${right ? "flex-row-reverse" : ""}`}>{label}{sort.key === key && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}</button>
  </TableHead>;

  const exportCsv = () => {
    const header = ["Name", "Contact", "Phone", "Email", "Plan", "Status", "Outlets", "Cities", "MRR (INR)", "Orders 30d", "Joined"];
    const exportRows = checked.size ? all.filter((t) => checked.has(t.id)) : all;
    const lines = exportRows.map((t) => [t.name, t.contactName, t.contactPhone, t.contactEmail ?? "", t.planName, t.status, t.outletCount, t.cities.join("; "), Math.round(mrr(t) / 100), t.orders30d, t.createdAt.slice(0, 10)].map(csvCell).join(","));
    const url = URL.createObjectURL(new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: "tenants.csv" });
    link.click();
    URL.revokeObjectURL(url);
  };

  const selected = data.tenants.find((t) => t.id === selectedId) ?? null;
  const filtered = !!query || status !== "all" || plan !== "all" || city !== "all" || health !== "all";
  const resetFilters = () => { setQuery(""); setStatus("all"); setPlan("all"); setCity("all"); setHealth("all"); setPage(0); };
  const pageIds = rows.map((t) => t.id);
  const allChecked = pageIds.length > 0 && pageIds.every((id) => checked.has(id));
  const toggleAll = () => setChecked((c) => { const n = new Set(c); for (const id of pageIds) { if (allChecked) n.delete(id); else n.add(id); } return n; });
  const toggleOne = (id: string) => setChecked((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Tenants</h1><p className="mt-1 text-sm text-muted-foreground">{data.tenants.length} {data.tenants.length === 1 ? "tenant" : "tenants"} on the platform</p></div>
      <div className="flex gap-2"><Button variant="outline" onClick={exportCsv} disabled={!all.length}><Download />{checked.size ? `Export ${checked.size} selected` : "Export CSV"}</Button><Button onClick={() => setAdding(true)}><Plus />Add tenant</Button></div>
    </div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5 [&>*]:min-w-0">
      {([
        { label: "Total tenants", value: counts.all, icon: Users, tone: "#5b42f5", change: data.changes.tenants },
        { label: "Active", value: counts.active, icon: Store, tone: "#16c784" },
        { label: "Trial", value: counts.trial, icon: FlaskConical, tone: "#f08b18" },
        { label: "Suspended", value: counts.suspended, icon: Ban, tone: "#ed5368" },
        { label: "Cancelled", value: counts.cancelled, icon: XCircle, tone: "#71717a" },
      ] as { label: string; value: number; icon: typeof Users; tone: string; change?: number | null }[]).map(({ label, value, icon: Icon, tone, change }) => <Card key={label} size="sm"><CardContent className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: `${tone}1f`, color: tone }}><Icon className="size-5" aria-hidden="true" /></span>
        <div className="min-w-0"><p className="truncate text-xs text-muted-foreground">{label}</p><p className="text-2xl font-bold leading-tight">{value}</p>
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">{change != null ? <span className={`flex items-center font-semibold ${change < 0 ? "text-red-600" : "text-emerald-600"}`}>{change < 0 ? <ArrowDownRight className="size-3" /> : <ArrowUpRight className="size-3" />}{Math.abs(change)}%</span> : null}{label === "Total tenants" ? "vs last month" : `${counts.all ? Math.round((value / counts.all) * 100) : 0}% of total`}</p></div>
      </CardContent></Card>)}
    </div>

    <Card>
      <CardContent className="space-y-4">
        <Tabs value={status} onValueChange={(v) => { setStatus(String(v)); setPage(0); }}>
          <TabsList variant="line" className="h-auto flex-wrap justify-start gap-x-1 gap-y-1 group-data-horizontal/tabs:h-auto [&>*]:h-8">{(["all", "active", "trial", "suspended", "cancelled"] as const).map((k) => <TabsTrigger key={k} value={k} className="capitalize">{k} ({counts[k]})</TabsTrigger>)}</TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Search name, contact, phone, city…" className="pl-8" aria-label="Search tenants" />
          </div>
          <Select value={plan} onValueChange={(v) => { if (v) { setPlan(v); setPage(0); } }}>
            <SelectTrigger aria-label="Plan filter"><SelectValue>{plan === "all" ? "All plans" : data.plans.find((p) => p.code === plan)?.name}</SelectValue></SelectTrigger>
            <SelectContent><SelectItem value="all">All plans</SelectItem>{data.plans.map((p) => <SelectItem key={p.code} value={p.code}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={city} onValueChange={(v) => { if (v) { setCity(v); setPage(0); } }}>
            <SelectTrigger aria-label="City filter"><SelectValue>{city === "all" ? "All cities" : city}</SelectValue></SelectTrigger>
            <SelectContent><SelectItem value="all">All cities</SelectItem>{cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={health} onValueChange={(v) => { if (v) { setHealth(v); setPage(0); } }}>
            <SelectTrigger aria-label="Health filter"><SelectValue>{health === "all" ? "All health" : health}</SelectValue></SelectTrigger>
            <SelectContent><SelectItem value="all">All health</SelectItem>{HEALTHS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
          </Select>
          {filtered && <Button variant="ghost" size="sm" onClick={resetFilters}><RotateCcw />Reset filters</Button>}
        </div>

        {rows.length ? <Table>
          <TableHeader><TableRow><TableHead className="w-8"><input type="checkbox" aria-label="Select all on page" checked={allChecked} onChange={toggleAll} className="size-4 accent-[#5b42f5]" /></TableHead>{sortHead("name", "Tenant")}<TableHead>City</TableHead><TableHead>Plan</TableHead>{sortHead("outletCount", "Outlets", true)}<TableHead>Status</TableHead>{sortHead("mrr", "MRR", true)}{sortHead("orders30d", "Orders (30d)", true)}{sortHead("createdAt", "Joined", false, "pl-6")}<TableHead className="pl-6">Health</TableHead><TableHead className="text-right"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
          <TableBody>{rows.map((t) => <TableRow key={t.id} className="cursor-pointer" onClick={() => setSelectedId(t.id)}>
            <TableCell onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${t.name}`} checked={checked.has(t.id)} onChange={() => toggleOne(t.id)} className="size-4 accent-[#5b42f5]" /></TableCell>
            <TableCell><p className="font-medium">{t.name}</p><p className="text-xs text-muted-foreground">{t.contactEmail ?? t.contactPhone}</p></TableCell>
            <TableCell className="text-muted-foreground">{t.cities.join(", ") || "—"}</TableCell>
            <TableCell><Badge variant="secondary">{t.planName}</Badge></TableCell>
            <TableCell className="text-right">{t.outletCount}</TableCell>
            <TableCell className="pl-6"><Badge variant="secondary" className={`capitalize ${statusTone[t.status]}`}>{t.status}</Badge></TableCell>
            <TableCell className="text-right">{t.status === "active" ? money(mrr(t)) : "—"}</TableCell>
            <TableCell className="text-right">{t.orders30d.toLocaleString("en-IN")}</TableCell>
            <TableCell className="pl-6 text-muted-foreground">{date(t.createdAt)}</TableCell>
            <TableCell className="pl-6"><Badge variant="secondary" className={healthTone[healthOf(t, now)]}>{healthOf(t, now)}</Badge></TableCell>
            <TableCell className="text-right"><Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedId(t.id); }}>View</Button></TableCell>
          </TableRow>)}</TableBody>
        </Table> : <div className="py-14 text-center">
          <p className="font-medium">{filtered ? "No tenants match your filters" : "No tenants yet"}</p>
          <p className="mt-1 text-sm text-muted-foreground">{filtered ? "Try a different search or clear the filters." : "Add your first restaurant to get started."}</p>
          {!filtered && <Button className="mt-4" onClick={() => setAdding(true)}><Plus />Add tenant</Button>}
        </div>}
        {all.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <p>Showing {current * pageSize + 1}–{Math.min(all.length, (current + 1) * pageSize)} of {all.length} {all.length === 1 ? "tenant" : "tenants"}</p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)}><ChevronLeft /></Button>
            {Array.from({ length: pages }, (_, i) => i).filter((i) => i === 0 || i === pages - 1 || Math.abs(i - current) <= 1).map((i, idx, arr) => <span key={i} className="flex items-center gap-1">
              {idx > 0 && i - arr[idx - 1] > 1 && <span aria-hidden="true">…</span>}
              <Button variant={i === current ? "default" : "outline"} size="icon-sm" aria-current={i === current ? "page" : undefined} onClick={() => setPage(i)}>{i + 1}</Button>
            </span>)}
            <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}><ChevronRight /></Button>
          </div>
          <label className="flex items-center gap-2">Rows per page
            <Select value={String(pageSize)} onValueChange={(v) => { if (v) { setPageSize(Number(v)); setPage(0); } }}>
              <SelectTrigger size="sm" aria-label="Rows per page"><SelectValue>{pageSize}</SelectValue></SelectTrigger>
              <SelectContent>{[10, 25, 50].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
            </Select>
          </label>
        </div>}
      </CardContent>
    </Card>

    <CreateTenantDialog key={String(adding)} open={adding} onOpenChange={setAdding} plans={data.plans.filter((p) => p.isPublic).map((p) => ({ code: p.code, name: p.name, kitchen: p.features.kitchenDisplay !== false }))} />
    <TenantSheet tenant={selected} plans={data.plans} now={now} onClose={() => setSelectedId(null)} />
  </div>;
}
