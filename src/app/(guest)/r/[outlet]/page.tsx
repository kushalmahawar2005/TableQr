import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppError } from "@/server/errors";
import { getRestaurantHome } from "@/server/guest/restaurant-home";
import { RestaurantHome } from "./restaurant-home";

export const metadata: Metadata = { title: "Restaurant" };

export default async function RestaurantPage(props: { params: Promise<{ outlet: string }> }) {
  const { outlet } = await props.params;
  let data;
  try {
    data = await getRestaurantHome(outlet);
  } catch (error) {
    if (error instanceof AppError && (error.code === "not_found" || error.code === "outlet_unavailable")) notFound();
    throw error;
  }
  return <RestaurantHome data={data} />;
}
