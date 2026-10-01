import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { AppError } from "@/server/errors";
import { getCartScreen } from "@/server/guest/cart-screen";
import { CartScreen } from "./_components/cart-screen";

export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false } };

// G5 Your order, for a phone at this table. Anyone else, or a closed table, goes to G1.
export default async function CartPage(props: PageProps<"/r/[outlet]/t/[table]/cart">) {
  const [{ outlet, table }, query] = await Promise.all([props.params, props.searchParams]);
  const jar = await cookies();
  const lang = parseLang(jar.get(LANG_COOKIE)?.value);
  const deviceId = jar.get(DEVICE_COOKIE)?.value ?? null;

  let data;
  try {
    data = await getCartScreen(outlet, table, deviceId);
  } catch (err) {
    if (err instanceof AppError) redirect(`/r/${encodeURIComponent(outlet)}/t/${encodeURIComponent(table)}`);
    throw err;
  }
  const realtimeUrl = process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null;
  return <CartScreen data={data} lang={lang} shortCode={table} fromMenu={query.from === "menu"} realtimeUrl={realtimeUrl} />;
}
