import type { Metadata } from "next";
import { DetailsClient } from "./details-client";

export const metadata: Metadata = { title: "Booking details", robots: { index: false, follow: false } };
export default async function BookingDetailsPage(props: { params: Promise<{ outlet: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { outlet } = await props.params;
  const q = await props.searchParams;
  return <DetailsClient outletCode={outlet} token={typeof q.token === "string" ? q.token : ""} hindi={q.lang === "hi"} />;
}
