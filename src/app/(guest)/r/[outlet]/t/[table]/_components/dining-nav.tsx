"use client";

import { Invoice01Icon, Note01Icon, Restaurant01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import type { Lang } from "@/lib/i18n";

/** Only destinations that exist: Menu, Orders, Table, Bill. No tracker, table or bill
 * implementation enters the menu's client bundle; these are plain links. */
const ICONS = { menu: Restaurant01Icon, orders: Note01Icon, table: UserGroupIcon, bill: Invoice01Icon } as const;

export function DiningNav({ tablePath, active, lang, inProgress = 0, preview = false, above, onLeave }: {
  tablePath: string; active: "menu" | "orders" | "table" | "bill"; lang: Lang; inProgress?: number; preview?: boolean;
  above?: ReactNode; onLeave?: () => void;
}) {
  const dock = useRef<HTMLDivElement>(null);
  const space = useRef<HTMLDivElement>(null);
  // The cart and navigation grow together with Hindi and larger text. Reserve their actual
  // height, so neither overlaps the last dish or the other's controls.
  useEffect(() => {
    const element = dock.current;
    if (!element) return;
    const measure = () => {
      if (space.current) space.current.style.height = `${element.getBoundingClientRect().height + 16}px`;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const labels = lang === "hi" ? { menu: "मेन्यू", orders: "ऑर्डर", table: "टेबल", bill: "बिल", nav: "खाने के विकल्प" } : { menu: "Menu", orders: "Orders", table: "Table", bill: "Bill", nav: "Dining navigation" };
  return (
    <>
    <div ref={space} aria-hidden className={above ? "h-44 shrink-0" : "h-20 shrink-0"} />
    <div ref={dock} className="pointer-events-none fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[480px]">
      {above && <div className="px-4 pb-3 min-[360px]:px-5">{above}</div>}
    <nav aria-label={labels.nav} className="pointer-events-auto border-t border-line/70 bg-surface/95 px-4 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_20px_rgb(31_41_55/0.06)] backdrop-blur-md min-[360px]:px-5">
      {/* Always one row of four: each tab is at least as wide as its label, so 200% text and Hindi
          share out the width instead of wrapping to a second row or breaking words */}
      <div className="grid min-h-16 grid-cols-[repeat(4,minmax(min-content,1fr))] text-body">
        {(["menu", "orders", "table", "bill"] as const).map((tab) => (
          <Link key={tab} href={preview ? "#" : `${tablePath}/${tab}`} prefetch={false} aria-current={active === tab ? "page" : undefined}
            onNavigate={(event) => { if (preview || active === tab) event.preventDefault(); else onLeave?.(); }}
            className={`group flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 px-1 py-2 text-center text-caption font-semibold break-words focus-visible:outline-2 focus-visible:outline-brand ${active === tab ? "text-brand" : "text-muted hover:text-ink"}`}>
            {/* Four tabs on a 320px phone: the count sits on the icon's corner instead of beside it */}
            <span className={`relative grid h-8 w-12 place-items-center rounded-full transition-colors duration-150 ${active === tab ? "bg-brand-soft" : ""}`}>
              <HugeiconsIcon icon={ICONS[tab]} size={22} strokeWidth={active === tab ? 2.2 : 1.7} aria-hidden />
              {tab === "orders" && inProgress > 0 && <span className="absolute -top-1 right-0.5 rounded-full bg-ink px-1.5 text-label leading-4 tabular text-white">{inProgress}</span>}
            </span>
            {labels[tab]}
          </Link>
        ))}
      </div>
    </nav>
    </div>
    </>
  );
}
