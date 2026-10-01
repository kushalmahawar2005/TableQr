"use client";

import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

// Unexpected failure while loading G1. English only: the language cookie is not readable here.
export default function TableLandingError({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col pt-10">
      <div role="alert" className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--state-paid-soft)] text-[var(--state-paid-text)]">
          <HugeiconsIcon icon={Alert02Icon} size={22} aria-hidden />
        </span>
        <div>
          <h1 className="font-display text-title font-bold">We could not load this table.</h1>
          <p className="mt-1 text-body text-muted">Check your connection and try again.</p>
        </div>
      </div>
      <button
        type="button"
        onClick={reset}
        className="mt-auto mb-[max(20px,env(safe-area-inset-bottom))] min-h-14 w-full rounded-cta border border-line bg-surface text-button font-semibold text-ink transition-transform duration-100 ease-natural active:scale-[0.98]"
      >
        Try again
      </button>
    </main>
  );
}
