import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import type { Runner } from "../db-types";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { AppError } from "../errors";
import { publish } from "../realtime/publish";
import { topics, waitlistRealtimeToken } from "../realtime/token";
import { outletScope } from "./waitlist-internal";
import { queueBookingNotification } from "./notifications";

export async function estimateWait(run: Runner, scope: { tenantId: string; outletId: string }, partySize: number, seatingPreference?: string | null, now = new Date()) {
  const [policy] = await run.select({ fallback: s.bookingPolicies.fallbackWaitMinutes, minimum: s.bookingPolicies.minimumHistoryParties }).from(s.bookingPolicies).where(and(eq(s.bookingPolicies.tenantId, scope.tenantId), eq(s.bookingPolicies.outletId, scope.outletId)));
  const tables = await run.select({ id: s.diningTables.id, maxSeats: s.diningTables.maxSeats, zoneId: s.diningTables.zoneId }).from(s.diningTables).where(and(eq(s.diningTables.tenantId, scope.tenantId), eq(s.diningTables.outletId, scope.outletId), eq(s.diningTables.isActive, true), eq(s.diningTables.isBookableOnline, true)));
  const suitable = seatingPreference && seatingPreference !== "No preference" ? tables.filter((t) => t.maxSeats >= partySize && String(t.zoneId) === seatingPreference) : tables.filter((t) => t.maxSeats >= partySize);
  const since = new Date(now.getTime() - 14 * 86_400_000);
  const history = await run.select({ openedAt: s.tableSessions.openedAt, closedAt: s.tableSessions.closedAt, partySize: s.tableSessions.partySize })
    .from(s.tableSessions).innerJoin(s.sessionTables, and(eq(s.sessionTables.tenantId, s.tableSessions.tenantId), eq(s.sessionTables.sessionId, s.tableSessions.id), eq(s.sessionTables.isPrimary, true)))
    .where(and(eq(s.tableSessions.tenantId, scope.tenantId), eq(s.tableSessions.outletId, scope.outletId), eq(s.tableSessions.status, "closed"), isNotNull(s.tableSessions.closedAt), gte(s.tableSessions.closedAt, since), lte(s.tableSessions.closedAt, now)));
  const useful = history.filter((h) => (h.partySize ?? 1) <= partySize + 2 && (h.partySize ?? 1) >= Math.max(1, partySize - 2) && h.closedAt).map((h) => Math.max(15, Math.round((h.closedAt!.getTime() - h.openedAt.getTime()) / 60_000)));
  const fallback = policy?.fallback ?? 30;
  if (useful.length < (policy?.minimum ?? 30) || suitable.length === 0) return { minutes: fallback, source: "fallback" as const, suitableTables: suitable.length, historyCount: useful.length };
  const avg = useful.reduce((a, b) => a + b, 0) / useful.length;
  const [queue] = await run.select({ n: count() }).from(s.waitlistEntries).where(and(eq(s.waitlistEntries.tenantId, scope.tenantId), eq(s.waitlistEntries.outletId, scope.outletId), inArray(s.waitlistEntries.status, ["waiting", "notified"])));
  const partiesAhead = Number(queue?.n ?? 0);
  const minutes = Math.max(5, Math.min(240, Math.round((partiesAhead * avg / Math.max(1, suitable.length)) / 5) * 5));
  return { minutes, source: "historical" as const, suitableTables: suitable.length, historyCount: useful.length };
}

const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const token = () => randomBytes(32).toString("base64url");

export async function joinPublicWaitlist(outletCode: string, input: { name: string; phone: string; partySize: number; seatingPreference?: string | null }) {
  const scope = await outletScope(db, outletCode);
  const name = input.name.trim().slice(0, 80); const partySize = Number(input.partySize);
  const now = new Date();
  if (!name || !/^[0-9+ ()-]{7,20}$/.test(input.phone) || !Number.isInteger(partySize) || partySize < 1 || partySize > 12) throw new AppError("invalid_state", "Enter a name, phone and party size from 1 to 12.");
  const [last] = await db.select({ sortOrder: s.waitlistEntries.sortOrder }).from(s.waitlistEntries).where(and(eq(s.waitlistEntries.tenantId, scope.tenantId), eq(s.waitlistEntries.outletId, scope.outletId), inArray(s.waitlistEntries.status, ["waiting", "notified"]))).orderBy(asc(s.waitlistEntries.sortOrder));
  const estimate = await estimateWait(db, scope, partySize, input.seatingPreference, now);
  const plain = token(); const id = uuidv7();
  await db.insert(s.waitlistEntries).values({ id, tenantId: scope.tenantId, outletId: scope.outletId, name, phone: input.phone, partySize, seatingPreference: input.seatingPreference ?? null, joinedAt: now, quotedMinutes: estimate.minutes, estimateMinutes: estimate.minutes, estimateSource: estimate.source, status: "waiting", sortOrder: (last?.sortOrder ?? 0) + 1, manageTokenHash: hash(plain), manageTokenExpiresAt: new Date(now.getTime() + 24 * 3600_000), updatedAt: now });
  await publish(scope, [{ topic: topics.floor, type: "waitlist.updated", data: { entryId: id } }, { topic: topics.waitlist(hash(plain)), type: "waitlist.position_changed", data: { entryId: id } }]);
  await queueBookingNotification({ tenantId: scope.tenantId, outletId: scope.outletId, waitlistEntryId: id, type: "waitlist_joined", recipient: input.phone, channel: "sms", idempotencyKey: `waitlist-joined:${id}` });
  return { entryId: id, token: plain };
}

export async function publicWaitlistStatus(outletCode: string, plainToken: string) {
  const scope = await outletScope(db, outletCode); const [row] = await db.select().from(s.waitlistEntries).where(and(eq(s.waitlistEntries.tenantId, scope.tenantId), eq(s.waitlistEntries.manageTokenHash, hash(plainToken))));
  if (!row) throw new AppError("not_found", "This waitlist link is invalid.");
  const queue = await db.select({ id: s.waitlistEntries.id, status: s.waitlistEntries.status, sortOrder: s.waitlistEntries.sortOrder }).from(s.waitlistEntries).where(and(eq(s.waitlistEntries.tenantId, scope.tenantId), eq(s.waitlistEntries.outletId, scope.outletId), inArray(s.waitlistEntries.status, ["waiting", "notified"]))).orderBy(asc(s.waitlistEntries.sortOrder), asc(s.waitlistEntries.joinedAt));
  const index = queue.findIndex((x) => x.id === row.id); const ahead = index < 0 ? 0 : index;
  return { id: row.id, name: row.name, phone: row.phone, partySize: row.partySize, seatingPreference: row.seatingPreference, status: row.status, position: index < 0 ? null : index + 1, partiesAhead: ahead, estimateMinutes: row.estimateMinutes ?? row.quotedMinutes ?? 30, joinedAt: row.joinedAt.getTime(), updatedAt: row.updatedAt.getTime(), readyDeadline: row.readyDeadline?.getTime() ?? null };
}

export async function publicWaitlistRealtimeToken(outletCode: string, plainToken: string) {
  const scope = await outletScope(db, outletCode); const [row] = await db.select({ manageTokenHash: s.waitlistEntries.manageTokenHash }).from(s.waitlistEntries).where(and(eq(s.waitlistEntries.tenantId, scope.tenantId), eq(s.waitlistEntries.manageTokenHash, hash(plainToken))));
  if (!row?.manageTokenHash) throw new AppError("not_found", "This waitlist link is invalid.");
  return waitlistRealtimeToken({ tenantId: scope.tenantId, outletId: scope.outletId, tokenHash: row.manageTokenHash });
}

export async function leavePublicWaitlist(outletCode: string, plainToken: string) {
  const scope = await outletScope(db, outletCode); const [row] = await db.select({ id: s.waitlistEntries.id, status: s.waitlistEntries.status }).from(s.waitlistEntries).where(and(eq(s.waitlistEntries.tenantId, scope.tenantId), eq(s.waitlistEntries.manageTokenHash, hash(plainToken))));
  if (!row) throw new AppError("not_found", "This waitlist link is invalid.");
  if (["left", "skipped", "expired", "seated"].includes(row.status)) return { status: row.status };
  await db.update(s.waitlistEntries).set({ status: "left", closedAt: new Date(), updatedAt: new Date() }).where(and(eq(s.waitlistEntries.tenantId, scope.tenantId), eq(s.waitlistEntries.id, row.id)));
  await publish(scope, [{ topic: topics.floor, type: "waitlist.updated", data: { entryId: row.id } }, { topic: topics.waitlist(hash(plainToken)), type: "waitlist.position_changed", data: { entryId: row.id } }]); return { status: "left" };
}
