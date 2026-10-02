import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { canSee } from "@/lib/staff-permissions";
import { getFloor } from "@/server/floor/read";
import { currentStaff } from "@/server/staff/request";
import { s1Copy } from "./_copy";
import { FloorScreen } from "./_components/floor-screen";

export const metadata: Metadata = { title: "Floor", robots: { index: false, follow: false } };

// S1 Host Floor. The layout has already checked sign-in; the role is checked here and again in
// every action.
export default async function FloorPage() {
  const staff = await currentStaff();
  const lang = parseLang((await cookies()).get(LANG_COOKIE)?.value);
  const c = s1Copy[lang];
  if (!staff || !canSee(staff.roles, "floor")) {
    return (
      <main className="p-8">
        <h1 className="font-display text-title font-bold text-ink">{c.denied}</h1>
        <p className="mt-2 text-body text-muted">{c.deniedBody}</p>
      </main>
    );
  }
  const data = await getFloor(staff);
  return <FloorScreen data={data} lang={lang} realtimeUrl={process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null} />;
}
