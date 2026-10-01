import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { AppError } from "@/server/errors";
import { publicOrigin, tableInvite } from "@/server/guest/invite";
import { getTableScreen } from "@/server/guest/table-screen";
import { TableScreen } from "./_components/table-screen";

export const metadata: Metadata = { title: "Your table", robots: { index: false, follow: false } };

// G7 Table & People, for a phone that has joined this table. Anyone else, and anyone removed or
// whose table has closed, goes to G1, which shows the table's current state.
export default async function TablePage(props: { params: Promise<{ outlet: string; table: string }> }) {
  const { outlet, table } = await props.params;
  const jar = await cookies();
  let data;
  try {
    data = await getTableScreen(outlet, table, jar.get(DEVICE_COOKIE)?.value ?? null);
  } catch (err) {
    if (err instanceof AppError) redirect(`/r/${encodeURIComponent(outlet)}/t/${encodeURIComponent(table)}`);
    throw err;
  }
  const invite = tableInvite(publicOrigin(await headers()), data.outlet.code, table);
  const realtimeUrl = process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null;
  return <TableScreen data={data} lang={parseLang(jar.get(LANG_COOKIE)?.value)} shortCode={table} realtimeUrl={realtimeUrl} invite={invite} />;
}
