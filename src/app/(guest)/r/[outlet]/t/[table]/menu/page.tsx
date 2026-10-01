import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { AppError } from "@/server/errors";
import { getMenuScreen } from "@/server/guest/menu-screen";
import { MenuScreen } from "./_components/menu-screen";

export const metadata: Metadata = { title: "Menu", robots: { index: false, follow: false } };

// G3 Menu, for a phone that has joined this table. Anyone else, and anyone whose table has
// closed, goes to G1, which shows the table's current state.
export default async function MenuPage(props: PageProps<"/r/[outlet]/t/[table]/menu">) {
  const { outlet, table } = await props.params;
  const jar = await cookies();
  const lang = parseLang(jar.get(LANG_COOKIE)?.value);
  const deviceId = jar.get(DEVICE_COOKIE)?.value ?? null;

  let data;
  try {
    data = await getMenuScreen(outlet, table, deviceId);
  } catch (err) {
    if (err instanceof AppError) redirect(`/r/${encodeURIComponent(outlet)}/t/${encodeURIComponent(table)}`);
    throw err;
  }

  // The realtime hub's socket address; without one the menu refreshes by polling
  const realtimeUrl = process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null;
  return <MenuScreen data={data} lang={lang} shortCode={table} realtimeUrl={realtimeUrl} />;
}
