import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { AppError } from "@/server/errors";
import { getTrackerScreen } from "@/server/guest/tracker-screen";
import { TrackerScreen } from "./_components/tracker-screen";
export const metadata: Metadata = { title: "Your orders", robots: { index: false, follow: false } };
export default async function OrdersPage(props: { params: Promise<{ outlet: string; table: string }> }) {
  const { outlet, table } = await props.params;
  const jar = await cookies();
  let data;
  try { data = await getTrackerScreen(outlet, table, jar.get(DEVICE_COOKIE)?.value ?? null); }
  catch (err) {
    if (err instanceof AppError) redirect(`/r/${encodeURIComponent(outlet)}/t/${encodeURIComponent(table)}`);
    throw err;
  }
  return <TrackerScreen data={data} lang={parseLang(jar.get(LANG_COOKIE)?.value)} shortCode={table} realtimeUrl={process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null} />;
}
