import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { assignableRoles, listTeam } from "@/server/staff/team";
import { teamDuty } from "@/server/staff/duty";
import { currentStaff } from "@/server/staff/request";
import { TeamScreen } from "./_components/team-screen";

export const metadata: Metadata = { title: "Team", robots: { index: false, follow: false } };

export default async function TeamPage() {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!canSee(staff.roles, "team")) {
    return <main className="p-8"><h1 className="font-display text-title font-bold text-ink">You don&apos;t have access to the team.</h1><p className="mt-2 text-body text-muted">Ask an owner if you need it.</p></main>;
  }
  return <TeamScreen initial={await listTeam(staff)} canEdit={staff.roles.includes("owner")} outletCode={staff.outlet.code} outletName={staff.outlet.name} roles={await assignableRoles(staff.tenantId)} duty={await teamDuty(staff)} />;
}
