import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { getDayClose, istToday } from "@/server/staff/day-close";
import { currentStaff } from "@/server/staff/request";
import { DayCloseScreen } from "./_components/day-close-screen";

export const metadata: Metadata = { title: "Day close" };

export default async function DayClosePage(props: PageProps<"/console/reports/day-close">) {
  const staff = await currentStaff();
  if (!staff || !canSee(staff, "reports")) notFound();
  const { date } = await props.searchParams;
  const report = await getDayClose(staff, typeof date === "string" ? date : istToday());
  return <DayCloseScreen report={report} outletName={staff.outlet.name} today={istToday()} />;
}
