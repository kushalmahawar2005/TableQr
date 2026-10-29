import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { tenantFeatures } from "@/server/plan";
import { getInventory } from "@/server/staff/inventory";
import { getPurchasing } from "@/server/staff/inventory-pro";
import { currentStaff } from "@/server/staff/request";
import { FeatureLocked } from "../_components/feature-locked";
import { InventoryScreen } from "./_components/inventory-screen";

export const metadata: Metadata = { title: "Inventory", robots: { index: false, follow: false } };

// Inventory: stock on hand, the recipe of each dish, and every change. Owners and managers only.
export default async function InventoryPage() {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!canSee(staff, "inventory")) {
    return (
      <main className="p-4 sm:p-8">
        <h1 className="font-display text-title font-bold text-ink">Only the owner or a manager can manage stock.</h1>
      </main>
    );
  }
  const features = await tenantFeatures(staff.tenantId, staff.outletId);
  if (!features.inventory) return <FeatureLocked feature="inventory" />;
  const [initial, purchasing] = await Promise.all([getInventory(staff), getPurchasing(staff)]);
  return <InventoryScreen features={features} initial={initial} purchasing={purchasing} />;
}
