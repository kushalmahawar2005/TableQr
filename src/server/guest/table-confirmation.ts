import "server-only";
import { and, eq, gt, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { uuidv7 } from "@/db/id";
import { checkFirstName } from "@/domain/guest-name";
import { OTP } from "@/domain/otp";
import { LOCK_THEN_READ, type Runner, type Tx } from "../db-types";
import { AppError } from "../errors";
import { releaseVisitTables, visitChanged } from "../floor/assignments";
import { tenantFeatures } from "../plan";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import type { StaffContext } from "../staff/context";
import { sendOutletPush } from "../staff/web-push";
import type { GuestContext } from "./context";
import { placeOrder } from "./order";

// A code proves the phone, not that its owner is at the table, and a saved link can order from home.
// Staff check a guest-opened table once; the cart waits here and reaches the kitchen on their accept.

type TrustedSession = { source: string; mode: string; openedByUserId: string | null; staffConfirmedAt: Date | null };

export async function tableIsTrusted(run: Runner, tenantId: string, sessionId: string, session: TrustedSession, now: Date) {
  if (session.staffConfirmedAt || session.openedByUserId || session.source !== "qr" || session.mode === "host_confirmed") return true;
  const phones = await run.select({ deviceId: s.participants.deviceId }).from(s.participants)
    .where(and(eq(s.participants.tenantId, tenantId), eq(s.participants.sessionId, sessionId), isNotNull(s.participants.deviceId), isNull(s.participants.removedAt)));
  const devices = phones.flatMap((phone) => phone.deviceId ? [phone.deviceId] : []);
  if (!devices.length) return false;
  const [code] = await run.select({ id: s.otpChallenges.id }).from(s.otpChallenges)
    .where(and(eq(s.otpChallenges.tenantId, tenantId), inArray(s.otpChallenges.deviceId, devices), gt(s.otpChallenges.verifiedAt, new Date(now.getTime() - OTP.skipHours * 3_600_000)))).limit(1);
  return !!code;
}

/** Keeps the cart and asks the waiter for this table, or the dashboard when there is no waiter app. */
export async function requestTableConfirmation(ctx: GuestContext, input: { requestId: string; name?: string }, now = new Date()) {
  const name = input.name ? checkFirstName(input.name) : null;
  const result = await db.transaction(async (tx) => {
    const [session] = await tx.select({ id: s.tableSessions.id }).from(s.tableSessions).where(and(eq(s.tableSessions.tenantId, ctx.tenantId), eq(s.tableSessions.id, ctx.sessionId))).for("update");
    if (!session) throw new AppError("session_expired", "Your table session has ended.");
    if (name?.ok) await tx.update(s.participants).set({ displayName: name.name }).where(and(eq(s.participants.tenantId, ctx.tenantId), eq(s.participants.id, ctx.participantId)));
    const [pending] = await tx.select({ id: s.serviceRequests.id }).from(s.serviceRequests)
      .where(and(eq(s.serviceRequests.tenantId, ctx.tenantId), eq(s.serviceRequests.sessionId, ctx.sessionId), eq(s.serviceRequests.participantId, ctx.participantId), eq(s.serviceRequests.kind, "confirm_order"), eq(s.serviceRequests.status, "open"))).limit(1);
    if (pending) return { id: pending.id, created: false };
    const id = uuidv7();
    await tx.insert(s.serviceRequests).values({ id, tenantId: ctx.tenantId, outletId: ctx.outletId, sessionId: ctx.sessionId, tableId: ctx.tableId, participantId: ctx.participantId, kind: "confirm_order", clientRequestId: input.requestId, createdAt: now });
    return { id, created: true };
  }, LOCK_THEN_READ);
  if (!result.created) return;
  await publish(ctx, [
    { topic: topics.tasks, type: "service_request.created", data: { requestId: result.id, tableId: ctx.tableId } },
    { topic: topics.session(ctx.sessionId), type: "service_request.created", data: { requestId: result.id } },
    visitChanged(ctx.sessionId, "service_request"),
  ]);
  const features = await tenantFeatures(ctx.tenantId, ctx.outletId);
  const message = { title: "Confirm table order", body: "A returning guest wants to order. Check they are at the table.", tag: `confirm-${result.id}` };
  void (features.waiterApp
    ? sendOutletPush(ctx, { ...message, url: "/waiter" }, { sessionId: ctx.sessionId, kind: "service" })
    : sendOutletPush(ctx, { ...message, url: "/console/dashboard" }, { kind: "management" }));
}

async function guestContextFor(tenantId: string, request: { outletId: string; tableId: string; sessionId: string; participantId: string }): Promise<GuestContext> {
  const [outlet] = await db.select({ brandId: s.outlets.brandId, timezone: s.outlets.timezone }).from(s.outlets).where(and(eq(s.outlets.tenantId, tenantId), eq(s.outlets.id, request.outletId)));
  if (!outlet) throw new AppError("not_found", "Business not found.");
  return { tenantId, ...outlet, ...request };
}

/** Staff saw the guest: the table is trusted from now on, and every waiting cart goes to the kitchen. */
export async function confirmTableOrder(ctx: StaffContext, tx: Tx, sessionId: string, now: Date) {
  await tx.update(s.tableSessions).set({ needsStaffCheck: false, staffConfirmedAt: now }).where(and(eq(s.tableSessions.tenantId, ctx.tenantId), eq(s.tableSessions.id, sessionId)));
  const waiting = await tx.select().from(s.serviceRequests)
    .where(and(eq(s.serviceRequests.tenantId, ctx.tenantId), eq(s.serviceRequests.sessionId, sessionId), eq(s.serviceRequests.kind, "confirm_order"), eq(s.serviceRequests.status, "open"))).for("update");
  await tx.update(s.serviceRequests).set({ status: "done", doneAt: now, doneByUserId: ctx.userId })
    .where(and(eq(s.serviceRequests.tenantId, ctx.tenantId), eq(s.serviceRequests.sessionId, sessionId), eq(s.serviceRequests.kind, "confirm_order"), eq(s.serviceRequests.status, "open")));
  return waiting;
}

/** Runs after the confirmation commits. A cart that cannot be placed stays with the guest to review. */
export async function placeConfirmedCarts(tenantId: string, waiting: { outletId: string; tableId: string; sessionId: string; participantId: string | null; clientRequestId: string | null }[], now: Date) {
  for (const request of waiting) {
    if (!request.participantId) continue;
    const ctx = await guestContextFor(tenantId, { ...request, participantId: request.participantId });
    await placeOrder(ctx, { requestId: request.clientRequestId ?? undefined }, now, { staffConfirmed: true }).catch((error: unknown) => {
      if (!(error instanceof AppError)) throw error;
    });
  }
}

/** Nobody is at this table: the phone leaves it, an empty visit frees the table, and the number can be blocked. */
export async function rejectTableOrder(ctx: StaffContext, requestId: string, opts: { block?: boolean } = {}, now = new Date()) {
  if (!ctx.userId) throw new AppError("invalid_state", "A signed-in staff member is required.");
  const scope = { tenantId: ctx.tenantId, outletId: ctx.outletId };
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(s.serviceRequests).where(and(eq(s.serviceRequests.tenantId, ctx.tenantId), eq(s.serviceRequests.outletId, ctx.outletId), eq(s.serviceRequests.id, requestId))).for("update");
    if (!row || row.kind !== "confirm_order") throw new AppError("not_found", "This request was not found.");
    if (row.status === "done") return null;
    await tx.update(s.serviceRequests).set({ status: "done", doneAt: now, doneByUserId: ctx.userId }).where(and(eq(s.serviceRequests.tenantId, ctx.tenantId), eq(s.serviceRequests.id, row.id)));
    const [person] = row.participantId ? await tx.select({ guestId: s.participants.guestId }).from(s.participants).where(and(eq(s.participants.tenantId, ctx.tenantId), eq(s.participants.id, row.participantId))) : [];
    if (row.participantId) {
      await tx.update(s.participants).set({ removedAt: now }).where(and(eq(s.participants.tenantId, ctx.tenantId), eq(s.participants.id, row.participantId)));
      await tx.delete(s.cartLines).where(and(eq(s.cartLines.tenantId, ctx.tenantId), eq(s.cartLines.sessionId, row.sessionId), eq(s.cartLines.participantId, row.participantId)));
    }
    if (opts.block && person?.guestId) await tx.update(s.guests).set({ blockedAt: now }).where(and(eq(s.guests.tenantId, ctx.tenantId), eq(s.guests.id, person.guestId)));
    const [others] = await tx.select({ id: s.participants.id }).from(s.participants).where(and(eq(s.participants.tenantId, ctx.tenantId), eq(s.participants.sessionId, row.sessionId), isNull(s.participants.removedAt), row.participantId ? ne(s.participants.id, row.participantId) : undefined)).limit(1);
    const [order] = await tx.select({ id: s.orders.id }).from(s.orders).where(and(eq(s.orders.tenantId, ctx.tenantId), eq(s.orders.sessionId, row.sessionId))).limit(1);
    const emptied = !others && !order;
    if (emptied) {
      await tx.update(s.tableSessions).set({ status: "closed", openKey: null, closedAt: now }).where(and(eq(s.tableSessions.tenantId, ctx.tenantId), eq(s.tableSessions.id, row.sessionId)));
      await releaseVisitTables(tx, ctx.tenantId, row.sessionId, now);
      await tx.update(s.diningTables).set({ state: "available", stateChangedAt: now }).where(and(eq(s.diningTables.tenantId, ctx.tenantId), eq(s.diningTables.id, row.tableId)));
    }
    await tx.insert(s.auditLog).values({ tenantId: ctx.tenantId, outletId: ctx.outletId, actorLabel: "staff", actorUserId: ctx.userId, action: "table.order_rejected", entity: "service_request", entityId: row.id, after: { blocked: !!opts.block, tableFreed: emptied }, createdAt: now });
    return row;
  }, LOCK_THEN_READ);
  if (!result) return;
  await publish(scope, [
    { topic: topics.tasks, type: "service_request.done", data: { requestId } },
    { topic: topics.session(result.sessionId), type: "participant.removed", data: { participantId: result.participantId } },
    { topic: topics.floor, type: "visit.updated" },
    visitChanged(result.sessionId, "service_request"),
  ]);
}

/** Staff lift or set the block from the customer list. */
export async function setGuestBlocked(ctx: StaffContext, guestId: string, blocked: boolean, now = new Date()) {
  await db.update(s.guests).set({ blockedAt: blocked ? now : null }).where(and(eq(s.guests.tenantId, ctx.tenantId), eq(s.guests.id, guestId)));
  await db.insert(s.auditLog).values({ tenantId: ctx.tenantId, outletId: ctx.outletId, actorLabel: "staff", actorUserId: ctx.userId, action: blocked ? "guest.blocked" : "guest.unblocked", entity: "guest", entityId: guestId, createdAt: now });
}
