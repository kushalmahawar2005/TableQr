"use client";

import { ArrowLeft01Icon, ArrowRight01Icon, Cancel01Icon, ChefHatIcon, Invoice01Icon, QrCodeIcon, SmartPhone01Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { guideCopy } from "./copy";

const spring = { type: "spring", stiffness: 380, damping: 32 } as const;

/** First sign-in: a few slides on what TableQR does, then the tour or straight to work */
export function Welcome({ lang, name, onStart, onSkip }: { lang: Lang; name: string; onStart: () => void; onSkip: () => void }) {
  const c = guideCopy(lang).welcome;
  const slides = [{ title: c.title(name.split(" ")[0] || name), body: c.body }, ...c.slides];
  const [[index, dir], setSlide] = useState<[number, number]>([0, 1]);
  const last = index === slides.length - 1;
  const go = (to: number) => setSlide([Math.max(0, Math.min(slides.length - 1, to)), to > index ? 1 : -1]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setSlide(([i]) => [Math.min(slides.length - 1, i + 1), 1]);
      if (e.key === "ArrowLeft") setSlide(([i]) => [Math.max(0, i - 1), -1]);
      if (e.key === "Escape") onSkip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length, onSkip]);

  return (
    <motion.div className="fixed inset-0 z-[60] grid place-items-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden />
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby="tq-welcome-title"
        className="relative w-full max-w-[440px] overflow-hidden rounded-card border border-line bg-surface text-ink shadow-2xl"
        initial={{ opacity: 0, y: 24, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.97 }}
        transition={spring}
      >
        <div className="relative h-52 overflow-hidden bg-brand-soft">
          <Glow />
          <button type="button" onClick={onSkip} aria-label={c.skip} title={c.skip} className="absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-full bg-surface/80 text-muted backdrop-blur hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-ink">
            <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden />
          </button>
          <AnimatePresence mode="popLayout" initial={false} custom={dir}>
            <motion.div
              key={index}
              custom={dir}
              className="absolute inset-0 grid place-items-center"
              variants={{ enter: (d: number) => ({ x: d * 80, opacity: 0 }), center: { x: 0, opacity: 1 }, exit: (d: number) => ({ x: d * -80, opacity: 0 }) }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={spring}
            >
              <Art index={index} />
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="px-6 pb-6 pt-5">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={index} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }} className="min-h-[104px]">
              <h2 id="tq-welcome-title" className="font-display text-title font-bold leading-tight">{slides[index].title}</h2>
              <p className="mt-2 text-body text-muted">{slides[index].body}</p>
            </motion.div>
          </AnimatePresence>
          <div className="mt-4 flex items-center gap-1.5" aria-hidden>
            {slides.map((_, i) => (
              <motion.button
                key={i}
                type="button"
                tabIndex={-1}
                onClick={() => go(i)}
                className="h-1.5 rounded-full bg-ink/15"
                animate={{ width: i === index ? 24 : 8, backgroundColor: i === index ? "var(--brand-main)" : "color-mix(in srgb, var(--ink) 15%, transparent)" }}
                transition={spring}
              />
            ))}
          </div>
          <div className="mt-5 flex items-center gap-2">
            {index > 0 ? (
              <button type="button" onClick={() => go(index - 1)} aria-label={c.back} className="grid size-11 shrink-0 place-items-center rounded-input border border-line text-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink">
                <HugeiconsIcon icon={ArrowLeft01Icon} size={20} aria-hidden />
              </button>
            ) : (
              <button type="button" onClick={onSkip} className="min-h-11 shrink-0 rounded-input px-3 text-body font-semibold text-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink">{c.skip}</button>
            )}
            <motion.button
              type="button"
              autoFocus
              onClick={last ? onStart : () => go(index + 1)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              className="ml-auto flex min-h-11 items-center gap-2 rounded-input bg-brand px-5 text-body font-bold text-brand-on shadow-sm hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              {last ? c.start : c.next}
              <HugeiconsIcon icon={last ? SparklesIcon : ArrowRight01Icon} size={18} aria-hidden />
            </motion.button>
          </div>
        </div>
      </motion.section>
    </motion.div>
  );
}

/** Two soft colour blobs drifting behind the picture */
function Glow() {
  return (
    <>
      <motion.span aria-hidden className="absolute -left-10 -top-16 size-56 rounded-full bg-brand/25 blur-3xl" animate={{ x: [0, 30, 0], y: [0, 20, 0] }} transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }} />
      <motion.span aria-hidden className="absolute -bottom-20 -right-10 size-60 rounded-full bg-brand/20 blur-3xl" animate={{ x: [0, -24, 0], y: [0, -16, 0] }} transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }} />
    </>
  );
}

const tile = "grid place-items-center rounded-2xl bg-surface text-ink shadow-lg ring-1 ring-black/5";

/** A small moving picture for each slide, drawn from icons */
function Art({ index }: { index: number }) {
  if (index === 0) {
    const orbit = [QrCodeIcon, ChefHatIcon, Invoice01Icon];
    return (
      <div className="relative size-40">
        <motion.div className="absolute inset-0" animate={{ rotate: 360 }} transition={{ duration: 18, repeat: Infinity, ease: "linear" }}>
          {orbit.map((icon, i) => {
            const a = (i / orbit.length) * Math.PI * 2;
            return (
              <motion.span key={i} className={`${tile} absolute size-11`} style={{ left: 80 + Math.cos(a) * 64 - 22, top: 80 + Math.sin(a) * 64 - 22 }} animate={{ rotate: -360 }} transition={{ duration: 18, repeat: Infinity, ease: "linear" }}>
                <HugeiconsIcon icon={icon} size={20} aria-hidden />
              </motion.span>
            );
          })}
        </motion.div>
        <motion.span className="absolute left-1/2 top-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-2xl bg-ink font-display text-[28px] font-bold text-white shadow-xl" initial={{ scale: 0.6, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.1 }}>
          T
        </motion.span>
      </div>
    );
  }
  if (index === 1) {
    return (
      <div className="relative">
        <motion.div className="relative grid h-36 w-[84px] place-items-center rounded-[18px] border-[3px] border-ink bg-surface shadow-xl" initial={{ y: 20, rotate: -6 }} animate={{ y: 0, rotate: -4 }} transition={spring}>
          <HugeiconsIcon icon={QrCodeIcon} size={44} className="text-ink" aria-hidden />
          <motion.span aria-hidden className="absolute inset-x-2 h-0.5 rounded-full bg-brand shadow-[0_0_12px_var(--brand-main)]" animate={{ top: ["22%", "78%", "22%"] }} transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }} />
        </motion.div>
        <motion.span className={`${tile} absolute -right-12 top-2 size-11`} initial={{ scale: 0 }} animate={{ scale: 1, y: [0, -6, 0] }} transition={{ scale: { delay: 0.25, ...spring }, y: { duration: 3, repeat: Infinity, ease: "easeInOut" } }}>
          <HugeiconsIcon icon={SmartPhone01Icon} size={20} aria-hidden />
        </motion.span>
      </div>
    );
  }
  if (index === 2) {
    return (
      <div className="relative flex items-center gap-4">
        <motion.span className={`${tile} size-20`} initial={{ scale: 0.7 }} animate={{ scale: 1 }} transition={spring}>
          <HugeiconsIcon icon={ChefHatIcon} size={36} aria-hidden />
        </motion.span>
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <motion.span key={i} className="flex h-8 w-28 items-center gap-2 rounded-lg bg-surface px-2 shadow-md ring-1 ring-black/5" initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ ...spring, delay: 0.15 + i * 0.12 }}>
              <span className={`size-2 rounded-full ${i === 0 ? "bg-brand" : "bg-success"}`} />
              <span className="h-1.5 flex-1 rounded-full bg-ink/15" />
            </motion.span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="relative flex items-end gap-4">
      <motion.span className={`${tile} size-20`} initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={spring}>
        <HugeiconsIcon icon={Invoice01Icon} size={36} aria-hidden />
      </motion.span>
      <div className="flex h-24 w-32 items-end gap-2 rounded-2xl bg-surface px-3 pb-3 shadow-lg ring-1 ring-black/5">
        {[28, 46, 36, 62].map((h, i) => (
          <motion.span key={i} className={`flex-1 rounded-t-md ${i === 3 ? "bg-brand" : "bg-ink/20"}`} initial={{ height: 4 }} animate={{ height: h }} transition={{ ...spring, delay: 0.15 + i * 0.08 }} />
        ))}
      </div>
    </div>
  );
}
