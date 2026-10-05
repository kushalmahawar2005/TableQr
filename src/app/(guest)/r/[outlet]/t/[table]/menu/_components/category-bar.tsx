"use client";

import { useEffect, useRef, useState } from "react";

export type CategoryLink = { id: string; label: string };

/**
 * Sticky section bar. Tapping scrolls to the section; the highlighted chip follows the scroll
 * through an IntersectionObserver, so nothing runs on every scroll frame.
 */
export function CategoryBar({ categories, label }: { categories: CategoryLink[]; label: string }) {
  const [active, setActive] = useState(categories[0]?.id ?? "");
  const bar = useRef<HTMLDivElement>(null);
  const ids = categories.map((c) => c.id).join(",");

  useEffect(() => {
    const sections = ids
      .split(",")
      .map((id) => document.getElementById(`cat-${id}`))
      .filter((el): el is HTMLElement => !!el);
    if (!sections.length) return;
    // A section counts as current once its heading passes just under the sticky bars
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id.slice(4));
      },
      { rootMargin: "-60px 0px -65% 0px" },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [ids]);

  // Keep the current chip in view inside the bar
  useEffect(() => {
    bar.current?.querySelector(`[data-cat="${active}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  const current = categories.some((c) => c.id === active) ? active : categories[0]?.id;

  return (
    <nav aria-label={label} className="sticky top-0 z-20 -mx-4 bg-paper/95 px-4 py-2 backdrop-blur-[2px] min-[360px]:-mx-5 min-[360px]:px-5">
      <div ref={bar} className="flex gap-2 overflow-x-auto py-1 [scrollbar-width:none]">
        {categories.map((c) => {
          const on = c.id === current;
          return (
            <a
              key={c.id}
              href={`#cat-${c.id}`}
              data-cat={c.id}
              aria-current={on ? "true" : undefined}
              onClick={(e) => {
                e.preventDefault();
                setActive(c.id);
                document.getElementById(`cat-${c.id}`)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
              }}
              className={`shrink-0 rounded-xl border px-4 py-2.5 text-body whitespace-nowrap shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-colors duration-150 ease-natural focus-visible:outline-2 focus-visible:outline-brand ${
                on ? "border-brand-border bg-brand-soft font-bold text-brand-strong" : "border-line/80 bg-surface font-medium text-ink hover:border-ink/30"
              }`}
            >
              {c.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
