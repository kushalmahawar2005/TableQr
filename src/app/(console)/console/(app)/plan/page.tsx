import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { feesUpiId } from "@/lib/support";
import { currentStaff } from "@/server/staff/request";
import { ContactTableQR } from "../_components/contact-tableqr";
import { planViewFor } from "../_components/plan-data";
import { PayCard, PlanIncludes, PlanPayments, PlanSummary } from "../_components/plan-panel";

export const metadata: Metadata = { title: "My plan", robots: { index: false, follow: false } };

// My plan: what this restaurant pays TableQR and paying it by UPI. Owners and managers only.
export default async function PlanPage() {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!canSee(staff.roles, "plan")) {
    return (
      <main className="p-8">
        <h1 className="font-display text-title font-bold text-ink">Only the owner or a manager can see the plan.</h1>
      </main>
    );
  }
  const plan = await planViewFor(staff);
  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-title font-bold text-ink">My plan</h1>
          <p className="mt-1 text-body text-muted">What you pay TableQR, and how to pay.</p>
        </div>
        <ContactTableQR message={`Hi TableQR, this is ${staff.outlet.name}. I have a question about our plan.`} />
      </header>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        <div className="grid min-w-0 content-start gap-6">
          <PlanSummary plan={plan} />
          <PlanIncludes plan={plan} />
          <PlanPayments plan={plan} />
        </div>
        <div className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <PayCard plan={plan} upiId={feesUpiId()} />
        </div>
      </div>
    </main>
  );
}
