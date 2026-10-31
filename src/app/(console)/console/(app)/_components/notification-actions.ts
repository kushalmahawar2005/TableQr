"use server";

import { getConsoleNotices, type ConsoleNotice } from "@/server/staff/notifications";
import { currentStaff } from "@/server/staff/request";

/**
 * What is new at this outlet since the screen last asked. The first call (since = null) only
 * returns the server's clock, so a screen never rings for things that happened before it opened.
 */
export async function noticesAction(since: number | null, expectedSessionId: string): Promise<{ ok: true; now: number; notices: ConsoleNotice[] } | { ok: false }> {
  const staff = await currentStaff();
  // A tab left open while another account signs in must not start polling that account's notices.
  if (!staff || staff.sessionId !== expectedSessionId) return { ok: false };
  const now = Date.now();
  if (since === null || !Number.isFinite(since)) return { ok: true, now, notices: [] };
  // Never look back more than a day, whatever the screen sends
  const from = new Date(Math.max(Number(since), now - 86_400_000));
  return { ok: true, now, notices: await getConsoleNotices(staff, from) };
}
