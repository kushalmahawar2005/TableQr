import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { InstallApp } from "@/components/install-app";
import { homeFor } from "@/lib/console-nav";
import { staffAppMetadataFor, staffAppViewportFor } from "@/lib/staff-app";
import { staffAppBrandForOutletCode } from "@/server/staff/pwa-branding";
import { currentStaff } from "@/server/staff/request";
import { SignInForm } from "./sign-in-form";

const signInOutletBrand = cache(async () => {
  const outletCode = (await cookies()).get("tq_staff_outlet")?.value;
  return staffAppBrandForOutletCode(outletCode);
});

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Staff sign in", robots: { index: false, follow: false }, ...staffAppMetadataFor(await signInOutletBrand()) };
}

export async function generateViewport(): Promise<Viewport> {
  return staffAppViewportFor(await signInOutletBrand());
}

export default async function StaffSignInPage() {
  const staff = await currentStaff();
  if (staff) redirect(homeFor(staff.roles));
  const outlet = (await cookies()).get("tq_staff_outlet")?.value ?? "";
  const brand = await staffAppBrandForOutletCode(outlet);
  return (
    <main className="grid min-h-dvh place-items-center bg-[#f3f1ec] px-4 py-8">
      <div className="w-full max-w-sm space-y-4">
        <InstallApp name={brand?.name ?? "TableQR"} logoUrl={brand?.logoUrl} />
        <SignInForm outlet={outlet} />
      </div>
    </main>
  );
}
