import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { AppError } from "@/server/errors";
import { getBillScreen } from "@/server/guest/bill-screen";
import { BillScreen } from "./_components/bill-screen";

export const metadata: Metadata = { title: "Bill", robots: { index: false, follow: false } };

// G8 Bill and split, for a phone at this table. Once the table is settled, the paid screen (G9)
// takes over; anyone else goes to G1.
export default async function BillPage(props: { params: Promise<{ outlet: string; table: string }>; searchParams: Promise<{ p?: string }> }) {
  const { outlet, table } = await props.params;
  const { p } = await props.searchParams;
  const jar = await cookies();
  let data;
  try {
    data = await getBillScreen(outlet, table, jar.get(DEVICE_COOKIE)?.value ?? null);
  } catch (err) {
    if (err instanceof AppError) redirect(`/r/${encodeURIComponent(outlet)}/t/${encodeURIComponent(table)}/paid`);
    throw err;
  }
  const realtimeUrl = process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null;
  const returning = typeof p === "string" && /^[0-9a-f-]{36}$/.test(p) ? p : null;
  return <BillScreen data={data} lang={parseLang(jar.get(LANG_COOKIE)?.value)} shortCode={table} realtimeUrl={realtimeUrl} returningPaymentId={returning} />;
}
