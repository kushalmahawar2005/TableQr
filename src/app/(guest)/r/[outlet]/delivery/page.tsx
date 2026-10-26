import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deliveryMenu } from "@/server/delivery/catalog";
import { deliveryStatus } from "@/server/delivery/checkout";
import { cookies } from "next/headers";
import { AppError } from "@/server/errors";
import { DeliveryScreen } from "./screen";

export const metadata: Metadata = { title: "Delivery", robots: { index: false, follow: false } };
export default async function DeliveryPage({ params, searchParams }: { params: Promise<{ outlet: string }>; searchParams: Promise<{ lang?: string; new?: string }> }) {
  const { outlet } = await params;
  const query = await searchParams;
  const { lang } = query;
  const jar = await cookies();
  const token = jar.get(`tq_delivery_${outlet.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")}`)?.value;
  let initialStatus: Awaited<ReturnType<typeof deliveryStatus>> | undefined;
  // Existing orders and pending/failed prepayments remain visible when new orders are paused.
  if (token && query.new !== "1") {
    try {
      const status = await deliveryStatus(outlet, token, jar.get("tq_device")?.value ?? "");
      if (status.status !== "draft" || status.paymentStatus !== "none") initialStatus = status;
    } catch (error) { if (!(error instanceof AppError)) throw error; }
  }
  if (initialStatus) return <DeliveryScreen outletCode={outlet} initialStatus={initialStatus} hindi={lang === "hi"} realtimeUrl={process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null} />;
  let data: Awaited<ReturnType<typeof deliveryMenu>> | undefined;
  let menuError: string | undefined;
  try {
    data = await deliveryMenu(outlet);
  }
  catch (error) {
    if (!(error instanceof AppError)) throw error;
    if (error.code === "not_found" || error.code === "outlet_unavailable") notFound();
    menuError = error.message;
  }
  if (menuError) return <main className="py-10"><Link href={`/r/${encodeURIComponent(outlet)}`} className="text-brand-strong">← Restaurant</Link><h1 className="mt-6 text-2xl font-bold">Delivery</h1><p className="mt-3 text-muted">{menuError}</p></main>;
  return <DeliveryScreen outletCode={outlet} data={data} hindi={lang === "hi"} realtimeUrl={process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null} />;
}
