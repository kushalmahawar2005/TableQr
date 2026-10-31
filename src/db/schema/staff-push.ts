import { char, index, json, mysqlTable, uniqueIndex } from "drizzle-orm/mysql-core";
import { createdAt, id, ref, sameTenant, tenantId, updatedAt } from "./_columns";
import { outlets, users } from "./tenancy";

export type StaffPushSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
};

/** Browser push endpoints are per device; hash the endpoint for uniqueness without indexing a long URL. */
export const staffPushSubscriptions = mysqlTable(
  "staff_push_subscriptions",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: ref("outlet_id").notNull(),
    userId: ref("user_id").notNull(),
    /** The login that enabled push; revoked or expired sessions must stop receiving it. */
    sessionId: ref("session_id"),
    endpointHash: char("endpoint_hash", { length: 64 }).notNull(),
    subscription: json("subscription").$type<StaffPushSubscription>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("staff_push_endpoint_uq").on(t.endpointHash),
    index("staff_push_outlet_idx").on(t.tenantId, t.outletId),
    index("staff_push_user_idx").on(t.tenantId, t.userId),
    index("staff_push_session_idx").on(t.tenantId, t.sessionId),
    sameTenant("fk_staff_push_outlet", t, t.outletId, outlets),
    sameTenant("fk_staff_push_user", t, t.userId, users),
  ],
);
