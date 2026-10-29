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
      <main className="p-8">
        <h1 className="font-display text-title font-bold text-ink">Only the owner or a manager can see the plan.</h1>
      </main>
    );
  }
  const plan = await planViewFor(staff);
  return (
    <main className="mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-caption font-semibold uppercase tracking-[0.08em] text-muted">Subscription & billing</p>
          <h1 className="mt-1 font-display text-title font-bold text-ink">My plan</h1>
          <p className="mt-1 text-body text-muted">Check your access, compare plans and pay securely when you’re ready.</p>
        </div>
        <ContactTableeqr message={`Hi Tableeqr, this is ${staff.outlet.name}. I have a question about our plan.`} />
      </header>
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <PlanPass plan={plan} />
        <div className="lg:sticky lg:top-20">
          <PayOrPaid plan={plan} />
        </div>
      </div>
      <div className="mt-6 grid gap-6">
        <CommercialSummary plan={plan} />
        <ComparePlans plan={plan} />
        <PlanPayments plan={plan} />
      </div>
    </main>
  );
}
