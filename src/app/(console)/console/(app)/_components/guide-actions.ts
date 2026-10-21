"use server";

import { markGuide, type GuideKey } from "@/server/staff/guide";
import { currentStaff } from "@/server/staff/request";

/** Remembers that this person has seen a part of the first-run guide */
export async function guideAction(keys: GuideKey[]): Promise<{ ok: boolean }> {
  const staff = await currentStaff();
  if (!staff || !Array.isArray(keys)) return { ok: false };
  await markGuide(staff, keys);
  return { ok: true };
}
