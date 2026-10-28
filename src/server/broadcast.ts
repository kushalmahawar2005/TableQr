import "server-only";

import { and, countDistinct, eq, inArray, isNotNull, max, ne, notExists, sql } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import type { BroadcastSegment } from "@/db/schema/broadcast";
import { AppError } from "./errors";
import { requireFeature } from "./plan";

type AudienceRow = { id: string; phone: string; name: string | null; birthday: string | null };

export const MAX_AUDIENCE = 10_000;
const DEFAULT_FREQUENCY_CAP_DAYS = 2;

/** Stored phones are ten digits; accepting +91 here keeps imports and webhook replies consistent. */
export function normaliseIndianMobile(value: string): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  const ten = digits.replace(/^91(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

function finiteInt(value: unknown, fallback: number | null = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : fallback;
}

export function cleanSegment(input: BroadcastSegment | null | undefined): BroadcastSegment {
  const segment = input && typeof input === "object" ? input : {};
  const result: BroadcastSegment = { outletId: segment.outletId ?? null };
  const days = (key: "visitedWithinDays" | "notSeenForDays") => {
    const value = finiteInt(segment[key]);
    if (segment[key] != null && (value === null || value < 1 || value > 3650)) throw new AppError("invalid_state", "Visit days must be between 1 and 3650.");
    if (value !== null) result[key] = value;
  };
  days("visitedWithinDays");
  days("notSeenForDays");
  for (const key of ["minSpendPaise", "minVisits"] as const) {
    const value = finiteInt(segment[key]);
    if (segment[key] != null && (value === null || value < 0 || value > 2_000_000_000)) throw new AppError("invalid_state", "The audience filter is invalid.");
    if (value !== null) result[key] = value;
  }
  if (segment.firstTimersOnly) result.firstTimersOnly = true;
  if (segment.birthday === "week" || segment.birthday === "month") result.birthday = segment.birthday;
  if (segment.channel === "dine_in" || segment.channel === "delivery" || segment.channel === "booking") result.channel = segment.channel;
  return result;
}

function birthdayMatches(value: string | null, mode: "week" | "month", now: Date, timezone: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [, month, day] = value.split("-").map(Number);
  if (!month || !day) return false;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const current = new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
  if (mode === "month") return month === current.getUTCMonth() + 1;
  const monday = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() - (current.getUTCDay() + 6) % 7));
  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(monday.getTime() + offset * 86_400_000);
    if (date.getUTCMonth() + 1 === month && date.getUTCDate() === day) return true;
  }
  return false;
}

/**
 * Returns the frozen-audience candidates before a campaign is started. Consent, opt-out,
 * Indian mobile validation and the frequency cap are always enforced here.
 */
export async function previewBroadcastAudience(
  tenantId: string,
  input?: { segment?: BroadcastSegment | null; frequencyCapDays?: number; now?: Date; timezone?: string },
  run: Pick<typeof db, "select"> = db,
) {
  await requireFeature(tenantId, "broadcast");
  const now = input?.now ?? new Date();
  const segment = cleanSegment(input?.segment);
  const [outlet] = segment.outletId ? await run.select({ timezone: s.outlets.timezone }).from(s.outlets).where(and(eq(s.outlets.tenantId, tenantId), eq(s.outlets.id, segment.outletId))) : [];
  if (segment.outletId && !outlet) throw new AppError("not_found", "Outlet not found.");
  const timezone = outlet?.timezone ?? input?.timezone ?? "Asia/Kolkata";
  const capDays = Math.min(365, Math.max(0, finiteInt(input?.frequencyCapDays, DEFAULT_FREQUENCY_CAP_DAYS) ?? DEFAULT_FREQUENCY_CAP_DAYS));
  const cutoff = new Date(now.getTime() - capDays * 86_400_000);

  const base = await run
    .select({ id: s.guests.id, phone: s.guests.phone, name: s.guests.name, birthday: s.guests.birthday, consent: s.guests.consentMarketing, optedOut: s.guests.marketingOptOutAt, lastMarketingAt: s.guests.lastMarketingAt })
    .from(s.guests)
    .where(and(
      eq(s.guests.tenantId, tenantId),
    ))
    .limit(MAX_AUDIENCE + 1);
  if (base.length > MAX_AUDIENCE) throw new AppError("invalid_state", "Audience preview supports up to 10,000 customer records. Ask Tableeqr to expand this limit before sending.");
  const blocked = new Set(base.filter((row) => row.optedOut || (row.lastMarketingAt && row.lastMarketingAt >= cutoff)).map((row) => normaliseIndianMobile(row.phone)));
  const valid = base.filter((row) => row.consent && !row.optedOut && !!normaliseIndianMobile(row.phone) && !blocked.has(normaliseIndianMobile(row.phone)));
  if (!valid.length) return { audience: [] as AudienceRow[], count: 0, credits: 0, segment };
  const guestIds = valid.map((row) => row.id);

  const activity = await run
    .select({ guestId: s.participants.guestId, visits: countDistinct(s.tableSessions.id), lastSeenAt: max(s.tableSessions.openedAt) })
    .from(s.participants)
    .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.participants.tenantId), eq(s.tableSessions.id, s.participants.sessionId)))
    .where(and(
      eq(s.participants.tenantId, tenantId),
      inArray(s.participants.guestId, guestIds),
      isNotNull(s.participants.guestId),
      segment.outletId ? eq(s.tableSessions.outletId, segment.outletId) : undefined,
      segment.channel === "dine_in" ? notExists(run.select({ id: s.deliveryCheckouts.id }).from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.tenantId, tenantId), eq(s.deliveryCheckouts.sessionId, s.tableSessions.id)))) : undefined,
    ))
    .groupBy(s.participants.guestId);
  const activityByGuest = new Map(activity.map((row) => [row.guestId!, { visits: Number(row.visits), lastSeenAt: row.lastSeenAt }]));

  const spend = await run
    .select({ guestId: s.participants.guestId, paidPaise: sql<number>`coalesce(sum(${s.billShares.paidPaise}), 0)` })
    .from(s.billShares)
    .innerJoin(s.bills, and(eq(s.bills.tenantId, s.billShares.tenantId), eq(s.bills.id, s.billShares.billId), eq(s.bills.status, "paid")))
    .innerJoin(s.participants, and(eq(s.participants.tenantId, s.billShares.tenantId), eq(s.participants.id, s.billShares.participantId)))
    .where(and(eq(s.billShares.tenantId, tenantId), inArray(s.participants.guestId, guestIds), isNotNull(s.participants.guestId), segment.outletId ? eq(s.bills.outletId, segment.outletId) : undefined))
    .groupBy(s.participants.guestId);
  const spendByGuest = new Map(spend.map((row) => [row.guestId!, Number(row.paidPaise ?? 0)]));

  const channelIds = async (channel: "delivery" | "booking") => {
    const rows = channel === "delivery"
      ? await run.select({ guestId: s.deliveryCheckouts.guestId }).from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.tenantId, tenantId), inArray(s.deliveryCheckouts.guestId, guestIds), isNotNull(s.deliveryCheckouts.guestId), inArray(s.deliveryCheckouts.status, ["placed", "dispatched", "delivered"]), segment.outletId ? eq(s.deliveryCheckouts.outletId, segment.outletId) : undefined))
      : await run.select({ guestId: s.reservations.guestId }).from(s.reservations).where(and(eq(s.reservations.tenantId, tenantId), inArray(s.reservations.guestId, guestIds), isNotNull(s.reservations.guestId), ne(s.reservations.status, "cancelled"), segment.outletId ? eq(s.reservations.outletId, segment.outletId) : undefined));
    return new Set(rows.map((row) => row.guestId).filter((id): id is string => !!id));
  };
  const channelSet = segment.channel && segment.channel !== "dine_in" ? await channelIds(segment.channel) : null;
  const outletMembers = segment.outletId ? new Set([...(await channelIds("delivery")), ...(await channelIds("booking"))]) : null;

  const audience = valid.filter((guest) => {
    const stats = activityByGuest.get(guest.id) ?? { visits: 0, lastSeenAt: null };
    if (segment.outletId && stats.visits === 0 && !outletMembers?.has(guest.id)) return false;
    if (segment.channel === "dine_in" && stats.visits === 0) return false;
    if (channelSet && !channelSet.has(guest.id)) return false;
    if (typeof segment.visitedWithinDays === "number" && (!stats.lastSeenAt || stats.lastSeenAt < new Date(now.getTime() - segment.visitedWithinDays * 86_400_000))) return false;
    if (typeof segment.notSeenForDays === "number" && (!stats.lastSeenAt || stats.lastSeenAt >= new Date(now.getTime() - segment.notSeenForDays * 86_400_000))) return false;
    if (typeof segment.minVisits === "number" && stats.visits < segment.minVisits) return false;
    if (segment.firstTimersOnly && stats.visits !== 1) return false;
    if (typeof segment.minSpendPaise === "number" && (spendByGuest.get(guest.id) ?? 0) < segment.minSpendPaise) return false;
    if (segment.birthday && !birthdayMatches(guest.birthday, segment.birthday, now, timezone)) return false;
    return true;
  }).map((guest) => ({ ...guest, phone: normaliseIndianMobile(guest.phone)! }));

  const unique = [...new Map(audience.map((guest) => [guest.phone, guest])).values()];
  return { audience: unique, count: unique.length, credits: unique.length, segment };
}


/** Platform/admin credit grant or adjustment. Negative adjustments can never make the balance negative. */
export async function adjustMessageCredits(input: { tenantId: string; delta: number; reason: "grant" | "adjust" | "purchase"; actorLabel: string; note?: string | null; feeId?: string | null; now?: Date }) {
  const delta = finiteInt(input.delta);
  if (delta === null || delta === 0 || Math.abs(delta) > 2_000_000_000) throw new AppError("invalid_state", "Credit adjustment is not valid.");
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [tenant] = await tx.select({ messageCredits: s.tenants.messageCredits }).from(s.tenants).where(eq(s.tenants.id, input.tenantId)).for("update");
    if (!tenant) throw new AppError("not_found", "Restaurant not found.");
    const balance = tenant.messageCredits + delta;
    if (!Number.isSafeInteger(balance) || balance < 0 || balance > 2_147_483_647) throw new AppError("invalid_state", "This adjustment exceeds the allowed credit balance.");
    await tx.update(s.tenants).set({ messageCredits: balance, updatedAt: now }).where(eq(s.tenants.id, input.tenantId));
    await tx.insert(s.messageCreditLedger).values({ id: uuidv7(), tenantId: input.tenantId, delta, balanceAfter: balance, reason: input.reason, feeId: input.feeId ?? null, actorLabel: input.actorLabel.slice(0, 80), note: input.note?.slice(0, 200) ?? null, createdAt: now });
    await tx.insert(s.auditLog).values({ tenantId: input.tenantId, actorLabel: input.actorLabel.slice(0, 80), action: "admin.message_credits_adjusted", entity: "tenant", entityId: input.tenantId, before: { balance: tenant.messageCredits }, after: { delta, balance }, reason: input.note?.slice(0, 200) ?? null, createdAt: now });
    return { balance };
  });
}
