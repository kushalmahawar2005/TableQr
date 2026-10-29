import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { parseLang } from "@/lib/i18n";
import { STAFF_LANG_COOKIE } from "@/lib/staff-language";
import { canSee } from "@/lib/staff-permissions";
import { posTerminal } from "@/server/staff/pos-terminal";
import { tenantFeatures } from "@/server/plan";
import { currentStaff } from "@/server/staff/request";
import { FeatureLocked } from "../_components/feature-locked";
import { PosTerminalScreen } from "./_components/pos-terminal-screen";

export const metadata: Metadata = { title: "POS", robots: { index: false, follow: false } };

// The POS terminal: pick a table or a takeaway, tap dishes or type an open item, send to the kitchen, bill.
export default async function PosTerminalPage() {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!canSee(staff, "pos")) {
    return (
      <main className="p-4 sm:p-8">
        <h1 className="font-display text-title font-bold text-ink">You don&apos;t have access to the POS.</h1>
        <p className="mt-2 text-body text-muted">Ask an owner if you need it.</p>
      </main>
    );
  }
  if (!(await tenantFeatures(staff.tenantId, staff.outletId)).pos) return <FeatureLocked feature="pos" />;
  const lang = parseLang((await cookies()).get(STAFF_LANG_COOKIE)?.value);
  const initial = await posTerminal(staff);
  return <PosTerminalScreen initial={initial} initialSavedAt={initial.loadedAt} initialIsServerFresh outletId={staff.outletId} staffUserId={staff.userId} canReviewOfflineOrders={staff.roles.some((role) => role === "owner" || role === "manager")} sessionExpiresAt={staff.expiresAt} hi={lang === "hi"} realtimeUrl={process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null} />;
}
