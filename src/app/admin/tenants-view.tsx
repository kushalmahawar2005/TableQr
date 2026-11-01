"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, ListFilter, Loader2, Plus, RotateCcw, Search, XCircle } from "lucide-react";
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
import { addOutletAction, changeTenantPlanAction, markPlanRequestDoneAction, recordFeePaymentAction, setTenantPriceAction, extendTrialAction, getTenantDetailAction, removeSelectedTenantsAction, deleteTenantPermanentlyAction, resetOwnerPinAction, setCustomPackageAction, setRoleAccessAction, setTenantKitchenAction, setTenantStatusAction, setTenantTableLimitAction, updateTenantAction } from "./actions";
import { CreateTenantDialog } from "./create-tenant-dialog";
import { FeeForm } from "./subscriptions-view";
import type { AdminData, AdminTenant, TenantDetail } from "./admin-types";
import { FEATURE_KEYS, FEATURE_LABELS, type Features } from "@/lib/plan-features";
import { BUSINESS_TYPES } from "@/lib/subscription-pricing";
import { onAdminOpen, takePendingTenant } from "./admin-nav";
import { csvCell, filterChip, ManageRow } from "./admin-ui";
import { CommercialForm } from "./commercial-form";
import { RoleAccessForm } from "./role-access-form";

const detailChart = { orders: { label: "Orders", color: "#D86B45" }, revenue: { label: "Paid bills (₹)", color: "#2f7d5b" } } satisfies ChartConfig;
const shortDay = (v: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(v));

function UsageBar({ label, used, max }: { label: string; used: number; max: number | null }) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return <div className="space-y-1"><div className="flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="font-medium">{used}{max ? ` / ${max}` : " · no limit"}</span></div>{max ? <div className="h-1.5 rounded-full bg-muted"><div className={`h-full rounded-full ${pct >= 90 ? "bg-red-500" : "bg-[var(--admin-brand)]"}`} style={{ width: `${pct}%` }} /></div> : null}</div>;
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
/** The tenant's kind of business in plain words, for the list and the category filter */
const categoryOf = (t: AdminTenant) => (t.businessType ? BUSINESS_TYPES[t.businessType] : "Not set");
const mrr = (t: AdminTenant) => t.status === "active" ? (t.monthlyPricePaise ?? 0) * t.outletCount : 0;

/** Status in words: trial days left, trial ended, fees due, or paused */
function accessBadge(t: AdminTenant, now: number): { label: string; tone: string } {
  const days = (iso: string | null) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86_400_000)) : 0);
  const red = "bg-red-100 text-red-700";
  const amber = "bg-amber-100 text-amber-700";
  const { state, reason } = t.access;
  if (reason === "suspended") return { label: "Suspended", tone: red };
  if (reason === "cancelled") return { label: "Cancelled", tone: statusTone.cancelled };
  if (state === "blocked") return { label: reason === "trial" ? "Trial ended · paused" : "Fees due · paused", tone: red };
  if (state === "grace") return { label: `${reason === "trial" ? "Trial ended" : "Fees due"} · stops in ${days(t.access.stopsAt)}d`, tone: red };
  if (reason === "trial") return { label: `Trial · ${days(t.access.endsAt)}d left`, tone: amber };
  // A trial made before end dates existed never ends until the admin extends it
  if (t.status === "trial") return { label: "Trial · no end date", tone: amber };
  return { label: "Active", tone: statusTone.active };
}

/** More free days, from today or from the current trial end, whichever is later */
function ExtendTrial({ pending, onExtend }: { pending: boolean; onExtend: (days: number) => void }) {
  const [custom, setCustom] = useState("");
  return <div className="flex flex-wrap items-center gap-2">
    {[7, 14, 30].map((d) => <Button key={d} variant="outline" size="sm" disabled={pending} onClick={() => onExtend(d)}>+{d} days</Button>)}
    <Input inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="Days" aria-label="Extend trial by days" className="h-8 w-20" />
    <Button size="sm" disabled={pending || !custom || Number(custom) < 1 || Number(custom) > 90} onClick={() => onExtend(Number(custom))}>Extend</Button>
  </div>;
}

/** What the restaurant can use right now, as ticks and crosses */
function FeatureList({ features }: { features: Features }) {
  return <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
    <li className="flex justify-between gap-2 sm:col-span-2"><span className="text-muted-foreground">Tables · Staff{features.rooms ? " · Rooms" : ""}</span><span className="font-medium">{features.maxTables ?? "No limit"} · {features.maxStaff ?? "No limit"}{features.rooms ? ` · ${features.maxRooms ?? "No limit"}` : ""}</span></li>
    {FEATURE_KEYS.map((k) => <li key={k} className={`flex items-center gap-2 ${features[k] ? "" : "text-muted-foreground line-through decoration-zinc-300"}`}><span aria-hidden="true">{features[k] ? "✓" : "✕"}</span>{FEATURE_LABELS[k].label}<span className="sr-only">{features[k] ? "included" : "not included"}</span></li>)}
  </ul>;
}

/** What this restaurant pays: the plan's price, or more or less as agreed with them */
function PriceForm({ tenant, planPricePaise, pending, onSave }: { tenant: AdminTenant; planPricePaise: number | null; pending: boolean; onSave: (rupees: number | null) => void }) {
  const [price, setPrice] = useState(tenant.customPricePaise === null ? "" : String(tenant.customPricePaise / 100));
  const list = planPricePaise === null ? "no list price" : `₹${(planPricePaise / 100).toLocaleString("en-IN")}`;
  return <section className="space-y-1.5">
    <Label>Price per outlet per month</Label>
    <p className="text-xs text-muted-foreground">Leave empty for the plan&apos;s price ({list}).</p>
    <div className="flex gap-2">
      <Input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 7))} placeholder={planPricePaise === null ? "₹ per month" : String(planPricePaise / 100)} aria-label="Price per outlet per month in rupees" />
      <Button variant="outline" disabled={pending} onClick={() => onSave(price === "" ? null : Number(price))}>Save</Button>
    </div>
    {tenant.customPricePaise !== null && <p className="text-xs text-[var(--admin-brand)]">Special price: ₹{(tenant.customPricePaise / 100).toLocaleString("en-IN")} instead of {list}.</p>}
  </section>;
}

/** Another outlet: it shares the menu; the owner switches to it at the top of the console */
function AddOutletForm({ pending, maxTables, onSave }: { pending: boolean; maxTables: number | null; onSave: (input: { name: string; city: string; address: string; code: string; tableCount: number }) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}><Plus />Add outlet</Button>;
  return <form className="space-y-3 rounded-xl border bg-white p-4" onSubmit={(e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    onSave({ name: String(f.get("name") ?? ""), city: String(f.get("city") ?? ""), address: String(f.get("address") ?? ""), code: String(f.get("code") ?? ""), tableCount: Number(f.get("tables") || 4) });
  }}>
    <div><h3 className="text-sm font-semibold">Add outlet</h3><p className="text-xs text-muted-foreground">Same menu as the first outlet. Prices can still be changed per outlet in Pricing.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5"><Label htmlFor="outlet-name">Outlet name</Label><Input id="outlet-name" name="name" required maxLength={80} placeholder="e.g. Spice Route, MI Road" /></div>
      <div className="space-y-1.5"><Label htmlFor="outlet-city">City</Label><Input id="outlet-city" name="city" required maxLength={60} /></div>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="outlet-address">Address</Label><Input id="outlet-address" name="address" required maxLength={300} /></div>
      <div className="space-y-1.5"><Label htmlFor="outlet-code">Sign-in code</Label><Input id="outlet-code" name="code" maxLength={12} placeholder="Made for you if empty" className="uppercase" /></div>
      <div className="space-y-1.5"><Label htmlFor="outlet-tables">Tables</Label><Input id="outlet-tables" name="tables" type="number" min={1} max={maxTables ?? 100} defaultValue={Math.min(4, maxTables ?? 4)} /></div>
    </div>
    <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Add outlet</Button>
  </form>;
}

/** Tick what this restaurant gets, set its limits and its price */
function CustomPackageForm({ tenant, pending, onSave }: { tenant: AdminTenant; pending: boolean; onSave: (input: { features: Features; priceRupees: number }) => void }) {
  const [f, setF] = useState<Features>(tenant.features);
  const [price, setPrice] = useState(String(Math.round((tenant.customPricePaise ?? tenant.monthlyPricePaise ?? 0) / 100)));
  const limit = (v: string) => (v === "" ? null : Math.max(1, Number(v.replace(/\D/g, "")) || 1));
  const tick = "flex min-h-10 items-center gap-2.5 text-sm";
  return <div className="space-y-3">
    <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
      {FEATURE_KEYS.map((k) => <label key={k} title={FEATURE_LABELS[k].hint} className={tick}><input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} className="size-4 shrink-0 accent-[var(--admin-brand)]" />{FEATURE_LABELS[k].label}</label>)}
      <label title="A small line on the guest page" className={tick}><input type="checkbox" checked={f.poweredBy} onChange={(e) => setF({ ...f, poweredBy: e.target.checked })} className="size-4 shrink-0 accent-[var(--admin-brand)]" />Show “Powered by Tableeqr”</label>
    </div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div className="space-y-1"><Label htmlFor="custom-tables" className="text-xs">Tables</Label><Input id="custom-tables" inputMode="numeric" value={f.maxTables ?? ""} placeholder="No limit" onChange={(e) => setF({ ...f, maxTables: limit(e.target.value) })} /></div>
      <div className="space-y-1"><Label htmlFor="custom-staff" className="text-xs">Staff logins</Label><Input id="custom-staff" inputMode="numeric" value={f.maxStaff ?? ""} placeholder="No limit" onChange={(e) => setF({ ...f, maxStaff: limit(e.target.value) })} /></div>
      <div className="space-y-1"><Label htmlFor="custom-rooms" className="text-xs">Rooms</Label><Input id="custom-rooms" inputMode="numeric" value={f.maxRooms ?? ""} placeholder="No limit" onChange={(e) => setF({ ...f, maxRooms: limit(e.target.value) })} /></div>
      <div className="space-y-1"><Label htmlFor="custom-price" className="text-xs">Price / month (₹)</Label><Input id="custom-price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 7))} /></div>
    </div>
    {tenant.planCode !== "custom" && <p className="text-xs text-muted-foreground">Saving moves this tenant to a custom package.</p>}
    <Button disabled={pending || price === ""} onClick={() => onSave({ features: f, priceRupees: Number(price) })}>{pending && <Loader2 className="animate-spin" />}Save</Button>
  </div>;
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-3 px-3 py-2 text-sm odd:bg-muted/60"><dt className="shrink-0 text-muted-foreground">{label}</dt><dd className="min-w-0 break-words text-right font-medium">{children}</dd></div>;
}

function TenantSheet({ tenant, plans, now, onClose }: { tenant: AdminTenant | null; plans: AdminData["plans"]; now: number; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [tab, setTab] = useState("overview");
  const [row, setRow] = useState<string | null>(null);
  const manage = (name: string) => { setTab("manage"); setRow(name); };
  const toggleRow = (name: string) => setRow((open) => (open === name ? null : name));
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
    <SheetContent className="w-full gap-0 overflow-y-auto bg-[var(--admin-bg)] data-[side=right]:sm:max-w-3xl">
      {tenant && <>
        <SheetHeader className="border-b bg-white p-4 sm:p-5">
          <div className="flex items-center gap-3 pr-8">
            <span className="hidden size-12 shrink-0 place-items-center rounded-xl bg-[var(--admin-brand)] sm:grid text-sm font-bold text-white">{tenant.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <SheetTitle className="flex flex-wrap items-center gap-2 text-lg">{tenant.name}<Badge variant="secondary" className={accessBadge(tenant, now).tone}>{accessBadge(tenant, now).label}</Badge></SheetTitle>
              <SheetDescription className="truncate">{[tenant.contactEmail ?? tenant.contactPhone, tenant.cities.join(", ")].filter(Boolean).join(" · ")}</SheetDescription>
            </div>
            <Badge variant="secondary" className="shrink-0">{tenant.planName}</Badge>
          </div>
        </SheetHeader>
        <Tabs value={tab} className="gap-0" onValueChange={(v) => { setTab(String(v)); setError(null); setNotice(null); }}>
          <TabsList variant="line" className="no-scrollbar h-11 w-full justify-start overflow-x-auto border-b bg-white px-2 sm:px-4"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="outlets">Outlets</TabsTrigger><TabsTrigger value="staff">Staff</TabsTrigger><TabsTrigger value="edit">Edit</TabsTrigger><TabsTrigger value="manage">Manage</TabsTrigger></TabsList>
          <div className="space-y-4 p-3 sm:p-4">
          {error && <p role="alert" className="sticky top-0 z-10 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {notice && <p role="status" className="sticky top-0 z-10 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

          <TabsContent value="overview" className="space-y-4">
            {tenant.requests.length > 0 && <section className="rounded-xl border border-[var(--admin-brand)]/40 bg-card p-4">
                <h3 className="text-sm font-semibold">They asked for</h3>
                <p className="mb-2 text-xs text-muted-foreground">Make the change in Manage, then mark it done.</p>
                <ul className="space-y-2">{tenant.requests.map((r) => <li key={r.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0"><p className="font-medium">{r.feature && r.feature in FEATURE_LABELS ? FEATURE_LABELS[r.feature as keyof typeof FEATURE_LABELS].label : "Plan change"}</p>
                    <p className="text-xs text-muted-foreground">{r.note ? `“${r.note}” · ` : ""}{r.requestedBy} · {shortDay(r.createdAt)}</p></div>
                  <div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" onClick={() => manage("plan")}>Manage</Button><Button size="sm" disabled={pending} onClick={() => run(() => markPlanRequestDoneAction(r.id), "Marked done.")}>Done</Button></div>
                </li>)}</ul>
              </section>}
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[["Orders", tenant.orders30d.toLocaleString("en-IN")], ["Paid bills", money(tenant.paidBills30dPaise)], ["Outlets", String(tenant.outletCount)]].map(([k, v]) => <div key={k} className="min-w-0 rounded-xl border bg-white p-3"><p className="truncate text-[11px] text-muted-foreground">{k}</p><p className="mt-1 truncate text-base font-bold tabular-nums sm:text-xl">{v}</p></div>)}
            </div>
            <p className="-mt-2 text-[11px] text-muted-foreground">Orders and paid bills are for the last 30 days.</p>
            {detailError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{detailError}</p>}
            {!detail && !detailError && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading details…</p>}
            {detail && <section className="rounded-xl border bg-white p-4"><h3 className="mb-2 text-sm font-semibold">Orders and paid bills</h3>
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
                <dl className="overflow-hidden rounded-lg border"><Detail label="Category">{categoryOf(tenant)}</Detail><Detail label="Contact">{tenant.contactName}</Detail><Detail label="Phone">{tenant.contactPhone}</Detail><Detail label="Email">{tenant.contactEmail ?? "—"}</Detail><Detail label="Last order">{date(tenant.lastOrderAt)}</Detail><Detail label="Joined">{date(tenant.createdAt)}</Detail></dl>
              </section>
              {detail ? <section className="space-y-3 rounded-xl border bg-white p-4"><h3 className="text-sm font-semibold">Usage vs plan limits</h3>
                <UsageBar label="Tables" used={detail.usage.tables} max={detail.usage.maxTables} />
                <UsageBar label="Staff" used={detail.usage.staff} max={detail.usage.maxStaff} />
                {(tenant.features.rooms || detail.usage.rooms > 0) && <UsageBar label="Rooms" used={detail.usage.rooms} max={detail.usage.maxRooms} />}
                <UsageBar label="Outlets" used={detail.usage.outlets} max={null} />
                <p className="flex justify-between text-xs"><span className="text-muted-foreground">QR codes</span><span className="font-medium">{detail.usage.qrCodes}</span></p>
                <p className="flex justify-between text-xs"><span className="text-muted-foreground">Menu items</span><span className="font-medium">{detail.usage.menuItems}</span></p>
              </section> : null}
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
                <Button variant="outline" size="sm" className="mt-3" onClick={() => manage(tenant.planCode === "custom" ? "features" : "plan")}>{tenant.planCode === "custom" ? "Edit custom package" : "Change plan"}</Button>
              </section>
              
              <section className="rounded-xl border bg-white p-4 sm:col-span-2"><h3 className="mb-2 text-sm font-semibold">What they get</h3><FeatureList features={tenant.features} /></section>
              <section className="rounded-xl border bg-white p-4"><h3 className="mb-2 text-sm font-semibold">Quick actions</h3>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setTab("edit")}>Edit details</Button>
                  <Button variant="outline" size="sm" onClick={() => manage("pin")}>Reset owner PIN</Button>
                  {tenant.status !== "cancelled" && <Button variant="outline" size="sm" onClick={() => manage("fees")}>{tenant.status === "trial" ? "Extend trial / fees" : "Record fees"}</Button>}
                  {tenant.status === "suspended" || tenant.status === "cancelled"
                    ? <Button size="sm" disabled={pending} onClick={() => run(() => setTenantStatusAction(tenant.id, "active"), "Tenant activated.")}>Activate</Button>
                    : <Button variant="destructive" size="sm" disabled={pending} onClick={() => { if (window.confirm(`Suspend ${tenant.name}? Their staff will lose access.`)) run(() => setTenantStatusAction(tenant.id, "suspended"), "Tenant suspended."); }}>Suspend</Button>}
                </div>
              </section>
            </div>
          </TabsContent>

          <TabsContent value="outlets" className="space-y-4">
            <section className="rounded-xl border bg-white p-4">
              {detail ? <Table><TableHeader><TableRow><TableHead>Outlet</TableHead><TableHead>Sign-in code</TableHead><TableHead className="hidden sm:table-cell">City</TableHead><TableHead className="text-right">Tables</TableHead></TableRow></TableHeader>
                <TableBody>{detail.outlets.map((o) => <TableRow key={o.id}><TableCell className="max-w-0 w-full"><span className="block truncate font-medium">{o.name}</span><span className="block truncate text-xs text-muted-foreground sm:hidden">{o.city}</span></TableCell><TableCell className="font-mono">{o.code}</TableCell><TableCell className="hidden text-muted-foreground sm:table-cell">{o.city}</TableCell><TableCell className="text-right">{o.tables}</TableCell></TableRow>)}</TableBody></Table>
                : <p className="text-sm text-muted-foreground">{detailError ?? "Loading…"}</p>}
            </section>
            {tenant.features.multiOutlet
              ? <AddOutletForm key={tenant.id} pending={pending} maxTables={tenant.features.maxTables} onSave={(input) => run(async () => {
                  const r = await addOutletAction(tenant.id, input);
                  if (!r.error) { const d = await getTenantDetailAction(tenant.id); setLoaded({ id: tenant.id, detail: d.detail, error: d.error }); }
                  return r;
                }, `Outlet added. The owner signs in there with its sign-in code, or switches outlet at the top of the console.`)} />
              : <section className="rounded-xl border border-dashed bg-white p-4 text-sm text-muted-foreground">Multiple outlets is not in the {tenant.planName} plan. Change the plan, or pick Custom and tick “Multiple outlets”, to add another outlet.</section>}
          </TabsContent>

          <TabsContent value="staff" className="rounded-xl border bg-white p-2 sm:p-4">
            {detail ? <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead className="hidden sm:table-cell">Role</TableHead><TableHead className="hidden sm:table-cell">Phone</TableHead><TableHead className="pl-3">Status</TableHead></TableRow></TableHeader>
              <TableBody>{detail.staff.map((m, i) => <TableRow key={`${m.id}-${i}`}><TableCell className="max-w-0 w-full"><span className="block truncate font-medium">{m.name}</span><span className="block truncate text-xs capitalize text-muted-foreground sm:hidden">{m.role} · {m.phone}</span></TableCell><TableCell className="hidden capitalize sm:table-cell">{m.role}</TableCell><TableCell className="hidden text-muted-foreground sm:table-cell">{m.phone}</TableCell><TableCell className="pl-3"><Badge variant="secondary" className={m.isActive ? statusTone.active : statusTone.cancelled}>{m.isActive ? "Active" : "Inactive"}</Badge></TableCell></TableRow>)}</TableBody></Table>
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

          <TabsContent value="manage" className="space-y-2">
            <ManageRow title="Plan and price" note={`${tenant.planName}${tenant.monthlyPricePaise ? ` · ${money(tenant.monthlyPricePaise)} per outlet` : ""}`} open={row === "plan"} onToggle={() => toggleRow("plan")}>
              <div className="space-y-1.5">
                <Label>Plan</Label>
                <Select value={tenant.planCode} onValueChange={(v) => v && v !== tenant.planCode && run(() => changeTenantPlanAction(tenant.id, v), "Plan changed.")}>
                  <SelectTrigger className="w-full" aria-label="Change plan"><SelectValue>{tenant.planName}</SelectValue></SelectTrigger>
                  <SelectContent>{plans.map((p) => <SelectItem key={p.code} value={p.code}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {tenant.planCode !== "custom" && <PriceForm key={`${tenant.id}-${tenant.customPricePaise}`} tenant={tenant} planPricePaise={plans.find((p) => p.code === tenant.planCode)?.monthlyPricePaise ?? null} pending={pending}
                onSave={(rupees) => run(() => setTenantPriceAction(tenant.id, rupees), rupees === null ? "Back to the plan's price." : "Price saved.")} />}
              {tenant.planCode !== "custom" && <><div>
                <form
                  className="flex flex-wrap items-end justify-between gap-3"
                  onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get("tableLimit") ?? "").trim(); run(() => setTenantTableLimitAction(tenant.id, v === "" ? null : Number(v)), v === "" ? "Table limit follows the plan again." : "Table limit saved."); }}
                >
                  <div>
                    <h3 className="text-sm font-semibold">Tables allowed</h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">The owner cannot add more tables than this on the floor plan; they are asked to upgrade. Leave empty to follow the {tenant.planName} plan.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input key={tenant.id + String(tenant.tableLimitOverride)} name="tableLimit" type="number" min={1} max={500} defaultValue={tenant.tableLimitOverride ?? ""} placeholder={tenant.tableLimitOverride === null && tenant.tableLimit !== null ? `Plan: ${tenant.tableLimit}` : "No limit"} className="w-28" aria-label="Tables allowed" />
                    <Button size="sm" type="submit" disabled={pending}>Save</Button>
                  </div>
                </form>
              </div>
              <div>
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
              </div></>}
            </ManageRow>
            <ManageRow title="Features" note={`${FEATURE_KEYS.filter((k) => tenant.features[k]).length} of ${FEATURE_KEYS.length} on · ${tenant.features.maxTables ?? "No limit on"} tables`} open={row === "features"} onToggle={() => toggleRow("features")}>
              <CustomPackageForm tenant={tenant} pending={pending} onSave={(input) => run(() => setCustomPackageAction(tenant.id, input), "Features saved.")} />
            </ManageRow>
            <ManageRow title="Staff access" note="Which role opens which screen" open={row === "roles"} onToggle={() => toggleRow("roles")}>
              <RoleAccessForm roleAccess={tenant.roleAccess} pending={pending} onSave={(access) => run(() => setRoleAccessAction(tenant.id, access), "Staff access saved.")} />
            </ManageRow>
            {tenant.status !== "cancelled" && <ManageRow title="Trial and fees" note={accessBadge(tenant, now).label} open={row === "fees"} onToggle={() => toggleRow("fees")}>
              {tenant.status === "trial" && <div className="space-y-2"><p className="text-sm font-semibold">Give more free days</p><ExtendTrial pending={pending} onExtend={(days) => run(() => extendTrialAction(tenant.id, days), `Trial extended by ${days} days.`)} /></div>}
              <FeeForm t={tenant} pending={pending} onSave={(input) => run(() => recordFeePaymentAction(tenant.id, input), `Saved. Paid for ${input.months} ${input.months === 1 ? "month" : "months"}.`)} />
            </ManageRow>}
            <ManageRow title="Category and setup" note={categoryOf(tenant)} open={row === "setup"} onToggle={() => toggleRow("setup")}>
              <CommercialForm tenantId={tenant.id} />
            </ManageRow>
            <ManageRow title="Owner PIN" note="Set a new 4-digit PIN" open={row === "pin"} onToggle={() => toggleRow("pin")}>
              <div className="flex gap-2">
                <Input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="New 4-digit PIN" aria-label="New owner PIN" />
                <Button variant="outline" disabled={pending || pin.length !== 4} onClick={() => run(() => resetOwnerPinAction(tenant.id, pin), "Owner PIN reset.")}>Reset</Button>
              </div>
            </ManageRow>
            <ManageRow title="Access" note={tenant.status === "suspended" || tenant.status === "cancelled" ? "Turned off" : "Tenant can use Tableeqr"} open={row === "access"} onToggle={() => toggleRow("access")}>
              <div className="flex flex-wrap gap-2">
                {tenant.status === "suspended" || tenant.status === "cancelled"
                  ? <Button disabled={pending} onClick={() => run(() => setTenantStatusAction(tenant.id, "active"), "Tenant activated.")}>{busy}Activate tenant</Button>
                  : <Button variant="destructive" disabled={pending} onClick={() => { if (window.confirm(`Suspend ${tenant.name}? Their staff will lose access.`)) run(() => setTenantStatusAction(tenant.id, "suspended"), "Tenant suspended."); }}>{busy}Suspend tenant</Button>}
                {(tenant.status === "suspended" || tenant.status === "cancelled") && <Button variant="destructive" disabled={pending} onClick={() => { const typed = window.prompt(`This deletes ${tenant.name} and all its data forever. Type the name to confirm:`); if (typed !== null) run(() => deleteTenantPermanentlyAction(tenant.id, typed), "Tenant deleted permanently."); }}>{busy}Delete permanently</Button>}
              </div>
            </ManageRow>
          </TabsContent>

          </div>
        </Tabs>
      </>}
    </SheetContent>
  </Sheet>;
}

type SortKey = "name" | "outletCount" | "mrr" | "orders30d" | "createdAt";
const SORTS = [{ value: "createdAt:-1", label: "Newest first" }, { value: "name:1", label: "Name A to Z" }, { value: "orders30d:-1", label: "Most orders" }, { value: "mrr:-1", label: "Most income" }, { value: "outletCount:-1", label: "Most outlets" }];

export function TenantsView({ data, canRemove }: { data: AdminData; canRemove: boolean }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [plan, setPlan] = useState("all");
  const [adding, setAdding] = useState(false);
  // A link from the dashboard or Fees may ask for one tenant's panel
  const [selectedId, setSelectedId] = useState<string | null>(() => takePendingTenant());
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "createdAt", dir: -1 });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [city, setCity] = useState("all");
  const [category, setCategory] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [health, setHealth] = useState("all");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [isRemoving, startRemove] = useTransition();
  const router = useRouter();
  const now = new Date(data.asOf).getTime();
  // A notification can ask for a tenant while this page is already open
  useEffect(() => onAdminOpen(() => { const id = takePendingTenant(); if (id) setSelectedId(id); }), []);

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
      (city === "all" || t.cities.includes(city)) && (category === "all" || categoryOf(t) === category) && (health === "all" || healthOf(t, now) === health) &&
      (!q || [t.name, t.contactName, t.contactEmail ?? "", t.contactPhone, ...t.cities].some((v) => v.toLowerCase().includes(q))))
      .sort((a, b) => (value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : 0) * sort.dir);
  }, [data.tenants, query, status, plan, city, category, health, sort, now]);
  const cities = useMemo(() => [...new Set(data.tenants.flatMap((t) => t.cities))].sort(), [data.tenants]);

  const categories = useMemo(() => {
    const seen = new Map<string, number>();
    for (const t of data.tenants) seen.set(categoryOf(t), (seen.get(categoryOf(t)) ?? 0) + 1);
    return [...seen].sort((a, b) => b[1] - a[1]);
  }, [data.tenants]);

  const pages = Math.max(1, Math.ceil(all.length / pageSize));
  const current = Math.min(page, pages - 1);
  const rows = all.slice(current * pageSize, (current + 1) * pageSize);
  const toggleSort = (key: SortKey) => { setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "name" ? 1 : -1 })); setPage(0); };
  const sortHead = (key: SortKey, label: string, right = false, extra = "") => <TableHead className={`${right ? "text-right" : ""} ${extra}`} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
    <button type="button" onClick={() => toggleSort(key)} className={`inline-flex items-center gap-1 hover:text-foreground ${right ? "flex-row-reverse" : ""}`}>{label}{sort.key === key && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}</button>
  </TableHead>;

  const exportCsv = () => {
    const header = ["Name", "Category", "Contact", "Phone", "Email", "Plan", "Status", "Outlets", "Cities", "Monthly income (INR)", "Orders 30d", "Joined"];
    const exportRows = checked.size ? all.filter((t) => checked.has(t.id)) : all;
    const lines = exportRows.map((t) => [t.name, categoryOf(t), t.contactName, t.contactPhone, t.contactEmail ?? "", t.planName, t.status, t.outletCount, t.cities.join("; "), Math.round(mrr(t) / 100), t.orders30d, t.createdAt.slice(0, 10)].map(csvCell).join(","));
    const url = URL.createObjectURL(new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: "tenants.csv" });
    link.click();
    URL.revokeObjectURL(url);
  };

  const selected = data.tenants.find((t) => t.id === selectedId) ?? null;
  const filtered = !!query || status !== "all" || plan !== "all" || city !== "all" || category !== "all" || health !== "all";
  const resetFilters = () => { setQuery(""); setStatus("all"); setPlan("all"); setCity("all"); setCategory("all"); setHealth("all"); setPage(0); };
  const pageIds = rows.map((t) => t.id);
  const allChecked = pageIds.length > 0 && pageIds.every((id) => checked.has(id));
  const toggleAll = () => setChecked((c) => { const n = new Set(c); for (const id of pageIds) { if (allChecked) n.delete(id); else n.add(id); } return n; });
  const toggleOne = (id: string) => setChecked((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const removeSelected = () => {
    if (!canRemove) return;
    const targets = data.tenants.filter((tenant) => checked.has(tenant.id) && tenant.status !== "cancelled");
    if (!targets.length) return;
    const names = targets.slice(0, 5).map((tenant) => tenant.name).join(", ");
    const suffix = targets.length > 5 ? ` and ${targets.length - 5} more` : "";
    if (!window.confirm(`Remove ${targets.length} selected restaurant${targets.length === 1 ? "" : "s"} (${names}${suffix})? Access will be turned off, but their records and billing history will be kept. You can reactivate them from their profile.`)) return;
    setSelectionError(null);
    startRemove(async () => {
      const result = await removeSelectedTenantsAction(targets.map((tenant) => tenant.id));
      if (result.error) { setSelectionError(result.error); return; }
      setChecked(new Set());
      router.refresh();
    });
  };

  const sortChoice = `${sort.key}:${sort.dir}`;
  const pickCategory = (value: string) => { setCategory(value); setPage(0); };

  return <div className="space-y-4">
    <div className="md:pr-44"><h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Tenants</h1><p className="mt-1 text-sm text-muted-foreground">{data.tenants.length} on Tableeqr</p></div>

    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Category" className="no-scrollbar -mx-4 flex min-w-0 flex-1 basis-full gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:basis-0 sm:px-0">
        <button type="button" aria-pressed={category === "all"} onClick={() => pickCategory("all")} className={filterChip(category === "all")}>All {data.tenants.length}</button>
        {categories.map(([name, count]) => <button key={name} type="button" aria-pressed={category === name} onClick={() => pickCategory(name)} className={filterChip(category === name)}>{name} {count}</button>)}
      </div>
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto"><Button variant="outline" onClick={exportCsv} disabled={!all.length}><Download />{checked.size ? `Export ${checked.size}` : "Export"}</Button><Button onClick={() => setAdding(true)}><Plus />Add tenant</Button></div>
    </div>

    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:w-full sm:flex-none xl:w-auto xl:min-w-64 xl:flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Search name, phone, city" className="pl-8" aria-label="Search tenants" />
          </div>
          <Button variant="outline" className="sm:hidden" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><ListFilter />Filter{filtered && " •"}</Button>
          <div className={`${filtersOpen ? "grid" : "hidden"} w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap [&_[data-slot=select-trigger]]:w-full sm:[&_[data-slot=select-trigger]]:w-auto`}>
            <Select value={status} onValueChange={(v) => { if (v) { setStatus(v); setPage(0); } }}>
              <SelectTrigger aria-label="Status filter"><SelectValue>{status === "all" ? "All status" : `${status[0].toUpperCase()}${status.slice(1)} (${counts[status]})`}</SelectValue></SelectTrigger>
              <SelectContent><SelectItem value="all">All status</SelectItem>{(["active", "trial", "suspended", "cancelled"] as const).map((k) => <SelectItem key={k} value={k}><span className="capitalize">{k}</span> ({counts[k]})</SelectItem>)}</SelectContent>
            </Select>
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
            <div className="lg:hidden">
              <Select value={sortChoice} onValueChange={(v) => { if (v) { const [key, dir] = v.split(":"); setSort({ key: key as SortKey, dir: Number(dir) as 1 | -1 }); setPage(0); } }}>
                <SelectTrigger aria-label="Sort"><SelectValue>{SORTS.find((o) => o.value === sortChoice)?.label ?? "Sort"}</SelectValue></SelectTrigger>
                <SelectContent>{SORTS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {filtered && <Button variant="ghost" size="sm" onClick={resetFilters}><RotateCcw />Reset</Button>}
        </div>

        {checked.size > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--admin-brand)]/25 bg-[var(--admin-brand)]/5 px-3 py-2.5">
          <div className="text-sm font-medium">{checked.size} selected{selectionError ? <p role="alert" className="mt-1 font-normal text-red-600">{selectionError}</p> : null}</div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => { setChecked(new Set()); setSelectionError(null); }}>Clear selection</Button>
            {canRemove && <Button variant="destructive" size="sm" disabled={isRemoving || !data.tenants.some((tenant) => checked.has(tenant.id) && tenant.status !== "cancelled")} onClick={removeSelected}>{isRemoving ? <Loader2 className="animate-spin" /> : <XCircle />}Remove selected</Button>}
          </div>
        </div>}

        {rows.length ? <>
        <ul className="divide-y lg:hidden">{rows.map((t) => { const badge = accessBadge(t, now); return <li key={t.id} className="flex items-start gap-3 py-3">
          <input type="checkbox" aria-label={`Select ${t.name}`} checked={checked.has(t.id)} onChange={() => toggleOne(t.id)} className="mt-1 size-4 shrink-0 accent-[var(--admin-brand)]" />
          <button type="button" onClick={() => setSelectedId(t.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-[var(--admin-brand)]">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{t.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{[categoryOf(t), t.cities.join(", "), t.planName].filter(Boolean).join(" · ")}</span>
              <span className="mt-1.5 flex flex-wrap items-center gap-1.5"><Badge variant="secondary" className={badge.tone}>{badge.label}</Badge><Badge variant="secondary" className={healthTone[healthOf(t, now)]}>{healthOf(t, now)}</Badge></span>
              <span className="mt-1 block text-xs tabular-nums text-muted-foreground">{t.orders30d.toLocaleString("en-IN")} orders{t.status === "active" ? ` · ${money(mrr(t))} a month` : ""}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </li>; })}</ul>
        <div className="hidden lg:block"><Table>
          <TableHeader><TableRow><TableHead className="w-8"><input type="checkbox" aria-label="Select all on page" checked={allChecked} onChange={toggleAll} className="size-4 accent-[var(--admin-brand)]" /></TableHead>{sortHead("name", "Tenant")}<TableHead className="hidden xl:table-cell">Category</TableHead><TableHead>Plan</TableHead>{sortHead("outletCount", "Outlets", true, "hidden 2xl:table-cell")}<TableHead className="pl-6">Status</TableHead>{sortHead("mrr", "A month", true)}{sortHead("orders30d", "Orders", true)}{sortHead("createdAt", "Joined", false, "hidden pl-6 2xl:table-cell")}<TableHead className="pl-6">Health</TableHead><TableHead><span className="sr-only">Open</span></TableHead></TableRow></TableHeader>
          <TableBody>{rows.map((t) => <TableRow key={t.id} className="cursor-pointer" onClick={() => setSelectedId(t.id)}>
            <TableCell onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${t.name}`} checked={checked.has(t.id)} onChange={() => toggleOne(t.id)} className="size-4 accent-[var(--admin-brand)]" /></TableCell>
            <TableCell className="max-w-64"><p className="truncate font-semibold">{t.name}</p><p className="truncate text-xs text-muted-foreground">{t.cities.join(", ") || t.contactEmail || t.contactPhone}</p></TableCell>
            <TableCell className="hidden text-muted-foreground xl:table-cell">{categoryOf(t)}</TableCell>
            <TableCell><Badge variant="secondary">{t.planName}</Badge></TableCell>
            <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{t.outletCount}</TableCell>
            <TableCell className="pl-6"><Badge variant="secondary" className={accessBadge(t, now).tone}>{accessBadge(t, now).label}</Badge></TableCell>
            <TableCell className="text-right tabular-nums">{t.status === "active" ? money(mrr(t)) : "—"}</TableCell>
            <TableCell className="text-right font-semibold tabular-nums">{t.orders30d.toLocaleString("en-IN")}</TableCell>
            <TableCell className="hidden pl-6 text-muted-foreground 2xl:table-cell">{date(t.createdAt)}</TableCell>
            <TableCell className="pl-6"><Badge variant="secondary" className={healthTone[healthOf(t, now)]}>{healthOf(t, now)}</Badge></TableCell>
            <TableCell className="w-8 text-right"><button type="button" aria-label={`Open ${t.name}`} onClick={(e) => { e.stopPropagation(); setSelectedId(t.id); }} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--admin-brand)]"><ChevronRight className="size-4" /></button></TableCell>
          </TableRow>)}</TableBody>
        </Table></div>
        </> : <div className="py-14 text-center">
          <p className="font-medium">{filtered ? "No tenants match" : "No tenants yet"}</p>
          <p className="mt-1 text-sm text-muted-foreground">{filtered ? "Try another search or reset the filters." : "Add your first restaurant to get started."}</p>
          {!filtered && <Button className="mt-4" onClick={() => setAdding(true)}><Plus />Add tenant</Button>}
        </div>}
        {all.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <p>{current * pageSize + 1}–{Math.min(all.length, (current + 1) * pageSize)} of {all.length}</p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)}><ChevronLeft /></Button>
            {Array.from({ length: pages }, (_, i) => i).filter((i) => i === 0 || i === pages - 1 || Math.abs(i - current) <= 1).map((i, idx, arr) => <span key={i} className="flex items-center gap-1">
              {idx > 0 && i - arr[idx - 1] > 1 && <span aria-hidden="true">…</span>}
              <Button variant={i === current ? "default" : "outline"} size="icon-sm" aria-current={i === current ? "page" : undefined} onClick={() => setPage(i)}>{i + 1}</Button>
            </span>)}
            <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}><ChevronRight /></Button>
          </div>
          <label className="hidden items-center gap-2 sm:flex">Rows per page
            <Select value={String(pageSize)} onValueChange={(v) => { if (v) { setPageSize(Number(v)); setPage(0); } }}>
              <SelectTrigger size="sm" aria-label="Rows per page"><SelectValue>{pageSize}</SelectValue></SelectTrigger>
              <SelectContent>{[10, 25, 50].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
            </Select>
          </label>
        </div>}
      </CardContent>
    </Card>

    <CreateTenantDialog key={String(adding)} open={adding} onOpenChange={setAdding} plans={data.plans.filter((p) => p.isPublic).map((p) => ({ code: p.code, name: p.name, features: p.features }))} />
    <TenantSheet key={selectedId ?? "closed"} tenant={selected} plans={data.plans} now={now} onClose={() => setSelectedId(null)} />
  </div>;
}
