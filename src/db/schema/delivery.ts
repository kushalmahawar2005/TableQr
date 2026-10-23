import { char, index, int, json, mysqlEnum, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { at, createdAt, id, ref, sameTenant, tenantId, tenantKey } from "./_columns";
import { guests, tableSessions } from "./sessions";
import { outlets } from "./tenancy";

export type DeliveryCartLine = { itemId: string; qty: number; modifierIds: string[] };
export type DeliveryAddress = { line: string; locality: string; pincode: string; instructions: string };

export const deliveryCheckouts = mysqlTable("delivery_checkouts", {
  id: id(), tenantId: tenantId(), outletId: ref("outlet_id").notNull(),
  tokenHash: char("token_hash", { length: 64 }).notNull(), deviceId: varchar("device_id", { length: 64 }).notNull(),
  lines: json("lines").$type<DeliveryCartLine[]>().notNull(), address: json("address").$type<DeliveryAddress>().notNull(),
  guestId: ref("guest_id"), name: varchar("name", { length: 40 }), phone: varchar("phone", { length: 15 }), verifiedAt: at("verified_at"),
  sessionId: ref("session_id"), status: mysqlEnum("status", ["draft", "placed", "dispatched", "delivered", "cancelled"]).notNull().default("draft"),
  deliveryFeePaise: int("delivery_fee_paise").notNull().default(0), totalPaise: int("total_paise").notNull().default(0),
  expiresAt: at("expires_at").notNull(), createdAt: createdAt(), placedAt: at("placed_at"),
}, t => [tenantKey("delivery_checkouts", t), uniqueIndex("delivery_token_uq").on(t.tokenHash), index("delivery_device_idx").on(t.tenantId, t.deviceId, t.createdAt), index("delivery_outlet_idx").on(t.outletId, t.status, t.createdAt), sameTenant("fk_delivery_outlet", t, t.outletId, outlets), sameTenant("fk_delivery_guest", t, t.guestId, guests), sameTenant("fk_delivery_session", t, t.sessionId, tableSessions)]);

export const deliveryOtpChallenges = mysqlTable("delivery_otp_challenges", {
  id: id(), tenantId: tenantId(), outletId: ref("outlet_id").notNull(), checkoutId: ref("checkout_id").notNull(),
  deviceId: varchar("device_id", { length: 64 }).notNull(), phone: varchar("phone", { length: 15 }).notNull(), codeHash: char("code_hash", { length: 64 }).notNull(),
  attempts: int("attempts").notNull().default(0), expiresAt: at("expires_at").notNull(), resendAt: at("resend_at").notNull(), lockedUntil: at("locked_until"), verifiedAt: at("verified_at"), deadAt: at("dead_at"), createdAt: createdAt(),
}, t => [index("delivery_otp_phone_idx").on(t.tenantId, t.phone, t.createdAt), index("delivery_otp_device_idx").on(t.tenantId, t.deviceId, t.createdAt), sameTenant("fk_delivery_otp_checkout", t, t.checkoutId, deliveryCheckouts), sameTenant("fk_delivery_otp_outlet", t, t.outletId, outlets)]);
