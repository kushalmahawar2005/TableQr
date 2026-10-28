"use client";

import {
  Calendar03Icon,
  ChartHistogramIcon,
  ChefHatIcon,
  CreditCardIcon,
  DashboardSquare01Icon,
  HelpCircleIcon,
  Home01Icon,
  Invoice01Icon,
  ComputerDollarIcon,
  Logout01Icon,
  MenuRestaurantIcon,
  Note01Icon,
  PackageIcon,
  BedIcon,
  Settings01Icon,
  SidebarLeftIcon,
  Tag01Icon,
  UserGroupIcon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowRight,
  Camera,
  ChevronDown,
  CreditCard,
  LogOut,
  Search,
  Settings,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { InstallApp } from "@/components/install-app";
import { NotificationPermissionOnboarding } from "@/components/notification-permission-onboarding";
import type { Lang } from "@/lib/i18n";
import { signOutAction } from "../../login/actions";
import { shrinkPhotoFile } from "@/lib/shrink-photo";
import { myPhotoAction, saveMyPhotoAction } from "./profile-actions";
import { startTour } from "./guide/copy";
import { NotificationBell } from "./notification-bell";
import { switchOutletAction } from "./outlet-actions";

const ICONS: Record<string, IconSvgElement> = {
  dashboard: Home01Icon,
  floor: DashboardSquare01Icon,
  reservations: Calendar03Icon,
  waitlist: UserGroupIcon,
  orders: Note01Icon,
  kitchen: ChefHatIcon,
  pos: ComputerDollarIcon,
  billing: Invoice01Icon,
  menu: MenuRestaurantIcon,
  inventory: PackageIcon,
  rooms: BedIcon,
  pricing: Tag01Icon,
  reports: ChartHistogramIcon,
  customers: UserGroupIcon,
  broadcasts: UserGroupIcon,
  team: UserMultipleIcon,
  settings: Settings01Icon,
  plan: CreditCardIcon,
};

const ROLE = {
  en: {
    owner: "Owner",
    manager: "Manager",
    host: "Host",
    cashier: "Cashier",
    waiter: "Waiter",
    kitchen: "Kitchen",
    accountant: "Accountant",
    reception: "Reception",
  },
  hi: {
    owner: "मालिक",
    manager: "मैनेजर",
    host: "होस्ट",
    cashier: "कैशियर",
    waiter: "वेटर",
    kitchen: "किचन",
    accountant: "अकाउंटेंट",
    reception: "रिसेप्शन",
  },
} as const;

/**
 * Staff console frame. 1024px and up: full sidebar, which can be folded to the icon rail. 640 to
 * 1023px: icon rail (labels stay as accessible names). Phones: a slim top bar and a bottom tab bar.
 */
export function StaffShell({
  lang,
  sections,
  staff,
  children,
  activeSlug,
  preview = false,
  theme = "light",
  sidebar = "open",
  kitchen = false,
  outlets = [],
  plan,
  logoUrl = null,
}: {
  lang: Lang;
  sections: { slug: string; label: string }[];
  staff: {
    name: string;
    roles: string[];
    outlet: string;
    shiftEnds: number | null;
  };
  children: ReactNode;
  activeSlug?: string;
  preview?: boolean;
  theme?: "light" | "dark";
  /** Wide-screen sidebar as last left: open, or folded to icons */
  sidebar?: "open" | "folded";
  /** Show the Kitchen button in the top bar */
  kitchen?: boolean;
  /** Other outlets this person can work at; a switcher shows when there is more than one */
  outlets?: { id: string; name: string; current: boolean }[];
  /** The signed-in outlet's restaurant logo for the shared header. */
  logoUrl?: string | null;
  /** The restaurant's plan, shown under the person's name; owners and managers get an Upgrade link */
  plan?: { name: string; canManage: boolean };
}) {
  const [dark, setDark] = useState(theme === "dark");
  const [networkOnline, setNetworkOnline] = useState(true);
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
  useEffect(() => {
    const update = () => setNetworkOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  // Folded sidebar on wide screens; kept in a cookie like the theme so the page opens the same way. Ctrl/Cmd+B flips it
  const [folded, setFolded] = useState(sidebar === "folded");
  useEffect(() => {
    document.cookie = `tq_sidebar=${folded ? "folded" : "open"}; path=/; max-age=31536000; samesite=lax`;
  }, [folded]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key?.toLowerCase() === "b" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setFolded((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Labels show only on wide screens with the sidebar open
  const wideLabel = folded ? "hidden" : "hidden lg:inline";
  const path = usePathname();
  const active = activeSlug ?? path?.split("/")[2];
  const role = staff.roles
    .map((r) => ROLE[lang][r as keyof (typeof ROLE)["en"]] ?? r)
    .join(", ");
  const initials =
    staff.name
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "SS";

  return (
    <div
      lang={lang}
      style={{ "--sidebar-width": folded ? "4rem" : "13rem" } as CSSProperties}
      className={`flex min-h-dvh flex-1 flex-col bg-paper text-ink sm:flex-row ${dark ? "theme-dark" : ""}`}
    >
      <header
        className={`sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b px-4 sm:hidden print:hidden ${active === "dashboard" ? "border-line bg-paper" : "border-line bg-surface"}`}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-forest font-display text-sm font-bold text-white shadow-xs"
            aria-hidden
          >
            T
          </span>
          <span className="min-w-0">
            <span className="block truncate font-display text-sm font-bold leading-tight text-ink">
              Tableeqr
            </span>
            <span className="block truncate text-[11px] font-medium leading-tight text-muted">
              {staff.outlet}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          {kitchen && (
            <KitchenButton
              lang={lang}
              active={active === "kitchen"}
              preview={preview}
              compact
              dashboardAccent={active === "dashboard"}
            />
          )}
          <HelpButton lang={lang} preview={preview} />
          {wide === false && (
            <span data-tour="bell" className="flex">
              <NotificationBell preview={preview} placement="header" />
            </span>
          )}
          <ThemeToggle
            dark={dark}
            onChange={setDark}
            className="grid size-9 place-items-center rounded-xl text-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-forest"
          />
          <form action={preview ? undefined : signOutAction}>
            <button
              type={preview ? "button" : "submit"}
              aria-label={lang === "hi" ? "साइन आउट" : "Sign out"}
              className="grid size-9 place-items-center rounded-xl text-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-forest"
            >
              <HugeiconsIcon icon={Logout01Icon} size={18} aria-hidden />
            </button>
          </form>
        </span>
      </header>
      <aside
        className={`sticky top-0 hidden h-dvh w-16 shrink-0 flex-col border-r transition-[width] duration-200 sm:flex print:hidden ${active === "dashboard" ? "border-line bg-paper" : "border-line bg-surface"} ${folded ? "" : "lg:w-52"}`}
      >
        <div
          className={`flex h-18 items-center gap-3 border-b border-line px-3 ${folded ? "" : "lg:px-4"}`}
        >
          <span
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-forest font-display text-lg font-bold text-white shadow-xs"
            aria-hidden
          >
            T
          </span>
          <span className={`hidden min-w-0 ${folded ? "" : "lg:block"}`}>
            <span className="block truncate font-display text-base font-bold text-ink">
              Tableeqr
            </span>
            <span className="block truncate text-xs font-medium text-muted">
              {staff.outlet}
            </span>
          </span>
        </div>
        <nav
          aria-label={lang === "hi" ? "स्टाफ मेन्यू" : "Staff menu"}
          className="no-scrollbar flex flex-1 flex-col gap-0.5 overflow-y-auto p-2"
        >
          {sections.map((s) => {
            const current = s.slug === active;
            return (
              <Link
                key={s.slug}
                href={preview ? "#" : `/console/${s.slug}`}
                data-tour={`nav-${s.slug}`}
                aria-current={current ? "page" : undefined}
                aria-label={s.label}
                title={s.label}
                className={`flex min-h-11 items-center gap-3 rounded-input px-3 text-body font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ink ${current ? "bg-forest text-white shadow-xs" : "text-muted hover:bg-ink/5 hover:text-ink"}`}
              >
                <HugeiconsIcon
                  icon={ICONS[s.slug] ?? DashboardSquare01Icon}
                  size={20}
                  className="shrink-0"
                  aria-hidden
                />
                <span className={`truncate ${wideLabel}`}>{s.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-line p-2">
          <div className={`hidden px-2 pb-2 ${folded ? "" : "lg:block"}`}>
            <p className="truncate text-body font-semibold">{staff.name}</p>
            <p className="truncate text-caption text-muted">{role}</p>
            {plan && (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-input border border-line px-2.5 py-1.5">
                <span className="min-w-0 truncate text-caption">
                  <span className="text-muted">
                    {lang === "hi" ? "प्लान" : "Plan"} ·{" "}
                  </span>
                  <span className="font-semibold text-ink">{plan.name}</span>
                </span>
                {plan.canManage && !preview && (
                  <Link
                    href="/console/plan"
                    className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-strong hover:bg-brand-soft/70"
                  >
                    {lang === "hi" ? "अपग्रेड" : "Upgrade"}
                  </Link>
                )}
              </div>
            )}
          </div>
          {!preview && !folded && (
            <div className="mb-1 px-1">
              <InstallApp name={staff.outlet} logoUrl={logoUrl} compact />
            </div>
          )}
          <ThemeToggle
            dark={dark}
            onChange={setDark}
            showLabel
            className={`flex min-h-11 w-full items-center gap-3 rounded-input px-3 text-body font-semibold text-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink [&>span]:hidden ${folded ? "" : "lg:[&>span]:inline"}`}
          />
          <form action={preview ? undefined : signOutAction}>
            <button
              type={preview ? "button" : "submit"}
              aria-label={lang === "hi" ? "साइन आउट" : "Sign out"}
              title={staff.name}
              className="flex min-h-11 w-full items-center gap-3 rounded-input px-3 text-body font-semibold text-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
            >
              <HugeiconsIcon
                icon={Logout01Icon}
                size={20}
                className="shrink-0"
                aria-hidden
              />
              <span className={wideLabel}>
                {lang === "hi" ? "साइन आउट" : "Sign out"}
              </span>
            </button>
          </form>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0">
        {/* Top bar on tablets and computers, level with the sidebar's logo row */}
        <header
          className={`sticky top-0 z-20 hidden h-18 shrink-0 print:hidden items-center justify-between gap-4 border-b px-4 backdrop-blur-[4px] sm:flex lg:px-6 ${active === "dashboard" ? "border-line bg-paper/95" : "border-line bg-surface/95"}`}
        >
          {/* Left: Sidebar toggle + Restaurant / Outlet Identity */}
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setFolded(!folded)}
              aria-label={
                folded
                  ? lang === "hi"
                    ? "मेन्यू खोलें"
                    : "Open sidebar"
                  : lang === "hi"
                    ? "मेन्यू बंद करें"
                    : "Close sidebar"
              }
              aria-expanded={!folded}
              title={`${folded ? (lang === "hi" ? "मेन्यू खोलें" : "Open sidebar") : lang === "hi" ? "मेन्यू बंद करें" : "Close sidebar"} (Ctrl+B)`}
              className="-ml-1 hidden size-10 shrink-0 place-items-center rounded-xl text-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-forest lg:grid cursor-pointer"
            >
              <HugeiconsIcon icon={SidebarLeftIcon} size={20} aria-hidden />
            </button>

            {outlets.length > 1 && !preview ? (
              <OutletSwitcher outlets={outlets} lang={lang} logoUrl={logoUrl} />
            ) : (
              <div className="flex h-12 items-center gap-3 rounded-xl px-2 py-1">
                <OutletBrandMark name={staff.outlet} logoUrl={logoUrl} />
                <div className="min-w-0 text-left">
                  <p className="truncate text-sm font-bold text-ink">
                    {staff.outlet}
                  </p>
                  <p className="truncate text-xs font-medium text-muted">
                    Kitchen &amp; Café
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Middle: Functional global search */}
          <HeaderSearch lang={lang} sections={sections} />

          {/* Right: Kitchen Display + Notification Bell + Functional User Profile */}
          <div className="flex items-center gap-3 shrink-0">
            {kitchen && (
              <KitchenButton
                lang={lang}
                active={active === "kitchen"}
                preview={preview}
                dashboardAccent={active === "dashboard"}
              />
            )}
            {wide && (
              <span data-tour="bell" className="flex">
                <NotificationBell preview={preview} placement="header" />
              </span>
            )}

            {/* Functional User Profile Menu */}
            <UserProfileDropdown
              staff={staff}
              role={role}
              initials={initials}
              lang={lang}
              preview={preview}
            />
          </div>
        </header>
        {!preview && <NotificationPermissionOnboarding lang={lang} />}
        {!preview && !networkOnline && <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-caption font-semibold text-warning"><span>{lang === "hi" ? "इंटरनेट बंद है। डैशबोर्ड का डेटा पुराना हो सकता है। काउंटर जारी रखने के लिए सेव POS खोलें।" : "Internet is disconnected. Dashboard data may be out of date. Open saved POS to continue at the counter."}</span><a href="/offline-pos" className="inline-flex min-h-9 items-center rounded-lg border border-warning/50 bg-surface px-3 text-ink">{lang === "hi" ? "सेव POS खोलें" : "Open saved POS"}</a></div>}
        {children}
      </div>
      <nav
        aria-label={lang === "hi" ? "स्टाफ मेन्यू" : "Staff menu"}
        className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden print:hidden"
      >
        {sections.map((s) => {
          const current = s.slug === active;
          return (
            <Link
              key={s.slug}
              href={preview ? "#" : `/console/${s.slug}`}
              data-tour={`nav-${s.slug}`}
              aria-current={current ? "page" : undefined}
              className={`flex min-h-16 min-w-[4.75rem] flex-1 flex-col items-center justify-center gap-1 px-1 text-[10px] font-semibold ${current ? "text-forest" : "text-muted"}`}
            >
              <HugeiconsIcon
                icon={ICONS[s.slug] ?? DashboardSquare01Icon}
                size={22}
                aria-hidden
              />
              <span className="max-w-full truncate">{s.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** Functional global search across sections, tables and operations */
function HeaderSearch({
  lang,
  sections,
}: {
  lang: Lang;
  sections: { slug: string; label: string }[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const trimmed = query.trim().toLowerCase();

  // Navigation matching items
  const matchedSections = sections.filter(
    (s) =>
      s.label.toLowerCase().includes(trimmed) ||
      s.slug.toLowerCase().includes(trimmed),
  );

  // Quick table shortcuts if typing table numbers (e.g. "t1", "table 2")
  const tableMatch = trimmed.match(/^(?:t|table)\s*(\d+)$/i);
  const tableNumber = tableMatch ? tableMatch[1] : null;

  const hasResults =
    trimmed.length > 0 && (matchedSections.length > 0 || tableNumber);

  return (
    <div
      ref={containerRef}
      className="relative mx-auto hidden max-w-md flex-1 px-4 md:block"
    >
      <div className="relative w-full">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          role="searchbox"
          autoComplete="off"
          spellCheck="false"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (tableNumber) {
                router.push(`/console/floor`);
                setOpen(false);
              } else if (matchedSections[0]) {
                router.push(`/console/${matchedSections[0].slug}`);
                setOpen(false);
              }
            }
          }}
          placeholder={
            lang === "hi"
              ? "टेबल, आर्डर, मेन्यू खोजें..."
              : "Search tables, orders, menu..."
          }
          className="h-11 w-full rounded-2xl border border-line bg-surface pl-10.5 pr-10 text-sm font-medium text-ink placeholder:text-muted shadow-[0_1px_3px_rgba(0,0,0,0.02)] transition-all focus:border-forest focus:bg-surface focus:outline-none focus:ring-2 focus:ring-forest/10"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setOpen(false);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted hover:bg-ink/5 hover:text-ink cursor-pointer"
            aria-label="Clear search"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {open && hasResults && (
        <div className="absolute left-4 right-4 top-13 z-50 overflow-hidden rounded-2xl border border-line bg-surface p-2 shadow-[0_12px_28px_rgba(23,37,31,0.12)]">
          <p className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
            Quick Destinations
          </p>
          <ul className="grid gap-1">
            {tableNumber && (
              <li>
                <Link
                  href={`/console/floor`}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold text-ink hover:bg-paper"
                >
                  <span className="flex items-center gap-2">
                    <span className="grid size-6 place-items-center rounded-lg bg-sage text-[11px] font-bold text-forest">
                      T{tableNumber}
                    </span>
                    <span>View Table {tableNumber} on Floor</span>
                  </span>
                  <ArrowRight
                    className="size-3.5 text-muted"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            )}
            {matchedSections.map((s) => (
              <li key={s.slug}>
                <Link
                  href={`/console/${s.slug}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold text-ink hover:bg-paper"
                >
                  <span className="flex items-center gap-2.5">
                    <span className="grid size-6 place-items-center rounded-lg bg-paper text-ink">
                      <HugeiconsIcon
                        icon={ICONS[s.slug] ?? DashboardSquare01Icon}
                        size={15}
                        aria-hidden
                      />
                    </span>
                    <span>{s.label}</span>
                  </span>
                  <ArrowRight
                    className="size-3.5 text-muted"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Functional User Profile Dropdown Menu */
function UserProfileDropdown({
  staff,
  role,
  initials,
  lang,
  preview,
}: {
  staff: {
    name: string;
    roles: string[];
    outlet: string;
    shiftEnds: number | null;
  };
  role: string;
  initials: string;
  lang: Lang;
  preview?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // The signed-in person's own photo: shown on the avatar, changed from this menu
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!preview) void myPhotoAction().then(setPhoto, () => {}); }, [preview]);
  const uploadPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true); setPhotoError(null);
    const form = new FormData();
    form.set("photo", await shrinkPhotoFile(file));
    const r = await saveMyPhotoAction(form);
    setPhotoBusy(false);
    if (r.ok) setPhoto(r.photoUrl); else setPhotoError(r.error);
  };

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={menuRef} className="relative pl-3 border-l border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="User menu"
        className="flex h-11 items-center gap-2.5 rounded-xl px-2 text-left hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-forest transition-all cursor-pointer"
      >
        {photo
          // Staff photos live in the photo bucket, so this stays a plain image
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={photo} alt="" className="size-9.5 shrink-0 rounded-full object-cover shadow-xs" />
          : <div className="grid size-9.5 shrink-0 place-items-center rounded-full bg-forest text-xs font-bold text-white shadow-xs">{initials}</div>}
        <div className="hidden min-w-0 sm:block">
          <div className="flex items-center gap-1">
            <span className="truncate text-xs font-bold leading-tight text-ink">
              {staff.name}
            </span>
            <ChevronDown className="size-3 text-muted" aria-hidden="true" />
          </div>
          <p className="truncate text-[10px] font-medium leading-tight text-muted">
            {role}
          </p>
        </div>
      </button>

      {open && (
        <div className="absolute right-0 top-13 z-50 w-56 rounded-2xl border border-line bg-surface p-2 shadow-[0_12px_28px_rgba(23,37,31,0.14)]">
          <div className="border-b border-line px-3 py-2.5">
            <p className="truncate text-xs font-bold text-ink">{staff.name}</p>
            <p className="truncate text-[11px] font-medium text-muted">
              {role} · {staff.outlet}
            </p>
          </div>
          <div className="py-1">
            <button
              type="button"
              disabled={photoBusy || preview}
              onClick={() => photoInput.current?.click()}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium text-ink hover:bg-paper disabled:opacity-60"
            >
              <Camera className="size-3.5 text-muted" aria-hidden="true" />
              <span>{photoBusy ? (lang === "hi" ? "फ़ोटो लग रही है…" : "Saving photo…") : photo ? (lang === "hi" ? "फ़ोटो बदलें" : "Change photo") : (lang === "hi" ? "अपनी फ़ोटो लगाएँ" : "Add your photo")}</span>
            </button>
            <input ref={photoInput} type="file" accept="image/*" className="hidden" onChange={(e) => void uploadPhoto(e.target.files?.[0])} />
            {photoError && <p role="alert" className="px-3 pb-1 text-[11px] font-semibold text-danger">{photoError}</p>}
            <Link
              href="/console/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-ink hover:bg-paper"
            >
              <Settings className="size-3.5 text-muted" aria-hidden="true" />
              <span>{lang === "hi" ? "सेटिंग्स" : "Settings"}</span>
            </Link>
            <Link
              href="/console/plan"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-ink hover:bg-paper"
            >
              <CreditCard className="size-3.5 text-muted" aria-hidden="true" />
              <span>
                {lang === "hi" ? "प्लान डिटेल्स" : "Subscription Plan"}
              </span>
            </Link>
          </div>
          <div className="border-t border-line pt-1">
            <form action={preview ? undefined : signOutAction}>
              <button
                type={preview ? "button" : "submit"}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium text-rose-600 hover:bg-rose-50 cursor-pointer"
              >
                <LogOut className="size-3.5" aria-hidden="true" />
                <span>{lang === "hi" ? "साइन आउट" : "Sign out"}</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/** Owners and managers of several outlets move between them here, without signing in again */
function OutletSwitcher({
  outlets,
  lang,
  logoUrl,
}: {
  outlets: { id: string; name: string; current: boolean }[];
  lang: Lang;
  logoUrl: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = outlets.find((o) => o.current) ?? outlets[0];
  return (
    <div className="relative flex h-12 items-center gap-3 rounded-xl px-2 py-1">
      <OutletBrandMark name={current?.name ?? "Restaurant"} logoUrl={logoUrl} />
      <div className="min-w-0 text-left">
        <label className="relative flex items-center cursor-pointer">
          <select
            aria-label={lang === "hi" ? "आउटलेट बदलें" : "Switch outlet"}
            disabled={busy}
            value={current?.id}
            onChange={async (e) => {
              setBusy(true);
              setError(null);
              const r = await switchOutletAction(e.target.value);
              if (r?.error) {
                setError(r.error);
                setBusy(false);
              }
            }}
            className="cursor-pointer appearance-none bg-transparent pr-4 text-sm font-bold text-ink focus:outline-none"
          >
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-0 size-3.5 text-muted"
            aria-hidden="true"
          />
        </label>
        <p className="truncate text-xs font-medium text-muted">
          Kitchen &amp; Café
        </p>
      </div>
      {error && (
        <span role="alert" className="truncate text-[10px] text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

function OutletBrandMark({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  return (
    <span className={`grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl ${logoUrl ? "" : "border border-line bg-sage/70 shadow-xs"}`} aria-label={logoUrl ? `${name} logo` : `${name} initial`}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="size-full object-contain" />
      ) : <span aria-hidden="true" className="font-display text-lg font-bold text-ink">{name.trim().charAt(0).toUpperCase() || "R"}</span>}
    </span>
  );
}

/** Opens the kitchen board in the console; a solid forest green pill on wide screens */
function KitchenButton({
  lang,
  active,
  preview,
  compact = false,
  dashboardAccent = false,
}: {
  lang: Lang;
  active: boolean;
  preview: boolean;
  compact?: boolean;
  dashboardAccent?: boolean;
}) {
  const label = lang === "hi" ? "किचन डिस्प्ले" : "Kitchen Display";
  const color = dashboardAccent
    ? "bg-[#103B2C] shadow-[0_2px_8px_rgba(16,59,44,0.18)] hover:bg-[#0c2b20] focus-visible:outline-[#103B2C]"
    : "bg-[#103B2C] shadow-[0_2px_8px_rgba(16,59,44,0.18)] hover:bg-[#0c2b20] focus-visible:outline-[#103B2C]";
  return (
    <Link
      href={preview ? "#" : "/console/kitchen"}
      data-tour="kitchen"
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center gap-2.5 rounded-xl ${color} font-semibold text-white transition-all active:scale-[0.98] focus-visible:outline-2 ${
        compact ? "size-10 justify-center" : "h-11 px-4.5 text-xs sm:text-sm"
      }`}
    >
      <HugeiconsIcon
        icon={ChefHatIcon}
        size={18}
        className="shrink-0"
        aria-hidden
      />
      {!compact && (
        <span className="flex items-center gap-2">
          <span>{label}</span>
          <span
            className="size-2 rounded-full bg-emerald-400 animate-pulse"
            aria-hidden="true"
          />
        </span>
      )}
    </Link>
  );
}

/** Opens the console tour again; the tour's last stop points here */
function HelpButton({ lang, preview }: { lang: Lang; preview: boolean }) {
  const label = lang === "hi" ? "टूर देखें" : "Take the tour";
  return (
    <button
      type="button"
      data-tour="help"
      onClick={preview ? undefined : startTour}
      aria-label={label}
      title={label}
      className="grid size-11 place-items-center rounded-xl text-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-forest cursor-pointer"
    >
      <HugeiconsIcon icon={HelpCircleIcon} size={20} aria-hidden />
    </button>
  );
}
