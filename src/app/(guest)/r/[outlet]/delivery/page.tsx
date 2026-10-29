import { customerCookie, customerReorderLines } from "@/server/guest/customer-account";
import { restaurantApp, restaurantAppMetadata } from "@/server/guest/restaurant-app";
import { guestBase } from "@/server/guest/guest-base";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deliveryMenu } from "@/server/delivery/catalog";
import { deliveryStatus } from "@/server/delivery/checkout";
import { cookies } from "next/headers";
import { AppError } from "@/server/errors";
import { DeliveryScreen } from "./screen";

// The restaurant's own app (plans with delivery or reservations) is installable from here
export async function generateMetadata(props: PageProps<"/r/[outlet]/delivery">): Promise<Metadata> {
  return { title: "Delivery order", robots: { index: false, follow: false }, ...restaurantAppMetadata(await restaurantApp((await props.params).outlet)) };
}
export default async function DeliveryPage({ params, searchParams }: { params: Promise<{ outlet: string }>; searchParams: Promise<{ lang?: string; new?: string; reorder?: string }> }) {
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
  const initialCart = query.reorder ? await customerReorderLines(outlet,jar.get(customerCookie(outlet))?.value,query.reorder) : [];
  const app = await restaurantApp(outlet);
  const installable = app ? { name: app.name, logoUrl: app.logoUrl } : null;
  if (initialStatus) return <DeliveryScreen key={initialStatus.id} initialCart={initialCart} outletCode={outlet} installable={installable} initialStatus={initialStatus} hindi={lang === "hi"} realtimeUrl={process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null} />;
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
  if (menuError) return <main className="py-10"><Link href={`${await guestBase(outlet)}`} className="text-brand-strong">← Guest link</Link><h1 className="mt-6 text-2xl font-bold">Delivery</h1><p className="mt-3 text-muted">{menuError}</p></main>;
  return <DeliveryScreen key={query.reorder ?? "new-order"} initialCart={initialCart} outletCode={outlet} installable={installable} data={data} hindi={lang === "hi"} realtimeUrl={process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null} />;
}
