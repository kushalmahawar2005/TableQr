import "server-only";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { isPlaceholderName } from "@/domain/guest-name";
import { isOpenAt, openingInfo } from "@/domain/hours";
import { AppError } from "../errors";
import type { Runner } from "../db-types";

// Resolving a table QR (/r/<outlet>/t/<code>) and deciding what the guest sees first (PS 3.2).

export type ResolvedTable = NonNullable<Awaited<ReturnType<typeof resolveQr>>>;

/**
 * Looks up outlet, table and tenant from the QR address without judging it. Everything later is
 * scoped by the tenant found here, so a guest can never reach another restaurant's rows.
 */
async function resolveQr(run: Runner, outletCode: string, shortCode: string) {
  // isolation-exempt: this is where the tenant is resolved, from the public outlet code
  const [row] = await run
    .select({
      tenantStatus: s.tenants.status,
      planFeatures: s.plans.features,
      logoUrl: s.brands.logoUrl,
      outlet: {
        id: s.outlets.id,
        tenantId: s.outlets.tenantId,
        brandId: s.outlets.brandId,
        code: s.outlets.code,
        name: s.outlets.name,
        city: s.outlets.city,
        timezone: s.outlets.timezone,
        openingHours: s.outlets.openingHours,
        accentColor: s.outlets.accentColor,
        sessionMode: s.outlets.sessionMode,
        autoAcceptOrders: s.outlets.autoAcceptOrders,
        newSessionCapPaise: s.outlets.newSessionCapPaise,
        soldOutDisplay: s.outlets.soldOutDisplay,
      },
      table: {
        id: s.diningTables.id,
        code: s.diningTables.code,
        maxSeats: s.diningTables.maxSeats,
        state: s.diningTables.state,
      },
      zoneName: s.zones.name,
      qrRevokedAt: s.qrCodes.revokedAt,
    })
    .from(s.qrCodes)
    .innerJoin(s.outlets, eq(s.outlets.id, s.qrCodes.outletId))
    .innerJoin(s.tenants, eq(s.tenants.id, s.outlets.tenantId))
    .innerJoin(s.plans, eq(s.plans.code, s.tenants.planCode))
    .innerJoin(s.brands, and(eq(s.brands.id, s.outlets.brandId), eq(s.brands.tenantId, s.outlets.tenantId)))
    .innerJoin(
      s.diningTables,
      and(eq(s.diningTables.id, s.qrCodes.tableId), eq(s.diningTables.tenantId, s.outlets.tenantId)),
    )
    .innerJoin(s.zones, eq(s.zones.id, s.diningTables.zoneId))
    .where(and(eq(s.outlets.code, outletCode), eq(s.qrCodes.shortCode, shortCode), eq(s.qrCodes.type, "table")))
    .limit(1);
  return row ?? null;
}

const isUnavailable = (t: ResolvedTable) => t.tenantStatus === "suspended" || t.tenantStatus === "cancelled";

/** The QR's outlet and table, refusing unknown or revoked codes and suspended restaurants */
export async function findTableByQr(run: Runner, outletCode: string, shortCode: string) {
  const row = await resolveQr(run, outletCode, shortCode);
  if (!row) throw new AppError("not_found", "We could not find this table. Please ask staff for help.");
  if (row.qrRevokedAt) throw new AppError("qr_revoked", "This code is no longer active. Please ask staff for help.");
  if (isUnavailable(row)) {
    throw new AppError("outlet_unavailable", "Ordering from the table is not available right now. Please ask staff.");
  }
  return row;
}

/**
 * Whether someone new can sit down at this table now: not settling up, restaurant open, table
 * free or already in use. Shared by Start/Join and by sending a verification code.
 */
export function assertCanSeat(
  t: ResolvedTable,
  tableState: ResolvedTable["table"]["state"],
  open: Awaited<ReturnType<typeof findOpenSession>>,
  now: Date,
) {
  if (open?.session.status === "bill_requested" || tableState === "bill_requested") {
    throw new AppError("table_settling", "This table is settling up. Please ask staff if you need anything.");
  }
  if (!isOpenAt(t.outlet.openingHours, t.outlet.timezone, now)) {
    throw new AppError("outlet_closed", `${t.outlet.name} is closed right now.`);
  }
  if (tableState !== "available" && tableState !== "seated") {
    throw new AppError("table_not_open", "This table is not ready for orders. Please ask the host.");
  }
}

/** The open session on a table, if any, with the people in it */
export async function findOpenSession(run: Runner, tenantId: string, tableId: string) {
  const [session] = await run
    .select()
    .from(s.tableSessions)
    .where(and(eq(s.tableSessions.tenantId, tenantId), eq(s.tableSessions.openKey, tableId)))
    .limit(1);
  if (!session) return null;
  const people = await run
    .select({ id: s.participants.id, displayName: s.participants.displayName, deviceId: s.participants.deviceId })
    .from(s.participants)
    .where(
      and(
        eq(s.participants.tenantId, tenantId),
        eq(s.participants.sessionId, session.id),
        isNull(s.participants.removedAt),
      ),
    )
    .orderBy(s.participants.id);
  return { session, people };
}

/**
 * Whether this phone was removed from the session by the host (G7). Removal lasts for the rest of
 * the session: the same phone must not come back as a fresh participant.
 */
export async function wasRemoved(run: Runner, tenantId: string, sessionId: string, deviceId: string | null) {
  if (!deviceId) return false;
  const [row] = await run
    .select({ id: s.participants.id })
    .from(s.participants)
    .where(
      and(
        eq(s.participants.tenantId, tenantId),
        eq(s.participants.sessionId, sessionId),
        eq(s.participants.deviceId, deviceId),
        isNotNull(s.participants.removedAt),
      ),
    )
    .limit(1);
  return !!row;
}

export type Landing =
  | { kind: "start" }
  /** `names` only when every person has given a real name; otherwise the page shows the count */
  | { kind: "join"; count: number; names: string[] | null; hostName: string | null }
  | { kind: "rejoin"; participantId: string }
  /** The host removed this phone from the table's current session (G7) */
  | { kind: "removed" }
  /** Bill requested: participants go to the bill, anyone new is kept out */
  | { kind: "settling"; isParticipant: boolean }
  | { kind: "preparing" }
  | { kind: "reserved" }
  | { kind: "blocked" }
  | { kind: "closed" }
  /** Host-confirmed mode: staff have not opened this table yet */
  | { kind: "awaiting_staff" }
  /** Host-confirmed mode: the table is open and joining needs the code from staff */
  | { kind: "code_required" }
  | { kind: "revoked" }
  | { kind: "unavailable" };

/**
 * Everything G1 needs to render, decided on the server (PS 3.2). Only an unknown code throws,
 * because then there is no restaurant to show; revoked codes and suspended restaurants still
 * show the restaurant's name with a guest-safe message.
 */
export async function getTableLanding(outletCode: string, shortCode: string, deviceId: string | null, now = new Date()) {
  const t = await resolveQr(db, outletCode, shortCode);
  if (!t) throw new AppError("not_found", "We could not find this table. Please ask staff for help.");

  const hours = openingInfo(t.outlet.openingHours, t.outlet.timezone, now);
  const outlet = {
    code: t.outlet.code,
    name: t.outlet.name,
    city: t.outlet.city,
    logoUrl: t.logoUrl,
    accentColor: t.outlet.accentColor,
    sessionMode: t.outlet.sessionMode,
    isOpen: hours.isOpen,
    closesAt: hours.closesAt,
    nextOpen: hours.nextOpen,
    poweredBy: t.planFeatures.poweredBy,
  };
  const table = { code: t.table.code, maxSeats: t.table.maxSeats, zone: t.zoneName, state: t.table.state };

  if (t.qrRevokedAt) return { outlet, table, landing: { kind: "revoked" } as Landing };
  if (isUnavailable(t)) return { outlet, table, landing: { kind: "unavailable" } as Landing };

  const open = await findOpenSession(db, t.outlet.tenantId, t.table.id);
  const removed = !!open && !open.people.some((p) => p.deviceId === deviceId) && (await wasRemoved(db, t.outlet.tenantId, open.session.id, deviceId));
  if (removed) return { outlet, table, landing: { kind: "removed" } as Landing };
  return { outlet, table, landing: decideLanding(t, open, deviceId, outlet.isOpen) };
}

export type TableLanding = Awaited<ReturnType<typeof getTableLanding>>;

function decideLanding(
  t: ResolvedTable,
  open: Awaited<ReturnType<typeof findOpenSession>>,
  deviceId: string | null,
  isOpen: boolean,
): Landing {
  // Someone already at the table goes straight back in, even near closing time
  const me = deviceId ? open?.people.find((p) => p.deviceId === deviceId) : undefined;
  if (me && open?.session.status === "open") return { kind: "rejoin", participantId: me.id };
  if (open?.session.status === "bill_requested") return { kind: "settling", isParticipant: !!me };
  if (!isOpen) return { kind: "closed" };

  const hostConfirmed = t.outlet.sessionMode === "host_confirmed";
  switch (t.table.state) {
    case "available":
      return hostConfirmed ? { kind: "awaiting_staff" } : { kind: "start" };
    case "seated": {
      if (hostConfirmed) return { kind: "code_required" };
      const people = open?.people ?? [];
      if (!people.length) return { kind: "start" };
      const named = people.every((p) => !isPlaceholderName(p.displayName));
      const host = people.find((p) => p.id === open?.session.hostParticipantId);
      return {
        kind: "join",
        count: people.length,
        names: named ? people.map((p) => p.displayName) : null,
        // No partial names: the host is named only when everyone is
        hostName: named && host ? host.displayName : null,
      };
    }
    case "bill_requested":
      return { kind: "settling", isParticipant: !!me };
    case "paid":
    case "needs_cleaning":
      return { kind: "preparing" };
    case "held":
    case "reserved":
      // Reservation timing (free-until, check-in) arrives with the Phase 2 booking backend
      return { kind: "reserved" };
    case "blocked":
      return { kind: "blocked" };
  }
}
