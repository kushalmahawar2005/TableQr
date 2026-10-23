import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { AppError } from "@/server/errors";
import { getRestaurantHome } from "@/server/guest/restaurant-home";
import { RestaurantHome } from "./restaurant-home";

export const metadata: Metadata = { title: "Restaurant" };

export default async function RestaurantPage(props: { params: Promise<{ outlet: string }> }) {
  const [{ outlet }, jar] = await Promise.all([props.params, cookies()]);
  let data;
  try {
    data = await getRestaurantHome(outlet);
  } catch (error) {
    if (error instanceof AppError && (error.code === "not_found" || error.code === "outlet_unavailable")) notFound();
    throw error;
  }
  return <RestaurantHome data={data} initialLang={parseLang(jar.get(LANG_COOKIE)?.value)} />;
}
