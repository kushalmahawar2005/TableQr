import { redirect } from "next/navigation";
import { currentStaff } from "@/server/staff/request";
import { menuManagerData, menuManagerRoles } from "@/server/staff/menu-manager";
import { MenuManager } from "./_components/menu-manager";

export default async function MenuPage() {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!staff.roles.some((role) => menuManagerRoles.includes(role as (typeof menuManagerRoles)[number]))) return <main className="p-6">Permission denied. Ask a manager.</main>;
  const data = await menuManagerData(staff);
  return <MenuManager initial={data} canEditPrice={staff.roles.includes("owner")} />;
}
