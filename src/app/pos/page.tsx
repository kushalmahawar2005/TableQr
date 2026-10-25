import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { currentStaff } from "@/server/staff/request";
import { posQueue } from "@/server/staff/pos-read";
import { posRoles } from "@/server/staff/pos-read";
import { BillingScreen } from "./_components/billing-screen";
import { tenantAccess } from "@/server/access";
import { AccessBanner, PausedScreen } from "../(console)/console/(app)/_components/access-notice";
export const metadata: Metadata = { title: "POS · TableQR" };
export default async function PosPage() {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!staff.roles.some(r => posRoles.includes(r as typeof posRoles[number])) || !canSee(staff, "billing")) return <main className="p-6">Permission denied. Ask a manager.</main>;
  const access = await tenantAccess(staff.tenantId);
  const canAsk = staff.roles.some((r) => r === "owner" || r === "manager");
  if (access.state === "blocked") return <PausedScreen access={access} canAsk={canAsk} staff={staff} />;
  return <><AccessBanner access={access} canAsk={canAsk} outlet={staff.outlet.name} /><BillingScreen initial={await posQueue(staff)} realtimeUrl={process.env.NEXT_PUBLIC_REALTIME_URL ?? null} /></>;
}
