import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { getMonth, getRegister } from "@/server/attendance/register";
import { tenantFeatures } from "@/server/plan";
import { currentStaff } from "@/server/staff/request";
import { FeatureLocked } from "../_components/feature-locked";
import { AttendanceScreen } from "./_components/attendance-screen";

export const metadata: Metadata = { title: "Attendance", robots: { index: false, follow: false } };

export default async function AttendancePage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await props.searchParams;
  const one = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : undefined);
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!canSee(staff, "attendance")) {
    return <main className="p-8"><h1 className="font-display text-title font-bold text-ink">You don&apos;t have access to attendance.</h1><p className="mt-2 text-body text-muted">Ask an owner if you need it.</p></main>;
  }
  if (!(await tenantFeatures(staff.tenantId, staff.outletId)).attendance) return <FeatureLocked feature="attendance" />;
  const view = one("view") === "month" ? "month" : "day";
  const outletId = one("outlet");
  const [day, month] = await Promise.all([
    view === "day" ? getRegister(staff, { date: one("date"), outletId }).catch(() => null) : null,
    view === "month" ? getMonth(staff, { month: one("month"), outletId }).catch(() => null) : null,
  ]);
  if (!day && !month) return <main className="p-8"><h1 className="font-display text-title font-bold text-ink">Attendance could not be loaded.</h1><p className="mt-2 text-body text-muted">Reload the page, or pick another date.</p></main>;
  return <AttendanceScreen key={`${view}-${day?.date ?? month?.month}-${day?.outletId ?? month?.outletId}`} day={day} month={month} />;
}
