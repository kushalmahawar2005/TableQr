import { boolean, index, int, mysqlEnum, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { roomRequestKinds, roomStatuses } from "../../domain/rooms";
import { at, createdAt, id, ref, sameTenant, tenantId, tenantKey, updatedAt } from "./_columns";
import { diningTables } from "./floor";
import { outlets, users } from "./tenancy";

// Hotel rooms (plans with Rooms). Kept apart from the restaurant's tables: a room has its own
// list, stays and requests. Food from a room is ordered on the hidden counter in table_id, so the
// kitchen, bill and payments work exactly as for a table.

export const rooms = mysqlTable(
  "rooms",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    /** As written on the door, e.g. 204 */
    number: varchar("number", { length: 7 }).notNull(),
    /** e.g. Deluxe, Suite */
    roomType: varchar("room_type", { length: 40 }),
    /** e.g. First floor */
    floorLabel: varchar("floor_label", { length: 40 }),
    /** The hidden counter (tableClass "room") its food orders run on; its QR is the room's QR */
    tableId: ref("table_id").notNull(),
    status: mysqlEnum("status", roomStatuses).notNull().default("vacant"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("rooms_outlet_number_uq").on(t.outletId, t.number),
    uniqueIndex("rooms_table_uq").on(t.tableId),
    tenantKey("rooms", t),
    sameTenant("fk_rooms_outlet", t, t.outletId, outlets),
    sameTenant("fk_rooms_table", t, t.tableId, diningTables),
  ],
);

/**
 * A guest's stay in a room, from check-in to check-out. Food sessions on the room's counter that
 * open during the stay belong to it. open_key equals room_id while the stay is open, so a room
 * has at most one open stay.
 */
export const roomStays = mysqlTable(
  "room_stays",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    roomId: ref("room_id").notNull(),
    guestName: varchar("guest_name", { length: 80 }).notNull(),
    guestPhone: varchar("guest_phone", { length: 15 }),
    guests: int("guests").notNull().default(1),
    /** Food is paid when it comes (per_order) or added to the room and paid at check-out */
    foodPay: mysqlEnum("food_pay", ["at_checkout", "per_order"]).notNull().default("at_checkout"),
    note: varchar("note", { length: 140 }),
    status: mysqlEnum("status", ["open", "closed"]).notNull().default("open"),
    openKey: ref("open_key"),
    checkInAt: at("check_in_at").notNull(),
    expectedCheckOutAt: at("expected_check_out_at"),
    checkOutAt: at("check_out_at"),
    checkedInByUserId: ref("checked_in_by_user_id"),
    checkedOutByUserId: ref("checked_out_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("room_stays_open_uq").on(t.openKey),
    index("room_stays_outlet_idx").on(t.outletId, t.checkInAt),
    tenantKey("room_stays", t),
    sameTenant("fk_room_stays_outlet", t, t.outletId, outlets),
    sameTenant("fk_room_stays_room", t, t.roomId, rooms),
    sameTenant("fk_room_stays_in_by", t, t.checkedInByUserId, users),
    sameTenant("fk_room_stays_out_by", t, t.checkedOutByUserId, users),
  ],
);

/** Housekeeping and other asks from a room's QR */
export const roomRequests = mysqlTable(
  "room_requests",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    roomId: ref("room_id").notNull(),
    stayId: ref("stay_id").notNull(),
    kind: mysqlEnum("kind", roomRequestKinds).notNull(),
    note: varchar("note", { length: 140 }),
    status: mysqlEnum("status", ["open", "done"]).notNull().default("open"),
    createdAt: createdAt(),
    doneAt: at("done_at"),
    doneByUserId: ref("done_by_user_id"),
  },
  (t) => [
    index("room_requests_outlet_status_idx").on(t.outletId, t.status),
    index("room_requests_stay_idx").on(t.stayId, t.createdAt),
    sameTenant("fk_room_requests_outlet", t, t.outletId, outlets),
    sameTenant("fk_room_requests_room", t, t.roomId, rooms),
    sameTenant("fk_room_requests_stay", t, t.stayId, roomStays),
    sameTenant("fk_room_requests_done_by", t, t.doneByUserId, users),
  ],
);
