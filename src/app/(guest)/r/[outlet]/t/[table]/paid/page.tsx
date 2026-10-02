import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { AppError } from "@/server/errors";
import { getAfterVisit } from "@/server/guest/after-visit";
import { PaidScreen } from "./_components/paid-screen";

export const metadata: Metadata = { title: "Paid", robots: { index: false, follow: false } };

// G9 Paid, receipt and next visit. Only the phone that sat at this table, and for 24 hours after
// the table is settled; anyone else goes to G1.
export default async function PaidPage(props: { params: Promise<{ outlet: string; table: string }> }) {
  const { outlet, table } = await props.params;
  const jar = await cookies();
  let data;
  try {
    data = await getAfterVisit(outlet, table, jar.get(DEVICE_COOKIE)?.value ?? null);
  } catch (err) {
    if (err instanceof AppError) redirect(`/r/${encodeURIComponent(outlet)}/t/${encodeURIComponent(table)}`);
    throw err;
  }
  if (!data) redirect(`/r/${encodeURIComponent(outlet)}/t/${encodeURIComponent(table)}`);
  const realtimeUrl = process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null;
  return <PaidScreen data={data} lang={parseLang(jar.get(LANG_COOKIE)?.value)} shortCode={table} realtimeUrl={realtimeUrl} />;
}
