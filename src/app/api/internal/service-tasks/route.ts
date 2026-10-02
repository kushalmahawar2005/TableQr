import { reconcileFloor } from "@/server/floor/sync";
import { timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { reconcilePendingPayments } from "@/server/billing/payments";
import { escalateServiceRequests } from "@/server/guest/service-requests";

/** Server-to-server cron callback. Never authorised by guest cookies or client-supplied tenant ids. */
export async function POST(request: Request) {
  const secret = process.env.SERVICE_TASK_SECRET;
  if (!secret) return Response.json({ error: "Scheduler not configured" }, { status: 503 });
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // isolation-exempt: authenticated system job enumerates tenant ids, then scopes every task query
  const tenants = await db.select({ tenantId: s.tenants.id }).from(s.tenants);
  let escalated = 0;
  let failedOutlets = 0;
  const now = new Date();
  for (const { tenantId } of tenants) {
    const outlets = await db.select({ outletId: s.outlets.id }).from(s.outlets)
      .where(and(eq(s.outlets.tenantId, tenantId)));
    for (const { outletId } of outlets) {
      try {
        escalated += await escalateServiceRequests({ tenantId, outletId }, now);
        // Pending payments are re-checked with the gateway every minute (PS 6.4)
        await reconcilePendingPayments({ tenantId, outletId }, now);
        // Held/Reserved follow the clock; expired online holds and timed blocks are released (S1)
        await reconcileFloor({ tenantId, outletId }, now);
      } catch (error) {
        // One outlet's transient failure must not prevent later outlets from receiving escalation.
        failedOutlets += 1;
        console.error("[service-tasks] outlet escalation failed", { tenantId, outletId, error });
      }
    }
  }
  return Response.json({ escalated, failedOutlets }, { status: failedOutlets ? 503 : 200 });
}
