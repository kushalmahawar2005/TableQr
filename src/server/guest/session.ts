import "server-only";
import { timingSafeEqual } from "node:crypto";
import { and, count, eq, gte, isNull, min } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { placeholderName } from "@/domain/guest-name";
import { LOCK_THEN_READ, type Tx } from "../db-types";
import { AppError } from "../errors";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import { assignTable, visitChanged } from "../floor/assignments";
import { assertCanSeat, findMovedSession, findOpenSession, findTableByQr, wasRemoved } from "./table";
import { tableIsTrusted } from "./table-confirmation";
import { findRecentVerification } from "./verify";
import { ROOM_CLASS } from "@/domain/rooms";
import { shiftWaiterId } from "../staff/waiter-coverage";

// Start ordering / Join this table (PS 3.2, 3.6). One open session per table.

type SeatInput = {
  outletCode: string;
  shortCode: string;
  deviceId: string;
  displayName?: string;
  /** The signed-in customer on this phone; they verified once and need no new code */
  customer?: { guestId: string; name: string } | null;
  /** Host-confirmed mode only: the table's 4-digit code, checked here on the server */
  joinCode?: string;
  now?: Date;
};
type Seated = { sessionId: string; participantId: string; isHost: boolean; isNew: boolean };

export async function startOrJoinTable(input: Omit<SeatInput, "joinCode">): Promise<Seated> {
  const res = await seat(input);
  if ("refused" in res) throw new AppError("invalid_state", "This table needs its code to join.");
  return res;
}

export type CodeJoin = ({ ok: true } & Seated) | { ok: false; error: "invalid" } | JoinCodeRefusal;

/**
 * Join this table with its code (Host-confirmed mode, G1). Joins only a session staff have
 * already opened; it never opens one. A wrong code counts towards the guessing limits.
 * Table problems (closed, settling, no open session, removed) throw like Start ordering.
 */
export async function joinTableWithCode(input: Omit<SeatInput, "displayName"> & { joinCode: string }): Promise<CodeJoin> {
  const code = String(input.joinCode ?? "").trim();
  if (!/^\d{4}$/.test(code)) return { ok: false, error: "invalid" };
  const res = await seat({ ...input, joinCode: code });
  return "refused" in res ? res.refused : { ok: true, ...res };
}

async function seat(input: SeatInput): Promise<Seated | { refused: JoinCodeRefusal }> {
  const now = input.now ?? new Date();
  let where: { tenantId: string; outletId: string; tableId: string } | null = null;

  const res = await db.transaction(async (tx) => {
    const t = await findTableByQr(tx, input.outletCode, input.shortCode);
    const tenantId = t.outlet.tenantId;
    where = { tenantId, outletId: t.outlet.id, tableId: t.table.id };

    // Serialise concurrent scans on the same table so only one session is ever opened
    const [table] = await tx
      .select({ state: s.diningTables.state, joinCode: s.diningTables.joinCode })
      .from(s.diningTables)
      .where(and(eq(s.diningTables.tenantId, tenantId), eq(s.diningTables.id, t.table.id)))
      .for("update");

    const open = await findOpenSession(tx, tenantId, t.table.id);
    // A room orders only while a guest is checked in; the QR is inside the room, so no code or OTP
    const stay = t.table.tableClass === ROOM_CLASS ? await roomStayAt(tx, tenantId, t.table.id) : null;
    if (t.table.tableClass === ROOM_CLASS && !stay) throw new AppError("table_not_open", "This room is not checked in. Please call reception.");

    // Guests can browse the menu before sharing their number. OTP is enforced atomically when an
    // order is placed; recent verification still restores the guest identity on this device/table.
    const recent = !stay ? await findRecentVerification(tx, tenantId, input.deviceId, now) : null;
    const verified = recent ?? (stay ? null : input.customer ?? null);
    // A sign-in lasts months and can order from anywhere, so it does not prove this phone is here.
    const signInOnly = !!input.customer && !recent && !stay && (!open || !await tableIsTrusted(tx, tenantId, open.session.id, open.session, now));
    // A code proves the phone, not the table, so the first order of a guest-opened table waits for staff.
    const checkEveryTable = t.outlet.confirmFirstTableOrder && !stay && t.outlet.sessionMode !== "host_confirmed";
    if (open && (signInOnly || (recent && open.session.needsStaffCheck && !checkEveryTable))) {
      await tx.update(s.tableSessions).set({ needsStaffCheck: signInOnly }).where(and(eq(s.tableSessions.tenantId, tenantId), eq(s.tableSessions.id, open.session.id)));
    }

    const existing = open?.people.find((p) => p.deviceId === input.deviceId);
    if (existing && open!.session.status === "open") {
      if (verified) await tx.update(s.participants).set({ guestId: verified.guestId, displayName: verified.name }).where(and(eq(s.participants.tenantId, tenantId), eq(s.participants.id, existing.id)));
      return {
        sessionId: open!.session.id,
        participantId: existing.id,
        isHost: open!.session.hostParticipantId === existing.id,
        isNew: false,
        changed: false,
      };
    }
    // The host moved this phone's party to another table (S1): back into its own visit, never a new one here
    if (!existing) {
      const moved = await findMovedSession(tx, tenantId, t.table.id, input.deviceId);
      const mine = moved?.people.find((p) => p.deviceId === input.deviceId);
      if (moved && mine && moved.session.status === "open") {
        if (verified) await tx.update(s.participants).set({ guestId: verified.guestId, displayName: verified.name }).where(and(eq(s.participants.tenantId, tenantId), eq(s.participants.id, mine.id)));
        return { sessionId: moved.session.id, participantId: mine.id, isHost: moved.session.hostParticipantId === mine.id, isNew: false, changed: false };
      }
    }
    // Removed by the host: this phone stays out for the rest of the session (G7)
    if (open && (await wasRemoved(tx, tenantId, open.session.id, input.deviceId))) {
      throw new AppError("participant_removed", "You were removed from this table. Please ask staff if you need help.");
    }
    assertCanSeat(t, table.state, open, now);

    // Host-confirmed mode: the table's code, given by the host or waiter, joins a session staff opened
    if (t.outlet.sessionMode === "host_confirmed" && !stay) {
      if (input.joinCode === undefined) {
        throw new AppError("verification_required", "Please ask staff to join this table.", { mode: t.outlet.sessionMode });
      }
      if (!open || open.session.status !== "open") {
        throw new AppError("table_not_open", "This table is not open for joining. Please ask staff.");
      }
      const check = await checkJoinCode(tx, { tenantId, tableId: t.table.id, deviceId: input.deviceId }, input.joinCode, table.joinCode, now);
      if (check) return { refused: check };
    }

    // Legacy bookings without a bound phone still have a bill participant for their preorder.
    // The first scanner adopts that unverified row; OTP is still required before placing an order.
    const preorderGuest = open?.session.source === "reservation" && !open.session.hostParticipantId && open.people.length === 1 ? open.people[0] : null;
    if (preorderGuest && !preorderGuest.deviceId && !preorderGuest.guestId) {
      await tx.update(s.participants).set({ deviceId: input.deviceId, guestId: verified?.guestId ?? null, displayName: verified?.name ?? preorderGuest.displayName }).where(and(eq(s.participants.tenantId, tenantId), eq(s.participants.id, preorderGuest.id)));
      await tx.update(s.tableSessions).set({ hostParticipantId: preorderGuest.id }).where(and(eq(s.tableSessions.tenantId, tenantId), eq(s.tableSessions.id, open!.session.id)));
      return { sessionId: open!.session.id, participantId: preorderGuest.id, isHost: true, isNew: false, changed: true };
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
        waiterUserId: await shiftWaiterId(tx, { tenantId, outletId: t.outlet.id }, t.table.id, now),
        mode: t.outlet.sessionMode,
        needsStaffCheck: signInOnly || checkEveryTable,
        openKey: t.table.id,
        openedAt: now,
        lastActivityAt: now,
        ...(stay ? { guestName: stay.guestName, partySize: stay.guests } : {}),
      });
      await assignTable(tx, { tenantId, outletId: t.outlet.id, sessionId }, t.table.id, { primary: true, now });
    }

    const participantId = uuidv7();
    const count = open?.people.length ?? 0;
    const name = verified?.name ?? (input.displayName?.trim().slice(0, 40) || (stay ? stay.guestName.split(" ")[0].slice(0, 40) : placeholderName(count + 1)));
    await tx.insert(s.participants).values({
      id: participantId,
      tenantId,
      sessionId,
      displayName: name,
      guestId: verified?.guestId,
      deviceId: input.deviceId,
      joinedAt: now,
    });

    // The first phone becomes host: of a new visit, or of one staff opened with nobody in it yet (S1).
    // Only one join can win the "no host yet" update, even from two tables combined into one visit.
    const [won] = await tx
      .update(s.tableSessions)
      .set({ hostParticipantId: participantId })
      .where(and(eq(s.tableSessions.tenantId, tenantId), eq(s.tableSessions.id, sessionId), isNull(s.tableSessions.hostParticipantId)));
    const isHost = won.affectedRows === 1;
    if (isNew) {
      await tx
        .update(s.diningTables)
        .set({ state: "seated", stateChangedAt: now })
        .where(and(eq(s.diningTables.tenantId, tenantId), eq(s.diningTables.id, t.table.id)));
    }

    return { sessionId, participantId, isHost, isNew, changed: true };
  }, LOCK_THEN_READ);

  if ("refused" in res) return res;
  // A returning phone changes nothing, so it announces nothing
  const w = where as { tenantId: string; outletId: string; tableId: string } | null;
  if (w && res.changed) {
    void publish({ tenantId: w.tenantId, outletId: w.outletId }, [
      { topic: topics.session(res.sessionId), type: "participant.joined", data: { participantId: res.participantId } },
      ...(res.isNew ? [{ topic: topics.floor, type: "table.state_changed", data: { tableId: w.tableId, state: "seated" } }] : []),
      visitChanged(res.sessionId, "participant_joined"),
    ]);
  }
  return { sessionId: res.sessionId, participantId: res.participantId, isHost: res.isHost, isNew: res.isNew };
}

/** The guest checked in to the room behind this hidden counter, if any */
async function roomStayAt(tx: Tx, tenantId: string, tableId: string) {
  const [row] = await tx
    .select({ guestName: s.roomStays.guestName, guests: s.roomStays.guests })
    .from(s.rooms)
    .innerJoin(s.roomStays, and(eq(s.roomStays.tenantId, s.rooms.tenantId), eq(s.roomStays.openKey, s.rooms.id)))
    .where(and(eq(s.rooms.tenantId, tenantId), eq(s.rooms.tableId, tableId), eq(s.rooms.isActive, true)));
  return row ?? null;
}

/** Guessing limits for table codes: per phone and per table, over a rolling 10 minutes */
export const JOIN_CODE = { windowSeconds: 600, perDevice: 5, perTable: 20 } as const;

export type JoinCodeRefusal = { ok: false; error: "wrong"; attemptsLeft: number } | { ok: false; error: "locked"; retryIn: number };

/** Null when the code is right; otherwise why not. A wrong code is recorded, the code never is. */
async function checkJoinCode(
  tx: Tx,
  where: { tenantId: string; tableId: string; deviceId: string },
  given: string,
  actual: string,
  now: Date,
): Promise<JoinCodeRefusal | null> {
  const since = new Date(now.getTime() - JOIN_CODE.windowSeconds * 1000);
  const recent = (byDevice: boolean) =>
    tx
      .select({ n: count(), first: min(s.joinCodeAttempts.createdAt) })
      .from(s.joinCodeAttempts)
      .where(
        and(
          eq(s.joinCodeAttempts.tenantId, where.tenantId),
          eq(s.joinCodeAttempts.tableId, where.tableId),
          byDevice ? eq(s.joinCodeAttempts.deviceId, where.deviceId) : undefined,
          gte(s.joinCodeAttempts.createdAt, since),
        ),
      );
  const [[mine], [all]] = await Promise.all([recent(true), recent(false)]);
  const retryIn = (first: Date | null) =>
    Math.max(1, Math.ceil(((first?.getTime() ?? now.getTime()) + JOIN_CODE.windowSeconds * 1000 - now.getTime()) / 1000));
  if (mine.n >= JOIN_CODE.perDevice) return { ok: false, error: "locked", retryIn: retryIn(mine.first) };
  if (all.n >= JOIN_CODE.perTable) return { ok: false, error: "locked", retryIn: retryIn(all.first) };

  const a = Buffer.from(given);
  const b = Buffer.from(actual);
  if (a.length === b.length && timingSafeEqual(a, b)) return null;

  await tx.insert(s.joinCodeAttempts).values({ tenantId: where.tenantId, tableId: where.tableId, deviceId: where.deviceId, createdAt: now });
  const attemptsLeft = JOIN_CODE.perDevice - mine.n - 1;
  return attemptsLeft > 0 ? { ok: false, error: "wrong", attemptsLeft } : { ok: false, error: "locked", retryIn: JOIN_CODE.windowSeconds };
}
