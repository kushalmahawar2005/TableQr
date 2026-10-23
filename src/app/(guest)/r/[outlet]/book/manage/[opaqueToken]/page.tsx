import type { Metadata } from "next";
import { bookingByToken } from "@/server/booking/core";
import { ManageBookingClient } from "./manage-client";

export const metadata: Metadata = { title: "Manage booking", robots: { index: false, follow: false } };
export default async function ManageBookingPage(props: { params: Promise<{ outlet: string; opaqueToken: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { outlet, opaqueToken } = await props.params;
  const query = await props.searchParams;
  let result; try { result = await bookingByToken(outlet, opaqueToken); } catch { return <main className="mx-auto max-w-[520px] px-5 py-10"><h1 className="font-display text-3xl font-bold">Booking not found</h1><p className="mt-3 text-muted">This secure link is invalid or expired.</p></main>; }
  const { row, scope } = result;
  return <ManageBookingClient outletCode={outlet} token={opaqueToken} timezone={scope.timezone} hindi={query.lang === "hi"} booking={{ reference: row.publicReference, name: row.name, startAt: row.startAt.getTime(), partySize: row.partySize, status: row.status }} />;
}
