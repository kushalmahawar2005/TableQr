import type { Metadata } from "next";
import { cookies } from "next/headers";
import { currentPlatformAdmin } from "@/server/admin/auth";
import { getAdminData } from "@/server/admin/dashboard";
import { AdminLogin, AdminShell, type AdminAlert } from "./admin-client";
import { FEATURE_LABELS } from "@/lib/plan-features";
import { DashboardView } from "./dashboard-view";
import { AuditView } from "./audit-view";
import { SettingsView } from "./settings-view";
import { AnalyticsView } from "./analytics-view";
import { FeesView } from "./fees-view";
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
  const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
  const alerts: AdminAlert[] = data.tenants.flatMap((t) => [
    ...(t.feeClaim ? [{ id: `${t.id}-claim`, title: t.feeClaim.method === "cashfree" ? `${t.name} payment is processing` : `${t.name} says they paid`, detail: t.feeClaim.method === "cashfree" ? `${rupees(t.feeClaim.amountPaise)} · Cashfree is confirming` : `${rupees(t.feeClaim.amountPaise)} · check it and confirm`, page: "Fees" }] : []),
    ...t.requests.map((r) => ({ id: r.id, title: `${t.name} asked for ${r.feature && r.feature in FEATURE_LABELS ? FEATURE_LABELS[r.feature as keyof typeof FEATURE_LABELS].label : "a plan change"}`, detail: r.note ? `“${r.note}”` : `by ${r.requestedBy}`, page: "Tenants", tenantId: t.id })),
  ]);
  return <AdminShell
    alerts={alerts}
    theme={theme}
    email={admin.email}
    logout={adminLogoutAction}
    pages={{
      Dashboard: <DashboardView data={data} name={name} />,
      Tenants: <TenantsView data={data} />,
      Subscriptions: <SubscriptionsView data={data} />,
      "Plans & Pricing": <PlansView data={data} />,
      Fees: <FeesView data={data} />,
      Analytics: <AnalyticsView data={data} />,
      "Audit Logs": <AuditView />,
      Settings: <SettingsView />,
    }}
  />;
}
