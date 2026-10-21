"use client";

import { ArrowLeft01Icon, ArrowRight01Icon, Cancel01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { guideCopy } from "./copy";

/** One stop of the tour; `target` matches a `data-tour` attribute, null shows the card in the middle */
export type TourStep = { target: string | null; title: string; body: string };

const spring = { type: "spring", stiffness: 320, damping: 32 } as const;
const PAD = 6;
const GAP = 14;
const EDGE = 12;

/** The copy of a target that is on screen now: the sidebar on wide screens, the bottom bar on phones */
function visible(target: string) {
  return [...document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)].find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

type Box = { left: number; top: number; width: number; height: number };

/**
 * Spotlight tour: the page dims, a lit window glides from one part of the screen to the next,
 * and a card beside it says what that part is for.
 */
export function Tour({ lang, steps: all, onClose }: { lang: Lang; steps: TourStep[]; onClose: () => void }) {
  const c = guideCopy(lang).tour;
  // Parts not on this screen (a button this role does not have) are left out
  const [steps] = useState(() => all.filter((s) => !s.target || visible(s.target)));
  const [i, setI] = useState(0);
  const [hole, setHole] = useState<Box | null>(null);
  const [card, setCard] = useState<{ left: number; top: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const step = steps[i];
  const last = i === steps.length - 1;

  const measure = useCallback(() => {
    const el = step?.target ? visible(step.target) : null;
    const r = el?.getBoundingClientRect();
    setHole(r ? { left: r.left - PAD, top: r.top - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 } : null);
  }, [step]);

  useLayoutEffect(() => {
    const el = step?.target ? visible(step.target) : null;
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading where the part sits on screen
    measure();
    // Once more after the smooth scroll has settled
    const t = setTimeout(measure, 380);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step, measure]);

  // Place the card beside the lit part: right of it, else below, else above, always on screen
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    if (!hole) return setCard({ left: (vw - w) / 2, top: (vh - h) / 2 });
    if (hole.left + hole.width + GAP + w <= vw - EDGE) {
      return setCard({ left: hole.left + hole.width + GAP, top: clamp(hole.top + hole.height / 2 - h / 2, EDGE, vh - h - EDGE) });
    }
    const left = clamp(hole.left + hole.width / 2 - w / 2, EDGE, vw - w - EDGE);
    if (hole.top + hole.height + GAP + h <= vh - EDGE) return setCard({ left, top: hole.top + hole.height + GAP });
    setCard({ left, top: clamp(hole.top - GAP - h, EDGE, vh - h - EDGE) });
  }, [hole, i]);

  const next = useCallback(() => (last ? onClose() : setI((n) => n + 1)), [last, onClose]);
  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back, onClose]);

  if (!step) return null;
  const vwCenter = typeof window === "undefined" ? 0 : window.innerWidth / 2;
  const vhCenter = typeof window === "undefined" ? 0 : window.innerHeight / 2;

  return (
    <motion.div className="fixed inset-0 z-[60]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      {/* Catches clicks so the page underneath stays put during the tour */}
      <div className="absolute inset-0" aria-hidden />
      {/* The dim layer with a lit window cut out of it */}
      <svg aria-hidden className="pointer-events-none absolute inset-0 size-full">
        <defs>
          <mask id="tq-tour-hole">
            <rect width="100%" height="100%" fill="white" />
            <motion.rect rx={14} fill="black" initial={false} animate={hole ? { x: hole.left, y: hole.top, width: hole.width, height: hole.height } : { x: vwCenter, y: vhCenter, width: 0, height: 0 }} transition={spring} />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgb(0 0 0 / 0.55)" mask="url(#tq-tour-hole)" />
      </svg>
      <motion.div
        aria-hidden
        className="pointer-events-none absolute rounded-[14px]"
        initial={false}
        animate={hole ?? { left: vwCenter, top: vhCenter, width: 0, height: 0 }}
        transition={spring}
      >
        {hole && (
          <motion.span
            key={i}
            className="absolute inset-0 rounded-[14px] border-2 border-brand"
            initial={{ opacity: 0.9, scale: 1 }}
            animate={{ opacity: 0, scale: 1.15 }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
          />
        )}
        {hole && <span className="absolute inset-0 rounded-[14px] ring-2 ring-white/90" />}
      </motion.div>

      <motion.div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tq-tour-title"
        aria-describedby="tq-tour-body"
        className="absolute w-[min(320px,calc(100vw-24px))] overflow-hidden rounded-card border border-line bg-surface text-ink shadow-2xl"
        style={{ visibility: card ? "visible" : "hidden" }}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1, left: card?.left ?? 0, top: card?.top ?? 0 }}
        transition={spring}
      >
        <div className="h-1 bg-ink/10">
          <motion.div className="h-full bg-brand" initial={false} animate={{ width: `${((i + 1) / steps.length) * 100}%` }} transition={spring} />
        </div>
        <div className="p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-caption font-semibold text-brand-strong tabular">{c.of(i + 1, steps.length)}</span>
            <button type="button" onClick={onClose} aria-label={c.skip} className="-mr-1 grid size-8 place-items-center rounded-input text-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink">
              <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden />
            </button>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }}>
              <h2 id="tq-tour-title" className="mt-1 font-display text-section font-bold leading-snug">{step.title}</h2>
              <p id="tq-tour-body" className="mt-1 text-body text-muted">{step.body}</p>
            </motion.div>
          </AnimatePresence>
          <div className="mt-4 flex items-center gap-2">
            {i > 0 ? (
              <button type="button" onClick={back} aria-label={c.back} className="grid size-10 shrink-0 place-items-center rounded-input border border-line text-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink">
                <HugeiconsIcon icon={ArrowLeft01Icon} size={18} aria-hidden />
              </button>
            ) : (
              <button type="button" onClick={onClose} className="min-h-10 rounded-input px-2 text-caption font-semibold text-muted hover:text-ink">{c.skip}</button>
            )}
            <motion.button
              type="button"
              autoFocus
              onClick={next}
              whileTap={{ scale: 0.96 }}
              className="ml-auto flex min-h-10 items-center gap-1.5 rounded-input bg-brand px-4 text-body font-bold text-brand-on hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              {last ? c.done : c.next}
              <HugeiconsIcon icon={last ? Tick02Icon : ArrowRight01Icon} size={16} aria-hidden />
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
