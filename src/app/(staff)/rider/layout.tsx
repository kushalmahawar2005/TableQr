import type { Metadata, Viewport } from "next";
import { InstallApp } from "@/components/install-app";
import { NotificationPermissionOnboarding } from "@/components/notification-permission-onboarding";
import { staffAppMetadataFor, staffAppViewportFor } from "@/lib/staff-app";
import { currentStaff } from "@/server/staff/request";
import { staffAppBrandForOutletCode } from "@/server/staff/pwa-branding";
import { cache } from "react";

const riderAppBrand = cache(async () => {
  const staff = await currentStaff();
  return staffAppBrandForOutletCode(staff?.outlet.code);
});

// The rider app uses the signed-in outlet's public name, logo and accent color.
export async function generateMetadata(): Promise<Metadata> {
  return staffAppMetadataFor(await riderAppBrand());
}

export async function generateViewport(): Promise<Viewport> {
  return staffAppViewportFor(await riderAppBrand());
}

export default async function RiderLayout({ children }: LayoutProps<"/rider">) {
  const brand = await riderAppBrand();
  return (
    <>
      <div className="mx-auto w-full max-w-xl px-4 pt-3 empty:hidden">
        <InstallApp name={brand?.name ?? "TableQR"} logoUrl={brand?.logoUrl} />
      </div>
      <div className="mx-auto w-full max-w-xl px-4">
        <NotificationPermissionOnboarding />
      </div>
      {children}
    </>
  );
}
