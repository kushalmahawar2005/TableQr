"use client";

import {
  Calendar03Icon,
  ChartHistogramIcon,
  DashboardSquare01Icon,
  Invoice01Icon,
  Logout01Icon,
  MenuRestaurantIcon,
  Note01Icon,
  Settings01Icon,
  Tag01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { Lang } from "@/lib/i18n";
import { signOutAction } from "../../login/actions";

const ICONS: Record<string, IconSvgElement> = {
  floor: DashboardSquare01Icon,
  reservations: Calendar03Icon,
  waitlist: UserGroupIcon,
  orders: Note01Icon,
  billing: Invoice01Icon,
  menu: MenuRestaurantIcon,
  pricing: Tag01Icon,
  reports: ChartHistogramIcon,
  settings: Settings01Icon,
};

const ROLE = { en: { owner: "Owner", manager: "Manager", host: "Host", cashier: "Cashier", waiter: "Waiter", kitchen: "Kitchen", accountant: "Accountant" }, hi: { owner: "मालिक", manager: "मैनेजर", host: "होस्ट", cashier: "कैशियर", waiter: "वेटर", kitchen: "किचन", accountant: "अकाउंटेंट" } } as const;

/**
 * Staff console frame. 1024px and up: full sidebar. 600 to 1023px: icon rail (labels stay as
 * accessible names). Phones under 600px are not a Host/POS target.
 */
export function StaffShell({
  lang,
  sections,
  staff,
  children,
  activeSlug,
  preview = false,
}: {
  lang: Lang;
  sections: { slug: string; label: string }[];
  staff: { name: string; roles: string[]; outlet: string; shiftEnds: number | null };
  children: ReactNode;
  activeSlug?: string;
  preview?: boolean;
}) {
  const path = usePathname();
  const active = activeSlug ?? path?.split("/")[2];
  const role = staff.roles.map((r) => ROLE[lang][r as keyof (typeof ROLE)["en"]] ?? r).join(", ");
  return (
    <div lang={lang} className="flex min-h-dvh flex-1 bg-[#f3f1ec] text-ink">
      <aside className="sticky top-0 flex h-dvh w-16 shrink-0 flex-col border-r border-line bg-surface lg:w-52">
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
          <form action={preview ? undefined : signOutAction}>
            <button type={preview ? "button" : "submit"} aria-label={lang === "hi" ? "साइन आउट" : "Sign out"} title={staff.name} className="flex min-h-11 w-full items-center gap-3 rounded-input px-3 text-body font-semibold text-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink">
              <HugeiconsIcon icon={Logout01Icon} size={20} className="shrink-0" aria-hidden />
              <span className="hidden lg:inline">{lang === "hi" ? "साइन आउट" : "Sign out"}</span>
            </button>
          </form>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
