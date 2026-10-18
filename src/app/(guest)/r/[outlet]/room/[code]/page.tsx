import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { getRoomPage } from "@/server/guest/room";
import { RoomScreen } from "./_components/room-screen";

// QR addresses are private to the room; keep them out of search results
export const metadata: Metadata = { title: "Your room", robots: { index: false, follow: false } };

// A hotel room's QR: room service from the restaurant's menu, and housekeeping asks.
export default async function RoomPage(props: { params: Promise<{ outlet: string; code: string }> }) {
  const { outlet, code } = await props.params;
  const jar = await cookies();
  const lang = parseLang(jar.get(LANG_COOKIE)?.value);
  const data = await getRoomPage(outlet, code, jar.get(DEVICE_COOKIE)?.value ?? null);
  // A table's QR opened here goes to the table page
  if (data.kind === "table") redirect(`/r/${encodeURIComponent(outlet)}/t/${encodeURIComponent(code)}`);
  return <RoomScreen data={data} lang={lang} outletCode={outlet} shortCode={code} />;
}
