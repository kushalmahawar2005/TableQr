import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { canUse, kdsSetupRoles } from "@/lib/staff-permissions";
import { AppError } from "../errors";
import { hashToken, verifyStaffPin } from "../staff/auth";
import { audit } from "../staff/audit";
import { KITCHEN_NOT_IN_PLAN, tenantHasKitchen } from "../plan";
import { tenantAccess } from "../access";

// Trusted kitchen screens (S2). A manager or owner sets the screen up once with their phone and
// PIN; it then holds its own 30-day credential, pinned to one station or to the expeditor's All
// view. Kitchen staff never sign in on it. Changing or revoking it needs a manager PIN again.

export const KDS_COOKIE = "tq_kds";
export const KDS_DEVICE_DAYS = 30;

export type KdsDevice = {
  tenantId: string;
  outletId: string;
  deviceId: string;
  /** Pinned station; null on an expeditor screen */
  station: string | null;
  expeditor: boolean;
  lang: "en" | "hi";
  outlet: { code: string; name: string; timezone: string; brandId: string };
  expiresAt: number;
  /** Set when a signed-in staff member works the board from the console instead of a wall screen */
  staff?: { userId: string; name: string };
};

type Scope = { tenantId: string; outletId: string };

/** Stations this outlet cooks at: from its menu and from tickets already sent (never a fixed list) */
export async function kitchenStations(scope: Scope): Promise<string[]> {
  const [outlet] = await db.select({ brandId: s.outlets.brandId }).from(s.outlets).where(and(eq(s.outlets.tenantId, scope.tenantId), eq(s.outlets.id, scope.outletId)));
  const [menu, sent] = await Promise.all([
    db
      .selectDistinct({ station: s.menuItems.station })
      .from(s.menuItems)
      .where(and(eq(s.menuItems.tenantId, scope.tenantId), eq(s.menuItems.brandId, outlet?.brandId ?? "-"), eq(s.menuItems.isActive, true))),
    db.selectDistinct({ station: s.tickets.station }).from(s.tickets).where(and(eq(s.tickets.tenantId, scope.tenantId), eq(s.tickets.outletId, scope.outletId))),
  ]);
  return [...new Set([...menu, ...sent].map((r) => r.station.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

async function managerAt(input: { outletCode: string; phone: string; pin: string; now: Date }) {
  const who = await verifyStaffPin(input);
  if (!canUse(who.roles, kdsSetupRoles)) throw new AppError("forbidden", "Only kitchen staff, a manager or the owner can set up a kitchen screen.");
  if (!(await tenantHasKitchen(who.scope.tenantId))) throw new AppError("forbidden", KITCHEN_NOT_IN_PLAN, { reason: "plan" });
  return who;
}

async function pin(scope: Scope, station: string | null, expeditor: boolean) {
  if (expeditor) return null;
  const name = String(station ?? "").trim();
  if (!name) throw new AppError("invalid_state", "Choose a station, or make this the expeditor screen.", { reason: "station" });
  if (!(await kitchenStations(scope)).includes(name)) throw new AppError("invalid_state", "That station is not on this outlet's menu.", { reason: "station" });
  return name;
}

/** Setup step 1: the manager's PIN is right, so show this outlet's stations to pin */
export async function kdsSetupOptions(input: { outletCode: string; phone: string; pin: string; now?: Date }) {
  const who = await managerAt({ ...input, now: input.now ?? new Date() });
  return { stations: await kitchenStations(who.scope), managerName: who.user.name };
}

/** First setup on a screen: returns the device token for the httpOnly cookie */
export async function setupKdsDevice(input: { outletCode: string; phone: string; pin: string; station: string | null; expeditor: boolean; lang?: "en" | "hi"; now?: Date }) {
  const now = input.now ?? new Date();
  const who = await managerAt({ ...input, now });
  const station = await pin(who.scope, input.station, input.expeditor === true);
  const token = randomBytes(32).toString("base64url");
  const id = uuidv7();
  const expiresAt = new Date(now.getTime() + KDS_DEVICE_DAYS * 86_400_000);
  await db.insert(s.kdsDevices).values({
    id,
    tenantId: who.scope.tenantId,
    outletId: who.scope.outletId,
    tokenHash: hashToken(token),
    station,
    expeditor: input.expeditor === true,
    lang: input.lang === "hi" ? "hi" : "en",
    createdByUserId: who.user.id,
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
  });
  await audit(db, { ...who.scope, userId: who.user.id, name: who.user.name }, { action: "kds.setup", entity: "kds_device", entityId: id, after: { station, expeditor: input.expeditor === true }, now });
  return { token, expiresAt, deviceId: id };
}

/** The screen behind a cookie, or null when missing, expired or revoked */
export async function resolveKdsDevice(token: string | null | undefined, now = new Date()): Promise<KdsDevice | null> {
  if (!token || token.length > 200) return null;
  // isolation-exempt: the token's hash is the lookup key; the row it finds carries the tenant
  const [row] = await db
    .select({ d: s.kdsDevices, outlet: { code: s.outlets.code, name: s.outlets.name, timezone: s.outlets.timezone, brandId: s.outlets.brandId } })
    .from(s.kdsDevices)
    .innerJoin(s.outlets, and(eq(s.outlets.tenantId, s.kdsDevices.tenantId), eq(s.outlets.id, s.kdsDevices.outletId)))
    .where(and(eq(s.kdsDevices.tokenHash, hashToken(token)), isNull(s.kdsDevices.revokedAt), gt(s.kdsDevices.expiresAt, now)));
  if (!row) return null;
  // Switching the kitchen screen off (plan or admin) turns existing screens off too
  if (!(await tenantHasKitchen(row.d.tenantId))) return null;
  // A paused restaurant's screens stop too, until the plan is renewed
  if ((await tenantAccess(row.d.tenantId, now)).state === "blocked") return null;
  if (!row.d.lastSeenAt || now.getTime() - row.d.lastSeenAt.getTime() > 5 * 60_000) {
    await db.update(s.kdsDevices).set({ lastSeenAt: now }).where(and(eq(s.kdsDevices.tenantId, row.d.tenantId), eq(s.kdsDevices.id, row.d.id)));
  }
  return {
    tenantId: row.d.tenantId,
    outletId: row.d.outletId,
    deviceId: row.d.id,
    station: row.d.station,
    expeditor: row.d.expeditor,
    lang: row.d.lang,
    outlet: row.outlet,
    expiresAt: row.d.expiresAt.getTime(),
  };
}

export async function requireKdsDevice(token: string | null | undefined, now = new Date()) {
  const device = await resolveKdsDevice(token, now);
  if (!device) throw new AppError("staff_signed_out", "This kitchen screen needs to be set up again by a manager.");
  return device;
}

/** Repin station, expeditor or language: a manager or owner of this outlet confirms with their PIN */
export async function updateKdsDevice(token: string, input: { phone: string; pin: string; station: string | null; expeditor: boolean; lang: "en" | "hi" }, now = new Date()) {
  const device = await requireKdsDevice(token, now);
  const who = await managerAt({ outletCode: device.outlet.code, phone: input.phone, pin: input.pin, now });
  const station = await pin(device, input.station, input.expeditor === true);
  await db
    .update(s.kdsDevices)
    .set({ station, expeditor: input.expeditor === true, lang: input.lang === "hi" ? "hi" : "en", updatedByUserId: who.user.id })
    .where(and(eq(s.kdsDevices.tenantId, device.tenantId), eq(s.kdsDevices.id, device.deviceId)));
  await audit(db, { tenantId: device.tenantId, outletId: device.outletId, userId: who.user.id, name: who.user.name }, {
    action: "kds.update",
    entity: "kds_device",
    entityId: device.deviceId,
    before: { station: device.station, expeditor: device.expeditor, lang: device.lang },
    after: { station, expeditor: input.expeditor === true, lang: input.lang },
    now,
  });
}

/** Sign the screen out for good; a manager or owner confirms with their PIN */
export async function revokeKdsDevice(token: string, input: { phone: string; pin: string }, now = new Date()) {
  const device = await requireKdsDevice(token, now);
  const who = await managerAt({ outletCode: device.outlet.code, phone: input.phone, pin: input.pin, now });
  await db
    .update(s.kdsDevices)
    .set({ revokedAt: now, updatedByUserId: who.user.id })
    .where(and(eq(s.kdsDevices.tenantId, device.tenantId), eq(s.kdsDevices.id, device.deviceId)));
  await audit(db, { tenantId: device.tenantId, outletId: device.outletId, userId: who.user.id, name: who.user.name }, { action: "kds.revoke", entity: "kds_device", entityId: device.deviceId, now });
}
