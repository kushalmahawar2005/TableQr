import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { feesUpiId } from "@/lib/support";
import { currentStaff } from "@/server/staff/request";
import { ContactTableQR } from "../_components/contact-tableqr";
import { planViewFor } from "../_components/plan-data";
import { PlanPanel } from "../_components/plan-panel";

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
    <main className="space-y-5 p-4 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-title font-bold text-ink">My plan</h1>
          <p className="text-body text-muted">What you pay TableQR, and how to pay.</p>
        </div>
        <ContactTableQR message={`Hi TableQR, this is ${staff.outlet.name}. I have a question about our plan.`} />
      </div>
      <PlanPanel plan={plan} upiId={feesUpiId()} />
    </main>
  );
}
