import "server-only";
import { and, count, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { settleAtCounter } from "../billing/payments";
import { storeMenuImage } from "../menu-storage";
import { LOCK_THEN_READ } from "../db-types";
import { AppError } from "../errors";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import { audit } from "../staff/audit";
import type { StaffSession } from "../staff/auth";
import { requireStaffRole } from "../staff/waiter";
import { freshLocation } from "@/domain/delivery";
import { deliveryStaffRoles } from "./staff";

// The restaurant's own riders: who can take a delivery right now, giving one to a rider, and
// the rider's side of it (pick up, collect cash, delivered). A rider sees only their own jobs.

export type RiderAvailability = "free" | "busy" | "offline";
export type RiderCard = {
  id: string;
  name: string;
  phone: string;
  photoUrl: string | null;
  vehicleNo: string | null;
  availability: RiderAvailability;
  /** Deliveries given to this rider that are not delivered yet */
  activeCount: number;
  /** Last known position, when the rider app sent one in the last 10 minutes */
  location: { lat: number; lng: number; at: number } | null;
};


const LIVE = ["placed", "dispatched"] as const;

/** Riders of this outlet (or of every outlet), with whether each is free, busy or off duty */
export async function outletRiders(staff: StaffSession): Promise<RiderCard[]> {
  await requireStaffRole(staff, deliveryStaffRoles);
  const people = await db
    .selectDistinct({ id: s.users.id, name: s.users.name, phone: s.users.phone, photoUrl: s.users.photoUrl, vehicleNo: s.users.vehicleNo, duty: s.users.dutyStatus, lastLat: s.users.lastLat, lastLng: s.users.lastLng, lastLocAt: s.users.lastLocAt })
    .from(s.users)
    .innerJoin(s.staffRoles, and(eq(s.staffRoles.tenantId, s.users.tenantId), eq(s.staffRoles.userId, s.users.id)))
    .where(and(
      eq(s.users.tenantId, staff.tenantId),
      eq(s.users.isActive, true),
      eq(s.staffRoles.role, "rider"),
      or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, staff.outletId)),
    ));
  if (!people.length) return [];
  const loads = await db
    .select({ riderId: s.deliveryCheckouts.courierUserId, n: count() })
    .from(s.deliveryCheckouts)
    .where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), inArray(s.deliveryCheckouts.courierUserId, people.map((p) => p.id)), inArray(s.deliveryCheckouts.status, LIVE)))
    .groupBy(s.deliveryCheckouts.courierUserId);
  const load = new Map(loads.map((l) => [l.riderId, Number(l.n)]));
  const order: Record<RiderAvailability, number> = { free: 0, busy: 1, offline: 2 };
  return people
    .map((p) => {
      const activeCount = load.get(p.id) ?? 0;
      const availability: RiderAvailability = p.duty !== "on" ? "offline" : activeCount > 0 ? "busy" : "free";
      return { id: p.id, name: p.name, phone: p.phone, photoUrl: p.photoUrl, vehicleNo: p.vehicleNo, availability, activeCount, location: freshLocation(p.lastLat, p.lastLng, p.lastLocAt) };
    })
    .sort((a, b) => order[a.availability] - order[b.availability] || a.activeCount - b.activeCount || a.name.localeCompare(b.name));
}

/** Gives a live delivery to a team rider; their name and phone go to the customer */
export async function assignTeamRider(staff: StaffSession, deliveryId: string, riderId: string, now = new Date()) {
  await requireStaffRole(staff, deliveryStaffRoles);
  const [rider] = await db
    .select({ id: s.users.id, name: s.users.name, phone: s.users.phone })
    .from(s.users)
    .innerJoin(s.staffRoles, and(eq(s.staffRoles.tenantId, s.users.tenantId), eq(s.staffRoles.userId, s.users.id)))
    .where(and(eq(s.users.tenantId, staff.tenantId), eq(s.users.id, String(riderId)), eq(s.users.isActive, true), eq(s.staffRoles.role, "rider"), or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, staff.outletId))))
    .limit(1);
  if (!rider) throw new AppError("not_found", "That rider is not on your team or is switched off.");
  const sessionId = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(s.deliveryCheckouts)
      .where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.outletId, staff.outletId), eq(s.deliveryCheckouts.id, String(deliveryId))))
      .for("update");
    if (!row?.sessionId) throw new AppError("not_found", "Delivery order not found.");
    if (!(LIVE as readonly string[]).includes(row.status)) throw new AppError("invalid_state", "This delivery is already finished.");
    if (row.courierUserId === rider.id) return row.sessionId;
    await tx.update(s.deliveryCheckouts).set({ courierUserId: rider.id, courierName: rider.name, courierPhone: rider.phone, courierAssignedAt: now })
      .where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.id, row.id)));
    await audit(tx, staff, { action: "delivery.rider_assigned", entity: "delivery", entityId: row.id, before: { riderId: row.courierUserId, name: row.courierName }, after: { riderId: rider.id, name: rider.name }, now });
    return row.sessionId;
  }, LOCK_THEN_READ);
  await publish({ tenantId: staff.tenantId, outletId: staff.outletId }, [{ topic: topics.floor, type: "delivery.updated", data: { sessionId } }]);
}

/** A rider's jobs: everything given to them that is still out, and what they delivered today */
export async function riderJobs(staff: StaffSession, now = new Date()) {
  await requireStaffRole(staff, ["rider"]);
  const since = new Date(now.getTime() - 18 * 3_600_000);
  const rows = await db
    .select({
      id: s.deliveryCheckouts.id, status: s.deliveryCheckouts.status, sessionId: s.deliveryCheckouts.sessionId,
      name: s.deliveryCheckouts.name, phone: s.deliveryCheckouts.phone, address: s.deliveryCheckouts.address,
      placedAt: s.deliveryCheckouts.placedAt, pickedUpAt: s.deliveryCheckouts.pickedUpAt, deliveredAt: s.deliveryCheckouts.deliveredAt,
      totalPaise: s.bills.totalPaise, billStatus: s.bills.status,
    })
    .from(s.deliveryCheckouts)
    .innerJoin(s.bills, and(eq(s.bills.tenantId, s.deliveryCheckouts.tenantId), eq(s.bills.sessionId, s.deliveryCheckouts.sessionId)))
    .where(and(
      eq(s.deliveryCheckouts.tenantId, staff.tenantId),
      eq(s.deliveryCheckouts.courierUserId, staff.userId),
      or(inArray(s.deliveryCheckouts.status, LIVE), and(eq(s.deliveryCheckouts.status, "delivered"), gte(s.deliveryCheckouts.deliveredAt, since))),
    ));
  const sessionIds = rows.map((r) => r.sessionId).filter((id): id is string => !!id);
  const [orders, lines] = sessionIds.length ? await Promise.all([
    db.select({ sessionId: s.orders.sessionId, status: s.orders.status }).from(s.orders).where(and(eq(s.orders.tenantId, staff.tenantId), inArray(s.orders.sessionId, sessionIds))),
    db.select({ sessionId: s.orderLines.sessionId, name: s.orderLines.nameEn, qty: s.orderLines.qty, status: s.orderLines.status }).from(s.orderLines).where(and(eq(s.orderLines.tenantId, staff.tenantId), inArray(s.orderLines.sessionId, sessionIds))),
  ]) : [[], []];
  const kitchen = new Map(orders.map((o) => [o.sessionId, o.status]));
  const [outlet] = await db.select({ name: s.outlets.name, address: s.outlets.address, city: s.outlets.city }).from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId)));
  return {
    pickup: { name: outlet?.name ?? staff.outlet.name, address: [outlet?.address, outlet?.city].filter(Boolean).join(", ") },
    jobs: rows
      .map((r) => {
        const live = lines.filter((l) => l.sessionId === r.sessionId && l.status !== "cancelled" && l.status !== "voided");
        return {
          ...r,
          paid: r.billStatus === "paid",
          kitchenReady: live.length > 0 && live.every((l) => l.status === "ready" || l.status === "served"),
          kitchenStatus: (r.sessionId && kitchen.get(r.sessionId)) || null,
          items: live.map((l) => ({ name: l.name, qty: l.qty })),
          placedAt: r.placedAt?.getTime() ?? null,
          pickedUpAt: r.pickedUpAt?.getTime() ?? null,
          deliveredAt: r.deliveredAt?.getTime() ?? null,
        };
      })
      .sort((a, b) => Number(a.status === "delivered") - Number(b.status === "delivered") || (a.placedAt ?? 0) - (b.placedAt ?? 0)),
  };
}

/** The rider's own delivery, locked, or an error a rider understands */
async function ownJob(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], staff: StaffSession, id: string) {
  const [row] = await tx.select().from(s.deliveryCheckouts)
    .where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.id, String(id)), eq(s.deliveryCheckouts.courierUserId, staff.userId)))
    .for("update");
  if (!row?.sessionId) throw new AppError("not_found", "This delivery is not given to you any more.");
  return row as typeof row & { sessionId: string };
}

/** Rider has the food in hand: the order is on its way */
export async function riderPickUp(staff: StaffSession, id: string, now = new Date()) {
  await requireStaffRole(staff, ["rider"]);
  const sessionId = await db.transaction(async (tx) => {
    const row = await ownJob(tx, staff, id);
    if (row.status === "dispatched") return row.sessionId;
    if (row.status !== "placed") throw new AppError("invalid_state", "This delivery is already finished.");
    const lines = await tx.select({ status: s.orderLines.status }).from(s.orderLines).where(and(eq(s.orderLines.tenantId, staff.tenantId), eq(s.orderLines.sessionId, row.sessionId)));
    const live = lines.filter((l) => l.status !== "voided" && l.status !== "cancelled");
    if (!live.length || live.some((l) => l.status !== "ready" && l.status !== "served")) throw new AppError("invalid_state", "The kitchen has not packed every item yet.");
    await tx.update(s.deliveryCheckouts).set({ status: "dispatched", pickedUpAt: now }).where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.id, row.id)));
    await audit(tx, staff, { action: "delivery.dispatched", entity: "delivery", entityId: row.id, before: { status: row.status }, after: { status: "dispatched", by: "rider" }, now });
    return row.sessionId;
  }, LOCK_THEN_READ);
  await publish({ tenantId: staff.tenantId, outletId: staff.outletId }, [{ topic: topics.floor, type: "delivery.updated", data: { sessionId } }]);
}

/** Cash taken at the door: recorded on the bill in the rider's name */
export async function riderCollectCash(staff: StaffSession, id: string, requestId: string, now = new Date()) {
  await requireStaffRole(staff, ["rider"]);
  const [row] = await db.select({ status: s.deliveryCheckouts.status, sessionId: s.deliveryCheckouts.sessionId, courier: s.deliveryCheckouts.courierUserId, outletId: s.deliveryCheckouts.outletId })
    .from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.id, String(id))));
  if (!row?.sessionId || row.courier !== staff.userId) throw new AppError("not_found", "This delivery is not given to you any more.");
  if (row.status !== "dispatched") throw new AppError("invalid_state", "Pick up the order before collecting cash.");
  const [bill] = await db.select({ totalPaise: s.bills.totalPaise, status: s.bills.status }).from(s.bills).where(and(eq(s.bills.tenantId, staff.tenantId), eq(s.bills.sessionId, row.sessionId)));
  if (!bill) throw new AppError("not_found", "The bill for this delivery is missing. Ask the restaurant.");
  if (bill.status === "paid") return { alreadyPaid: true };
  await settleAtCounter({ ...staff, outletId: row.outletId }, { sessionId: row.sessionId, method: "cash", receivedPaise: bill.totalPaise, clientRequestId: requestId }, now, ["rider"]);
  return { alreadyPaid: false };
}

/** Food handed over. Cash orders must be paid first, so the bill and the drawer agree. */
export async function riderDelivered(staff: StaffSession, id: string, now = new Date()) {
  await requireStaffRole(staff, ["rider"]);
  const sessionId = await db.transaction(async (tx) => {
    const row = await ownJob(tx, staff, id);
    if (row.status === "delivered") return row.sessionId;
    if (row.status !== "dispatched") throw new AppError("invalid_state", "Pick up the order before marking it delivered.");
    const [bill] = await tx.select({ status: s.bills.status }).from(s.bills).where(and(eq(s.bills.tenantId, staff.tenantId), eq(s.bills.sessionId, row.sessionId)));
    if (bill?.status !== "paid") throw new AppError("invalid_state", "Collect the cash first, then mark it delivered.");
    await tx.update(s.deliveryCheckouts).set({ status: "delivered", deliveredAt: now }).where(and(eq(s.deliveryCheckouts.tenantId, staff.tenantId), eq(s.deliveryCheckouts.id, row.id)));
    await audit(tx, staff, { action: "delivery.delivered", entity: "delivery", entityId: row.id, before: { status: row.status }, after: { status: "delivered", by: "rider" }, now });
    return row.sessionId;
  }, LOCK_THEN_READ);
  await publish({ tenantId: staff.tenantId, outletId: staff.outletId }, [{ topic: topics.floor, type: "delivery.updated", data: { sessionId } }]);
}

/** The rider goes online (ready for deliveries) or offline, from their own phone */
export async function riderSetOnline(staff: StaffSession, online: boolean, now = new Date()) {
  await requireStaffRole(staff, ["rider"]);
  const status = online ? "on" : "off";
  await db.update(s.users).set({ dutyStatus: status, dutyChangedAt: now }).where(and(eq(s.users.tenantId, staff.tenantId), eq(s.users.id, staff.userId)));
  await audit(db, staff, { action: "staff.duty", entity: "user", entityId: staff.userId, after: { status, by: "rider" }, now });
  return { online };
}

/** The rider's own profile: face photo and vehicle number, shown to the team and the customer */
export async function riderProfile(staff: StaffSession) {
  await requireStaffRole(staff, ["rider"]);
  const [me] = await db.select({ name: s.users.name, phone: s.users.phone, photoUrl: s.users.photoUrl, vehicleNo: s.users.vehicleNo, duty: s.users.dutyStatus })
    .from(s.users).where(and(eq(s.users.tenantId, staff.tenantId), eq(s.users.id, staff.userId)));
  if (!me) throw new AppError("not_found", "Your profile was not found.");
  return { ...me, online: me.duty === "on" };
}

export async function saveRiderProfile(staff: StaffSession, input: { vehicleNo?: string | null; photo?: { bytes: Buffer; contentType: string; filename: string } | null }) {
  await requireStaffRole(staff, ["rider"]);
  const vehicleNo = input.vehicleNo === undefined ? undefined : String(input.vehicleNo ?? "").toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 20) || null;
  let photoUrl: string | undefined;
  if (input.photo) photoUrl = (await storeMenuImage({ tenantId: staff.tenantId, brandId: "riders", ...input.photo })).url;
  if (vehicleNo === undefined && photoUrl === undefined) return riderProfile(staff);
  await db.update(s.users).set({ ...(vehicleNo !== undefined ? { vehicleNo } : {}), ...(photoUrl ? { photoUrl } : {}) })
    .where(and(eq(s.users.tenantId, staff.tenantId), eq(s.users.id, staff.userId)));
  return riderProfile(staff);
}

/** The rider app reports where the phone is, while it is open and the rider is online */
export async function riderReportLocation(staff: StaffSession, input: { lat: number; lng: number }, now = new Date()) {
  await requireStaffRole(staff, ["rider"]);
  const lat = Number(input?.lat), lng = Number(input?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new AppError("invalid_state", "Location not understood.");
  await db.update(s.users).set({ lastLat: Math.round(lat * 1e6) / 1e6, lastLng: Math.round(lng * 1e6) / 1e6, lastLocAt: now })
    .where(and(eq(s.users.tenantId, staff.tenantId), eq(s.users.id, staff.userId), eq(s.users.dutyStatus, "on")));
  return { ok: true };
}
