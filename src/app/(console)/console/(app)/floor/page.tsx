import type { Metadata } from "next";
import { cookies } from "next/headers";
import { parseLang } from "@/lib/i18n";
import { STAFF_LANG_COOKIE } from "@/lib/staff-language";
import { canSee } from "@/lib/staff-permissions";
import { getFloor } from "@/server/floor/read";
import { tenantFeatures } from "@/server/plan";
import { currentStaff } from "@/server/staff/request";
import { FeatureLocked } from "../_components/feature-locked";
import { s1Copy } from "./_copy";
import { FloorScreen } from "./_components/floor-screen";

export const metadata: Metadata = { title: "Floor", robots: { index: false, follow: false } };

// S1 Host Floor. The layout has already checked sign-in; the role is checked here and again in
// every action.
export default async function FloorPage() {
  const staff = await currentStaff();
  const lang = parseLang((await cookies()).get(STAFF_LANG_COOKIE)?.value);
  const c = s1Copy[lang];
  if (!staff || !canSee(staff, "floor")) {
    return (
      <main className="p-8">
        <h1 className="font-display text-title font-bold text-ink">{c.denied}</h1>
        <p className="mt-2 text-body text-muted">{c.deniedBody}</p>
      </main>
    );
  }
  if (!(await tenantFeatures(staff.tenantId, staff.outletId)).dineIn) return <FeatureLocked feature="dineIn" />;
  const data = await getFloor(staff);
  return <FloorScreen data={data} lang={lang} realtimeUrl={process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null} />;
}
