import type { Metadata, Viewport } from "next";
import { InstallApp } from "@/components/install-app";
import { NotificationPermissionOnboarding } from "@/components/notification-permission-onboarding";
import { staffAppViewportFor } from "@/lib/staff-app";
import { currentStaff } from "@/server/staff/request";
import { staffAppBrandForOutletCode } from "@/server/staff/pwa-branding";
import { cache } from "react";

const riderAppBrand = cache(async () => {
  const staff = await currentStaff();
  return staffAppBrandForOutletCode(staff?.outlet.code);
});

// The rider app uses the signed-in outlet's public name, logo and accent color.
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Tableeqr Rider",
    robots: { index: false, follow: false },
    appleWebApp: { capable: true, title: "Tableeqr Rider", statusBarStyle: "default" },
  };
}

// cover: in the Android app the page runs under the status bar, and env(safe-area-inset-top) says by how much
export async function generateViewport(): Promise<Viewport> {
  return { ...staffAppViewportFor(await riderAppBrand()), viewportFit: "cover" };
}

export default async function RiderLayout({ children }: LayoutProps<"/rider">) {
  const staff = await currentStaff();
  const brand = staff ? await staffAppBrandForOutletCode(staff.outlet.code) : null;
  return (
    // Room for the phone's status bar: the reported inset, or --app-top set by the screen inside the app
    <div className="pt-[max(env(safe-area-inset-top),var(--app-top,0px))]">
      {staff?.roles.includes("rider") && <>
        <div className="mx-auto w-full max-w-xl px-4 pt-3 empty:hidden">
          <InstallApp name="Tableeqr Rider" logoUrl={brand?.logoUrl} title="Get the Rider app" downloadHref="/download/rider" />
        </div>
        <div className="mx-auto w-full max-w-xl px-4">
          <NotificationPermissionOnboarding />
        </div>
      </>}
      {children}
    </div>
  );
}
