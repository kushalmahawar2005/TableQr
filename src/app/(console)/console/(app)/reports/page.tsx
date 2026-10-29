import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { getReport, type ReportRange } from "@/server/staff/reports-read";
import { tenantFeatures } from "@/server/plan";
import { currentStaff } from "@/server/staff/request";
import { ReportsScreen } from "./_components/reports-screen";
import { FeatureLocked } from "../_components/feature-locked";

export const metadata: Metadata = { title: "Reports", robots: { index: false, follow: false } };

export default async function ReportsPage(props: PageProps<"/console/reports">) {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!canSee(staff, "reports")) {
    return (
      <main className="p-4 sm:p-8">
        <h1 className="font-display text-title font-bold text-ink">You don&apos;t have access to reports.</h1>
        <p className="mt-2 text-body text-muted">Ask an owner if you need it.</p>
      </main>
    );
  }
  if (!(await tenantFeatures(staff.tenantId, staff.outletId)).fullReports) return <FeatureLocked feature="fullReports" extra={[{ href: "/console/reports/day-close", label: "Open Day close" }, { href: "/console/reports/gst", label: "Open GST report" }]} />;
  const raw = Number((await props.searchParams).days);
  const range: ReportRange = raw === 7 || raw === 90 ? raw : 30;
  const report = await getReport(staff, range, new Date());
  return <ReportsScreen report={report} outlet={staff.outlet.name} />;
}
