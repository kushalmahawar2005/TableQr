import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { AppError } from "@/server/errors";
import { getItemSheet } from "@/server/guest/item-sheet";
import { ItemSheet } from "./item-sheet";

/** Server side of G4, shared by the sheet over the menu and the page opened from a link */
export async function ItemSheetPage({
  params,
  mode,
}: {
  params: Promise<{ outlet: string; table: string; itemId: string }>;
  mode: "sheet" | "page";
}) {
  const { outlet, table, itemId } = await params;
  const jar = await cookies();
  const lang = parseLang(jar.get(LANG_COOKIE)?.value);
  const deviceId = jar.get(DEVICE_COOKIE)?.value ?? null;
  const menuPath = `/r/${encodeURIComponent(outlet)}/t/${encodeURIComponent(table)}/menu`;

  let data;
  try {
    data = await getItemSheet(outlet, table, deviceId, itemId);
  } catch (err) {
    // Not at the table, or no such dish: the menu decides where the guest belongs
    if (err instanceof AppError) redirect(menuPath);
    throw err;
  }
  return <ItemSheet data={data} lang={lang} shortCode={table} mode={mode} />;
}
