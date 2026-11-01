import { customerAtTable, customerCookie } from "@/server/guest/customer-account";
import { startOrJoinTable } from "@/server/guest/session";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { getTableLanding } from "@/server/guest/table";
import { isRecentlyVerified } from "@/server/guest/verify";
import { VerifyScreen } from "./_components/verify-screen";

export const metadata: Metadata = { title: "Confirm your number", robots: { index: false, follow: false } };

// G2 Verify number, Verified mode only. Anyone who does not need it goes back to G1, which shows
// the table's current state; a phone already at the table goes to the menu.
export default async function VerifyPage(props: PageProps<"/r/[outlet]/t/[table]/verify">) {
  const [{ outlet, table }, query] = await Promise.all([props.params, props.searchParams]);
  const jar = await cookies();
  const lang = parseLang(jar.get(LANG_COOKIE)?.value);
  const deviceId = jar.get(DEVICE_COOKIE)?.value ?? null;
  const tablePath = `/r/${encodeURIComponent(outlet)}/t/${encodeURIComponent(table)}`;
  const returnToCart = query.next === "cart";

  const data = await getTableLanding(outlet, table, deviceId).catch(() => null);
  if (!data) redirect(tablePath);
  const { landing } = data;
  if (landing.kind !== "start" && landing.kind !== "join" && landing.kind !== "rejoin") redirect(tablePath);
  // A signed-in customer already verified once: seat them with that identity, no new code.
  const customer = deviceId ? await customerAtTable(outlet, jar.get(customerCookie(outlet))?.value) : null;
  if (deviceId && customer) {
    const seated = await startOrJoinTable({ outletCode: outlet, shortCode: table, deviceId, customer }).then(() => true, () => false);
    if (seated) redirect(returnToCart ? `${tablePath}/cart` : `${tablePath}/menu`);
  }
  // Verified here within 12 hours: return to the cart that requested verification.
  if (deviceId && (await isRecentlyVerified(outlet, table, deviceId))) redirect(returnToCart ? `${tablePath}/cart` : `${tablePath}/menu`);

  return (
    <VerifyScreen
      lang={lang}
      shortCode={table}
      data={{
        outlet: data.outlet,
        tableCode: data.table.code,
        context: landing.kind === "join" ? { kind: "join", count: landing.count } : { kind: "start" },
      }}
      returnToCart={returnToCart}
    />
  );
}
