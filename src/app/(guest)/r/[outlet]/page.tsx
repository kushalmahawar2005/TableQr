import { restaurantApp, restaurantAppMetadata } from "@/server/guest/restaurant-app";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { AppError } from "@/server/errors";
import { getRestaurantHome } from "@/server/guest/restaurant-home";
import { RestaurantHome } from "./restaurant-home";

// The restaurant's own app (plans with delivery or reservations) is installable from here
export async function generateMetadata(props: PageProps<"/r/[outlet]">): Promise<Metadata> {
  return { title: "Restaurant", ...restaurantAppMetadata(await restaurantApp((await props.params).outlet)) };
}

export default async function RestaurantPage(props: { params: Promise<{ outlet: string }> }) {
  const [{ outlet }, jar] = await Promise.all([props.params, cookies()]);
  let data;
  try {
    data = await getRestaurantHome(outlet);
  } catch (error) {
    if (error instanceof AppError && (error.code === "not_found" || error.code === "outlet_unavailable")) notFound();
    throw error;
  }
  const app = await restaurantApp(outlet);
  return <RestaurantHome data={data} initialLang={parseLang(jar.get(LANG_COOKIE)?.value)} installable={app ? { name: app.name, logoUrl: app.logoUrl } : null} />;
}
