import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { getReport, type ReportRange } from "@/server/staff/reports-read";
import { currentStaff } from "@/server/staff/request";
import { ReportsScreen } from "./_components/reports-screen";

export const metadata: Metadata = { title: "Reports", robots: { index: false, follow: false } };

export default async function ReportsPage(props: PageProps<"/console/reports">) {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!canSee(staff.roles, "reports")) {
    return (
      <main className="p-8">
        <h1 className="font-display text-title font-bold text-ink">You don&apos;t have access to reports.</h1>
        <p className="mt-2 text-body text-muted">Ask an owner if you need it.</p>
      </main>
    );
  }
  const raw = Number((await props.searchParams).days);
  const range: ReportRange = raw === 7 || raw === 90 ? raw : 30;
  const report = await getReport(staff, range, new Date());
  return <ReportsScreen report={report} outlet={staff.outlet.name} />;
}
