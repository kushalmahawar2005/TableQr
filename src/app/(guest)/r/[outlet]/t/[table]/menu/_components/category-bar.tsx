"use client";

import { Restaurant01Icon, StarIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { menuThumb } from "@/domain/menu-photo";

/** A section in the bar; the photo is the first dish in it that has one */
export type CategoryLink = { id: string; label: string; photo: string | null };

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
      { rootMargin: "-130px 0px -60% 0px" },
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
    <nav aria-label={label} className="sticky top-0 z-20 -mx-4 mt-3 bg-paper/95 px-4 pb-1 backdrop-blur-[2px] min-[360px]:-mx-5 min-[360px]:px-5">
      <div ref={bar} className="flex gap-1.5 overflow-x-auto pt-2.5 [scrollbar-width:none]">
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
              className="group flex w-[76px] shrink-0 flex-col items-center gap-1.5 rounded-xl pb-1.5 text-center focus-visible:outline-2 focus-visible:outline-brand"
            >
              <TilePhoto id={c.id} photo={c.photo} on={on} />
              <span className={`line-clamp-2 min-h-[2lh] text-label leading-tight break-words ${on ? "font-bold text-brand-strong" : "font-medium text-ink"}`}>{c.label}</span>
              <span aria-hidden className={`h-[3px] w-8 rounded-full transition-colors duration-150 ${on ? "bg-brand" : "bg-transparent"}`} />
            </a>
          );
        })}
      </div>
    </nav>
  );
}

function TilePhoto({ id, photo, on }: { id: string; photo: string | null; on: boolean }) {
  const [ok, setOk] = useState(true);
  const [smallFailed, setSmallFailed] = useState(false);
  const src = smallFailed ? photo : menuThumb(photo);
  const frame = `size-16 rounded-2xl transition-[box-shadow,transform] duration-150 ${on ? "ring-2 ring-brand ring-offset-2 ring-offset-paper" : "ring-1 ring-line/70 group-hover:ring-ink/30"}`;
  if (photo && ok) {
    return (
      // Restaurant photos can live on any host, so this stays a plain lazy image
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src ?? undefined} alt="" loading="lazy" decoding="async" onError={() => (src !== photo ? setSmallFailed(true) : setOk(false))} className={`${frame} bg-line/40 object-cover`} />
    );
  }
  return (
    <span aria-hidden className={`${frame} grid place-items-center bg-gradient-to-br from-brand-soft to-surface ${on ? "text-brand" : "text-brand/60"}`}>
      <HugeiconsIcon icon={id === "popular" ? StarIcon : Restaurant01Icon} size={24} strokeWidth={1.5} />
    </span>
  );
}
