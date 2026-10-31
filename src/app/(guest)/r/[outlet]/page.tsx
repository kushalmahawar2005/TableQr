import { restaurantApp, restaurantAppMetadata } from "@/server/guest/restaurant-app";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { AppError } from "@/server/errors";
import { getRestaurantHome } from "@/server/guest/restaurant-home";
import { deliveryMenu } from "@/server/delivery/catalog";
import { DeliveryScreen } from "./delivery/screen";
import { RestaurantHome } from "./restaurant-home";

// The restaurant's own app (plans with delivery or reservations) is installable from here
export async function generateMetadata(props: PageProps<"/r/[outlet]">): Promise<Metadata> {
  const code = (await props.params).outlet;
  const [app, home] = await Promise.all([restaurantApp(code), getRestaurantHome(code).catch(() => null)]);
  return { title: home?.outlet.name ?? "Guest link", ...restaurantAppMetadata(app) };
}

export default async function RestaurantPage(props: { params: Promise<{ outlet: string }>; searchParams: Promise<{ mode?: string }> }) {
  const [{ outlet }, jar] = await Promise.all([props.params, cookies()]);
  let data;
  try {
    data = await getRestaurantHome(outlet);
  } catch (error) {
    if (error instanceof AppError && (error.code === "not_found" || error.code === "outlet_unavailable")) notFound();
    throw error;
  }
  const app = await restaurantApp(outlet);
  const query = await props.searchParams;
  const mode = query.mode === "pickup" && data.services.pickup ? "pickup" : data.services.delivery ? "delivery" : "pickup";
  if (data.services.delivery || data.services.pickup) {
    let menu;
    try { menu = await deliveryMenu(outlet, mode); } catch (error) { if (!(error instanceof AppError)) throw error; }
    if(menu) return <DeliveryScreen key={mode} outletCode={outlet} data={{ ...menu, outlet: { ...menu.outlet, name: data.outlet.name } }} initialServiceMode={mode} installable={app ? { name: app.name, logoUrl: app.logoUrl } : null} hindi={parseLang(jar.get(LANG_COOKIE)?.value) === "hi"} />;
  }
  return <RestaurantHome data={data} initialLang={parseLang(jar.get(LANG_COOKIE)?.value)} installable={app ? { name: app.name, logoUrl: app.logoUrl } : null} />;
}
