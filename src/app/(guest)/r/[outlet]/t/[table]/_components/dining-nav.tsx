"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import type { Lang } from "@/lib/i18n";

/** Only destinations that exist. No tracker implementation enters the menu's client bundle. */
export function DiningNav({ tablePath, active, lang, inProgress = 0, preview = false, above, onLeave }: {
  tablePath: string; active: "menu" | "orders"; lang: Lang; inProgress?: number; preview?: boolean;
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
  const labels = lang === "hi" ? { menu: "मेन्यू", orders: "ऑर्डर", nav: "खाने के विकल्प" } : { menu: "Menu", orders: "Orders", nav: "Dining navigation" };
  return (
    <>
    <div ref={space} aria-hidden className={above ? "h-44 shrink-0" : "h-20 shrink-0"} />
    <div ref={dock} className="pointer-events-none fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[480px]">
      {above && <div className="px-4 pb-3 min-[360px]:px-5">{above}</div>}
    <nav aria-label={labels.nav} className="pointer-events-auto border-t border-line bg-paper px-4 pb-[env(safe-area-inset-bottom)] min-[360px]:px-5">
      <div className="grid min-h-16 grid-cols-2 gap-4">
        {(["menu", "orders"] as const).map((tab) => (
          <Link key={tab} href={preview ? "#" : `${tablePath}/${tab}`} prefetch={false} aria-current={active === tab ? "page" : undefined}
            onNavigate={(event) => { if (preview || active === tab) event.preventDefault(); else onLeave?.(); }}
            className={`flex min-h-16 flex-wrap items-center justify-center gap-2 border-t-2 px-2 py-3 text-body font-semibold focus-visible:outline-2 focus-visible:outline-brand ${active === tab ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"}`}>
            {labels[tab]}
            {tab === "orders" && inProgress > 0 && <span className="rounded-full bg-ink px-2 py-0.5 text-label tabular text-white">{inProgress}</span>}
          </Link>
        ))}
      </div>
    </nav>
    </div>
    </>
  );
}
