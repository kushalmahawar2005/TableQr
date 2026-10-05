import "server-only";

import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import type { SettingsData } from "@/app/admin/admin-types";
import { requirePlatformAdmin } from "./auth";

const set = (name: string) => Boolean(process.env[name]?.trim());

/** Admin team and a non-secret health check of the deployment. Only whether things are set is reported, never values. */
export async function getSettingsData(): Promise<SettingsData> {
  const me = await requirePlatformAdmin();
  const team = await db.select({ id: s.platformAdmins.id, name: s.platformAdmins.name, email: s.platformAdmins.email, role: s.platformAdmins.role, isActive: s.platformAdmins.isActive, lastLoginAt: s.platformAdmins.lastLoginAt })
    .from(s.platformAdmins).orderBy(asc(s.platformAdmins.createdAt));

  let dbOk = true;
  try { await db.execute(sql`select 1`); } catch { dbOk = false; }
  const production = process.env.NODE_ENV === "production";
  const paymentsMock = process.env.PAYMENTS_MOCK === "1" || process.env.PAYMENTS_MOCK === "true";
  const smsMock = process.env.SMS_MOCK === "1" || process.env.SMS_MOCK === "true";

  return {
    me: { name: me.name, email: me.email, role: me.role },
    team: team.map((t) => ({ ...t, lastLoginAt: t.lastLoginAt?.toISOString() ?? null })),
    system: [
      { label: "Database", ok: dbOk, detail: dbOk ? "Connected" : "Cannot reach the database" },
      { label: "Environment", ok: true, detail: production ? "Production" : "Development" },
      { label: "Live updates (realtime)", ok: set("REALTIME_URL") && set("REALTIME_PUBLISH_SECRET"), detail: set("REALTIME_URL") ? "Configured" : "Not set. Screens fall back to refreshing" },
      { label: "Online payments", ok: !paymentsMock || !production, detail: paymentsMock ? (production ? "Test mode is ON in production" : "Test mode (no real money)") : "Live mode" },
      { label: "SMS / OTP", ok: !smsMock || !production, detail: smsMock ? (production ? "Test mode is ON in production" : "Test mode (messages are not sent)") : "Live mode" },
      { label: "Menu image storage", ok: Boolean(process.env.MENU_STORAGE_DRIVER), detail: process.env.MENU_STORAGE_DRIVER ? `Using ${process.env.MENU_STORAGE_DRIVER}` : "Not configured" },
      { label: "Public app address", ok: set("PUBLIC_APP_URL") || set("NEXT_PUBLIC_APP_URL"), detail: set("PUBLIC_APP_URL") || set("NEXT_PUBLIC_APP_URL") ? "Set" : "Not set. QR links may be wrong" },
    ],
  };
}
