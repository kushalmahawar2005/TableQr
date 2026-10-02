import "server-only";
import * as s from "@/db/schema";
import type { Runner } from "../db-types";

// Append-only trail of staff floor and booking changes (PS 7.5): who, what, before and after.

export async function audit(
  run: Runner,
  staff: { tenantId: string; outletId: string; userId: string; name: string },
  entry: { action: string; entity: string; entityId: string | null; before?: unknown; after?: unknown; reason?: string | null; now: Date },
) {
  await run.insert(s.auditLog).values({
    tenantId: staff.tenantId,
    outletId: staff.outletId,
    actorUserId: staff.userId,
    actorLabel: `staff:${staff.name}`.slice(0, 80),
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason?.slice(0, 200) ?? null,
    createdAt: entry.now,
  });
}
