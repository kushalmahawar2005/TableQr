import { redirect } from "next/navigation";
import { homeFor } from "@/lib/console-nav";
import { currentStaff } from "@/server/staff/request";

export default async function ConsoleIndex() {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  redirect(homeFor(staff));
}
