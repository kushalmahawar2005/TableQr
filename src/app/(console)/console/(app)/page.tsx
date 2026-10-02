import { redirect } from "next/navigation";
import { consoleSections } from "@/lib/console-nav";
import { canSee } from "@/lib/staff-permissions";
import { currentStaff } from "@/server/staff/request";

export default async function ConsoleIndex() {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  const first = consoleSections.find((s) => canSee(staff.roles, s.slug));
  redirect(first ? `/console/${first.slug}` : "/console/login");
}
