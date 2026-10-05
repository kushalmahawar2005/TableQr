"use client";

import { useActionState, useEffect, useState } from "react";
import { BarChart3, Command, CreditCard, LayoutGrid, Repeat, ScrollText, LogOut, Moon, Settings, Store, Sun, Tag, type LucideIcon } from "lucide-react";
import { Sidebar, SidebarBody, SidebarLabel, SidebarLink } from "@/components/ui/sidebar";
import { saveTheme } from "@/components/theme-toggle";
import { adminLoginAction, type AdminLoginState } from "./actions";

const field = "mt-1 block h-10 w-full rounded-lg border border-[#dfe3ed] bg-white px-3 text-sm text-[#172033] outline-none transition focus:border-[#5b42f5] focus:ring-2 focus:ring-[#5b42f5]/15";

export function AdminLogin() {
  const [state, action, pending] = useActionState<AdminLoginState, FormData>(adminLoginAction, { error: null });
  return <form action={action} className="mx-auto w-full max-w-sm rounded-2xl border border-[#e2e5ec] bg-white p-7 shadow-xl">
    <div className="mb-6 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#5b42f5] text-xl text-white">⌘</span><div><p className="font-display text-lg font-bold">TableQR</p><p className="text-xs text-muted-foreground">Platform Admin</p></div></div>
    <h1 className="font-display text-2xl font-bold text-[#172033]">Welcome back</h1>
    <p className="mt-1 text-sm text-muted-foreground">Sign in to manage your platform.</p>
    <label className="mt-6 block text-sm font-semibold">Email<input name="email" type="email" required className={field} /></label>
    <label className="mt-3 block text-sm font-semibold">Password<input name="password" type="password" required className={field} /></label>
    {state.error && <p role="alert" className="mt-3 text-sm text-danger">{state.error}</p>}
    <button disabled={pending} className="mt-5 h-11 w-full rounded-lg bg-[#5b42f5] text-sm font-semibold text-white disabled:opacity-60">{pending ? "Signing in…" : "Sign in"}</button>
  </form>;
}

const navGroups: { title: string; items: { label: string; icon: LucideIcon }[] }[] = [
  { title: "Overview", items: [{ label: "Dashboard", icon: LayoutGrid }] },
  { title: "Tenants", items: [{ label: "Tenants", icon: Store }, { label: "Subscriptions", icon: Repeat }] },
  { title: "Business", items: [{ label: "Plans & Pricing", icon: Tag }, { label: "Payments", icon: CreditCard }, { label: "Analytics", icon: BarChart3 }] },
  { title: "System", items: [{ label: "Audit Logs", icon: ScrollText }, { label: "Settings", icon: Settings }] },
];

export function AdminSidebar({ active, onSelect, email, logout, dark, onTheme }: { active: string; onSelect: (item: string) => void; email: string; logout: () => Promise<void>; dark: boolean; onTheme: (dark: boolean) => void }) {
  return <SidebarBody>
    <div className="flex h-11 items-center gap-3 px-1.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#5b42f5] text-white"><Command aria-hidden="true" className="size-4" /></span>
      <SidebarLabel><span className="block font-display text-sm font-bold leading-tight text-foreground">TableQR</span><span className="block text-[11px] font-normal text-muted-foreground">Platform Admin</span></SidebarLabel>
    </div>
    <nav aria-label="Platform admin" className="mt-6 flex-1 space-y-5 overflow-y-auto overflow-x-hidden">
      {navGroups.map((group) => <div key={group.title}>
        <p className="mb-1 h-4 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70"><SidebarLabel>{group.title}</SidebarLabel></p>
        <div className="space-y-0.5">{group.items.map(({ label, icon: Icon }) => <SidebarLink key={label} label={label} active={active === label} icon={<Icon className="size-[18px]" />} onClick={() => onSelect(label)} />)}</div>
      </div>)}
    </nav>
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <div className="flex h-11 items-center gap-3 px-1">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#5b42f5] text-xs font-semibold text-white">{email.slice(0, 2).toUpperCase()}</span>
        <SidebarLabel><span className="block truncate text-sm font-medium text-foreground">{email}</span><span className="block text-xs text-muted-foreground">Platform Owner</span></SidebarLabel>
      </div>
      <SidebarLink label={dark ? "Light mode" : "Dark mode"} icon={dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />} onClick={() => { saveTheme(!dark); onTheme(!dark); }} role="switch" aria-checked={dark} />
      <form action={logout}><SidebarLink type="submit" label="Sign out" icon={<LogOut className="size-[18px]" />} className="hover:bg-red-50 hover:text-red-600" /></form>
    </div>
  </SidebarBody>;
}

export function AdminShell(props: { email: string; pages: Record<string, React.ReactNode>; logout: () => Promise<void>; theme?: "light" | "dark" }) {
  const [active, setActive] = useState("Dashboard");
  const [dark, setDark] = useState(props.theme === "dark");
  // Dialogs and side panels render in a portal on <body>, so the dark tokens must live on <html> while the admin is open.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    return () => document.documentElement.classList.remove("dark");
  }, [dark]);
  return <Sidebar>
    <div className={`flex min-h-svh flex-col bg-[var(--admin-bg)] text-[var(--admin-fg)] md:flex-row ${dark ? "dark" : ""}`}>
      <AdminSidebar active={active} onSelect={setActive} email={props.email} logout={props.logout} dark={dark} onTheme={setDark} />
      <main className="admin-scope min-w-0 flex-1 p-5 lg:p-8">{props.pages[active] ?? <div className="grid min-h-[50vh] place-items-center text-center"><div><p className="font-display text-lg font-bold">{active}</p><p className="mt-1 text-sm text-muted-foreground">This page is coming soon.</p></div></div>}</main>
    </div>
  </Sidebar>;
}
