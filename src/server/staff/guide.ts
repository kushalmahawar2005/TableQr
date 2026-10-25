import "server-only";
import { and, count, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { canSee } from "@/lib/staff-permissions";
import { tenantFeatures } from "../plan";
import type { StaffSession } from "./auth";

// First-run guide: the welcome, the spotlight tour and the setup list on the dashboard.
// What each person has already seen is kept on their own user row, so it shows once on any device.

export type Guide = NonNullable<(typeof s.users.$inferSelect)["guide"]>;
export type GuideKey = keyof Guide;
export const GUIDE_KEYS: readonly GuideKey[] = ["welcome", "tour", "setupHidden", "qrPrinted"];

export async function getGuide(staff: Pick<StaffSession, "tenantId" | "userId">): Promise<Guide> {
  const [row] = await db.select({ guide: s.users.guide }).from(s.users).where(and(eq(s.users.tenantId, staff.tenantId), eq(s.users.id, staff.userId)));
  return row?.guide ?? {};
}

/** Stamps these steps as done now; steps already stamped keep their first time */
export async function markGuide(staff: Pick<StaffSession, "tenantId" | "userId">, keys: readonly GuideKey[]) {
  const wanted = keys.filter((k) => GUIDE_KEYS.includes(k));
  if (wanted.length === 0) return;
  const guide = await getGuide(staff);
  const now = Date.now();
  const next = { ...guide };
  for (const k of wanted) next[k] ??= now;
  await db.update(s.users).set({ guide: next }).where(and(eq(s.users.tenantId, staff.tenantId), eq(s.users.id, staff.userId)));
}

export type SetupStepKey = "details" | "menu" | "tables" | "rooms" | "qr" | "team" | "order";
export type SetupStep = { key: SetupStepKey; done: boolean; href: string };

/**
 * The owner's setup list, worked out from what the restaurant already has, so a step ticks itself
 * when the work is done anywhere. Null when this person hid it or it is not theirs to do.
 */
export async function setupSteps(staff: StaffSession): Promise<SetupStep[] | null> {
  if (!staff.roles.some((r) => r === "owner" || r === "manager")) return null;
  const guide = await getGuide(staff);
  if (guide.setupHidden) return null;
  const t = { tenantId: staff.tenantId, outletId: staff.outletId };
  const [features, [outlet], [items], [tables], [rooms], [team], [order], [printed]] = await Promise.all([
    tenantFeatures(t.tenantId),
    db.select({ hours: s.outlets.openingHours }).from(s.outlets).where(and(eq(s.outlets.tenantId, t.tenantId), eq(s.outlets.id, t.outletId))),
    db.select({ n: count() }).from(s.menuItems).where(and(eq(s.menuItems.tenantId, t.tenantId), eq(s.menuItems.isActive, true))),
    db.select({ n: count() }).from(s.diningTables).where(and(eq(s.diningTables.tenantId, t.tenantId), eq(s.diningTables.outletId, t.outletId), eq(s.diningTables.isActive, true))),
    db.select({ n: count() }).from(s.rooms).where(and(eq(s.rooms.tenantId, t.tenantId), eq(s.rooms.outletId, t.outletId), eq(s.rooms.isActive, true))),
    db.select({ n: count() }).from(s.users).where(and(eq(s.users.tenantId, t.tenantId), eq(s.users.isActive, true), ne(s.users.id, staff.userId))),
    db.select({ id: s.orders.id }).from(s.orders).where(and(eq(s.orders.tenantId, t.tenantId), eq(s.orders.outletId, t.outletId))).limit(1),
    // Anyone at the restaurant printing the QR posters counts
    db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, t.tenantId), isNotNull(sql`JSON_EXTRACT(${s.users.guide}, '$.qrPrinted')`))).limit(1),
  ]);
  const steps: (SetupStep & { show: boolean })[] = [
    { key: "details", done: !!outlet?.hours && Object.keys(outlet.hours).length > 0, href: "/console/settings#hours", show: canSee(staff, "settings") },
    { key: "menu", done: items.n > 0, href: "/console/menu", show: canSee(staff, "menu") },
    { key: "tables", done: tables.n > 0, href: "/console/floor/editor", show: features.dineIn && canSee(staff, "floor") },
    { key: "rooms", done: rooms.n > 0, href: "/console/rooms", show: features.rooms && canSee(staff, "rooms") },
    { key: "qr", done: !!printed || !!guide.qrPrinted, href: features.dineIn ? "/console/floor/editor/qr-sheet" : "/console/rooms/qr-sheet", show: features.dineIn || features.rooms },
    { key: "team", done: team.n > 0, href: "/console/team", show: canSee(staff, "team") },
    { key: "order", done: !!order, href: features.dineIn ? "/console/floor" : "/console/rooms", show: true },
  ];
  return steps.filter((st) => st.show).map(({ key, done, href }) => ({ key, done, href }));
}
