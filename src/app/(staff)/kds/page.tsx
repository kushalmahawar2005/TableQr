import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { KDS_COOKIE, resolveKdsDevice } from "@/server/kitchen/device";
import { kdsBoard } from "@/server/kitchen/kds";
import { KdsScreen } from "./_components/kds-screen";
import { KdsSetup } from "./_components/kds-setup";

export const metadata: Metadata = { title: "Kitchen", robots: { index: false, follow: false } };
export const viewport: Viewport = { themeColor: "#141a2b", colorScheme: "dark" };
export const dynamic = "force-dynamic";

// S2 Kitchen display: a wall screen with its own device credential, independent of the console.
// No credential (or an expired or revoked one) shows the manager setup.
export default async function KitchenDisplayPage() {
  const jar = await cookies();
  const device = await resolveKdsDevice(jar.get(KDS_COOKIE)?.value);
  if (!device) return <KdsSetup initialLang={parseLang(jar.get(LANG_COOKIE)?.value)} />;
  const board = await kdsBoard(device, null);
  return (
    <KdsScreen
      initial={board}
      device={{ station: device.station, expeditor: device.expeditor, lang: device.lang, outletName: device.outlet.name, timezone: device.outlet.timezone }}
      realtimeUrl={process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null}
    />
  );
}
