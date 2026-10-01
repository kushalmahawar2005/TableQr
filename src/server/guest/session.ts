import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { placeholderName } from "@/domain/guest-name";
import { LOCK_THEN_READ } from "../db-types";
import { AppError } from "../errors";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import { assertCanSeat, findOpenSession, findTableByQr, wasRemoved } from "./table";
import { findRecentVerification } from "./verify";

// Start ordering / Join this table (PS 3.2, 3.6). One open session per table.

export async function startOrJoinTable(input: {
  outletCode: string;
  shortCode: string;
  deviceId: string;
  displayName?: string;
  now?: Date;
}): Promise<{ sessionId: string; participantId: string; isHost: boolean; isNew: boolean }> {
  const now = input.now ?? new Date();
  let where: { tenantId: string; outletId: string; tableId: string } | null = null;

  const res = await db.transaction(async (tx) => {
    const t = await findTableByQr(tx, input.outletCode, input.shortCode);
    const tenantId = t.outlet.tenantId;
    where = { tenantId, outletId: t.outlet.id, tableId: t.table.id };

    // Serialise concurrent scans on the same table so only one session is ever opened
    const [table] = await tx
      .select({ state: s.diningTables.state })
      .from(s.diningTables)
      .where(and(eq(s.diningTables.tenantId, tenantId), eq(s.diningTables.id, t.table.id)))
      .for("update");

    const open = await findOpenSession(tx, tenantId, t.table.id);

    const existing = open?.people.find((p) => p.deviceId === input.deviceId);
    if (existing && open!.session.status === "open") {
      return {
        sessionId: open!.session.id,
        participantId: existing.id,
        isHost: open!.session.hostParticipantId === existing.id,
        isNew: false,
        changed: false,
      };
    }
    // Removed by the host: this phone stays out for the rest of the session (G7)
    if (open && (await wasRemoved(tx, tenantId, open.session.id, input.deviceId))) {
      throw new AppError("participant_removed", "You were removed from this table. Please ask staff if you need help.");
    }
    assertCanSeat(t, table.state, open, now);

    // Verified mode: this phone confirmed its number at this table within the last 12 hours
    // (G2). Host-confirmed joining arrives with the staff code flow.
    const verified =
      t.outlet.sessionMode === "verified" ? await findRecentVerification(tx, tenantId, t.table.id, input.deviceId, now) : null;
    if (t.outlet.sessionMode !== "open" && !verified) {
      throw new AppError("verification_required", "Please verify your number to order at this table.", {
        mode: t.outlet.sessionMode,
      });
    }

    let sessionId = open?.session.id;
    const isNew = !sessionId;
    if (!sessionId) {
      sessionId = uuidv7();
      await tx.insert(s.tableSessions).values({
        id: sessionId,
        tenantId,
        outletId: t.outlet.id,
        tableId: t.table.id,
        mode: t.outlet.sessionMode,
        openKey: t.table.id,
        openedAt: now,
        lastActivityAt: now,
      });
    }

    const participantId = uuidv7();
    const count = open?.people.length ?? 0;
    const name = verified?.name ?? (input.displayName?.trim().slice(0, 40) || placeholderName(count + 1));
    await tx.insert(s.participants).values({
      id: participantId,
      tenantId,
      sessionId,
      displayName: name,
      guestId: verified?.guestId,
      deviceId: input.deviceId,
      joinedAt: now,
    });

    if (isNew) {
      await tx
        .update(s.tableSessions)
        .set({ hostParticipantId: participantId })
        .where(and(eq(s.tableSessions.tenantId, tenantId), eq(s.tableSessions.id, sessionId)));
      await tx
        .update(s.diningTables)
        .set({ state: "seated" })
        .where(and(eq(s.diningTables.tenantId, tenantId), eq(s.diningTables.id, t.table.id)));
    }

    return { sessionId, participantId, isHost: isNew, isNew, changed: true };
  }, LOCK_THEN_READ);

  // A returning phone changes nothing, so it announces nothing
  const w = where as { tenantId: string; outletId: string; tableId: string } | null;
  if (w && res.changed) {
    void publish({ tenantId: w.tenantId, outletId: w.outletId }, [
      { topic: topics.session(res.sessionId), type: "participant.joined", data: { participantId: res.participantId } },
      ...(res.isNew ? [{ topic: topics.floor, type: "table.state_changed", data: { tableId: w.tableId, state: "seated" } }] : []),
    ]);
  }
  return { sessionId: res.sessionId, participantId: res.participantId, isHost: res.isHost, isNew: res.isNew };
}
