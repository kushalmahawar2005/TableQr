"use client";

import { AnimatePresence, MotionConfig } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { guideAction } from "../guide-actions";
import { guideCopy, TOUR_EVENT } from "./copy";
import { Tour, type TourStep } from "./tour";
import { Welcome } from "./welcome";

/**
 * First-run guide for the console. The welcome opens by itself the first time a person signs in;
 * the tour starts from there, or later from the help button in the top bar.
 */
export function Guide({ lang, name, sections, kitchen, welcomeSeen }: { lang: Lang; name: string; sections: { slug: string; label: string }[]; kitchen: boolean; welcomeSeen: boolean }) {
  const [mode, setMode] = useState<"welcome" | "tour" | null>(null);

  useEffect(() => {
    // A moment after the page appears, so the welcome does not land on a half-drawn screen
    const t = welcomeSeen ? undefined : setTimeout(() => setMode((m) => m ?? "welcome"), 500);
    const open = () => setMode("tour");
    window.addEventListener(TOUR_EVENT, open);
    return () => {
      clearTimeout(t);
      window.removeEventListener(TOUR_EVENT, open);
    };
  }, [welcomeSeen]);

  const c = guideCopy(lang).tour;
  const steps: TourStep[] = [
    { target: null, ...c.intro },
    ...sections.flatMap(({ slug, label }) => {
      const body = c.sections[slug];
      return body ? [{ target: `nav-${slug}`, title: label, body }] : [];
    }),
    ...(kitchen ? [{ target: "kitchen", ...c.kitchen }] : []),
    { target: "bell", ...c.bell },
    { target: "help", ...c.help },
  ];

  const startTour = useCallback(() => {
    void guideAction(["welcome"]);
    setMode("tour");
  }, []);
  const skipAll = useCallback(() => {
    void guideAction(["welcome", "tour"]);
    setMode(null);
  }, []);
  const endTour = useCallback(() => {
    void guideAction(["welcome", "tour"]);
    setMode(null);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {mode === "welcome" && <Welcome key="welcome" lang={lang} name={name} onStart={startTour} onSkip={skipAll} />}
        {mode === "tour" && <Tour key="tour" lang={lang} steps={steps} onClose={endTour} />}
      </AnimatePresence>
    </MotionConfig>
  );
}
