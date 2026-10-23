import type { Metadata } from "next";
import Link from "next/link";
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
  // Existing order tracking stays accessible when new delivery orders are paused.
  if (token && query.new !== "1") {
    try {
      const status = await deliveryStatus(outlet, token, jar.get("tq_device")?.value ?? "");
      if (status.status !== "draft") return <DeliveryScreen outletCode={outlet} initialStatus={status} hindi={lang === "hi"} />;
    } catch (error) { if (!(error instanceof AppError)) throw error; }
  }
  try { return <DeliveryScreen outletCode={outlet} data={await deliveryMenu(outlet)} hindi={lang === "hi"} />; }
  catch (error) {
    if (!(error instanceof AppError)) throw error;
    return <main className="py-10"><Link href={`/r/${encodeURIComponent(outlet)}`} className="text-brand-strong">← Restaurant</Link><h1 className="mt-6 text-2xl font-bold">Delivery</h1><p className="mt-3 text-muted">{error.message}</p></main>;
  }
}
