import "server-only";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { canSee } from "@/lib/staff-permissions";
import { AppError } from "../errors";
import type { StaffSession } from "./auth";
import { requireFeature } from "../plan";
import { isPlaceholderName } from "@/domain/guest-name";

// Customers: everyone this restaurant has a phone number for, from table verification, bookings,
// the waitlist and bills sent on WhatsApp, joined up by phone. Shows how often they come and when
// they last did, so the owner knows the regulars. Offers go only to people who agreed to them.

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "roles" | "access">;

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
  /** Staff stopped this number from table and cash orders */
  blocked?: boolean;
  /** Who else sat at the table on their last visit: names first, then how many gave no name */
  companions: { names: string[]; unnamed: number };
};

const normal = (phone: string | null | undefined) => {
  const d = String(phone ?? "").replace(/\D/g, "");
  const local = d.length === 12 && d.startsWith("91") ? d.slice(2) : d;
  return local.length >= 10 ? local.slice(-10) : null;
};

export type CustomerFilter = "all" | "regulars" | "offers" | "away";
export const CUSTOMERS_PAGE_SIZE = 50;
const DAY = 86_400_000;
const CHUNK = 400;

export type CustomersPage = {
  customers: Customer[];
  /** How many people each filter holds, whatever the search says */
  counts: Record<CustomerFilter, number>;
  total: number;
  page: number;
  pages: number;
};

/**
 * One page of customers. The heavy part runs in SQL (one row per guest, per phone), so memory and
 * time stay flat as visits pile up; only the people on this page get their "came with" names.
 * `all` returns every match (for the CSV), still without loading each visit.
 */
export async function getCustomers(
  staff: Staff,
  opts: { q?: string; filter?: CustomerFilter; page?: number; all?: boolean } = {},
  now = Date.now(),
): Promise<CustomersPage> {
  if (!canSee(staff, "customers")) throw new AppError("forbidden", "Your role cannot see customers.");
  await requireFeature(staff.tenantId, "whatsappBills");
  const t = staff.tenantId;
  const perVisit = db
    .selectDistinct({
      guestId: s.participants.guestId,
      sessionId: s.tableSessions.id,
      openedAt: s.tableSessions.openedAt,
      spend: sql<number>`case when ${s.bills.status} = 'paid' then ${s.bills.totalPaise} else 0 end`.as("spend"),
    })
    .from(s.participants)
    .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.participants.tenantId), eq(s.tableSessions.id, s.participants.sessionId)))
    .leftJoin(s.bills, and(eq(s.bills.tenantId, s.tableSessions.tenantId), eq(s.bills.sessionId, s.tableSessions.id)))
    .where(and(eq(s.participants.tenantId, t), isNotNull(s.participants.guestId)))
    .as("pv");
  const [guests, visitStats, reservations, waitlist] = await Promise.all([
    db.select({ id: s.guests.id, phone: s.guests.phone, name: s.guests.name, firstSeenAt: s.guests.firstSeenAt, consentMarketing: s.guests.consentMarketing, noShowCount: s.guests.noShowCount }).from(s.guests).where(eq(s.guests.tenantId, t)),
    // One row per guest: visits, last visit and what their tables paid
    db
      .select({
        guestId: perVisit.guestId,
        visits: sql<number>`count(*)`.mapWith(Number),
        last: sql<Date>`max(${perVisit.openedAt})`.mapWith(s.tableSessions.openedAt),
        first: sql<Date>`min(${perVisit.openedAt})`.mapWith(s.tableSessions.openedAt),
        spend: sql<number>`coalesce(sum(${perVisit.spend}), 0)`.mapWith(Number),
      })
      .from(perVisit)
      .groupBy(perVisit.guestId),
    // One row per phone number used on a booking
    db
      .select({
        phone: s.reservations.phone,
        name: sql<string | null>`max(case when lower(trim(${s.reservations.name})) <> 'pending guest' and trim(${s.reservations.name}) <> '' then ${s.reservations.name} end)`,
        bookings: sql<number>`sum(${s.reservations.status} <> 'cancelled')`.mapWith(Number),
        noShows: sql<number>`sum(${s.reservations.status} = 'no_show')`.mapWith(Number),
        first: sql<Date>`min(${s.reservations.createdAt})`.mapWith(s.reservations.createdAt),
      })
      .from(s.reservations)
      .where(and(eq(s.reservations.tenantId, t), isNotNull(s.reservations.phone)))
      .groupBy(s.reservations.phone),
    db
      .select({ phone: s.waitlistEntries.phone, name: sql<string | null>`max(${s.waitlistEntries.name})`, first: sql<Date>`min(${s.waitlistEntries.joinedAt})`.mapWith(s.waitlistEntries.joinedAt) })
      .from(s.waitlistEntries)
      .where(and(eq(s.waitlistEntries.tenantId, t), isNotNull(s.waitlistEntries.phone)))
      .groupBy(s.waitlistEntries.phone),
  ]);

  const byPhone = new Map<string, Customer>();
  const get = (phone: string, name: string | null, seen: Date | null) => {
    let c = byPhone.get(phone);
    if (!c) {
      c = { phone, name: null, visits: 0, lastVisitAt: null, bookings: 0, noShows: 0, spendPaise: 0, offersOk: false, firstSeenAt: null, companions: { names: [], unnamed: 0 } };
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
  for (const v of visitStats) {
    const phone = v.guestId ? phoneOfGuest.get(v.guestId) : undefined;
    if (!phone) continue;
    const c = get(phone, null, v.first);
    c.visits += v.visits;
    c.lastVisitAt = Math.max(c.lastVisitAt ?? 0, v.last.getTime());
    c.spendPaise += v.spend;
  }
  for (const r of reservations) {
    const phone = normal(r.phone);
    if (!phone) continue;
    const c = get(phone, r.name, r.first);
    c.bookings += r.bookings;
    c.noShows = Math.max(c.noShows, r.noShows);
  }
  for (const w of waitlist) {
    const phone = normal(w.phone);
    if (phone) get(phone, w.name, w.first);
  }

  const everyone = [...byPhone.values()];
  const away = (c: Customer) => c.lastVisitAt !== null && now - c.lastVisitAt > 30 * DAY;
  const counts = { all: everyone.length, regulars: everyone.filter((c) => c.visits >= 3).length, offers: everyone.filter((c) => c.offersOk).length, away: everyone.filter(away).length };
  const filter = opts.filter ?? "all";
  const q = String(opts.q ?? "").trim().toLowerCase().replace(/\s/g, "");
  const matches = everyone
    .filter((c) => {
      if (q && !`${c.name ?? ""}${c.phone}`.toLowerCase().replace(/\s/g, "").includes(q)) return false;
      if (filter === "regulars") return c.visits >= 3;
      if (filter === "offers") return c.offersOk;
      if (filter === "away") return away(c);
      return true;
    })
    .sort((a, b) => (b.lastVisitAt ?? b.firstSeenAt ?? 0) - (a.lastVisitAt ?? a.firstSeenAt ?? 0));

  const pages = Math.max(1, Math.ceil(matches.length / CUSTOMERS_PAGE_SIZE));
  const page = opts.all ? 1 : Math.min(pages, Math.max(1, Math.floor(opts.page ?? 1) || 1));
  const shown = opts.all ? matches : matches.slice((page - 1) * CUSTOMERS_PAGE_SIZE, page * CUSTOMERS_PAGE_SIZE);
  await addCompanions(t, shown, phoneOfGuest);
  const blocked = await db.select({ phone: s.guests.phone }).from(s.guests).where(and(eq(s.guests.tenantId, staff.tenantId), isNotNull(s.guests.blockedAt)));
  const blockedPhones = new Set(blocked.map((guest) => normal(guest.phone)));
  return { customers: shown.map((customer) => ({ ...customer, blocked: blockedPhones.has(customer.phone) })), counts, total: matches.length, page, pages };
}

/** Who else sat at the table on each shown guest's last visit. Only these guests are looked up. */
async function addCompanions(tenantId: string, shown: Customer[], phoneOfGuest: Map<string, string>) {
  const guestIdsOf = new Map<string, string[]>();
  for (const [guestId, phone] of phoneOfGuest) guestIdsOf.set(phone, [...(guestIdsOf.get(phone) ?? []), guestId]);
  const wanted = new Set(shown.map((c) => c.phone));
  const ids = shown.flatMap((c) => guestIdsOf.get(c.phone) ?? []);
  const lastSession = new Map<string, { sessionId: string; at: number }>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = await db
      .selectDistinct({ guestId: s.participants.guestId, sessionId: s.tableSessions.id, openedAt: s.tableSessions.openedAt })
      .from(s.participants)
      .innerJoin(s.tableSessions, and(eq(s.tableSessions.tenantId, s.participants.tenantId), eq(s.tableSessions.id, s.participants.sessionId)))
      .where(and(eq(s.participants.tenantId, tenantId), inArray(s.participants.guestId, ids.slice(i, i + CHUNK))));
    for (const r of rows) {
      const phone = r.guestId ? phoneOfGuest.get(r.guestId) : undefined;
      if (!phone || !wanted.has(phone)) continue;
      const at = r.openedAt.getTime();
      if (at >= (lastSession.get(phone)?.at ?? 0)) lastSession.set(phone, { sessionId: r.sessionId, at });
    }
  }
  const sessionIds = [...new Set([...lastSession.values()].map((v) => v.sessionId))];
  const people: { sessionId: string; name: string; guestId: string | null }[] = [];
  for (let i = 0; i < sessionIds.length; i += CHUNK) {
    people.push(...(await db
      .select({ sessionId: s.participants.sessionId, name: s.participants.displayName, guestId: s.participants.guestId })
      .from(s.participants)
      .where(and(eq(s.participants.tenantId, tenantId), inArray(s.participants.sessionId, sessionIds.slice(i, i + CHUNK))))
      .orderBy(s.participants.joinedAt)));
  }
  const bySession = new Map<string, typeof people>();
  for (const p of people) bySession.set(p.sessionId, [...(bySession.get(p.sessionId) ?? []), p]);
  for (const c of shown) {
    const last = lastSession.get(c.phone);
    if (!last) continue;
    for (const p of bySession.get(last.sessionId) ?? []) {
      if (p.guestId && phoneOfGuest.get(p.guestId) === c.phone) continue;
      const name = p.name.trim();
      if (!name || isPlaceholderName(name)) c.companions.unnamed++;
      else if (!c.companions.names.includes(name) && name !== c.name) c.companions.names.push(name);
    }
  }
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
