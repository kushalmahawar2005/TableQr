import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { AppError } from "../errors";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";
import { outletScope } from "./waitlist-internal";
import { queueBookingNotification } from "./notifications";

const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const token = () => randomBytes(32).toString("base64url");

export async function joinPublicWaitlist(outletCode: string, input: { name: string; phone: string; partySize: number; seatingPreference?: string | null }) {
  const scope = await outletScope(db, outletCode);
  const name = input.name.trim().slice(0, 80); const partySize = Number(input.partySize);
  if (!name || !/^[0-9+ ()-]{7,20}$/.test(input.phone) || !Number.isInteger(partySize) || partySize < 1 || partySize > 12) throw new AppError("invalid_state", "Enter a name, phone and party size from 1 to 12.");
  const [last] = await db.select({ sortOrder: s.waitlistEntries.sortOrder }).from(s.waitlistEntries).where(and(eq(s.waitlistEntries.tenantId, scope.tenantId), eq(s.waitlistEntries.outletId, scope.outletId), inArray(s.waitlistEntries.status, ["waiting", "notified"]))).orderBy(asc(s.waitlistEntries.sortOrder));
  const [policy] = await db.select({ fallback: s.bookingPolicies.fallbackWaitMinutes, ready: s.bookingPolicies.readyWindowMinutes }).from(s.bookingPolicies).where(and(eq(s.bookingPolicies.tenantId, scope.tenantId), eq(s.bookingPolicies.outletId, scope.outletId)));
  const plain = token(); const id = uuidv7(); const now = new Date(); const estimate = policy?.fallback ?? 30;
  await db.insert(s.waitlistEntries).values({ id, tenantId: scope.tenantId, outletId: scope.outletId, name, phone: input.phone, partySize, seatingPreference: input.seatingPreference ?? null, joinedAt: now, quotedMinutes: estimate, estimateMinutes: estimate, estimateSource: "fallback", status: "waiting", sortOrder: (last?.sortOrder ?? 0) + 1, manageTokenHash: hash(plain), manageTokenExpiresAt: new Date(now.getTime() + 24 * 3600_000), updatedAt: now });
  await publish(scope, [{ topic: topics.floor, type: "waitlist.updated", data: { entryId: id } }]);
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

export async function leavePublicWaitlist(outletCode: string, plainToken: string) {
  const scope = await outletScope(db, outletCode); const [row] = await db.select({ id: s.waitlistEntries.id, status: s.waitlistEntries.status }).from(s.waitlistEntries).where(and(eq(s.waitlistEntries.tenantId, scope.tenantId), eq(s.waitlistEntries.manageTokenHash, hash(plainToken))));
  if (!row) throw new AppError("not_found", "This waitlist link is invalid.");
  if (["left", "skipped", "expired", "seated"].includes(row.status)) return { status: row.status };
  await db.update(s.waitlistEntries).set({ status: "left", closedAt: new Date(), updatedAt: new Date() }).where(and(eq(s.waitlistEntries.tenantId, scope.tenantId), eq(s.waitlistEntries.id, row.id)));
  await publish(scope, [{ topic: topics.floor, type: "waitlist.updated", data: { entryId: row.id } }]); return { status: "left" };
}
