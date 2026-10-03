import "server-only";
import { eq } from "drizzle-orm";
import type { Runner } from "../db-types";
import * as s from "@/db/schema";
import { AppError } from "../errors";
export async function outletScope(run: Runner, outletCode: string) { // isolation-exempt: public outlet code resolves the tenant before scoped operations.
  const [o] = await run.select({ tenantId: s.outlets.tenantId, outletId: s.outlets.id, outletCode: s.outlets.code, name: s.outlets.name }).from(s.outlets).where(eq(s.outlets.code, String(outletCode).trim().toUpperCase())); if (!o) throw new AppError("not_found", "We could not find this restaurant."); return o; }
