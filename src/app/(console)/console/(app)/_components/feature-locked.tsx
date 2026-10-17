import Link from "next/link";
import { FEATURE_LABELS, type FeatureKey } from "@/lib/plan-features";

/** Shown in place of a screen the restaurant's plan does not include */
export function FeatureLocked({ feature, extra }: { feature: FeatureKey; extra?: { href: string; label: string } }) {
  const { label, hint } = FEATURE_LABELS[feature];
  return (
    <main className="grid min-h-[60vh] place-items-center p-8 text-center">
      <div className="max-w-md">
        <p className="text-caption font-semibold uppercase tracking-wider text-muted">Not in your plan</p>
        <h1 className="mt-2 font-display text-title font-bold text-ink">{label}</h1>
        <p className="mt-2 text-body text-muted">{hint}. Ask TableQR to upgrade your plan to use it.</p>
        {extra && (
          <Link href={extra.href} className="mt-5 inline-flex min-h-11 items-center rounded-cta border border-line px-4 text-button font-semibold text-ink hover:bg-ink/5">
            {extra.label}
          </Link>
        )}
      </div>
    </main>
  );
}
