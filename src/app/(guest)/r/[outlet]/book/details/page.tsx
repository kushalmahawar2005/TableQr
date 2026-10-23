import type { Metadata } from "next";
import { DetailsClient } from "./details-client";
import { getBookingDetailsConfig } from "@/server/booking/core";

export const metadata: Metadata = { title: "Booking details", robots: { index: false, follow: false } };
export default async function BookingDetailsPage(props: { params: Promise<{ outlet: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { outlet } = await props.params;
  const q = await props.searchParams;
  const token = typeof q.token === "string" ? q.token : "";
  const config = token ? await getBookingDetailsConfig(outlet, token).catch(() => null) : null;
  return <DetailsClient outletCode={outlet} token={token} timezone={config?.timezone ?? "Asia/Kolkata"} freeCancellationMinutes={config?.freeCancellationMinutes ?? 120} hindi={q.lang === "hi"} />;
}
