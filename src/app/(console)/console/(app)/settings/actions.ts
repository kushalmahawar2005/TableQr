"use server";
import { AppError } from "@/server/errors";
import { consoleSectionRoles } from "@/lib/staff-permissions";
import { updateOutletSettings, type SettingsPatch } from "@/server/staff/settings-write";
import { staffFor } from "@/server/staff/request";

export type SettingsResult = { ok: true } | { ok: false; message: string };

export async function saveSettingsAction(input: SettingsPatch): Promise<SettingsResult> {
  try {
    await updateOutletSettings(await staffFor(consoleSectionRoles.settings), input);
    return { ok: true };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    console.error("[settings] save failed", err);
    return { ok: false, message: "That didn't go through. Try again." };
  }
}
