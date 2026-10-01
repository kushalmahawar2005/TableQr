"use client";

import { useTransition } from "react";
import type { Lang } from "@/lib/i18n";
import { setLanguage } from "../actions";

const options: { lang: Lang; label: string; name: string }[] = [
  { lang: "en", label: "EN", name: "English" },
  { lang: "hi", label: "HI", name: "हिन्दी (Hindi)" },
];

/** EN / HI switch, both labels readable. Drawn compact, but each option has a 44px tap area. */
export function LanguageToggle({ lang, label, preview }: { lang: Lang; label: string; preview?: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <div role="group" aria-label={label} className="flex shrink-0 rounded-full border border-line bg-surface p-0.5">
      {options.map((o) => {
        const active = o.lang === lang;
        return (
          <button
            key={o.lang}
            type="button"
            aria-label={o.name}
            aria-pressed={active}
            disabled={pending}
            onClick={() => !active && !preview && startTransition(() => setLanguage(o.lang))}
            className={`relative h-8 min-w-10 rounded-full px-2.5 text-caption font-semibold transition-colors duration-150 ease-natural before:absolute before:-inset-y-1.5 before:inset-x-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
              active ? "bg-ink text-white" : "text-ink/70 hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
