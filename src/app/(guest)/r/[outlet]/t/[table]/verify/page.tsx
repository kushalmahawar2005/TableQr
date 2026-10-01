import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { getTableLanding } from "@/server/guest/table";
import { isRecentlyVerified } from "@/server/guest/verify";
import { VerifyScreen } from "./_components/verify-screen";

export const metadata: Metadata = { title: "Confirm your number", robots: { index: false, follow: false } };

// G2 Verify number, Verified mode only. Anyone who does not need it goes back to G1, which shows
// the table's current state; a phone already at the table goes to the menu.
export default async function VerifyPage(props: PageProps<"/r/[outlet]/t/[table]/verify">) {
  const { outlet, table } = await props.params;
  const jar = await cookies();
  const lang = parseLang(jar.get(LANG_COOKIE)?.value);
  const deviceId = jar.get(DEVICE_COOKIE)?.value ?? null;
  const tablePath = `/r/${encodeURIComponent(outlet)}/t/${encodeURIComponent(table)}`;

  const data = await getTableLanding(outlet, table, deviceId).catch(() => null);
  if (!data) redirect(tablePath);
  const { landing } = data;
  if (landing.kind === "rejoin") redirect(`${tablePath}/menu`);
  if (data.outlet.sessionMode !== "verified" || (landing.kind !== "start" && landing.kind !== "join")) redirect(tablePath);
  // Verified here within 12 hours: G2 never shows, G1's button joins straight away
  if (deviceId && (await isRecentlyVerified(outlet, table, deviceId))) redirect(tablePath);

  return (
    <VerifyScreen
      lang={lang}
      shortCode={table}
      data={{
        outlet: data.outlet,
        tableCode: data.table.code,
        context: landing.kind === "join" ? { kind: "join", count: landing.count } : { kind: "start" },
      }}
    />
  );
}
