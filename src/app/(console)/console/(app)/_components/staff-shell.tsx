"use client";

import {
  Calendar03Icon,
  ChartHistogramIcon,
  ChefHatIcon,
  CreditCardIcon,
  DashboardSquare01Icon,
  Home01Icon,
  Invoice01Icon,
  Logout01Icon,
  MenuRestaurantIcon,
  Note01Icon,
  Settings01Icon,
  Tag01Icon,
  UserGroupIcon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import type { Lang } from "@/lib/i18n";
import { signOutAction } from "../../login/actions";
import { NotificationBell } from "./notification-bell";
import { switchOutletAction } from "./outlet-actions";

const ICONS: Record<string, IconSvgElement> = {
  dashboard: Home01Icon,
  floor: DashboardSquare01Icon,
  reservations: Calendar03Icon,
  waitlist: UserGroupIcon,
  orders: Note01Icon,
  kitchen: ChefHatIcon,
  billing: Invoice01Icon,
  menu: MenuRestaurantIcon,
  pricing: Tag01Icon,
  reports: ChartHistogramIcon,
  customers: UserGroupIcon,
  team: UserMultipleIcon,
  settings: Settings01Icon,
  plan: CreditCardIcon,
};

const ROLE = { en: { owner: "Owner", manager: "Manager", host: "Host", cashier: "Cashier", waiter: "Waiter", kitchen: "Kitchen", accountant: "Accountant" }, hi: { owner: "मालिक", manager: "मैनेजर", host: "होस्ट", cashier: "कैशियर", waiter: "वेटर", kitchen: "किचन", accountant: "अकाउंटेंट" } } as const;

/**
 * Staff console frame. 1024px and up: full sidebar. 640 to 1023px: icon rail (labels stay as
 * accessible names). Phones: a slim top bar and a bottom tab bar.
 */
export function StaffShell({
  lang,
  sections,
  staff,
  children,
  activeSlug,
  preview = false,
  theme = "light",
  kitchen = false,
  outlets = [],
}: {
  lang: Lang;
  sections: { slug: string; label: string }[];
  staff: { name: string; roles: string[]; outlet: string; shiftEnds: number | null };
  children: ReactNode;
  activeSlug?: string;
  preview?: boolean;
  theme?: "light" | "dark";
  /** Show the Kitchen button in the top bar */
  kitchen?: boolean;
  /** Other outlets this person can work at; a switcher shows when there is more than one */
  outlets?: { id: string; name: string; current: boolean }[];
}) {
  const [dark, setDark] = useState(theme === "dark");
  // Dialogs and menus render in a portal on <body>, outside this wrapper, so the console theme must also be on <html> while the console is open.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("console-ui");
    root.classList.toggle("theme-dark", dark);
    return () => root.classList.remove("console-ui", "theme-dark");
  }, [dark]);
  // One bell only, so it never rings twice: in the top bar of the content on wider screens, in the phone top bar otherwise
  const [wide, setWide] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const path = usePathname();
  const active = activeSlug ?? path?.split("/")[2];
  const role = staff.roles.map((r) => ROLE[lang][r as keyof (typeof ROLE)["en"]] ?? r).join(", ");
  return (
    <div lang={lang} className={`flex min-h-dvh flex-1 flex-col bg-paper text-ink sm:flex-row ${dark ? "theme-dark" : ""}`}>
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-4 sm:hidden print:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-input bg-ink font-display text-body font-bold text-white" aria-hidden>T</span>
          <span className="min-w-0"><span className="block truncate font-display text-body font-bold leading-tight">TableQR</span><span className="block truncate text-caption leading-tight text-muted">{staff.outlet}</span></span>
        </span>
        <span className="flex items-center">
        {kitchen && <KitchenButton lang={lang} active={active === "kitchen"} preview={preview} compact />}
        {wide === false && <NotificationBell preview={preview} placement="header" />}
        <ThemeToggle dark={dark} onChange={setDark} className="grid size-10 place-items-center rounded-input text-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink" />
        <form action={preview ? undefined : signOutAction}>
          <button type={preview ? "button" : "submit"} aria-label={lang === "hi" ? "साइन आउट" : "Sign out"} className="grid size-10 place-items-center rounded-input text-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink">
            <HugeiconsIcon icon={Logout01Icon} size={20} aria-hidden />
          </button>
        </form>
        </span>
      </header>
      <aside className="sticky top-0 hidden h-dvh w-16 shrink-0 flex-col border-r border-line bg-surface sm:flex lg:w-52 print:hidden">
        <div className="flex h-14 items-center gap-2 border-b border-line px-3 lg:px-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-input bg-ink font-display text-section font-bold text-white" aria-hidden>
            T
          </span>
          <span className="hidden min-w-0 lg:block">
            <span className="block truncate font-display text-body font-bold">TableQR</span>
            <span className="block truncate text-caption text-muted">{staff.outlet}</span>
          </span>
        </div>
        <nav aria-label={lang === "hi" ? "स्टाफ मेन्यू" : "Staff menu"} className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {sections.map((s) => {
            const current = s.slug === active;
            return (
              <Link
                key={s.slug}
                href={preview ? "#" : `/console/${s.slug}`}
                aria-current={current ? "page" : undefined}
                aria-label={s.label}
                title={s.label}
                className={`flex min-h-11 items-center gap-3 rounded-input px-3 text-body font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ink ${current ? "bg-ink text-white" : "text-muted hover:bg-ink/5 hover:text-ink"}`}
              >
                <HugeiconsIcon icon={ICONS[s.slug] ?? DashboardSquare01Icon} size={20} className="shrink-0" aria-hidden />
                <span className="hidden truncate lg:inline">{s.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-line p-2">
          <div className="hidden px-2 pb-2 lg:block">
            <p className="truncate text-body font-semibold">{staff.name}</p>
            <p className="truncate text-caption text-muted">{role}</p>
          </div>
          <ThemeToggle dark={dark} onChange={setDark} showLabel className="flex min-h-11 w-full items-center gap-3 rounded-input px-3 text-body font-semibold text-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink [&>span]:hidden lg:[&>span]:inline" />
          <form action={preview ? undefined : signOutAction}>
            <button type={preview ? "button" : "submit"} aria-label={lang === "hi" ? "साइन आउट" : "Sign out"} title={staff.name} className="flex min-h-11 w-full items-center gap-3 rounded-input px-3 text-body font-semibold text-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink">
              <HugeiconsIcon icon={Logout01Icon} size={20} className="shrink-0" aria-hidden />
              <span className="hidden lg:inline">{lang === "hi" ? "साइन आउट" : "Sign out"}</span>
            </button>
          </form>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0">
        {/* Top bar on tablets and computers, level with the sidebar's logo row */}
        <header className="sticky top-0 z-20 hidden h-14 shrink-0 print:hidden items-center justify-end gap-2 border-b border-line bg-surface/95 px-4 backdrop-blur-[2px] sm:flex lg:px-6">
          {outlets.length > 1 && !preview ? <OutletSwitcher outlets={outlets} lang={lang} /> : <span className="mr-auto truncate text-caption text-muted">{staff.outlet}</span>}
          {kitchen && <KitchenButton lang={lang} active={active === "kitchen"} preview={preview} />}
          {wide && <NotificationBell preview={preview} placement="header" />}
        </header>
        {children}
      </div>
      <nav aria-label={lang === "hi" ? "स्टाफ मेन्यू" : "Staff menu"} className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden print:hidden">
        {sections.map((s) => {
          const current = s.slug === active;
          return (
            <Link key={s.slug} href={preview ? "#" : `/console/${s.slug}`} aria-current={current ? "page" : undefined} className={`flex min-h-16 min-w-[4.75rem] flex-1 flex-col items-center justify-center gap-1 px-1 text-[10px] font-semibold ${current ? "text-brand" : "text-muted"}`}>
              <HugeiconsIcon icon={ICONS[s.slug] ?? DashboardSquare01Icon} size={22} aria-hidden />
              <span className="max-w-full truncate">{s.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** Owners and managers of several outlets move between them here, without signing in again */
function OutletSwitcher({ outlets, lang }: { outlets: { id: string; name: string; current: boolean }[]; lang: Lang }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="mr-auto flex min-w-0 items-center gap-2 text-caption text-muted">
      <span className="hidden md:inline">{lang === "hi" ? "आउटलेट" : "Outlet"}</span>
      <select
        aria-label={lang === "hi" ? "आउटलेट बदलें" : "Switch outlet"}
        disabled={busy}
        value={outlets.find((o) => o.current)?.id}
        onChange={async (e) => {
          setBusy(true);
          setError(null);
          const r = await switchOutletAction(e.target.value);
          if (r?.error) { setError(r.error); setBusy(false); }
        }}
        className="h-9 min-w-0 max-w-56 truncate rounded-input border border-line bg-surface px-2 text-body font-semibold text-ink"
      >
        {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      {error && <span role="alert" className="truncate text-danger">{error}</span>}
    </label>
  );
}

/** Opens the kitchen board in the console; a pill on wide screens, an icon on phones */
function KitchenButton({ lang, active, preview, compact = false }: { lang: Lang; active: boolean; preview: boolean; compact?: boolean }) {
  const label = lang === "hi" ? "किचन" : "Kitchen";
  return (
    <Link
      href={preview ? "#" : "/console/kitchen"}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={label}
      className={`flex items-center gap-2 rounded-input font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ink ${
        compact ? "size-10 justify-center" : "min-h-10 border border-line px-3 text-body"
      } ${active ? "bg-ink text-white" : "text-muted hover:bg-ink/5 hover:text-ink"}`}
    >
      <HugeiconsIcon icon={ChefHatIcon} size={20} className="shrink-0" aria-hidden />
      {!compact && <span>{label}</span>}
    </Link>
  );
}
