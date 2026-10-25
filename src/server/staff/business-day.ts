import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { dayCutoffMinutes } from "@/domain/hours";

/** Minutes after midnight when this outlet's business day ends; 0 unless it stays open past midnight */
export async function outletDayCutoff(tenantId: string, outletId: string): Promise<number> {
  const [row] = await db.select({ hours: s.outlets.openingHours }).from(s.outlets)
    .where(and(eq(s.outlets.tenantId, tenantId), eq(s.outlets.id, outletId)));
  return dayCutoffMinutes(row?.hours ?? null);
}
