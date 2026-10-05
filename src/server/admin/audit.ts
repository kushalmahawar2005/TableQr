import "server-only";

import { desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import type { AuditData } from "@/app/admin/admin-types";
import { requirePlatformAdmin } from "./auth";

const LIMIT = 500;

/** Latest audit entries across tenants, last 90 days: staff changes, system events and platform-admin changes. */
export async function getAuditData(): Promise<AuditData> {
  await requirePlatformAdmin();
  const since = new Date(Date.now() - 90 * 86_400_000);
  // isolation-exempt: authenticated platform admins read the cross-tenant audit trail.
  const rows = await db.select({
    id: s.auditLog.id, createdAt: s.auditLog.createdAt, tenantName: s.tenants.name, actorLabel: s.auditLog.actorLabel, action: s.auditLog.action,
    entity: s.auditLog.entity, reason: s.auditLog.reason, before: s.auditLog.before, after: s.auditLog.after,
  }).from(s.auditLog).innerJoin(s.tenants, eq(s.auditLog.tenantId, s.tenants.id)).where(gte(s.auditLog.createdAt, since)).orderBy(desc(s.auditLog.createdAt)).limit(LIMIT + 1);
  return { entries: rows.slice(0, LIMIT).map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })), truncated: rows.length > LIMIT };
}
