import "server-only";
import { and, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { LOCK_THEN_READ } from "../db-types";
import { publish } from "../realtime/publish";
import { topics } from "../realtime/token";

export async function queueBookingNotification(input: { tenantId: string; outletId: string; reservationId?: string; waitlistEntryId?: string; type: (typeof s.notificationTypes)[number]; recipient: string; channel: string; idempotencyKey: string; scheduledAt?: Date }) {
  try { const [row] = await db.insert(s.bookingNotifications).values({ tenantId: input.tenantId, outletId: input.outletId, reservationId: input.reservationId ?? null, waitlistEntryId: input.waitlistEntryId ?? null, type: input.type, recipient: input.recipient, channel: input.channel, idempotencyKey: input.idempotencyKey, scheduledAt: input.scheduledAt ?? new Date() }).$returningId(); return row.id; } catch { const [row] = await db.select({ id: s.bookingNotifications.id }).from(s.bookingNotifications).where(and(eq(s.bookingNotifications.tenantId, input.tenantId), eq(s.bookingNotifications.idempotencyKey, input.idempotencyKey))); return row?.id ?? null; }
}

export async function queueReservationConfirmation(scope: { tenantId: string; outletId: string }, row: { id: string; phone: string | null; startAt: Date }, now = new Date()) {
  if (!row.phone) return;
  const notifications = [
    { type: "booking_confirmation" as const, key: "booking-confirmed", at: now },
    { type: "booking_reminder_24h" as const, key: "booking-reminder-24h", at: new Date(row.startAt.getTime() - 24 * 3600_000) },
    { type: "booking_reminder_2h" as const, key: "booking-reminder-2h", at: new Date(row.startAt.getTime() - 2 * 3600_000) },
  ];
  for (const notification of notifications) await queueBookingNotification({ ...scope, reservationId: row.id, type: notification.type, recipient: row.phone, channel: "sms", idempotencyKey: `${notification.key}:${row.id}`, scheduledAt: notification.at });
}

export async function processBookingNotifications(now = new Date()) {
  // isolation-exempt: the authenticated service task intentionally drains due rows across tenants.
  const rows = await db.transaction(async (tx) => tx.select().from(s.bookingNotifications).where(and(inArray(s.bookingNotifications.status, ["pending", "failed"]), lte(s.bookingNotifications.scheduledAt, now))).orderBy(s.bookingNotifications.scheduledAt).limit(100).for("update"), LOCK_THEN_READ);
  let sent = 0;
  for (const row of rows) {
    // No real message provider exists yet, so production must never report a booking message as sent
    if (process.env.NODE_ENV === "production") { await db.update(s.bookingNotifications).set({ status: "failed", attempts: row.attempts + 1, lastError: "No booking message provider is implemented yet", updatedAt: now }).where(and(eq(s.bookingNotifications.tenantId, row.tenantId), eq(s.bookingNotifications.id, row.id))); continue; }
    await db.update(s.bookingNotifications).set({ status: "sent", attempts: row.attempts + 1, providerRef: `mock_${row.id}`, sentAt: now, updatedAt: now }).where(and(eq(s.bookingNotifications.tenantId, row.tenantId), eq(s.bookingNotifications.id, row.id))); sent++;
  }
  return { sent, attempted: rows.length };
}

export async function expireReadyWaitlists(now = new Date()) {
  // isolation-exempt: the authenticated service task intentionally scans all outlets for expiry.
  const rows = await db.select({ id: s.waitlistEntries.id, tenantId: s.waitlistEntries.tenantId, outletId: s.waitlistEntries.outletId, manageTokenHash: s.waitlistEntries.manageTokenHash }).from(s.waitlistEntries).where(and(eq(s.waitlistEntries.status, "notified"), lte(s.waitlistEntries.readyDeadline, now)));
  for (const row of rows) { await db.update(s.waitlistEntries).set({ status: "expired", closedAt: now, updatedAt: now }).where(and(eq(s.waitlistEntries.tenantId, row.tenantId), eq(s.waitlistEntries.id, row.id))); await publish({ tenantId: row.tenantId, outletId: row.outletId }, [{ topic: topics.floor, type: "waitlist.skipped", data: { entryId: row.id, reason: "ready_window_expired" } }, ...(row.manageTokenHash ? [{ topic: topics.waitlist(row.manageTokenHash), type: "waitlist.expired", data: { entryId: row.id } }] : [])]); }
  return rows.length;
}
