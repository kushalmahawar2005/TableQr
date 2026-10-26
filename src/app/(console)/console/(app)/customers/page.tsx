import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { getCustomers, type CustomerFilter } from "@/server/staff/customers";
import { tenantFeatures } from "@/server/plan";
import { currentStaff } from "@/server/staff/request";
import { CustomersScreen } from "./_components/customers-screen";
import { FeatureLocked } from "../_components/feature-locked";

export const metadata: Metadata = { title: "Customers", robots: { index: false, follow: false } };

const FILTERS: CustomerFilter[] = ["all", "regulars", "offers", "away"];

// One page of customers at a time: search, filter and page all live in the address
export default async function CustomersPage(props: PageProps<"/console/customers">) {
  const staff = await currentStaff();
  if (!staff || !canSee(staff, "customers")) notFound();
  if (!(await tenantFeatures(staff.tenantId)).whatsappBills) return <FeatureLocked feature="whatsappBills" />;
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const filter = FILTERS.find((f) => f === one(sp.filter)) ?? "all";
  const q = one(sp.q).slice(0, 60);
  const data = await getCustomers(staff, { q, filter, page: Number(one(sp.page)) || 1 });
  return <CustomersScreen data={data} q={q} filter={filter} outletName={staff.outlet.name} />;
}
