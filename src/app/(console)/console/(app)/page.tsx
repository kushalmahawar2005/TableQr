import { redirect } from "next/navigation";
import { landingSection } from "@/lib/console-nav";
import { currentStaff } from "@/server/staff/request";

export default async function ConsoleIndex() {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  const first = landingSection(staff.roles);
  redirect(first ? `/console/${first}` : "/console/login");
}
