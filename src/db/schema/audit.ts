import { index, json, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { createdAt, id, ref, tenantId } from "./_columns";
import { tenants } from "./tenancy";

/** Append-only record of voids, discounts, refunds, PIN use and settings changes */
export const auditLog = mysqlTable(
  "audit_log",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    outletId: ref("outlet_id"),
    actorUserId: ref("actor_user_id"),
    /** Readable actor for rows not made by a staff user, e.g. "guest:Aarav" or "system" */
    actorLabel: varchar("actor_label", { length: 80 }).notNull(),
    action: varchar("action", { length: 60 }).notNull(),
    entity: varchar("entity", { length: 40 }).notNull(),
    entityId: ref("entity_id"),
    before: json("before"),
    after: json("after"),
    reason: varchar("reason", { length: 200 }),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("audit_log_entity_idx").on(t.entity, t.entityId),
  ],
);
