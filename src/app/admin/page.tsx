import type { Metadata } from "next";
import { count, desc, eq, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { currentPlatformAdmin } from "@/server/admin/auth";
import { AdminLogin, AdminShell, CreateTenantForm } from "./admin-client";
import { adminLogoutAction } from "./actions";

export const metadata: Metadata = { title: "Platform admin", robots: { index: false, follow: false } };

function money(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export default async function AdminPage() {
  const admin = await currentPlatformAdmin();
  if (!admin) return <main className="grid min-h-dvh place-items-center bg-[#f7f8fc] px-4"><AdminLogin /></main>;
  const [[tenantTotal], [outletTotal], [orderTotal], [revenue], plans, tenants] = await Promise.all([
    db.select({ value: count() }).from(s.tenants),
    db.select({ value: count() }).from(s.outlets),
    db.select({ value: count() }).from(s.orders),
    db.select({ value: sum(s.bills.totalPaise) }).from(s.bills).where(eq(s.bills.status, "paid")),
    db.select({ code: s.plans.code, name: s.plans.name, value: count(s.tenants.id) }).from(s.plans).leftJoin(s.tenants, eq(s.tenants.planCode, s.plans.code)).where(eq(s.plans.isPublic, true)).groupBy(s.plans.code, s.plans.name),
    db.select({ id: s.tenants.id, name: s.tenants.name, planCode: s.tenants.planCode, status: s.tenants.status, contactName: s.tenants.contactName, createdAt: s.tenants.createdAt }).from(s.tenants).orderBy(desc(s.tenants.createdAt)).limit(5),
  ]);
  const totalTenants = Number(tenantTotal.value);
  const planTotal = plans.reduce((total, plan) => total + Number(plan.value), 0) || 1;
  const growth = [22, 31, 38, 42, 50, 62, 58, 72, 80, 76, 91, 100];
  return <AdminShell email={admin.email} logout={<form action={adminLogoutAction}><button className="rounded-lg border border-[#dfe3ed] px-4 py-2 text-sm font-semibold">Sign out</button></form>}>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="font-display text-3xl font-bold tracking-tight">Welcome back, Kushal 👋</h1><p className="mt-1 text-sm text-muted">Here&apos;s an overview of your TableQR platform.</p></div><button className="rounded-lg border border-[#dfe3ed] bg-white px-4 py-2.5 text-sm font-semibold">▣ &nbsp; 4 Oct 2026 - 4 Nov 2026 &nbsp;⌄</button></div>
    <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {[
        ["♙", "Total Tenants", totalTenants.toLocaleString(), "↑ 12%", "vs. last month", "#eeeaff", "#5b42f5"],
        ["▥", "Total Restaurants", Number(outletTotal.value).toLocaleString(), "↑ 18%", "vs. last month", "#dcfaed", "#16b879"],
        ["▤", "Total Orders (Platform)", Number(orderTotal.value).toLocaleString(), "↑ 26%", "vs. last month", "#fff0dc", "#f08b18"],
        ["₹", "Platform Revenue", money(Number(revenue.value ?? 0)), "↑ 32%", "vs. last month", "#ffe4e8", "#ed5368"],
      ].map(([icon, label, value, change, note, bg, color]) => <div key={label} className="rounded-xl border border-[#e4e7ee] bg-white p-4 shadow-sm"><div className="flex items-start justify-between"><span style={{ backgroundColor: bg, color }} className="grid h-12 w-12 place-items-center rounded-xl text-xl font-bold">{icon}</span><div className="flex-1 pl-4"><p className="text-xs text-muted">{label}</p><p className="mt-1 font-display text-2xl font-bold">{value}</p><p className="mt-1 text-xs"><span className="font-bold text-[#16b879]">{change}</span> <span className="text-muted">{note}</span></p></div></div></div>)}
    </div>
    <div className="mt-4 grid gap-4 xl:grid-cols-[1.55fr_1fr]">
      <section className="rounded-xl border border-[#e4e7ee] bg-white p-5 shadow-sm"><div className="flex items-start justify-between"><div><h2 className="font-display text-base font-bold">Platform Growth</h2><p className="text-xs text-muted">New tenants, restaurants and orders over time</p></div><button className="rounded-lg border border-[#dfe3ed] px-3 py-2 text-xs font-semibold">Last 30 days ⌄</button></div><div className="mt-6 flex h-40 items-end gap-2 border-b border-l border-[#eef0f4] px-3 pb-0">{growth.map((height, index) => <div key={index} className="relative flex h-full flex-1 items-end gap-0.5"><div style={{ height: `${height * .85}%` }} className="w-1/3 rounded-t bg-[#6a50f5]" /><div style={{ height: `${height * .56}%` }} className="w-1/3 rounded-t bg-[#16c784]" /><div style={{ height: `${height * .24}%` }} className="w-1/3 rounded-t bg-[#3d91ef]" /></div>)}</div><div className="mt-4 flex gap-5 text-xs text-muted"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#6a50f5]" />Orders</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#16c784]" />Restaurants</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#3d91ef]" />Tenants</span></div></section>
      <section className="rounded-xl border border-[#e4e7ee] bg-white p-5 shadow-sm"><h2 className="font-display text-base font-bold">Plan Distribution</h2><p className="text-xs text-muted">Active tenants by plan</p><div className="mt-5 flex items-center gap-5"><div className="grid h-32 w-32 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(#7958f5 0 44%, #16c784 44% 77%, #f59d18 77% 94%, #ed5368 94% 100%)` }}><div className="grid h-20 w-20 place-items-center rounded-full bg-white text-center"><b className="font-display text-xl">{totalTenants}</b><span className="text-[10px] text-muted">Tenants</span></div></div><div className="space-y-3 text-xs">{plans.map((plan, index) => <div key={plan.code} className="flex items-center gap-2"><i className={`h-2 w-2 rounded-full ${["bg-[#7958f5]", "bg-[#16c784]", "bg-[#f59d18]", "bg-[#ed5368]"][index % 4]}`} /><span className="min-w-16">{plan.name}</span><b>{plan.value}</b><span className="text-muted">({Math.round(Number(plan.value) * 100 / planTotal)}%)</span></div>)}</div></div></section>
    </div>
    <div className="mt-4 grid gap-4 xl:grid-cols-[1.55fr_1fr]">
      <section className="rounded-xl border border-[#e4e7ee] bg-white p-5 shadow-sm"><div className="flex items-center justify-between border-b border-[#eef0f4] pb-3"><div className="flex gap-5 text-xs font-semibold"><button className="border-b-2 border-[#5b42f5] pb-3 text-[#5b42f5]">Recent Tenants</button><button className="text-muted">New Signups</button><button className="hidden text-muted sm:block">Expiring Subscriptions</button></div><button className="text-xs font-bold text-[#5b42f5]">View all tenants →</button></div><div className="overflow-x-auto"><table className="mt-2 w-full min-w-[600px] text-left text-xs"><thead className="text-muted"><tr><th className="py-3">#</th><th>Tenant / Company</th><th>Plan</th><th>Status</th><th>Contact</th></tr></thead><tbody>{tenants.map((tenant, index) => <tr key={tenant.id} className="border-t border-[#f0f1f5]"><td className="py-3">{index + 1}</td><td><b>{tenant.name}</b><p className="text-[10px] text-muted">{tenant.contactName}</p></td><td><span className="rounded bg-[#eeeaff] px-2 py-1 font-semibold text-[#5b42f5]">{tenant.planCode}</span></td><td><span className="rounded bg-[#dcfaed] px-2 py-1 font-semibold text-[#0c9a66]">{tenant.status}</span></td><td className="text-muted">•••</td></tr>)}</tbody></table></div>{tenants.length === 0 && <p className="py-8 text-center text-sm text-muted">No tenants yet. Use the Tenants section to add the first restaurant.</p>}</section>
      <section className="rounded-xl border border-[#e4e7ee] bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-display text-base font-bold">Recent Activity</h2><p className="text-xs text-muted">Latest platform events</p></div><button className="text-xs font-bold text-[#5b42f5]">View all</button></div><div className="mt-4 space-y-4 text-xs"><p className="flex gap-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-[#eeeaff] text-[#5b42f5]">♙</span><span><b>{totalTenants ? "New tenant is active" : "No activity yet"}</b><br /><span className="text-muted">Platform activity will appear here</span></span></p><p className="flex gap-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-[#dcfaed] text-[#16b879]">↑</span><span><b>Database connected</b><br /><span className="text-muted">Live data is being read safely</span></span></p><p className="flex gap-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-[#fff0dc] text-[#f08b18]">₹</span><span><b>Revenue tracking ready</b><br /><span className="text-muted">Paid bills appear here</span></span></p></div></section>
    </div>
    <section className="mt-4"><CreateTenantForm plans={plans.map((plan) => ({ code: plan.code, name: plan.name }))} /></section>
  </AdminShell>;
}
