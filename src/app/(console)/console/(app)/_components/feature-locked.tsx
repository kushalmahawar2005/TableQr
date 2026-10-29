import Link from "next/link";
import { FEATURE_LABELS, type FeatureKey } from "@/lib/plan-features";
import { hasOpenRequest } from "@/server/staff/plan-request";
import { currentStaff } from "@/server/staff/request";
import { ContactTableeqr } from "./contact-tableeqr";
import { RequestUpgrade } from "./request-upgrade";

/** Shown in place of a screen the restaurant's plan does not include */
export async function FeatureLocked({ feature, extra }: { feature: FeatureKey; extra?: { href: string; label: string } | { href: string; label: string }[] }) {
  const { label, hint } = FEATURE_LABELS[feature];
  const staff = await currentStaff();
  // Owners and managers can ask for it; Tableeqr then changes the plan by hand
  const canAsk = !!staff && staff.roles.some((r) => r === "owner" || r === "manager");
  const asked = canAsk && (await hasOpenRequest(staff.tenantId, feature));
  return (
    <main className="grid min-h-[60vh] place-items-center p-4 sm:p-8 text-center">
      <div className="max-w-md">
        <p className="text-caption font-semibold uppercase tracking-wider text-muted">Not in your plan</p>
        <h1 className="mt-2 font-display text-title font-bold text-ink">{label}</h1>
        <p className="mt-2 text-body text-muted">{hint}. Ask Tableeqr to upgrade your plan to use it.</p>
        {canAsk && <RequestUpgrade feature={feature} asked={asked} />}
        {canAsk && <div className="mt-3"><ContactTableeqr message={`Hi Tableeqr, this is ${staff.outlet.name}. We want ${label}.`} /></div>}
        {extra && (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {(Array.isArray(extra) ? extra : [extra]).map((x) => (
              <Link key={x.href} href={x.href} className="inline-flex min-h-11 items-center rounded-cta border border-line px-4 text-button font-semibold text-ink hover:bg-ink/5">
                {x.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
