"use client";

import { Restaurant01Icon, StarIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";

export type CategoryLink = { id: string; label: string; photo: string | null };

/**
 * Sticky side rail of sections, each with a photo from its first dish. Tapping scrolls to the
 * section; the highlighted entry follows the scroll through an IntersectionObserver, so nothing
 * runs on every scroll frame.
 */
export function CategoryBar({ categories, label }: { categories: CategoryLink[]; label: string }) {
  const [active, setActive] = useState(categories[0]?.id ?? "");
  const rail = useRef<HTMLElement>(null);
  const ids = categories.map((c) => c.id).join(",");

  useEffect(() => {
    const sections = ids
      .split(",")
      .map((id) => document.getElementById(`cat-${id}`))
      .filter((el): el is HTMLElement => !!el);
    if (!sections.length) return;
    // A section counts as current once its heading reaches the upper part of the screen
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id.slice(4));
      },
      { rootMargin: "-10px 0px -65% 0px" },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [ids]);

  // Keep the current entry in view inside the rail, without moving the page itself
  useEffect(() => {
    const box = rail.current;
    const el = box?.querySelector<HTMLElement>(`[data-cat="${active}"]`);
    if (!box || !el) return;
    if (el.offsetTop < box.scrollTop || el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight - 96) {
      box.scrollTo({ top: Math.max(0, el.offsetTop - box.clientHeight / 3), behavior: "smooth" });
    }
  }, [active]);

  const current = categories.some((c) => c.id === active) ? active : categories[0]?.id;

  return (
    <nav
      ref={rail}
      aria-label={label}
      className="sticky top-0 h-dvh w-[76px] shrink-0 overflow-y-auto border-r border-line/70 bg-surface pb-32 [scrollbar-width:none]"
    >
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
            className={`relative flex flex-col items-center gap-1.5 px-1.5 py-3 text-center transition-colors duration-150 ease-natural focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ${
              on ? "bg-brand-soft" : "hover:bg-paper"
            }`}
          >
            {on && <span aria-hidden className="absolute inset-y-2 right-0 w-[3px] rounded-l-full bg-brand" />}
            <RailPhoto id={c.id} photo={c.photo} on={on} />
            <span className={`line-clamp-2 text-label leading-tight break-words ${on ? "font-bold text-brand-strong" : "font-medium text-ink"}`}>{c.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

function RailPhoto({ id, photo, on }: { id: string; photo: string | null; on: boolean }) {
  const [ok, setOk] = useState(true);
  const ring = on ? "ring-2 ring-brand" : "ring-1 ring-line/80";
  if (photo && ok) {
    return (
      // Restaurant photos can live on any host, so this stays a plain lazy image
      // eslint-disable-next-line @next/next/no-img-element
      <img src={photo} alt="" loading="lazy" decoding="async" onError={() => setOk(false)} className={`size-12 rounded-xl bg-line/40 object-cover ${ring}`} />
    );
  }
  return (
    <span aria-hidden className={`grid size-12 place-items-center rounded-xl bg-brand-soft text-brand ${ring}`}>
      <HugeiconsIcon icon={id === "popular" ? StarIcon : Restaurant01Icon} size={22} strokeWidth={1.6} />
    </span>
  );
}
