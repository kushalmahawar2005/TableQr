import type { Metadata } from "next";
import { cookies } from "next/headers";
import { currentPlatformAdmin } from "@/server/admin/auth";
import { getAdminData } from "@/server/admin/dashboard";
import { AdminLogin, AdminShell } from "./admin-client";
import { DashboardView } from "./dashboard-view";
import { AuditView } from "./audit-view";
import { SettingsView } from "./settings-view";
import { AnalyticsView } from "./analytics-view";
import { FeesView } from "./fees-view";
import { feesUpiId } from "@/lib/support";
import { PlansView } from "./plans-view";
import { SubscriptionsView } from "./subscriptions-view";
import { TenantsView } from "./tenants-view";
import { adminLogoutAction } from "./actions";

export const metadata: Metadata = { title: "Platform admin", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const admin = await currentPlatformAdmin();
  if (!admin) return <main className="grid min-h-dvh place-items-center bg-[#f7f8fc] px-4"><AdminLogin /></main>;
  const data = await getAdminData();
  const theme = (await cookies()).get("tq_theme")?.value === "dark" ? "dark" : "light";
  const name = admin.name.trim().split(/\s+/)[0] || admin.email.split("@")[0];
  return <AdminShell
    theme={theme}
    email={admin.email}
    logout={adminLogoutAction}
    pages={{
      Dashboard: <DashboardView data={data} name={name} />,
      Tenants: <TenantsView data={data} />,
      Subscriptions: <SubscriptionsView data={data} />,
      "Plans & Pricing": <PlansView data={data} />,
      Fees: <FeesView data={data} upiId={feesUpiId()} />,
      Analytics: <AnalyticsView data={data} />,
      "Audit Logs": <AuditView />,
      Settings: <SettingsView />,
    }}
  />;
}
