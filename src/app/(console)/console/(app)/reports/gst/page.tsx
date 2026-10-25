import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { getGstReport } from "@/server/staff/gst-report";
import { currentStaff } from "@/server/staff/request";
import { GstScreen } from "./_components/gst-screen";

export const metadata: Metadata = { title: "GST report" };

// GST report for a month, on every plan: filing GST is not optional.
export default async function GstPage(props: PageProps<"/console/reports/gst">) {
  const staff = await currentStaff();
  if (!staff || !canSee(staff, "reports")) notFound();
  const { month } = await props.searchParams;
  const report = await getGstReport(staff, typeof month === "string" ? month : "");
  return <GstScreen report={report} />;
}
