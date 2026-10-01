import "server-only";
import { and, asc, desc, eq, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { LOCK_THEN_READ } from "../db-types";
import { AppError } from "../errors";
import { lockSession } from "../billing/bill";
import { announceBill, requestBillInTransaction } from "../billing/payments";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import type { StaffContext } from "../staff/context";
import type { GuestContext } from "./context";

export const SERVICE_COOLDOWN_MS = 2 * 60_000;
export const SERVICE_ESCALATION_MS = 5 * 60_000;
export type ServiceKind = typeof s.serviceRequestKinds[number];
/** Also stored: the guest's choice on the bill to pay at the counter (G8) */
export type StoredServiceKind = typeof s.storedServiceRequestKinds[number];

/** One cooldown per table visit and kind, shared by every phone at the table. */
export async function getServiceRequests(ctx: GuestContext) {
  const rows = await db.select().from(s.serviceRequests)
    .where(and(eq(s.serviceRequests.tenantId, ctx.tenantId), eq(s.serviceRequests.outletId, ctx.outletId), eq(s.serviceRequests.sessionId, ctx.sessionId)))
    .orderBy(desc(s.serviceRequests.createdAt), desc(s.serviceRequests.id));
  return s.serviceRequestKinds.map((kind) => {
    const latest = rows.find((r) => r.kind === kind);
    return {
      kind,
      requestId: latest?.id ?? null,
      requestedAt: latest?.createdAt.getTime() ?? null,
      cooldownUntil: latest ? latest.createdAt.getTime() + SERVICE_COOLDOWN_MS : 0,
      status: latest?.status ?? null,
      escalated: !!latest?.escalatedAt,
    };
  });
}

export async function createServiceRequest(ctx: GuestContext, kind: StoredServiceKind, requestId: string, now = new Date()) {
  if (!s.storedServiceRequestKinds.includes(kind) || typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{8,64}$/.test(requestId)) {
    throw new AppError("invalid_state", "Choose a valid service request.");
  }
  const result = await db.transaction(async (tx) => {
    const session = await lockSession(tx, ctx);
    if (session.status === "closed") throw new AppError("session_expired", "This table has already been settled.");
    const [me] = await tx.select().from(s.participants)
      .where(and(eq(s.participants.tenantId, ctx.tenantId), eq(s.participants.sessionId, ctx.sessionId), eq(s.participants.id, ctx.participantId), isNull(s.participants.removedAt)))
      .for("update");
    if (!me || me.paidOutAt) throw new AppError("session_expired", "You have already left this table.");
    if (kind === "pay_at_counter" && session.status !== "bill_requested") {
      throw new AppError("invalid_state", "Request the bill first.", { reason: "not_requested" });
    }
    if (kind === "request_bill" && session.hostParticipantId !== ctx.participantId) {
      throw new AppError("invalid_state", "Only the table host can request the bill.", { reason: "host_only" });
    }
    const [replay] = await tx.select().from(s.serviceRequests)
      .where(and(eq(s.serviceRequests.tenantId, ctx.tenantId), eq(s.serviceRequests.sessionId, ctx.sessionId), eq(s.serviceRequests.clientRequestId, requestId)));
    if (replay) {
      if (replay.kind !== kind) throw new AppError("invalid_state", "This request was already used.");
      return { id: replay.id, createdAt: replay.createdAt.getTime(), replayed: true };
    }
    const [latest] = await tx.select().from(s.serviceRequests)
      .where(and(eq(s.serviceRequests.tenantId, ctx.tenantId), eq(s.serviceRequests.sessionId, ctx.sessionId), eq(s.serviceRequests.kind, kind)))
      .orderBy(desc(s.serviceRequests.createdAt), desc(s.serviceRequests.id)).limit(1);
    if (latest && now.getTime() < latest.createdAt.getTime() + SERVICE_COOLDOWN_MS) {
      return { id: latest.id, createdAt: latest.createdAt.getTime(), replayed: true };
    }
    // A pending task stays one task; pressing again after cooldown does not reset its escalation clock.
    const [pending] = await tx.select().from(s.serviceRequests)
      .where(and(eq(s.serviceRequests.tenantId, ctx.tenantId), eq(s.serviceRequests.sessionId, ctx.sessionId), eq(s.serviceRequests.kind, kind), eq(s.serviceRequests.status, "open")))
      .orderBy(asc(s.serviceRequests.createdAt)).limit(1);
    if (pending) return { id: pending.id, createdAt: pending.createdAt.getTime(), replayed: true };
    if (kind === "request_bill" && session.status === "bill_requested") {
      throw new AppError("table_settling", "The bill has already been requested.");
    }
    if (kind === "request_bill") await requestBillInTransaction(tx, ctx, now);
    const id = uuidv7();
    await tx.insert(s.serviceRequests).values({ id, tenantId: ctx.tenantId, outletId: ctx.outletId, sessionId: ctx.sessionId, tableId: ctx.tableId, participantId: ctx.participantId, kind, clientRequestId: requestId, createdAt: now });
    await tx.update(s.tableSessions).set({ lastActivityAt: now })
      .where(and(eq(s.tableSessions.tenantId, ctx.tenantId), eq(s.tableSessions.id, ctx.sessionId)));
    return { id, createdAt: now.getTime(), replayed: false };
  }, LOCK_THEN_READ);
  if (!result.replayed) {
    await publish(ctx, [
      { topic: topics.tasks, type: "service_request.created", data: { requestId: result.id, tableId: ctx.tableId } },
      { topic: topics.session(ctx.sessionId), type: "service_request.created", data: { requestId: result.id } },
    ]);
    if (kind === "request_bill") announceBill(ctx, { tableId: ctx.tableId, state: "bill_requested" });
  }
  return { ...result, cooldownUntil: result.createdAt + SERVICE_COOLDOWN_MS };
}

/** Internal staff domain function. No guest action exposes completion; staff auth must supply ctx. */
export async function completeServiceRequest(ctx: StaffContext, requestId: string, now = new Date()) {
  if (!ctx.userId) throw new AppError("invalid_state", "A signed-in staff member is required.");
  // Require an active user with this outlet's waiter/manager/owner scope, not a caller-supplied role.
  const [user] = await db.select().from(s.users)
    .where(and(eq(s.users.tenantId, ctx.tenantId), eq(s.users.id, ctx.userId)));
  const [role] = await db.select().from(s.staffRoles)
    .where(and(eq(s.staffRoles.tenantId, ctx.tenantId), eq(s.staffRoles.userId, ctx.userId), inArray(s.staffRoles.role, ["waiter", "manager", "owner"]), or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, ctx.outletId))));
  if (!user || !user.isActive || !role) {
    throw new AppError("invalid_state", "You cannot complete requests for this outlet.");
  }
  const request = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(s.serviceRequests)
      .where(and(eq(s.serviceRequests.tenantId, ctx.tenantId), eq(s.serviceRequests.outletId, ctx.outletId), eq(s.serviceRequests.id, requestId))).for("update");
    if (!row) throw new AppError("not_found", "This service request was not found.");
    if (row.status === "done") return null;
    await tx.update(s.serviceRequests).set({ status: "done", doneAt: now, doneByUserId: ctx.userId })
      .where(and(eq(s.serviceRequests.tenantId, ctx.tenantId), eq(s.serviceRequests.id, requestId)));
    return row;
  }, LOCK_THEN_READ);
  if (request) await publish(ctx, [
    { topic: topics.tasks, type: "service_request.done", data: { requestId } },
    { topic: topics.session(request.sessionId), type: "service_request.done", data: { requestId } },
  ]);
}

/** Called by the authenticated scheduled job, independent of whether any guest page is open. */
export async function escalateServiceRequests(scope: { tenantId: string; outletId: string }, now = new Date()) {
  const cutoff = new Date(now.getTime() - SERVICE_ESCALATION_MS);
  const changed = await db.transaction(async (tx) => {
    // Exclude closed visits before the limit, otherwise their old requests can starve active tables.
    const requests = await tx.select({ request: s.serviceRequests }).from(s.serviceRequests)
      .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, scope.tenantId), eq(s.tableSessions.id, s.serviceRequests.sessionId)))
      .where(and(eq(s.serviceRequests.tenantId, scope.tenantId), eq(s.serviceRequests.outletId, scope.outletId), eq(s.serviceRequests.status, "open"), isNull(s.serviceRequests.escalatedAt), lte(s.serviceRequests.createdAt, cutoff), ne(s.tableSessions.status, "closed")))
      .orderBy(asc(s.serviceRequests.createdAt)).limit(100).for("update");
    for (const { request: r } of requests) {
      await tx.update(s.serviceRequests).set({ escalatedAt: now })
        .where(and(eq(s.serviceRequests.tenantId, scope.tenantId), eq(s.serviceRequests.id, r.id)));
    }
    return requests.map(({ request }) => request);
  }, LOCK_THEN_READ);
  // The realtime Worker accepts at most 100 events; each task produces two.
  for (let offset = 0; offset < changed.length; offset += 50) {
    await publish(scope, changed.slice(offset, offset + 50).flatMap((r) => [
      { topic: topics.tasks, type: "service_request.escalated", data: { requestId: r.id, tableId: r.tableId } },
      { topic: topics.session(r.sessionId), type: "service_request.escalated", data: { requestId: r.id } },
    ]));
  }
  return changed.length;
}
