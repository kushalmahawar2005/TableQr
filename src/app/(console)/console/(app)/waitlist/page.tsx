import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { getFloor } from "@/server/floor/read";
import { tenantFeatures } from "@/server/plan";
import { currentStaff } from "@/server/staff/request";
import { WaitlistScreen } from "./_components/waitlist-screen";
import { FeatureLocked } from "../_components/feature-locked";

export const metadata: Metadata = { title: "Waitlist", robots: { index: false, follow: false } };

export default async function WaitlistPage() {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!canSee(staff.roles, "waitlist")) {
    return (
      <main className="p-8">
        <h1 className="font-display text-title font-bold text-ink">You don&apos;t have access to the waitlist.</h1>
        <p className="mt-2 text-body text-muted">Ask an owner if you need it.</p>
      </main>
    );
  }
  if (!(await tenantFeatures(staff.tenantId)).reservations) return <FeatureLocked feature="reservations" />;
  const data = await getFloor(staff);
  const tables = data.tables.filter((t) => t.state === "available").map((t) => ({ id: t.id, code: t.code, seats: t.maxSeats, combinableWith: t.combinableWith })).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  return <WaitlistScreen entries={data.waitlist} outlet={staff.outlet.name} outletCode={staff.outlet.code} freeTables={tables} canManage={data.may.waitlist} />;
}
