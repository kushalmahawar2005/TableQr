import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { currentStaff } from "@/server/staff/request";
import { ContactTableeqr } from "../_components/contact-tableeqr";
import { planViewFor } from "../_components/plan-data";
import { CommercialSummary, ComparePlans, PayOrPaid, PlanPass, PlanPayments } from "../_components/plan-panel";

export const metadata: Metadata = { title: "My plan", robots: { index: false, follow: false } };

// My plan: the restaurant's Tableeqr membership, paying for it, and moving to a bigger plan.
export default async function PlanPage() {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!canSee(staff, "plan")) {
    return (
      <main className="p-4 sm:p-8">
        <h1 className="font-display text-title font-bold text-ink">Only the owner or a manager can see the plan.</h1>
      </main>
    );
  }
  const plan = await planViewFor(staff);
  return (
    <div className="dashboard-theme min-h-[calc(100dvh-4rem)] bg-dashboard-canvas sm:min-h-[calc(100dvh-4.5rem)]">
    <main className="mx-auto w-full max-w-[1440px] px-3 py-3 pb-6 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-lg font-bold leading-6 tracking-tight text-ink sm:text-[28px] sm:leading-8">My plan</h1>
          <p className="mt-1 text-sm font-medium text-muted">Check your access, compare plans and pay when you are ready.</p>
        </div>
        <ContactTableeqr message={`Hi Tableeqr, this is ${staff.outlet.name}. I have a question about our plan.`} />
      </header>
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <PlanPass plan={plan} />
        <div className="lg:sticky lg:top-20">
          <PayOrPaid plan={plan} />
        </div>
      </div>
      <div className="mt-4 grid gap-4">
        <CommercialSummary plan={plan} />
        <ComparePlans plan={plan} />
        <PlanPayments plan={plan} />
      </div>
    </main>
    </div>
  );
}
