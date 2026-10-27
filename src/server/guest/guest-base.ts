import "server-only";
import { headers } from "next/headers";

/** Server pages: /r/CODE, or /r/CODE/app when the request came through the installed app (see proxy.ts) */
export async function guestBase(code: string) {
  const fromApp = (await headers()).get("x-guest-base");
  const plain = `/r/${encodeURIComponent(code)}`;
  return fromApp && fromApp.toLowerCase() === `${plain}/app`.toLowerCase() ? fromApp : plain;
}
