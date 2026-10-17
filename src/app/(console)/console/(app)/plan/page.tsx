import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { feesUpiId } from "@/lib/support";
import { currentStaff } from "@/server/staff/request";
import { ContactTableQR } from "../_components/contact-tableqr";
import { planViewFor } from "../_components/plan-data";
import { ComparePlans, PayOrPaid, PlanPass, PlanPayments } from "../_components/plan-panel";

export const metadata: Metadata = { title: "My plan", robots: { index: false, follow: false } };

// My plan: the restaurant's TableQR membership, paying for it, and moving to a bigger plan.
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
  const upiId = feesUpiId();
  return (
    <main className="mx-auto w-full max-w-[1160px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-title font-bold text-ink">My plan</h1>
        <ContactTableQR message={`Hi TableQR, this is ${staff.outlet.name}. I have a question about our plan.`} />
      </header>
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <PlanPass plan={plan} />
        <div className="lg:sticky lg:top-20">
          <PayOrPaid plan={plan} upiId={upiId} />
        </div>
      </div>
      <div className="mt-6 grid gap-6">
        <ComparePlans plan={plan} upiId={upiId} />
        <PlanPayments plan={plan} />
      </div>
    </main>
  );
}
