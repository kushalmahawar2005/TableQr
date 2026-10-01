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
    <nav aria-label={label} className="sticky top-0 z-20 -mx-4 border-b border-line bg-paper/95 px-4 backdrop-blur-[2px] min-[360px]:-mx-5 min-[360px]:px-5">
      <div ref={bar} className="flex gap-5 overflow-x-auto [scrollbar-width:none]">
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
              className={`relative shrink-0 py-3 text-body whitespace-nowrap transition-colors duration-150 ease-natural focus-visible:outline-2 focus-visible:outline-brand ${
                on ? "font-bold text-ink" : "font-medium text-muted hover:text-ink"
              }`}
            >
              {c.label}
              <span aria-hidden className={`absolute inset-x-0 -bottom-px h-0.5 rounded-full ${on ? "bg-brand" : "bg-transparent"}`} />
            </a>
          );
        })}
      </div>
    </nav>
  );
}
