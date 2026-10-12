import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { getDashboard, getRevenueTrend } from "@/server/staff/dashboard";
import { teamDuty } from "@/server/staff/duty";
import { currentStaff } from "@/server/staff/request";
import { DashboardScreen } from "./_components/dashboard-screen";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false, follow: false } };

// O1 Owner Dashboard: a read-only view of the signed-in outlet. The layout has already checked
// sign-in; the role is checked here (other roles see a plain message) and again in the read model.
export default async function DashboardPage() {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!canSee(staff.roles, "dashboard")) {
    return (
      <main className="p-8">
        <h1 className="font-display text-title font-bold text-ink">You don&apos;t have access to the dashboard.</h1>
        <p className="mt-2 text-body text-muted">Ask an owner if you need it.</p>
      </main>
    );
  }
  const now = new Date();
  const [data, trend, duty] = await Promise.all([getDashboard(staff, now), getRevenueTrend(staff, now), canSee(staff.roles, "team") ? teamDuty(staff, now) : null]);
  // Who is on duty, set right here by the manager or owner
  const canChange = staff.roles.some((r) => r === "owner" || r === "manager");
  return <DashboardScreen initial={data} initialTrend={trend} duty={duty ? { rows: duty, canChange } : undefined} />;
}
