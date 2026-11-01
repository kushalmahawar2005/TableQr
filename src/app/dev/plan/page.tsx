import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StaffShell } from "@/app/(console)/console/(app)/_components/staff-shell";
import { CommercialSummary, ComparePlans, PayOrPaid, PlanPass, PlanPayments, type PlanView } from "@/app/(console)/console/(app)/_components/plan-panel";
import { consoleSections } from "@/lib/console-nav";
import { DEFAULT_PLANS } from "@/lib/plan-features";

export const metadata: Metadata = { title: "My plan (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const plans = DEFAULT_PLANS.filter((p) => ["starter", "growth", "pro"].includes(p.code)).map((p) => ({ code: p.code, name: p.name, monthlyPricePaise: p.monthlyPricePaise, features: p.features }));
const plan: PlanView = {
  commercial: { version: 1, outletCount: 1, addons: {}, goLiveAt: null, setupReceivedPaise: 0, setupReference: "" }, businessType: "cloud_kitchen", planName: "Base", planCode: "starter", outlet: "Spice Route",
  fee: { perOutletPaise: 69_900, outletCount: 1, totalPaise: 109_800, pricingVersion: 1, addonPaise: 39_900, addonCounts: { riderTracking: 1 } },
  access: { state: "ok", reason: "trial", endsAt: Date.parse("2026-11-12T00:00:00Z") }, features: plans[0].features, plans, waiting: false, now: Date.parse("2026-11-01T00:00:00Z"), payments: [],
};

// Development-only review board for My plan, with sample data
export default function PlanBoard() {
  if (process.env.NODE_ENV === "production") notFound();
  const sections = consoleSections.map((s) => ({ slug: s.slug, label: s.label }));
  return (
    <StaffShell lang="en" sections={sections} staff={{ name: "Owner", roles: ["owner"], outlet: "Spice Route", shiftEnds: null }} activeSlug="plan" preview>
      <div className="dashboard-theme min-h-dvh bg-dashboard-canvas">
        <main className="mx-auto w-full max-w-[1440px] px-3 py-3 pb-6 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]"><PlanPass plan={plan} /><PayOrPaid plan={plan} /></div>
          <div className="mt-4 grid gap-4"><CommercialSummary plan={plan} /><ComparePlans plan={plan} /><PlanPayments plan={plan} /></div>
        </main>
      </div>
    </StaffShell>
  );
}
