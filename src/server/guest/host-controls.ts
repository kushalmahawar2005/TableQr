import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { lockSession } from "../billing/bill";
import { LOCK_THEN_READ, type Tx } from "../db-types";
import { AppError } from "../errors";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import type { GuestContext } from "./context";

// Host controls (G7, PS 3.6): pause or resume ordering, remove someone, pass host. Only the
// current host, while still at the table, can use them, and only while the table is ordering.
// Each runs under the session row lock, so two phones can never both win a race.

type Locked = Awaited<ReturnType<typeof lockSession>>;

const hostOnly = () => new AppError("invalid_state", "Only the table host can do this.", { reason: "host_only" });

/** Locks the session and checks the caller is its current, active host */
async function lockAsHost(tx: Tx, ctx: GuestContext): Promise<Locked> {
  const session = await lockSession(tx, ctx);
  if (session.status === "closed") throw new AppError("session_expired", "This table has already been settled.");
  if (session.status === "bill_requested") {
    throw new AppError("table_settling", "The bill has been requested, so the table cannot be changed now.");
  }
  const [me] = await tx
    .select({ id: s.participants.id, paidOutAt: s.participants.paidOutAt })
    .from(s.participants)
    .where(
      and(
        eq(s.participants.tenantId, ctx.tenantId),
        eq(s.participants.sessionId, ctx.sessionId),
        eq(s.participants.id, ctx.participantId),
        isNull(s.participants.removedAt),
      ),
    )
    .for("update");
  if (!me || me.paidOutAt) throw new AppError("session_expired", "You have already left this table.");
  if (session.hostParticipantId !== ctx.participantId) throw hostOnly();
  return session;
}

/** The person the host acts on: someone else, still at this table, not paid and left */
async function lockTarget(tx: Tx, ctx: GuestContext, targetId: string) {
  if (typeof targetId !== "string" || !targetId) throw new AppError("not_found", "This person is not at your table.");
  if (targetId === ctx.participantId) {
    throw new AppError("invalid_state", "You cannot do this to yourself.", { reason: "self" });
  }
  const [target] = await tx
    .select()
    .from(s.participants)
    .where(and(eq(s.participants.tenantId, ctx.tenantId), eq(s.participants.sessionId, ctx.sessionId), eq(s.participants.id, targetId)))
    .for("update");
  if (!target) throw new AppError("not_found", "This person is not at your table.");
  return target;
}

const touch = (tx: Tx, ctx: GuestContext, now: Date, set: Partial<typeof s.tableSessions.$inferInsert> = {}) =>
  tx
    .update(s.tableSessions)
    .set({ ...set, lastActivityAt: now })
    .where(and(eq(s.tableSessions.tenantId, ctx.tenantId), eq(s.tableSessions.id, ctx.sessionId)));

/** Pause (true) or resume (false) new orders for everyone at the table. Repeating it is harmless. */
export async function setOrderingLocked(ctx: GuestContext, locked: boolean, now = new Date()) {
  if (typeof locked !== "boolean") throw new AppError("invalid_state", "Choose pause or resume.");
  const changed = await db.transaction(async (tx) => {
    const session = await lockAsHost(tx, ctx);
    if (session.orderingLocked === locked) return false;
    await touch(tx, ctx, now, { orderingLocked: locked });
    return true;
  }, LOCK_THEN_READ);
  if (changed) {
    await publish(ctx, [{ topic: topics.session(ctx.sessionId), type: "session.updated", data: { change: locked ? "ordering_paused" : "ordering_resumed" } }]);
  }
  return { orderingLocked: locked, changed };
}

/**
 * Removes someone for the rest of this session. Their unplaced cart goes, and they drop out of
 * anyone's unplaced shared lines. Placed orders, and anything already billed, stay as they are.
 */
export async function removeParticipant(ctx: GuestContext, targetId: string, now = new Date()) {
  const changed = await db.transaction(async (tx) => {
    await lockAsHost(tx, ctx);
    const target = await lockTarget(tx, ctx, targetId);
    if (target.removedAt) return false;
    if (target.paidOutAt) {
      throw new AppError("invalid_state", "This person has already paid and left.", { reason: "paid_out" });
    }
    await tx
      .update(s.participants)
      .set({ removedAt: now })
      .where(and(eq(s.participants.tenantId, ctx.tenantId), eq(s.participants.id, target.id)));
    await tx
      .delete(s.cartLines)
      .where(and(eq(s.cartLines.tenantId, ctx.tenantId), eq(s.cartLines.sessionId, ctx.sessionId), eq(s.cartLines.participantId, target.id)));
    const shared = await tx
      .select({ id: s.cartLines.id, sharedWith: s.cartLines.sharedWith })
      .from(s.cartLines)
      .where(and(eq(s.cartLines.tenantId, ctx.tenantId), eq(s.cartLines.sessionId, ctx.sessionId)))
      .for("update");
    for (const line of shared) {
      if (!line.sharedWith?.includes(target.id)) continue;
      const rest = line.sharedWith.filter((id) => id !== target.id);
      await tx
        .update(s.cartLines)
        .set({ sharedWith: rest.length > 1 ? rest : null })
        .where(and(eq(s.cartLines.tenantId, ctx.tenantId), eq(s.cartLines.id, line.id)));
    }
    await touch(tx, ctx, now);
    return true;
  }, LOCK_THEN_READ);
  if (changed) {
    await publish(ctx, [
      { topic: topics.session(ctx.sessionId), type: "participant.removed", data: { participantId: targetId } },
      { topic: topics.session(ctx.sessionId), type: "cart.updated" },
    ]);
  }
  return { changed };
}

/** Hands host to someone else at the table. Exactly one host before and after. */
export async function passHost(ctx: GuestContext, targetId: string, now = new Date()) {
  await db.transaction(async (tx) => {
    await lockAsHost(tx, ctx);
    const target = await lockTarget(tx, ctx, targetId);
    if (target.removedAt) throw new AppError("invalid_state", "This person is no longer at your table.", { reason: "removed" });
    if (target.paidOutAt) {
      throw new AppError("invalid_state", "This person has already paid and left.", { reason: "paid_out" });
    }
    await touch(tx, ctx, now, { hostParticipantId: target.id });
  }, LOCK_THEN_READ);
  await publish(ctx, [{ topic: topics.session(ctx.sessionId), type: "session.updated", data: { change: "host_changed" } }]);
}
