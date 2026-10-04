"use client";

import { useActionState, useState } from "react";
import { adminLoginAction, createTenantAction, type AdminLoginState, type TenantState } from "./actions";

const field = "mt-1 block h-10 w-full rounded-lg border border-[#dfe3ed] bg-white px-3 text-sm text-[#172033] outline-none transition focus:border-[#5b42f5] focus:ring-2 focus:ring-[#5b42f5]/15";

export function AdminLogin() {
  const [state, action, pending] = useActionState<AdminLoginState, FormData>(adminLoginAction, { error: null });
  return <form action={action} className="mx-auto w-full max-w-sm rounded-2xl border border-[#e2e5ec] bg-white p-7 shadow-xl">
    <div className="mb-6 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#5b42f5] text-xl text-white">⌘</span><div><p className="font-display text-lg font-bold">TableQR</p><p className="text-xs text-muted">Platform Admin</p></div></div>
    <h1 className="font-display text-2xl font-bold text-[#172033]">Welcome back</h1>
    <p className="mt-1 text-sm text-muted">Sign in to manage your platform.</p>
    <label className="mt-6 block text-sm font-semibold">Email<input name="email" type="email" required className={field} /></label>
    <label className="mt-3 block text-sm font-semibold">Password<input name="password" type="password" required className={field} /></label>
    {state.error && <p role="alert" className="mt-3 text-sm text-danger">{state.error}</p>}
    <button disabled={pending} className="mt-5 h-11 w-full rounded-lg bg-[#5b42f5] text-sm font-semibold text-white disabled:opacity-60">{pending ? "Signing in…" : "Sign in"}</button>
  </form>;
}

export function AdminSidebar({ active, onSelect }: { active: string; onSelect: (item: string) => void }) {
  const items = [
    ["⌂", "Dashboard"], ["▣", "Tenants"], ["◇", "Plans & Pricing"], ["▤", "Subscriptions"],
    ["▥", "Restaurants / Outlets"], ["♙", "Users & Roles"], ["⌗", "QR Codes"], ["▤", "Orders (All Tenants)"],
    ["◷", "Reservations"], ["▣", "Payments"], ["▥", "Analytics"], ["♧", "Notifications"], ["⚙", "System Settings"], ["≡", "Audit Logs"],
  ];
  return <aside className="hidden min-h-dvh w-[236px] shrink-0 bg-[#171c2b] text-white lg:block">
    <div className="flex h-[72px] items-center gap-3 border-b border-white/10 px-6"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#5b42f5] text-lg">⌘</span><div><p className="font-display text-lg font-bold">TableQR</p><p className="text-[11px] text-white/55">Platform Admin</p></div></div>
    <nav className="space-y-1 px-3 py-5">{items.map(([icon, label]) => <button key={label} onClick={() => onSelect(label)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] transition ${active === label ? "bg-[#5b42f5] font-semibold" : "text-white/70 hover:bg-white/10 hover:text-white"}`}><span className="w-5 text-center text-base">{icon}</span>{label}{label === "Notifications" && <span className="ml-auto rounded-full bg-[#ef5267] px-1.5 text-[10px]">3</span>}</button>)}</nav>
    <div className="mx-3 mt-8 rounded-xl bg-white/5 p-3 text-xs text-white/55"><p className="font-semibold text-white/85">TableQR</p><p className="mt-1">v0.1.0</p></div>
  </aside>;
}

export function CreateTenantForm({ plans }: { plans: { code: string; name: string }[] }) {
  const [state, action, pending] = useActionState<TenantState, FormData>(createTenantAction, { error: null, success: null });
  return <form action={action} className="rounded-xl border border-[#e2e5ec] bg-white p-5 shadow-sm">
    <h2 className="font-display text-lg font-bold">Add restaurant</h2><p className="mt-1 text-sm text-muted">Creates the first outlet, owner, zone, tables and QR codes.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">{[
      ["tenantName", "Restaurant name", "text"], ["contactName", "Contact name", "text"], ["contactPhone", "Contact phone", "tel"], ["contactEmail", "Contact email", "email"], ["brandName", "Brand name", "text"], ["outletCode", "Outlet code", "text"], ["outletName", "Outlet name", "text"], ["city", "City", "text"], ["address", "Address", "text"], ["ownerName", "Owner name", "text"], ["ownerPhone", "Owner phone", "tel"], ["ownerPin", "Owner 4-digit PIN", "password"], ["tableCount", "Tables", "number"],
    ].map(([name, label, type]) => <label key={name} className="text-sm font-semibold">{label}<input name={name} type={type} required={!["contactEmail", "brandName"].includes(name)} defaultValue={name === "tableCount" ? "4" : undefined} min={name === "tableCount" ? "1" : undefined} max={name === "tableCount" ? "100" : undefined} pattern={name === "ownerPin" ? "\\d{4}" : undefined} maxLength={name === "ownerPin" ? 4 : undefined} className={field} /></label>)}
      <label className="text-sm font-semibold">Plan<select name="planCode" required className={field}>{plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></label>
    </div>
    {state.error && <p role="alert" className="mt-4 text-sm text-danger">{state.error}</p>}{state.success && <p role="status" className="mt-4 text-sm text-success">{state.success}</p>}
    <button disabled={pending} className="mt-5 h-10 rounded-lg bg-[#5b42f5] px-5 text-sm font-semibold text-white disabled:opacity-60">{pending ? "Creating…" : "Create restaurant"}</button>
  </form>;
}

export function AdminShell(props: { email: string; children: React.ReactNode; logout: React.ReactNode }) {
  const [active, setActive] = useState("Dashboard");
  return <div className="flex min-h-dvh bg-[#f7f8fc] text-[#172033]"><AdminSidebar active={active} onSelect={setActive} /><div className="min-w-0 flex-1"><header className="flex h-[72px] items-center justify-between border-b border-[#e7e9ef] bg-white px-5 lg:px-8"><div className="hidden w-full max-w-[410px] items-center gap-2 rounded-lg border border-[#e2e5ec] bg-[#fafbfe] px-3 py-2 text-sm text-muted sm:flex">⌕ <span>Search tenants, restaurants, users, orders...</span><kbd className="ml-auto rounded border px-1.5 text-[10px]">⌘ K</kbd></div><div className="ml-auto flex items-center gap-4"><span className="text-xl">♧</span><span className="h-8 w-px bg-[#e7e9ef]" /> <span className="grid h-9 w-9 place-items-center rounded-full bg-[#20283b] text-xs text-white">KM</span><div className="hidden text-left sm:block"><p className="text-sm font-semibold">{props.email}</p><p className="text-xs text-muted">Platform Owner</p></div><span>⌄</span></div></header><main className="p-5 lg:p-8">{props.children}</main></div></div>;
}
