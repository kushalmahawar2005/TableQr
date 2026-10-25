import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { tenantFeatures } from "@/server/plan";
import { getSalesDetail } from "@/server/staff/sales-detail";
import { currentStaff } from "@/server/staff/request";
import { FeatureLocked } from "../../_components/feature-locked";
import { ItemsScreen } from "./_components/items-screen";

export const metadata: Metadata = { title: "Items & staff" };

export default async function ItemsReportPage(props: PageProps<"/console/reports/items">) {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!canSee(staff, "reports")) notFound();
  if (!(await tenantFeatures(staff.tenantId)).fullReports) return <FeatureLocked feature="fullReports" extra={[{ href: "/console/reports/day-close", label: "Open Day close" }, { href: "/console/reports/gst", label: "Open GST report" }]} />;
  const { from, to } = await props.searchParams;
  const report = await getSalesDetail(staff, { from: typeof from === "string" ? from : undefined, to: typeof to === "string" ? to : undefined });
  return <ItemsScreen report={report} outletName={staff.outlet.name} />;
}
