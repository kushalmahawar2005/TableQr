import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FEATURE_LABELS } from "@/lib/plan-features";
import { tenantFeatures } from "@/server/plan";
import { currentStaff } from "@/server/staff/request";
import { waiterBoard } from "@/server/staff/waiter-read";
import { WaiterScreen } from "./_components/waiter-screen";
import { tenantAccess } from "@/server/access";
import { AccessBanner, PausedScreen } from "../../(console)/console/(app)/_components/access-notice";

export const metadata: Metadata = { title: "My floor" };

export default async function WaiterPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!staff.roles.some((r) => ["waiter", "manager", "owner"].includes(r))) return <main className="p-6">Permission denied. Ask a manager.</main>;
  if (!(await tenantFeatures(staff.tenantId)).waiterApp) return <main className="p-6"><h1 className="font-display text-title font-bold">{FEATURE_LABELS.waiterApp.label} is not in your plan.</h1><p className="mt-2 text-muted">Ask Tableeqr to upgrade your plan to use it.</p></main>;
  const access = await tenantAccess(staff.tenantId);
  const canAsk = staff.roles.some((r) => r === "owner" || r === "manager");
  if (access.state === "blocked") return <PausedScreen access={access} canAsk={canAsk} staff={staff} />;
  const { tab } = await searchParams;
  const initialTab = tab === "tables" || tab === "order" || tab === "me" ? tab : "tasks";
  const theme = (await cookies()).get("tq_theme")?.value === "dark" ? "dark" : "light";
  return <><AccessBanner access={access} canAsk={canAsk} outlet={staff.outlet.name} /><WaiterScreen initial={await waiterBoard(staff)} initialTab={initialTab} realtimeUrl={process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null} theme={theme} /></>;
}
