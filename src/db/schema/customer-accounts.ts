import { char, index, int, json, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { at, createdAt, id, ref, tenantId, tenantKey, sameTenant } from "./_columns";
import { guests } from "./sessions";
import { outlets } from "./tenancy";
import type { DeliveryAddress } from "./delivery";
export const customerChallenges = mysqlTable("customer_challenges",{
 id:id(),tenantId:tenantId(),outletId:ref("outlet_id").notNull(),deviceHash:char("device_hash",{length:64}).notNull(),phone:varchar("phone",{length:15}).notNull(),codeHash:char("code_hash",{length:64}).notNull(),attempts:int("attempts").notNull().default(0),expiresAt:at("expires_at").notNull(),usedAt:at("used_at"),createdAt:createdAt(),
},t=>[index("customer_otp_phone_idx").on(t.tenantId,t.phone,t.createdAt),index("customer_otp_device_idx").on(t.tenantId,t.deviceHash,t.createdAt),sameTenant("customer_otp_outlet_fk",t,t.outletId,outlets)]);
export const customerSessions = mysqlTable("customer_sessions",{
 id:id(),tenantId:tenantId(),guestId:ref("guest_id").notNull(),tokenHash:char("token_hash",{length:64}).notNull(),expiresAt:at("expires_at").notNull(),createdAt:createdAt(),
},t=>[uniqueIndex("customer_session_token_uq").on(t.tokenHash),sameTenant("customer_session_guest_fk",t,t.guestId,guests)]);
export const customerProfiles = mysqlTable("customer_profiles",{
 id:id(),tenantId:tenantId(),guestId:ref("guest_id").notNull(),addresses:json("addresses").$type<(DeliveryAddress & {id:string;label:string})[]>().notNull(),
},t=>[tenantKey("customer_profiles",t),uniqueIndex("customer_profile_guest_uq").on(t.tenantId,t.guestId),sameTenant("customer_profile_guest_fk",t,t.guestId,guests)]);
