import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { InstallApp } from "@/components/install-app";
import { homeFor } from "@/lib/console-nav";
import { staffAppMetadata, staffAppViewport } from "@/lib/staff-app";
import { currentStaff } from "@/server/staff/request";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Staff sign in", robots: { index: false, follow: false }, ...staffAppMetadata };
export const viewport = staffAppViewport;

export default async function StaffSignInPage() {
  const staff = await currentStaff();
  if (staff) redirect(homeFor(staff.roles));
  const outlet = (await cookies()).get("tq_staff_outlet")?.value ?? "";
  return (
    <main className="grid min-h-dvh place-items-center bg-[#f3f1ec] px-4 py-8">
      <div className="w-full max-w-sm space-y-4">
        <InstallApp />
        <SignInForm outlet={outlet} />
      </div>
    </main>
  );
}
