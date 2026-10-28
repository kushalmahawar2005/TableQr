import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/server/db-types";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import type { Scope } from "./visits";

export function staffOpenRequestFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function validateStaffOpenRequestId(value: unknown) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,64}$/.test(value)) {
    throw new AppError("invalid_state", "This POS session request is not valid.");
  }
  return value;
}

export async function findStaffOpenRequest(tx: Tx, scope: Scope, requestId: string, userId: string, fingerprint: string) {
  const [session] = await tx.select().from(s.tableSessions)
    .where(and(eq(s.tableSessions.tenantId, scope.tenantId), eq(s.tableSessions.outletId, scope.outletId), eq(s.tableSessions.staffRequestId, requestId)))
    .for("update");
  if (!session) return null;
  if (session.openedByUserId !== userId || session.staffRequestFingerprint !== fingerprint) {
    throw new AppError("conflict", "This POS request id was already used for a different session.", { reason: "request_id_reused" });
  }
  return session;
}
