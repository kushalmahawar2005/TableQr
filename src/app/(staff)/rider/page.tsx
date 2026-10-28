import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { riderJobs, riderProfile } from "@/server/delivery/riders";
import { myVerification } from "@/server/delivery/rider-docs";
import { currentStaff } from "@/server/staff/request";
import { RiderScreen } from "./rider-screen";

export const metadata: Metadata = { title: "My deliveries" };

// The rider's phone: online or offline, the deliveries given to them, and their profile
export default async function RiderPage() {
  const staff = await currentStaff();
  if (!staff) redirect("/rider/login");
  if (!staff.roles.includes("rider")) return <main className="p-6">This page is for delivery riders. Ask a manager to give you the Rider role.</main>;
  const [jobs, profile, verification] = await Promise.all([riderJobs(staff), riderProfile(staff), myVerification(staff)]);
  return <RiderScreen initialJobs={jobs} initialProfile={profile} initialVerification={verification} realtimeUrl={process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null} />;
}
