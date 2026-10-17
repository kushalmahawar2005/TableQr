import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { getCustomers } from "@/server/staff/customers";
import { tenantFeatures } from "@/server/plan";
import { currentStaff } from "@/server/staff/request";
import { CustomersScreen } from "./_components/customers-screen";
import { FeatureLocked } from "../_components/feature-locked";

export const metadata: Metadata = { title: "Customers", robots: { index: false, follow: false } };

export default async function CustomersPage() {
  const staff = await currentStaff();
  if (!staff || !canSee(staff.roles, "customers")) notFound();
  if (!(await tenantFeatures(staff.tenantId)).whatsappBills) return <FeatureLocked feature="whatsappBills" />;
  const customers = await getCustomers(staff);
  // eslint-disable-next-line react-hooks/purity -- a server render reads the clock once, for "not seen in 30 days"
  return <CustomersScreen customers={customers} outletName={staff.outlet.name} now={Date.now()} />;
}
