import type { Metadata } from "next";
import { InstallApp } from "@/components/install-app";
import { NotificationPermissionOnboarding } from "@/components/notification-permission-onboarding";
import { staffAppMetadata, staffAppViewport } from "@/lib/staff-app";

// The waiter app installs to the phone's home screen as the TableQR Staff app.
export const metadata: Metadata = { ...staffAppMetadata };
export const viewport = staffAppViewport;

export default function WaiterLayout({ children }: LayoutProps<"/waiter">) {
  return (
    <>
      <div className="mx-auto w-full max-w-xl px-4 pt-3 empty:hidden">
        <InstallApp />
      </div>
      <div className="mx-auto w-full max-w-xl px-4">
        <NotificationPermissionOnboarding />
      </div>
      {children}
    </>
  );
}
