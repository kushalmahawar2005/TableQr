import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentStaff } from "@/server/staff/request";
import { posQueue } from "@/server/staff/pos-read";
import { posRoles } from "@/server/staff/pos-read";
import { BillingScreen } from "./_components/billing-screen";
export const metadata: Metadata = { title: "POS · TableQR" };
export default async function PosPage() {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!staff.roles.some(r => posRoles.includes(r as typeof posRoles[number]))) return <main className="p-6">Permission denied. Ask a manager.</main>;
  return <BillingScreen initial={await posQueue(staff)} realtimeUrl={process.env.NEXT_PUBLIC_REALTIME_URL ?? null} />;
}
