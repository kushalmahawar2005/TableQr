import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import { roundHalfUp } from "@/domain/money";
import * as s from "@/db/schema";
import { localClock, type WeeklyHours } from "@/domain/hours";
import { diningMinutesFor, localTime, overlaps, parseLocalDateTime, serviceDate, type BookingPolicy } from "@/domain/booking-policy";
import { LOCK_THEN_READ, type Runner } from "../db-types";
import { AppError } from "../errors";
import { requireFeature } from "../plan";
import { loadPolicy } from "../floor/policy";
import { syncEvents, syncTableHolds } from "../floor/sync";
import { publish } from "../realtime/publish";
import { sendOutletPush } from "../staff/web-push";
import { topics } from "../realtime/token";
import { queueReservationConfirmation } from "./notifications";
import { audit } from "../staff/audit";
import type { StaffSession } from "../staff/auth";
import { loadItemsForBrowsing, loadItems } from "../guest/menu";
import { priceLine } from "@/domain/pricing";
import { isWithinCategoryWindow } from "../guest/menu";
import { configuredGuestServices, type GuestService } from "@/domain/guest-services";
import { tenantAccess } from "../access";
import { outletGatewayFromConfig } from "../payments/outlet-gateway";

export const BOOKING_HOLD_MINUTES = 5;
const LIVE = ["requested", "confirmed", "reminded", "arrived"] as const;
/** Staff may move these to a new time; see rescheduleReservationStaff */
const RESCHEDULABLE: string[] = ["requested", "confirmed", "reminded"];
/** Staff reschedule ignores the online cutoff; it may go back this far to correct a time just past */
const STAFF_RESCHEDULE_PAST_MINUTES = 15;

export type BookingPreference = { seatingPreference?: string | null; tableClass?: string | null; zoneId?: string | null };
export type BookingSlot = {
  startAt: number;
  endAt: number;
  available: boolean;
  reason: "available" | "full" | "closed" | "cutoff" | "paused" | "blackout" | "outside_window";
  alternatives: number[];
  creditRequiredPaise: number;
  creditReason: string | null;
};

type OutletScope = { tenantId: string; brandId: string; outletId: string; outletCode: string; timezone: string; openingHours: WeeklyHours | null; name: string; address: string; city: string; guestServices?: GuestService[] | null; bookingPaymentMode?: "gateway" | "manual_qr"; bookingPaymentQrUrl?: string | null; bookingAdvancePaise?: number; paymentGatewayConfig?: string | null };

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const publicRef = () => `TQ-${randomBytes(5).toString("hex").toUpperCase()}`;
const liveStatuses = [...LIVE];

async function outletScope(run: Runner, outletCode: string): Promise<OutletScope> {
  // isolation-exempt: the tenant is resolved from the public outlet code before scoped queries.
  const [o] = await run.select({ tenantId: s.outlets.tenantId, brandId: s.outlets.brandId, outletId: s.outlets.id, outletCode: s.outlets.code, timezone: s.outlets.timezone, openingHours: s.outlets.openingHours, name: s.outlets.name, address: s.outlets.address, city: s.outlets.city, guestServices: s.outlets.guestServices, bookingPaymentMode: s.outlets.bookingPaymentMode, bookingPaymentQrUrl: s.outlets.bookingPaymentQrUrl, bookingAdvancePaise: s.outlets.bookingAdvancePaise, paymentGatewayConfig: s.outlets.paymentGatewayConfig })
    .from(s.outlets).where(eq(s.outlets.code, String(outletCode).trim().toUpperCase()));
  if (!o) throw new AppError("not_found", "We could not find this restaurant.");
  return o;
}

async function requireOnlineBookings(scope: OutletScope) {
  await requireFeature(scope.tenantId, "reservations", scope.outletId);
  if (!configuredGuestServices(scope.guestServices).includes("reservations") || (await tenantAccess(scope.tenantId)).state === "blocked") throw new AppError("forbidden", "Online booking is not available here. Please contact the restaurant.");
}

export async function getBookingZones(outletCode: string) {
  const scope = await outletScope(db, outletCode);
  await requireOnlineBookings(scope);
  return db.select({ id: s.zones.id, name: s.zones.name }).from(s.zones).where(and(eq(s.zones.tenantId, scope.tenantId), eq(s.zones.outletId, scope.outletId), eq(s.zones.isActive, true))).orderBy(asc(s.zones.sortOrder), asc(s.zones.name));
}

/** Guest-facing date/time rules must use the restaurant's timezone and cancellation policy. */
export async function getBookingPageConfig(outletCode: string) {
  const scope = await outletScope(db, outletCode);
  await requireOnlineBookings(scope);
  const [zones, policy] = await Promise.all([
    db.select({ id: s.zones.id, name: s.zones.name }).from(s.zones)
      .where(and(eq(s.zones.tenantId, scope.tenantId), eq(s.zones.outletId, scope.outletId), eq(s.zones.isActive, true)))
      .orderBy(asc(s.zones.sortOrder), asc(s.zones.name)),
    loadPolicy(db, scope),
  ]);
  return { zones, timezone: scope.timezone, today: serviceDate(new Date(), scope.timezone), freeCancellationMinutes: policy.freeCancellationMinutes };
}

export async function getBookingDetailsConfig(outletCode: string, token: string) {
  const { scope } = await bookingByToken(outletCode, token);
  const policy = await loadPolicy(db, scope);
  return { timezone: scope.timezone, freeCancellationMinutes: policy.freeCancellationMinutes };
}

async function validateZone(run: Runner, scope: OutletScope, zoneId?: string | null) {
  if (!zoneId) return;
  const [zone] = await run.select({ id: s.zones.id }).from(s.zones).where(and(eq(s.zones.tenantId, scope.tenantId), eq(s.zones.outletId, scope.outletId), eq(s.zones.id, zoneId), eq(s.zones.isActive, true)));
  if (!zone) throw new AppError("invalid_state", "Choose a seating preference from this restaurant.");
}

const policyWithFallback = (row: BookingPolicy): BookingPolicy => ({ ...row, holdMinutes: BOOKING_HOLD_MINUTES });

async function exceptionFor(run: Runner, scope: OutletScope, date: string) {
  const [row] = await run.select().from(s.bookingCalendarExceptions).where(and(eq(s.bookingCalendarExceptions.tenantId, scope.tenantId), eq(s.bookingCalendarExceptions.outletId, scope.outletId), eq(s.bookingCalendarExceptions.serviceDate, date)));
  return row ?? null;
}

function slotStarts(date: string, scope: OutletScope, policy: BookingPolicy) {
  const day = localClock(localTime(date, 12 * 60, scope.timezone), scope.timezone).day;
  // No hours set: offer usual dining hours rather than a slot every half hour through the night
  const windows = scope.openingHours && Object.keys(scope.openingHours).length ? (scope.openingHours[day] ?? []) : [["11:00", "23:00"] as [string, string]];
  const result: Date[] = [];
  for (const [from, to] of windows) {
    const [fh, fm] = from.split(":").map(Number);
    const [th, tm] = to.split(":").map(Number);
    const begin = fh * 60 + fm;
    let end = th * 60 + tm;
    if (end <= begin) end += 24 * 60;
    for (let m = Math.ceil(begin / policy.slotIntervalMinutes) * policy.slotIntervalMinutes; m + policy.slotIntervalMinutes <= end; m += policy.slotIntervalMinutes) {
      result.push(localTime(date, m, scope.timezone));
    }
  }
  return [...new Map(result.map((x) => [x.getTime(), x])).values()].sort((a, b) => a.getTime() - b.getTime());
}

async function liveClaims(run: Runner, scope: OutletScope, exceptReservationId?: string) {
  return run.select({ reservationId: s.reservations.id, tableId: s.reservationTables.tableId, startAt: s.reservations.startAt, endAt: s.reservations.expectedEndAt })
    .from(s.reservationTables)
    .innerJoin(s.reservations, and(eq(s.reservations.tenantId, s.reservationTables.tenantId), eq(s.reservations.id, s.reservationTables.reservationId)))
    .where(and(eq(s.reservationTables.tenantId, scope.tenantId), eq(s.reservations.outletId, scope.outletId), inArray(s.reservations.status, liveStatuses), exceptReservationId ? ne(s.reservations.id, exceptReservationId) : undefined));
}

async function activeSessions(run: Runner, scope: OutletScope, now: Date) {
  return run.select({ tableId: s.sessionTables.tableId, expectedEndAt: s.tableSessions.expectedEndAt, openedAt: s.tableSessions.openedAt, partySize: s.tableSessions.partySize })
    .from(s.sessionTables)
    .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.sessionTables.tenantId), eq(s.tableSessions.id, s.sessionTables.sessionId)))
    .where(and(eq(s.sessionTables.tenantId, scope.tenantId), eq(s.sessionTables.outletId, scope.outletId), isNull(s.sessionTables.releasedAt), ne(s.tableSessions.status, "closed"), lte(s.tableSessions.openedAt, now)));
}

type Table = typeof s.diningTables.$inferSelect;
function combinations(tables: Table[], party: number): Table[][] {
  const single = tables.filter((t) => t.maxSeats >= party && party >= t.minSeats).map((t) => [t]);
  if (single.length) return single;
  const byId = new Map(tables.map((t) => [t.id, t]));
  const out: Table[][] = [];
  for (const a of tables) for (const id of a.combinableWith ?? []) {
    const b = byId.get(id);
    if (b && a.id < b.id && a.maxSeats + b.maxSeats >= party) out.push([a, b]);
  }
  return out;
}

function preferenceRank(group: Table[], pref: BookingPreference) {
  const zone = pref.zoneId ? group.every((t) => t.zoneId === pref.zoneId) : true;
  const cls = pref.tableClass ? group.every((t) => t.tableClass === pref.tableClass) : true;
  return (zone && cls ? 0 : 1) + (zone ? 0 : 2) + (cls ? 0 : 1);
}

/** Everything table choice needs, read once: bookable tables, live bookings, open visits and the policy */
async function loadFloor(run: Runner, scope: OutletScope, now: Date, lock = false, exceptReservationId?: string) {
  const q = run.select().from(s.diningTables).where(and(eq(s.diningTables.tenantId, scope.tenantId), eq(s.diningTables.outletId, scope.outletId), eq(s.diningTables.isActive, true), eq(s.diningTables.isBookableOnline, true), ne(s.diningTables.state, "blocked"))).orderBy(asc(s.diningTables.id));
  const tables = lock ? await q.for("update") : await q;
  const claims = await liveClaims(run, scope, exceptReservationId);
  const sessions = await activeSessions(run, scope, now);
  const policy = await loadPolicy(run, scope);
  return { tables, claims, sessions, policy };
}
type Floor = Awaited<ReturnType<typeof loadFloor>>;

/** The best free table (or pair) for a time, worked out from an already loaded floor */
function pickTables(floor: Floor, startAt: Date, endAt: Date, party: number, pref: BookingPreference) {
  const blocked = new Set<string>();
  for (const c of floor.claims) if (overlaps(startAt.getTime(), endAt.getTime(), c.startAt.getTime(), c.endAt.getTime(), 0)) blocked.add(c.tableId);
  for (const v of floor.sessions) {
    const until = v.expectedEndAt ?? new Date(v.openedAt.getTime() + diningMinutesFor(Math.max(1, v.partySize ?? 1), floor.policy) * 60_000);
    if (until.getTime() + floor.policy.turnoverBufferMinutes * 60_000 > startAt.getTime()) blocked.add(v.tableId);
  }
  const available = floor.tables.filter((t) => !blocked.has(t.id));
  return combinations(available, party).sort((a, b) => preferenceRank(a, pref) - preferenceRank(b, pref) || a.length - b.length || a[0].id.localeCompare(b[0].id))[0] ?? null;
}

async function chooseTables(run: Runner, scope: OutletScope, startAt: Date, endAt: Date, party: number, pref: BookingPreference, now: Date, lock = false, exceptReservationId?: string) {
  return pickTables(await loadFloor(run, scope, now, lock, exceptReservationId), startAt, endAt, party, pref);
}

async function slotCredit(run: Runner, scope: OutletScope, policy: BookingPolicy, startAt: Date) {
  if (policy.peakCreditPaise <= 0 && policy.repeatNoShowCreditPaise <= 0) return { amountPaise: 0, reason: null as string | null };
  return creditFor(policy, await liveClaims(run, scope), startAt);
}

function creditFor(policy: BookingPolicy, claims: { startAt: Date }[], startAt: Date) {
  if (policy.peakCreditPaise <= 0 && policy.repeatNoShowCreditPaise <= 0) return { amountPaise: 0, reason: null as string | null };
  const end = new Date(startAt.getTime() + 30 * 60_000);
  const covers = claims.filter((x) => x.startAt >= startAt && x.startAt < end).length;
  if (policy.peakCreditPaise > 0 && covers >= Math.floor(policy.pacingCoversPerSlot * 0.8)) return { amountPaise: policy.peakCreditPaise, reason: "Peak slot booking credit" };
  return { amountPaise: 0, reason: null };
}

export async function getBookingAvailability(outletCode: string, input: { date: string; partySize: number; preference?: BookingPreference }, now = new Date()) {
  const scope = await outletScope(db, outletCode);
  await requireOnlineBookings(scope);
  await validateZone(db, scope, input.preference?.zoneId);
  const policy = policyWithFallback(await loadPolicy(db, scope));
  const date = String(input.date);
  const party = Number(input.partySize);
  if (!Number.isInteger(party) || party < policy.minPartySize || party > policy.maxPartySize) return { date, partySize: party, groupRequest: party > policy.maxPartySize, paused: false, slots: [] as BookingSlot[], policy };
  const exception = await exceptionFor(db, scope, date);
  const today = serviceDate(now, scope.timezone);
  const latest = new Date(now.getTime() + policy.bookingWindowDays * 86_400_000);
  const starts = slotStarts(date, scope, policy);
  const slots: BookingSlot[] = [];
  // One read of the floor for the whole day; each slot is then worked out in memory
  const floor = await loadFloor(db, scope, now);
  for (const start of starts) {
    const end = new Date(start.getTime() + diningMinutesFor(party, policy) * 60_000);
    const tooSoon = start.getTime() < now.getTime() + policy.onlineCutoffMinutes * 60_000;
    const outside = date < today || start > latest;
    const paused = exception?.onlineBookingsPaused === true;
    const credit = creditFor(policy, floor.claims, start);
    const chosen = !tooSoon && !outside && !paused ? pickTables(floor, start, end, party, input.preference ?? {}) : null;
    slots.push({ startAt: start.getTime(), endAt: end.getTime(), available: !!chosen, reason: paused ? "blackout" : tooSoon ? "cutoff" : outside ? "outside_window" : chosen ? "available" : "full", alternatives: [], creditRequiredPaise: Math.max(scope.bookingAdvancePaise ?? 0, credit.amountPaise), creditReason: credit.reason ?? ((scope.bookingAdvancePaise ?? 0) > 0 ? "Reservation advance" : null) });
  }
  const available = slots.filter((x) => x.available).map((x) => x.startAt);
  for (const slot of slots) if (!slot.available) slot.alternatives = available.sort((a, b) => Math.abs(a - slot.startAt) - Math.abs(b - slot.startAt)).slice(0, 3);
  return { date, partySize: party, groupRequest: false, paused: !!exception?.onlineBookingsPaused, slots, policy };
}

export async function createBookingHold(outletCode: string, input: { date: string; startAt: number; partySize: number; preference?: BookingPreference; requestId: string; holdToken: string }, now = new Date()) {
  const scope = await outletScope(db, outletCode);
  await requireOnlineBookings(scope);
  if (scope.bookingPaymentMode === "manual_qr" && !scope.bookingPaymentQrUrl) throw new AppError("invalid_state", "The restaurant has not added its booking payment QR yet. Please contact staff.");
  await validateZone(db, scope, input.preference?.zoneId);
  const policy = policyWithFallback(await loadPolicy(db, scope));
  const startAt = new Date(Number(input.startAt));
  if (Number.isNaN(startAt.getTime()) || startAt.getTime() < now.getTime() + policy.onlineCutoffMinutes * 60_000) throw new AppError("conflict", "Choose a later online booking time.", { reason: "cutoff" });
  const partySize = Number(input.partySize);
  if (!Number.isInteger(partySize) || partySize < policy.minPartySize || partySize > policy.maxPartySize) throw new AppError("invalid_state", "Choose a valid party size for online booking.", { reason: "party_size" });
  const date = String(input.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || serviceDate(startAt, scope.timezone) !== date || !slotStarts(date, scope, policy).some((slot) => slot.getTime() === startAt.getTime())) {
    throw new AppError("invalid_state", "Choose one of the restaurant's available booking times.", { reason: "slot" });
  }
  const latest = new Date(now.getTime() + policy.bookingWindowDays * 86_400_000);
  if (startAt > latest) throw new AppError("invalid_state", "This time is outside the restaurant's booking window.", { reason: "window" });
  const exception = await exceptionFor(db, scope, date);
  if (exception?.onlineBookingsPaused) throw new AppError("conflict", "Online bookings are paused for this date.", { reason: "paused" });
  const endAt = new Date(startAt.getTime() + diningMinutesFor(partySize, policy) * 60_000);
  const holdExpiresAt = new Date(now.getTime() + BOOKING_HOLD_MINUTES * 60_000);
  const tokenHash = hash(input.holdToken);
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(s.reservations).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.bookingRequestId, input.requestId))).for("update");
    if (existing && existing.holdExpiresAt && existing.holdExpiresAt > now && existing.manageTokenHash === hash(input.holdToken)) return existing;
    const chosen = await chooseTables(tx, scope, startAt, endAt, partySize, input.preference ?? {}, now, true);
    if (!chosen) throw new AppError("conflict", "That time is no longer available.", { reason: "full" });
    const slotCreditAmount = await slotCredit(tx, scope, policy, startAt);
    const credit = { amountPaise: Math.max(scope.bookingAdvancePaise ?? 0, slotCreditAmount.amountPaise), reason: slotCreditAmount.reason };
    if (credit.amountPaise > 0 && scope.bookingPaymentMode !== "manual_qr" && !outletGatewayFromConfig(scope.paymentGatewayConfig)) {
      throw new AppError("invalid_state", "This restaurant has not connected online advance payments yet. Please contact the restaurant or choose another time.", { reason: "booking_payment_unavailable" });
    }
    const id = uuidv7();
    const manage = input.holdToken;
    const reference = publicRef();
    await tx.insert(s.reservations).values({ id, tenantId: scope.tenantId, outletId: scope.outletId, name: "Pending guest", publicReference: reference, manageTokenHash: hash(manage), manageTokenExpiresAt: new Date(now.getTime() + 90 * 86_400_000), bookingRequestId: input.requestId, partySize, startAt, expectedEndAt: endAt, status: "requested", source: "online", seatingPreference: input.preference?.seatingPreference ?? null, requestedZoneId: input.preference?.zoneId ?? null, requestedTableClass: input.preference?.tableClass ?? null, holdExpiresAt, holdOwnerHash: tokenHash, advancePaymentMode: scope.bookingPaymentMode ?? "gateway", advancePaymentQrUrl: scope.bookingPaymentQrUrl ?? null, creditRequiredPaise: credit.amountPaise, creditPaidPaise: 0, creditAppliedPaise: 0, creditStatus: credit.amountPaise ? "required" : "none", createdAt: now, updatedAt: now });
    await tx.insert(s.reservationTables).values(chosen.map((t) => ({ id: uuidv7(), tenantId: scope.tenantId, reservationId: id, tableId: t.id })));
    await tx.insert(s.reservationHistory).values({ tenantId: scope.tenantId, reservationId: id, kind: "hold_created", after: { startAt, endAt, tableIds: chosen.map((t) => t.id) }, createdAt: now });
    return { ...(await tx.select().from(s.reservations).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, id))))[0], manageToken: manage } as typeof s.reservations.$inferSelect & { manageToken: string };
  }, LOCK_THEN_READ);
  await publish(scope, [{ topic: topics.floor, type: "booking.hold_created", data: { reservationId: result.id } }]);
  return { reservationId: result.id, publicReference: result.publicReference, manageToken: (result as { manageToken?: string }).manageToken ?? input.holdToken, holdExpiresAt: result.holdExpiresAt?.getTime() ?? holdExpiresAt.getTime(), creditRequiredPaise: result.creditRequiredPaise };
}

export async function bookingByToken(outletCode: string, token: string, now = new Date()) {
  const scope = await outletScope(db, outletCode);
  const [row] = await db.select().from(s.reservations).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.outletId, scope.outletId), eq(s.reservations.manageTokenHash, hash(token))));
  if (!row || !row.manageTokenExpiresAt || row.manageTokenExpiresAt <= now) throw new AppError("not_found", "This booking link is not valid or has expired.");
  return { row, scope };
}

/** Guest preorder menu, priced from the same tenant/outlet menu used by table ordering. */
export async function bookingPreorderMenu(outletCode: string) {
  const scope = await outletScope(db, outletCode);
  await requireFeature(scope.tenantId, "reservations", scope.outletId);
  const loaded = await loadItemsForBrowsing(scope, new Date());
  const categoryIds = [...new Set(loaded.map(({ item }) => item.categoryId))];
  const categories = categoryIds.length ? await db.select({ id: s.menuCategories.id, nameEn: s.menuCategories.nameEn, nameHi: s.menuCategories.nameHi, sortOrder: s.menuCategories.sortOrder })
    .from(s.menuCategories).where(and(eq(s.menuCategories.tenantId, scope.tenantId), inArray(s.menuCategories.id, categoryIds))) : [];
  const byCategory = new Map(categories.map((category) => [category.id, category]));
  return loaded.filter(({ pricing }) => pricing.isAvailable).map(({ item, pricing }) => ({
    id: item.id, nameEn: item.nameEn, nameHi: item.nameHi, pricePaise: pricing.pricePaise,
    categoryId: item.categoryId, categoryEn: byCategory.get(item.categoryId)?.nameEn ?? "Menu", categoryHi: byCategory.get(item.categoryId)?.nameHi ?? null,
    categorySort: byCategory.get(item.categoryId)?.sortOrder ?? 0, isVeg: item.isVeg, imageUrl: item.imageUrl ?? null,
    taxRateBp: item.taxRateBp, station: item.station, prepMinutes: Math.max(1, item.prepMinutes),
    allergens: item.allergens ?? null, isJain: item.isJain, spiceLevel: item.spiceLevel ?? null,
    groups: pricing.groups,
  }));
}

/** Save a bounded preorder and require its full amount as booking credit before confirmation. */
export async function saveBookingPreorder(outletCode: string, token: string, lines: { itemId: string; qty: number; modifierIds?: string[] }[], now = new Date()) {
  const scope = await outletScope(db, outletCode);
  await requireFeature(scope.tenantId, "reservations", scope.outletId);
  if (!Array.isArray(lines) || lines.length > 30) throw new AppError("invalid_state", "Choose up to 30 preorder items.");
  if (new Set(lines.map((line) => String(line.itemId))).size !== lines.length) throw new AppError("invalid_state", "Each preorder dish can only be listed once.");
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(s.reservations).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.outletId, scope.outletId), eq(s.reservations.manageTokenHash, hash(token)))).for("update");
    if (!row) throw new AppError("not_found", "This booking link is not valid.");
    if (row.status !== "requested" || !row.holdExpiresAt || row.holdExpiresAt <= now) throw new AppError("invalid_state", "Your table hold has expired. Start a new booking to change its preorder.");
    const [started] = await tx.select({ status: s.reservationCredits.status }).from(s.reservationCredits).where(and(eq(s.reservationCredits.tenantId, scope.tenantId), eq(s.reservationCredits.reservationId, row.id), inArray(s.reservationCredits.status, ["pending", "paid"]))).limit(1);
    if (started || row.manualAdvanceClaimedAt) throw new AppError("invalid_state", "The advance payment has already started, so the preorder is locked.");
    const items = await loadItems(tx, scope, now, [...new Set(lines.map((line) => String(line.itemId))) ]);
    const byId = new Map(items.map((loaded) => [loaded.item.id, loaded]));
    const snapshot: NonNullable<typeof row.preorder> = [];
    for (const line of lines) {
      const loaded = byId.get(String(line.itemId));
      const qty = Number(line.qty);
      if (!loaded || !isWithinCategoryWindow(loaded.categoryWindow, scope.timezone, row.startAt)) throw new AppError("invalid_state", "A selected dish is not available at your booked time.");
      const priced = priceLine(loaded.pricing, qty, [...new Set((line.modifierIds ?? []).map(String))]);
      if (!priced.ok) throw new AppError("invalid_state", "Please review the options for a selected dish.");
      snapshot.push({ itemId: loaded.item.id, nameEn: loaded.item.nameEn, nameHi: loaded.item.nameHi, qty, unitPricePaise: priced.line.unitPricePaise, taxRateBp: loaded.item.taxRateBp, station: loaded.item.station, prepMinutes: Math.max(1, loaded.item.prepMinutes), allergens: loaded.item.allergens ?? null, isJain: loaded.item.isJain, spiceLevel: loaded.item.spiceLevel ?? null, modifierChoices: priced.line.modifiers.map(({ groupId, modifierId }) => ({ groupId, modifierId })), modifiers: priced.line.modifiers.map(({ nameEn, nameHi, priceDeltaPaise }) => ({ nameEn, nameHi, priceDeltaPaise })) });
    }
    const previousTaxByRate = new Map<number, number>();
    for (const line of row.preorder ?? []) previousTaxByRate.set(line.taxRateBp, (previousTaxByRate.get(line.taxRateBp) ?? 0) + (line.qty * line.unitPricePaise * line.taxRateBp) / 10_000);
    const previousPreorderTotal = (row.preorder ?? []).reduce((sum, line) => sum + line.qty * line.unitPricePaise, 0)
      + [...previousTaxByRate.values()].reduce((sum, tax) => sum + roundHalfUp(tax), 0);
    const baseAdvance = Math.max(0, row.creditRequiredPaise - previousPreorderTotal);
    const preorderSubtotal = snapshot.reduce((sum, line) => sum + line.qty * line.unitPricePaise, 0);
    const taxByRate = new Map<number, number>();
    for (const line of snapshot) taxByRate.set(line.taxRateBp, (taxByRate.get(line.taxRateBp) ?? 0) + (line.qty * line.unitPricePaise * line.taxRateBp) / 10_000);
    const preorderTax = [...taxByRate.values()].reduce((sum, tax) => sum + roundHalfUp(tax), 0);
    const preorderTotal = preorderSubtotal + preorderTax;
    if (!Number.isSafeInteger(preorderTotal) || baseAdvance + preorderTotal > 2_000_000_000) throw new AppError("invalid_state", "Your preorder total is too high. Contact the restaurant to book.");
    await tx.update(s.reservations).set({ preorder: snapshot, creditRequiredPaise: baseAdvance + preorderTotal, creditStatus: baseAdvance + preorderTotal > 0 ? "required" : "none", updatedAt: now }).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, row.id)));
    return { preorder: snapshot, preorderTotalPaise: preorderTotal, creditRequiredPaise: baseAdvance + preorderTotal };
  }, LOCK_THEN_READ);
}

export async function confirmBooking(outletCode: string, token: string, input: { name: string; phone: string; guestId?: string | null; marketingConsent?: boolean }, now = new Date()) {
  const scope = await outletScope(db, outletCode);
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(s.reservations).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.outletId, scope.outletId), eq(s.reservations.manageTokenHash, hash(token)))).for("update");
    if (!row) throw new AppError("not_found", "This booking link is not valid.");
    if (!row.manageTokenExpiresAt || row.manageTokenExpiresAt <= now) throw new AppError("not_found", "This booking link has expired.");
    if (row.status === "confirmed") return { id: row.id, replayed: true };
    if (row.status !== "requested") throw new AppError("invalid_state", "This booking is no longer awaiting confirmation.");
    if (row.status === "requested" && (!row.holdExpiresAt || row.holdExpiresAt <= now)) throw new AppError("conflict", "Your booking hold expired. Please choose another time.", { reason: "hold_expired" });
    if (row.creditRequiredPaise > row.creditPaidPaise + row.advanceReceivedPaise) throw new AppError("payment_required", "The advance must be received before this booking can be confirmed.");
    if (!row.guestId || !row.phone || (input.guestId && input.guestId !== row.guestId)) throw new AppError("verification_required", "Verify your mobile number before confirming this booking.");
    const [verifiedGuest] = await tx.select({ id: s.guests.id }).from(s.guests).where(and(eq(s.guests.tenantId, scope.tenantId), eq(s.guests.id, row.guestId), eq(s.guests.phone, row.phone)));
    if (!verifiedGuest) throw new AppError("verification_required", "Verify your mobile number before confirming this booking.");
    const guestId = verifiedGuest.id;
    await tx.update(s.reservations).set({ status: "confirmed", confirmedAt: now, holdExpiresAt: null, holdReleasedAt: null, updatedAt: now }).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, row.id)));
    await tx.insert(s.reservationHistory).values({ tenantId: scope.tenantId, reservationId: row.id, kind: "confirmed", before: { status: row.status }, after: { status: "confirmed", guestId }, createdAt: now });
    return { id: row.id, replayed: false };
  }, LOCK_THEN_READ);
  await publish(scope, [{ topic: topics.floor, type: "booking.updated", data: { reservationId: result.id } }]);
  if (!result.replayed) await sendOutletPush(scope, {
    title: "New reservation", body: "A guest confirmed a reservation. Open reservations to review it.",
    url: "/console/reservations", tag: `booking-${result.id}`,
  }, { kind: "management" });
  const confirmed = (await bookingByToken(outletCode, token)).row;
  await queueReservationConfirmation(scope, confirmed, now);
  return { row: confirmed, scope };
}

export async function cancelBookingPublic(outletCode: string, token: string, reason = "guest_cancelled", now = new Date()) {
  const { row, scope } = await bookingByToken(outletCode, token);
  if (["cancelled", "no_show"].includes(row.status)) return { status: row.status, freeCancellation: false, manualRefundNeedsRestaurant: false };
  const policy = policyWithFallback(await loadPolicy(db, scope));
  let free = false;
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(s.reservations).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, row.id))).for("update");
    if (!locked) throw new AppError("not_found", "This booking is no longer available.");
    if (["cancelled", "no_show"].includes(locked.status)) return;
    free = now.getTime() <= locked.startAt.getTime() - policy.freeCancellationMinutes * 60_000;
    await tx.update(s.reservations).set({ status: "cancelled", cancelledAt: now, holdExpiresAt: null, holdReleasedAt: now, holdReleaseReason: reason, updatedAt: now }).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, row.id)));
    await tx.insert(s.reservationHistory).values({ tenantId: scope.tenantId, reservationId: row.id, kind: "cancelled", before: { status: locked.status }, after: { status: "cancelled", free, reason }, reason, createdAt: now });
  }, LOCK_THEN_READ);
  await publish(scope, [{ topic: topics.floor, type: "booking.cancelled", data: { reservationId: row.id } }]);
  if (free && row.creditPaidPaise > 0) await (await import("./credit")).refundReservationCredit(scope.tenantId, row.id);
  return { status: "cancelled", freeCancellation: free, manualRefundNeedsRestaurant: free && row.advanceReceivedPaise > 0 };
}

export async function lateBookingPublic(outletCode: string, token: string, now = new Date()) {
  const { row, scope } = await bookingByToken(outletCode, token);
  if (row.status !== "confirmed" && row.status !== "arrived") throw new AppError("invalid_state", "This booking cannot be extended now.");
  const [used] = await db.select({ id: s.reservationHistory.id }).from(s.reservationHistory).where(and(eq(s.reservationHistory.tenantId, scope.tenantId), eq(s.reservationHistory.reservationId, row.id), eq(s.reservationHistory.kind, "late_extended"))).limit(1);
  if (used) throw new AppError("conflict", "The late-arrival extension has already been used.");
  const policy = policyWithFallback(await loadPolicy(db, scope));
  await db.insert(s.reservationHistory).values({ tenantId: scope.tenantId, reservationId: row.id, kind: "late_extended", after: { minutes: policy.lateExtensionMinutes }, createdAt: now });
  await publish(scope, [{ topic: topics.floor, type: "booking.updated", data: { reservationId: row.id } }]);
  return { minutes: policy.lateExtensionMinutes };
}

export async function rescheduleBookingPublic(outletCode: string, token: string, input: { localDateTime: string }, now = new Date()) {
  const scope = await outletScope(db, outletCode);
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(s.reservations).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.outletId, scope.outletId), eq(s.reservations.manageTokenHash, hash(token)))).for("update");
    if (!row || ["cancelled", "no_show", "completed", "seated"].includes(row.status)) throw new AppError("invalid_state", "This booking cannot be rescheduled now.");
    const policy = policyWithFallback(await loadPolicy(tx, scope));
    await validateZone(tx, scope, row.requestedZoneId);
    const startAt = parseLocalDateTime(input.localDateTime, scope.timezone);
    const date = startAt ? serviceDate(startAt, scope.timezone) : "";
    if (!startAt || startAt.getTime() < now.getTime() + policy.onlineCutoffMinutes * 60_000) throw new AppError("conflict", "Choose a later online booking time.", { reason: "cutoff" });
    if (!slotStarts(date, scope, policy).some((slot) => slot.getTime() === startAt.getTime())) throw new AppError("invalid_state", "Choose one of the restaurant's available booking times.", { reason: "slot" });
    const latest = new Date(now.getTime() + policy.bookingWindowDays * 86_400_000);
    if (startAt > latest) throw new AppError("invalid_state", "This time is outside the restaurant's booking window.", { reason: "window" });
    if ((await exceptionFor(tx, scope, date))?.onlineBookingsPaused) throw new AppError("conflict", "Online bookings are paused for this date.", { reason: "paused" });
    const endAt = new Date(startAt.getTime() + diningMinutesFor(row.partySize, policy) * 60_000);
    const chosen = await chooseTables(tx, scope, startAt, endAt, row.partySize, { seatingPreference: row.seatingPreference, tableClass: row.requestedTableClass, zoneId: row.requestedZoneId }, now, true, row.id);
    if (!chosen) throw new AppError("conflict", "That new time is no longer available.", { reason: "full" });
    await tx.delete(s.reservationTables).where(and(eq(s.reservationTables.tenantId, scope.tenantId), eq(s.reservationTables.reservationId, row.id)));
    await tx.insert(s.reservationTables).values(chosen.map((t) => ({ id: uuidv7(), tenantId: scope.tenantId, reservationId: row.id, tableId: t.id })));
    await tx.update(s.reservations).set({ startAt, expectedEndAt: endAt, status: "confirmed", updatedAt: now }).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, row.id)));
    await tx.insert(s.reservationHistory).values({ tenantId: scope.tenantId, reservationId: row.id, kind: "rescheduled", before: { startAt: row.startAt, endAt: row.expectedEndAt }, after: { startAt, endAt, tableIds: chosen.map((t) => t.id) }, createdAt: now });
    return row.id;
  }, LOCK_THEN_READ);
  await publish(scope, [{ topic: topics.floor, type: "booking.updated", data: { reservationId: result } }]);
  return bookingByToken(outletCode, token);
}

/**
 * Staff reschedule from the calendar: same allocation rules as the public reschedule, but not the
 * online cutoff. Any time from 15 minutes ago onward is allowed, the same window as a booking
 * staff create. The new time is the outlet's wall clock, converted here on the server. The lifecycle never moves
 * forward or back by accident: requested stays requested, confirmed stays confirmed, and a
 * reminded booking goes back to confirmed because its reminder was for the old time. Parties
 * already here (arrived) and closed bookings cannot be moved.
 */
export async function rescheduleReservationStaff(staff: Pick<StaffSession, "tenantId" | "outletId" | "outlet" | "roles" | "userId" | "name">, reservationId: string, input: { localDateTime: string; partySize?: number }, now = new Date()) {
  if (!staff.roles.some((r) => r === "owner" || r === "manager")) throw new AppError("forbidden", "Only managers and owners can reschedule reservations.");
  const scope = { tenantId: staff.tenantId, brandId: "", outletId: staff.outletId, outletCode: staff.outlet.code, timezone: staff.outlet.timezone, openingHours: null as WeeklyHours | null, name: staff.outlet.name, address: "", city: "" };
  const startAt = parseLocalDateTime(input.localDateTime, staff.outlet.timezone);
  if (!startAt) throw new AppError("invalid_state", "Choose a valid date and time.", { reason: "start" });
  const events = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(s.reservations)
      .where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.outletId, scope.outletId), eq(s.reservations.id, String(reservationId))))
      .for("update");
    if (!row) throw new AppError("not_found", "This booking was not found.");
    if (row.status === "arrived") throw new AppError("invalid_state", "This party has arrived. Seat them or cancel instead of rescheduling.", { status: row.status });
    if (!RESCHEDULABLE.includes(row.status)) throw new AppError("invalid_state", `This booking is ${row.status.replace("_", " ")} and cannot be rescheduled.`, { status: row.status });
    if (row.status === "requested" && row.holdExpiresAt && row.holdExpiresAt > now) throw new AppError("conflict", "This online booking is still in progress.", { reason: "held" });
    const policy = policyWithFallback(await loadPolicy(tx, scope));
    if (startAt.getTime() < now.getTime() - STAFF_RESCHEDULE_PAST_MINUTES * 60_000) throw new AppError("conflict", "Choose a later reservation time.", { reason: "cutoff" });
    const partySize = input.partySize === undefined ? row.partySize : Number(input.partySize);
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 50) throw new AppError("invalid_state", "Enter how many guests.", { reason: "party_size" });
    const endAt = new Date(startAt.getTime() + diningMinutesFor(partySize, policy) * 60_000);
    const chosen = await chooseTables(tx, scope, startAt, endAt, partySize, { seatingPreference: row.seatingPreference, tableClass: row.requestedTableClass, zoneId: row.requestedZoneId }, now, true, row.id);
    if (!chosen) throw new AppError("conflict", "That time is no longer available.", { reason: "full" });
    const beforeTables = (await tx.select({ tableId: s.reservationTables.tableId }).from(s.reservationTables).where(and(eq(s.reservationTables.tenantId, scope.tenantId), eq(s.reservationTables.reservationId, row.id)))).map((t) => t.tableId);
    const tableIds = chosen.map((t) => t.id);
    const status = row.status === "reminded" ? "confirmed" : row.status;
    await tx.delete(s.reservationTables).where(and(eq(s.reservationTables.tenantId, scope.tenantId), eq(s.reservationTables.reservationId, row.id)));
    await tx.insert(s.reservationTables).values(tableIds.map((tableId) => ({ id: uuidv7(), tenantId: scope.tenantId, reservationId: row.id, tableId })));
    await tx
      .update(s.reservations)
      .set({ startAt, expectedEndAt: endAt, partySize, status, ...(row.status === "reminded" ? { remindedAt: null } : {}), updatedAt: now })
      .where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, row.id)));
    const before = { startAt: row.startAt, endAt: row.expectedEndAt, partySize: row.partySize, status: row.status, tableIds: beforeTables };
    const after = { startAt, endAt, partySize, status, tableIds };
    await tx.insert(s.reservationHistory).values({ tenantId: scope.tenantId, reservationId: row.id, kind: "rescheduled", actorUserId: staff.userId, before, after, reason: "staff_reschedule", createdAt: now });
    await audit(tx, staff, { action: "reservation.reschedule", entity: "reservation", entityId: row.id, before, after, now });
    const sync = await syncTableHolds(tx, scope, now, [...new Set([...beforeTables, ...tableIds])]);
    return [{ topic: topics.floor, type: "reservation.updated", data: { reservationId: row.id } }, ...syncEvents(sync)];
  }, LOCK_THEN_READ);
  await publish({ tenantId: staff.tenantId, outletId: staff.outletId }, events);
  return reservationId;
}

export async function arriveBookingPublic(outletCode: string, token: string, now = new Date()) {
  const { row, scope } = await bookingByToken(outletCode, token);
  if (row.status !== "confirmed" && row.status !== "arrived") throw new AppError("invalid_state", "This booking is not ready for arrival.");
  if (row.status === "arrived") return { status: "arrived" as const };
  await db.update(s.reservations).set({ status: "arrived", arrivedAt: now, updatedAt: now }).where(and(eq(s.reservations.tenantId, scope.tenantId), eq(s.reservations.id, row.id)));
  await db.insert(s.reservationHistory).values({ tenantId: scope.tenantId, reservationId: row.id, kind: "arrived", before: { status: row.status }, after: { status: "arrived" }, createdAt: now });
  await publish(scope, [{ topic: topics.floor, type: "booking.updated", data: { reservationId: row.id } }]);
  return { status: "arrived" as const };
}

export async function createGroupRequest(outletCode: string, input: { requestId: string; name: string; phone: string; partySize: number; desiredDate: string; desiredLocalDateTime: string; notes?: string | null; guestId?: string }) {
  const scope = await outletScope(db, outletCode); const partySize = Number(input.partySize);
  await requireOnlineBookings(scope);
  if (partySize <= 12 || partySize > 100 || !input.name.trim() || !input.phone.trim()) throw new AppError("invalid_state", "Group requests are for parties above 12 guests.");
  const desiredStartAt = parseLocalDateTime(input.desiredLocalDateTime, scope.timezone);
  if (!desiredStartAt || serviceDate(desiredStartAt, scope.timezone) !== input.desiredDate) throw new AppError("invalid_state", "Choose a valid event date and time.");
  const existing = await db.select({ id: s.groupRequests.id, publicReference: s.groupRequests.publicReference }).from(s.groupRequests).where(and(eq(s.groupRequests.tenantId, scope.tenantId), eq(s.groupRequests.requestId, input.requestId))).limit(1);
  if (existing[0]) return existing[0];
  const id = uuidv7(); const reference = publicRef();
  await db.insert(s.groupRequests).values({ id, tenantId: scope.tenantId, outletId: scope.outletId, publicReference: reference, requestId: input.requestId, guestId: input.guestId ?? null, name: input.name.trim().slice(0, 80), phone: input.phone.trim().slice(0, 15), partySize, desiredDate: input.desiredDate, desiredStartAt, notes: input.notes?.trim().slice(0, 500) || null, status: "requested" });
  // An event enquiry is not a confirmed booking. The guest sees a reference immediately, and the
  // restaurant follows up manually; never queue the standard booking-confirmation message here.
  await sendOutletPush(scope, { title: "New party request", body: `${input.name.trim()} requested a booking for ${partySize} guests.`, url: "/console/reservations", tag: `party-${id}` }, { kind: "management" });
  await publish(scope, [{ topic: topics.floor, type: "booking.group_request", data: { groupRequestId: id } }]);
  return { id, publicReference: reference };
}

export type BookingCore = typeof s.reservations.$inferSelect;
