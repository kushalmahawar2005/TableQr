import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { openingInfo } from "@/domain/hours";
import { ROOM_CLASS, roomRequestKinds, type RoomRequestKind } from "@/domain/rooms";
import { AppError } from "../errors";
import { findOpenSession, findTableByQr } from "./table";

// A guest's page in a hotel room (/r/<outlet>/room/<code>): room service through the restaurant's
// own menu, and housekeeping asks. Only while a guest is checked in to the room.

async function roomAt(outletCode: string, shortCode: string) {
  const t = await findTableByQr(db, outletCode, shortCode);
  if (t.table.tableClass !== ROOM_CLASS) return { t, room: null, stay: null };
  const tenantId = t.outlet.tenantId;
  const [room] = await db.select().from(s.rooms).where(and(eq(s.rooms.tenantId, tenantId), eq(s.rooms.tableId, t.table.id), eq(s.rooms.isActive, true)));
  if (!room) throw new AppError("not_found", "We could not find this room. Please call reception.");
  const [stay] = await db.select().from(s.roomStays).where(and(eq(s.roomStays.tenantId, tenantId), eq(s.roomStays.openKey, room.id)));
  return { t, room, stay: stay ?? null };
}

export type RoomPage =
  | { kind: "table" }
  | { kind: "error"; code: "not_found" | "qr_revoked" | "outlet_unavailable" }
  | {
      kind: "room";
      outlet: { code: string; name: string; city: string; logoUrl: string | null; accentColor: string | null; isOpen: boolean };
      room: { number: string; roomType: string | null };
      stay: {
        firstName: string;
        foodPay: "at_checkout" | "per_order";
        joined: boolean;
        requests: { id: string; kind: RoomRequestKind; status: "open" | "done"; createdAt: number }[];
      } | null;
    };

export async function getRoomPage(outletCode: string, shortCode: string, deviceId: string | null, now = new Date()): Promise<RoomPage> {
  let found;
  try {
    found = await roomAt(outletCode, shortCode);
  } catch (err) {
    if (err instanceof AppError && (err.code === "not_found" || err.code === "qr_revoked" || err.code === "outlet_unavailable")) return { kind: "error", code: err.code };
    throw err;
  }
  const { t, room, stay } = found;
  if (!room) return { kind: "table" };
  const tenantId = t.outlet.tenantId;
  let joined = false;
  let requests: { id: string; kind: RoomRequestKind; status: "open" | "done"; createdAt: number }[] = [];
  if (stay) {
    const open = await findOpenSession(db, tenantId, t.table.id);
    joined = !!deviceId && !!open?.people.some((p) => p.deviceId === deviceId);
    requests = (
      await db
        .select({ id: s.roomRequests.id, kind: s.roomRequests.kind, status: s.roomRequests.status, createdAt: s.roomRequests.createdAt })
        .from(s.roomRequests)
        .where(and(eq(s.roomRequests.tenantId, tenantId), eq(s.roomRequests.stayId, stay.id)))
        .orderBy(desc(s.roomRequests.createdAt))
        .limit(8)
    ).map((r) => ({ ...r, kind: r.kind as RoomRequestKind, createdAt: r.createdAt.getTime() }));
  }
  return {
    kind: "room",
    outlet: {
      code: t.outlet.code,
      name: t.outlet.name,
      city: t.outlet.city,
      logoUrl: t.logoUrl,
      accentColor: t.outlet.accentColor,
      isOpen: openingInfo(t.outlet.openingHours, t.outlet.timezone, now).isOpen,
    },
    room: { number: room.number, roomType: room.roomType },
    stay: stay ? { firstName: stay.guestName.split(" ")[0], foodPay: stay.foodPay, joined, requests } : null,
  };
}

/** A housekeeping ask from the room. The same ask while one is still open is not sent twice. */
export async function askFromRoom(outletCode: string, shortCode: string, kind: RoomRequestKind, note: string | null, now = new Date()) {
  if (!roomRequestKinds.includes(kind)) throw new AppError("invalid_state", "Choose what you need.");
  const { room, stay } = await roomAt(outletCode, shortCode);
  if (!room) throw new AppError("not_found", "We could not find this room. Please call reception.");
  if (!stay) throw new AppError("table_not_open", "This room is not checked in. Please call reception.");
  const text = String(note ?? "").trim().slice(0, 140) || null;
  if (kind === "other" && !text) throw new AppError("invalid_state", "Write what you need.");
  const open = await db
    .select({ id: s.roomRequests.id, kind: s.roomRequests.kind })
    .from(s.roomRequests)
    .where(and(eq(s.roomRequests.tenantId, room.tenantId), eq(s.roomRequests.stayId, stay.id), eq(s.roomRequests.status, "open")));
  const same = open.find((r) => r.kind === kind);
  if (same && kind !== "other") return { id: same.id, repeated: true };
  const n = open.length;
  if (n >= 10) throw new AppError("rate_limited", "Reception has your earlier requests. Please call them if it is urgent.");
  const [row] = await db.insert(s.roomRequests).values({ tenantId: room.tenantId, outletId: room.outletId, roomId: room.id, stayId: stay.id, kind, note: text, createdAt: now }).$returningId();
  return { id: row.id, repeated: false };
}
