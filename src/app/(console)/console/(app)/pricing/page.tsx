import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canPrice, canSee } from "@/lib/staff-permissions";
import { getPricingData } from "@/server/staff/pricing";
import { tenantFeatures } from "@/server/plan";
import { currentStaff } from "@/server/staff/request";
import { PricingScreen } from "./_components/pricing-screen";
import { FeatureLocked } from "../_components/feature-locked";

export const metadata: Metadata = { title: "Pricing", robots: { index: false, follow: false } };

// O4 Pricing: outlet price overrides. The layout has already checked sign-in; the role is checked
// here (other roles see a plain message) and again in every action.
export default async function PricingPage() {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!canPrice(staff.roles, "pricing.view") || !canSee(staff, "pricing")) {
    return (
      <main className="p-8">
        <h1 className="font-display text-title font-bold text-ink">You don&apos;t have access to pricing.</h1>
        <p className="mt-2 text-body text-muted">Ask an owner if you need it.</p>
      </main>
    );
  }
  if (!(await tenantFeatures(staff.tenantId)).pricingRules) return <FeatureLocked feature="pricingRules" />;
  return <PricingScreen initial={await getPricingData(staff)} />;
}
