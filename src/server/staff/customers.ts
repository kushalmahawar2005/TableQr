import "server-only";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { canSee } from "@/lib/staff-permissions";
import { AppError } from "../errors";
import type { StaffSession } from "./auth";

// Customers: everyone this restaurant has a phone number for, from table verification, bookings,
// the waitlist and bills sent on WhatsApp, joined up by phone. Shows how often they come and when
// they last did, so the owner knows the regulars. Offers go only to people who agreed to them.

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "roles">;

export type Customer = {
  phone: string;
  name: string | null;
  visits: number;
  lastVisitAt: number | null;
  bookings: number;
  noShows: number;
  spendPaise: number;
  offersOk: boolean;
  firstSeenAt: number | null;
};

const normal = (phone: string | null | undefined) => {
  const d = String(phone ?? "").replace(/\D/g, "");
  const local = d.length === 12 && d.startsWith("91") ? d.slice(2) : d;
  return local.length >= 10 ? local.slice(-10) : null;
};

export async function getCustomers(staff: Staff): Promise<Customer[]> {
  if (!canSee(staff.roles, "customers")) throw new AppError("forbidden", "Your role cannot see customers.");
  const [guests, visits, reservations, waitlist] = await Promise.all([
    db.select().from(s.guests).where(eq(s.guests.tenantId, staff.tenantId)),
    // One row per guest per visit, with that table's paid total
    db
      .selectDistinct({ guestId: s.participants.guestId, sessionId: s.tableSessions.id, openedAt: s.tableSessions.openedAt, spend: s.bills.totalPaise, billStatus: s.bills.status })
      .from(s.participants)
      .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.participants.tenantId), eq(s.tableSessions.id, s.participants.sessionId)))
      .leftJoin(s.bills, and(eq(s.bills.tenantId, s.tableSessions.tenantId), eq(s.bills.sessionId, s.tableSessions.id)))
      .where(and(eq(s.participants.tenantId, staff.tenantId), isNotNull(s.participants.guestId))),
    db
      .select({ phone: s.reservations.phone, name: s.reservations.name, status: s.reservations.status, startAt: s.reservations.startAt, createdAt: s.reservations.createdAt })
      .from(s.reservations)
      .where(and(eq(s.reservations.tenantId, staff.tenantId), isNotNull(s.reservations.phone))),
    db
      .select({ phone: s.waitlistEntries.phone, name: s.waitlistEntries.name, joinedAt: s.waitlistEntries.joinedAt })
      .from(s.waitlistEntries)
      .where(and(eq(s.waitlistEntries.tenantId, staff.tenantId), isNotNull(s.waitlistEntries.phone))),
  ]);

  const byPhone = new Map<string, Customer>();
  const get = (phone: string, name: string | null, seen: Date | null) => {
    let c = byPhone.get(phone);
    if (!c) {
      c = { phone, name: null, visits: 0, lastVisitAt: null, bookings: 0, noShows: 0, spendPaise: 0, offersOk: false, firstSeenAt: null };
      byPhone.set(phone, c);
    }
    if (!c.name && name && name.trim() && !/^pending guest$/i.test(name.trim())) c.name = name.trim();
    if (seen && (c.firstSeenAt === null || seen.getTime() < c.firstSeenAt)) c.firstSeenAt = seen.getTime();
    return c;
  };

  const phoneOfGuest = new Map<string, string>();
  for (const g of guests) {
    const phone = normal(g.phone);
    if (!phone) continue;
    phoneOfGuest.set(g.id, phone);
    const c = get(phone, g.name, g.firstSeenAt);
    c.offersOk = c.offersOk || g.consentMarketing;
    c.noShows = Math.max(c.noShows, g.noShowCount);
  }
  const counted = new Set<string>();
  for (const v of visits) {
    const phone = v.guestId ? phoneOfGuest.get(v.guestId) : undefined;
    if (!phone || counted.has(`${phone}:${v.sessionId}`)) continue;
    counted.add(`${phone}:${v.sessionId}`);
    const c = get(phone, null, v.openedAt);
    c.visits++;
    c.lastVisitAt = Math.max(c.lastVisitAt ?? 0, v.openedAt.getTime());
    if (v.billStatus === "paid") c.spendPaise += v.spend ?? 0;
  }
  const noShowFromBookings = new Map<string, number>();
  for (const r of reservations) {
    const phone = normal(r.phone);
    if (!phone) continue;
    const c = get(phone, r.name, r.createdAt);
    if (r.status === "cancelled") continue;
    c.bookings++;
    if (r.status === "no_show") noShowFromBookings.set(phone, (noShowFromBookings.get(phone) ?? 0) + 1);
  }
  for (const [phone, n] of noShowFromBookings) {
    const c = byPhone.get(phone)!;
    c.noShows = Math.max(c.noShows, n);
  }
  for (const w of waitlist) {
    const phone = normal(w.phone);
    if (phone) get(phone, w.name, w.joinedAt);
  }
  return [...byPhone.values()].sort((a, b) => (b.lastVisitAt ?? b.firstSeenAt ?? 0) - (a.lastVisitAt ?? a.firstSeenAt ?? 0));
}

/**
 * Keeps the number a bill was sent to on WhatsApp, so walk-in guests join the customer list. It is
 * linked to the guests at that table; offers stay off until the guest agrees to them.
 */
export async function rememberCustomer(staff: Pick<StaffSession, "tenantId" | "outletId">, input: { sessionId: string; phone: string; name?: string | null }, now = new Date()) {
  const phone = normal(input.phone);
  if (!phone || !/^[6-9]\d{9}$/.test(phone)) throw new AppError("invalid_state", "Enter a 10-digit mobile number.", { reason: "phone" });
  const [session] = await db.select({ id: s.tableSessions.id }).from(s.tableSessions).where(and(eq(s.tableSessions.tenantId, staff.tenantId), eq(s.tableSessions.outletId, staff.outletId), eq(s.tableSessions.id, String(input.sessionId))));
  if (!session) throw new AppError("not_found", "That table visit is not at this outlet.");
  const name = String(input.name ?? "").trim().slice(0, 80) || null;
  await db
    .insert(s.guests)
    .values({ tenantId: staff.tenantId, phone, name, lastSeenAt: now })
    .onDuplicateKeyUpdate({ set: { lastSeenAt: now, ...(name ? { name: sql`coalesce(${s.guests.name}, ${name})` } : {}) } });
  const [guest] = await db.select({ id: s.guests.id }).from(s.guests).where(and(eq(s.guests.tenantId, staff.tenantId), eq(s.guests.phone, phone)));
  // Link the people at the table who are not linked to anyone yet, so this visit counts for them
  const people = await db.select({ id: s.participants.id, guestId: s.participants.guestId }).from(s.participants).where(and(eq(s.participants.tenantId, staff.tenantId), eq(s.participants.sessionId, session.id)));
  const loose = people.filter((p) => !p.guestId).map((p) => p.id);
  if (guest && loose.length === people.length && loose.length > 0) {
    await db.update(s.participants).set({ guestId: guest.id }).where(and(eq(s.participants.tenantId, staff.tenantId), inArray(s.participants.id, loose.slice(0, 1))));
  }
  return { phone };
}
