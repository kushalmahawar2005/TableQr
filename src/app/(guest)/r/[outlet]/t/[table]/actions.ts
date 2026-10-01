"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { uuidv7 } from "@/db/id";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import { AppError } from "@/server/errors";
import { startOrJoinTable } from "@/server/guest/session";

const YEAR = 60 * 60 * 24 * 365;
const cookieBase = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" } as const;

export type StartResult = { error: "ask_staff" | "failed" } | null;

/**
 * Start ordering / Join this table. Opens or joins the one session on this table and moves the
 * guest to the menu. When the table changed meanwhile (closed, settling, being prepared) the
 * page re-renders with its new state instead of showing an error.
 */
// useActionState passes the previous result first; this action does not need it
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function startOrJoin(outletCode: string, shortCode: string, _prev: StartResult): Promise<StartResult> {
  const jar = await cookies();
  let deviceId = jar.get(DEVICE_COOKIE)?.value;
  if (!deviceId) {
    deviceId = uuidv7();
    jar.set(DEVICE_COOKIE, deviceId, { ...cookieBase, maxAge: YEAR });
  }

  const tablePath = `/r/${encodeURIComponent(outletCode)}/t/${encodeURIComponent(shortCode)}`;
  try {
    await startOrJoinTable({ outletCode, shortCode, deviceId });
  } catch (err) {
    if (!(err instanceof AppError)) return { error: "failed" };
    if (err.code === "verification_required") {
      // Verified mode confirms the number on G2 (skipped if this phone verified here within 12 hours)
      if (err.details?.mode === "verified") redirect(`${tablePath}/verify`);
      // Host-confirmed joining is not built yet: guest-safe message, no dead end
      return { error: "ask_staff" };
    }
    refresh();
    return null;
  }
  redirect(`${tablePath}/menu`);
}

/** EN / HI switch, remembered on this phone. Setting the cookie re-renders the page. */
export async function setLanguage(lang: string) {
  (await cookies()).set(LANG_COOKIE, parseLang(lang), { ...cookieBase, maxAge: YEAR });
}
