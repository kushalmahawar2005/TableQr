import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { landingSection } from "@/lib/console-nav";
import { currentStaff } from "@/server/staff/request";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Staff sign in", robots: { index: false, follow: false } };

export default async function StaffSignInPage() {
  const staff = await currentStaff();
  if (staff) redirect(landingSection(staff.roles) === "dashboard" ? "/console/dashboard" : "/console/floor");
  const outlet = (await cookies()).get("tq_staff_outlet")?.value ?? "";
  return (
    <main className="grid min-h-dvh place-items-center bg-[#f3f1ec] px-4">
      <SignInForm outlet={outlet} />
    </main>
  );
}
