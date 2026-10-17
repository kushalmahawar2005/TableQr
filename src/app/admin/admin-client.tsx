"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Bell, Command, CreditCard, LayoutGrid, Repeat, ScrollText, LogOut, Moon, Settings, Store, Sun, Tag, type LucideIcon } from "lucide-react";
import { Sidebar, SidebarBody, SidebarLabel, SidebarLink } from "@/components/ui/sidebar";
import { saveTheme } from "@/components/theme-toggle";
import { adminLoginAction, type AdminLoginState } from "./actions";
import { onAdminOpen, openAdminPage } from "./admin-nav";

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
  { title: "Business", items: [{ label: "Plans & Pricing", icon: Tag }, { label: "Fees", icon: CreditCard }, { label: "Analytics", icon: BarChart3 }] },
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

export type AdminAlert = { id: string; title: string; detail: string; page: string; tenantId?: string };

/** New upgrade requests and "I have paid" claims; the list refreshes every minute */
function AlertsBell({ alerts }: { alerts: AdminAlert[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return <div ref={box} className="relative">
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Notifications${alerts.length ? `, ${alerts.length} new` : ""}`} className="relative grid size-10 place-items-center rounded-full border border-border bg-card text-card-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-[#5b42f5]">
      <Bell className="size-[18px]" aria-hidden="true" />
      {alerts.length > 0 && <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-bold leading-5 text-white">{alerts.length}</span>}
    </button>
    {open && <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl">
      <p className="border-b border-border px-4 py-2.5 text-sm font-semibold">Notifications</p>
      {alerts.length ? <ul className="max-h-96 divide-y divide-border overflow-y-auto">{alerts.map((a) => <li key={a.id}>
        <button type="button" onClick={() => { setOpen(false); openAdminPage(a.page, a.tenantId); }} className="block w-full px-4 py-3 text-left hover:bg-muted">
          <span className="block text-sm font-medium">{a.title}</span><span className="block text-xs text-muted-foreground">{a.detail}</span>
        </button>
      </li>)}</ul> : <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing new.</p>}
    </div>}
  </div>;
}

export function AdminShell(props: { email: string; pages: Record<string, React.ReactNode>; logout: () => Promise<void>; theme?: "light" | "dark"; alerts?: AdminAlert[] }) {
  const [active, setActive] = useState("Dashboard");
  const router = useRouter();
  const alerts = props.alerts ?? [];
  useEffect(() => onAdminOpen(setActive), []);
  // New requests and payments show up without a reload
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(t);
  }, [router]);
  useEffect(() => {
    document.title = `${alerts.length ? `(${alerts.length}) ` : ""}Platform admin | TableQR`;
  }, [alerts.length]);
  const [dark, setDark] = useState(props.theme === "dark");
  // Dialogs and side panels render in a portal on <body>, so the dark tokens must live on <html> while the admin is open.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    return () => document.documentElement.classList.remove("dark");
  }, [dark]);
  useEffect(() => {
    document.documentElement.classList.add("admin-ui");
    return () => document.documentElement.classList.remove("admin-ui");
  }, []);
  return <Sidebar>
    <div className={`flex min-h-svh flex-col bg-[var(--admin-bg)] text-[var(--admin-fg)] md:flex-row ${dark ? "dark" : ""}`}>
      <AdminSidebar active={active} onSelect={setActive} email={props.email} logout={props.logout} dark={dark} onTheme={setDark} />
      <main className="admin-scope min-w-0 flex-1 p-5 pt-3 lg:p-8 lg:pt-4"><div className="mb-2 flex justify-end"><AlertsBell alerts={alerts} /></div>{props.pages[active] ?? <div className="grid min-h-[50vh] place-items-center text-center"><div><p className="font-display text-lg font-bold">{active}</p><p className="mt-1 text-sm text-muted-foreground">This page is coming soon.</p></div></div>}</main>
    </div>
  </Sidebar>;
}
