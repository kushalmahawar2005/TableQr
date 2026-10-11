import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { KdsScreen } from "@/app/(staff)/kds/_components/kds-screen";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { canSee } from "@/lib/staff-permissions";
import { consoleKitchen, kdsBoard } from "@/server/kitchen/kds";
import { currentStaff } from "@/server/staff/request";
import * as act from "./actions";

export const metadata: Metadata = { title: "Kitchen" };

// Kitchen board inside the console, for every plan. Restaurants whose plan includes the kitchen
// display can also run it full screen on a wall device at /kds.
export default async function ConsoleKitchenPage() {
  const staff = await currentStaff();
  if (!staff || !canSee(staff.roles, "kitchen")) notFound();
  const lang = parseLang((await cookies()).get(LANG_COOKIE)?.value);
  const kitchen = await consoleKitchen(staff);
  const board = await kdsBoard(kitchen, null);
  return (
    <KdsScreen
      embedded
      initial={board}
      device={{ station: null, expeditor: true, lang, outletName: staff.outlet.name, timezone: staff.outlet.timezone }}
      realtimeUrl={process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null}
      actions={{
        board: act.boardAction,
        token: act.tokenAction,
        accept: act.acceptAction,
        start: act.startAction,
        bumpTicket: act.bumpTicketAction,
        bumpLine: act.bumpLineAction,
        recall: act.recallAction,
        stock: act.stockAction,
        search: act.searchAction,
      }}
    />
  );
}
