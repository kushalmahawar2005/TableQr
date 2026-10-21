"use client";

import { ArrowRight01Icon, HelpCircleIcon, SparklesIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import type { Lang } from "@/lib/i18n";
import type { SetupStep } from "@/server/staff/guide";
import { guideAction } from "../guide-actions";
import { guideCopy, startTour } from "./copy";

const spring = { type: "spring", stiffness: 300, damping: 28 } as const;
const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/** Owner's "get ready" list on the dashboard; each step ticks itself from the restaurant's real data */
export function SetupChecklist({ lang, steps }: { lang: Lang; steps: SetupStep[] }) {
  const c = guideCopy(lang).setup;
  const [open, setOpen] = useState(true);
  const done = steps.filter((s) => s.done).length;
  const allDone = done === steps.length;
  const nextKey = steps.find((s) => !s.done)?.key;
  const hide = () => {
    setOpen(false);
    void guideAction(["setupHidden"]);
  };

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence initial={false}>
        {open && (
          <motion.section
            aria-labelledby="tq-setup-title"
            className="relative mt-5 overflow-hidden rounded-card border border-brand-border bg-surface"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={spring}
          >
            <motion.span aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-64 rounded-full bg-brand/15 blur-3xl" animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }} />
            <div className="relative flex flex-wrap items-center gap-4 border-b border-line p-4 sm:p-5">
              <Ring done={done} total={steps.length} />
              <div className="min-w-0 flex-1">
                <h2 id="tq-setup-title" className="font-display text-section font-bold text-ink">{allDone ? c.allDone : c.title}</h2>
                <p className="mt-0.5 text-body text-muted">{allDone ? c.allDoneBody : c.body}</p>
                <p className="mt-1 text-caption font-semibold text-brand-strong tabular">{c.progress(done, steps.length)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={startTour} className={`flex min-h-10 items-center gap-1.5 rounded-input border border-line px-3 text-body font-semibold text-ink hover:bg-ink/5 ${focus}`}>
                  <HugeiconsIcon icon={HelpCircleIcon} size={18} aria-hidden />
                  {c.tour}
                </button>
                <button type="button" onClick={hide} className={`min-h-10 rounded-input px-3 text-body font-semibold text-muted hover:bg-ink/5 hover:text-ink ${focus}`}>{c.hide}</button>
              </div>
            </div>
            {allDone ? (
              <Celebrate />
            ) : (
              <ol className="relative grid gap-px bg-line sm:grid-cols-2">
                {steps.map((st, i) => {
                  const s = c.steps[st.key];
                  const isNext = st.key === nextKey;
                  return (
                    <motion.li key={st.key} className={`flex items-start gap-3 p-4 ${isNext ? "bg-brand-soft/60" : "bg-surface"}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.05 * i }}>
                      <Check done={st.done} n={i + 1} />
                      <div className="min-w-0 flex-1">
                        <p className={`text-body font-semibold ${st.done ? "text-muted line-through decoration-ink/30" : "text-ink"}`}>{s.title}</p>
                        {!st.done && <p className="mt-0.5 text-caption text-muted">{s.body}</p>}
                      </div>
                      {!st.done && (
                        <Link
                          href={st.href}
                          className={`group flex min-h-9 shrink-0 items-center gap-1 rounded-input px-3 text-caption font-bold ${isNext ? "bg-brand text-brand-on hover:bg-brand-hover" : "border border-line text-ink hover:bg-ink/5"} ${focus}`}
                        >
                          {c.go}
                          <HugeiconsIcon icon={ArrowRight01Icon} size={14} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
                        </Link>
                      )}
                    </motion.li>
                  );
                })}
              </ol>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

/** Progress as a ring that fills in */
function Ring({ done, total }: { done: number; total: number }) {
  const r = 22;
  return (
    <div className="relative grid size-14 shrink-0 place-items-center">
      <svg viewBox="0 0 56 56" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="28" cy="28" r={r} fill="none" strokeWidth="5" className="stroke-ink/10" />
        <motion.circle cx="28" cy="28" r={r} fill="none" strokeWidth="5" strokeLinecap="round" className="stroke-brand" initial={{ pathLength: 0 }} animate={{ pathLength: total ? done / total : 0 }} transition={{ ...spring, delay: 0.2 }} />
      </svg>
      <span className="font-display text-body font-bold tabular text-ink">{Math.round((total ? done / total : 0) * 100)}%</span>
    </div>
  );
}

/** A tick that draws itself for finished steps, the step number otherwise */
function Check({ done, n }: { done: boolean; n: number }) {
  return done ? (
    <motion.span className="grid size-7 shrink-0 place-items-center rounded-full bg-success text-white" initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>
      <HugeiconsIcon icon={Tick02Icon} size={16} strokeWidth={2.5} aria-hidden />
    </motion.span>
  ) : (
    <span className="grid size-7 shrink-0 place-items-center rounded-full border-2 border-line text-caption font-bold text-muted tabular">{n}</span>
  );
}

/** Little sparks rising when every step is done */
function Celebrate() {
  return (
    <div className="relative flex h-28 items-center justify-center overflow-hidden">
      {Array.from({ length: 14 }, (_, i) => (
        <motion.span
          key={i}
          aria-hidden
          className={`absolute bottom-0 size-2 rounded-full ${i % 3 === 0 ? "bg-brand" : i % 3 === 1 ? "bg-success" : "bg-warning"}`}
          style={{ left: `${5 + ((i * 37) % 90)}%` }}
          initial={{ y: 0, opacity: 0 }}
          animate={{ y: -110, opacity: [0, 1, 0] }}
          transition={{ duration: 1.8 + (i % 4) * 0.3, repeat: Infinity, delay: (i % 7) * 0.25, ease: "easeOut" }}
        />
      ))}
      <motion.span className="grid size-14 place-items-center rounded-full bg-brand text-brand-on shadow-lg" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 300, damping: 12 }}>
        <HugeiconsIcon icon={SparklesIcon} size={26} aria-hidden />
      </motion.span>
    </div>
  );
}
