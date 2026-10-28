import type { Metadata, Viewport } from "next";
import { InstallApp } from "@/components/install-app";
import { NotificationPermissionOnboarding } from "@/components/notification-permission-onboarding";
import { staffAppMetadataFor, staffAppViewportFor } from "@/lib/staff-app";
import { currentStaff } from "@/server/staff/request";
import { staffAppBrandForOutletCode } from "@/server/staff/pwa-branding";
import { cache } from "react";

const waiterAppBrand = cache(async () => {
  const staff = await currentStaff();
  return staffAppBrandForOutletCode(staff?.outlet.code);
});

// The waiter app uses the signed-in outlet's public name, logo and accent color.
export async function generateMetadata(): Promise<Metadata> {
  return staffAppMetadataFor(await waiterAppBrand());
}

export async function generateViewport(): Promise<Viewport> {
  return staffAppViewportFor(await waiterAppBrand());
}

export default async function WaiterLayout({ children }: LayoutProps<"/waiter">) {
  const brand = await waiterAppBrand();
  return (
    <>
      <div className="mx-auto w-full max-w-xl px-4 pt-3 empty:hidden">
        <InstallApp name={brand?.name ?? "Tableeqr"} logoUrl={brand?.logoUrl} />
      </div>
      <div className="mx-auto w-full max-w-xl px-4">
        <NotificationPermissionOnboarding />
      </div>
      {children}
    </>
  );
}
