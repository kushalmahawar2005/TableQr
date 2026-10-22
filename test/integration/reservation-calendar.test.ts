import { and, desc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { localTime, serviceDate } from "@/domain/booking-policy";
import { canSee, staffRoles } from "@/lib/staff-permissions";
import { createBookingHold, rescheduleBookingPublic, rescheduleReservationStaff } from "@/server/booking/core";
import { cancelReservation, createReservation } from "@/server/floor/reservations";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { createCalendarReservation, editReservationDetails, getReservationCalendar, updateGroupRequestStatus } from "@/server/staff/reservations";
import { resetTestDb } from "./setup-db";

let env: Awaited<ReturnType<typeof resetTestDb>>;
let owner: StaffSession;
let manager: StaffSession;
let host: StaffSession;
let waiter: StaffSession;
const realTz = process.env.TZ;

const signIn = async (phone: string, pin: string) => (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone, pin })).token))!;
/** An outlet calendar date `days` from today */
const dayAhead = (days: number) => serviceDate(new Date(Date.now() + days * 86_400_000), owner.outlet.timezone);
const at = (date: string, hh: number, mm = 0) => localTime(date, hh * 60 + mm, owner.outlet.timezone);
const row = async (id: string) => (await env.db.select().from(s.reservations).where(eq(s.reservations.id, id)))[0];
const setStatus = (id: string, patch: Partial<typeof s.reservations.$inferInsert>) => env.db.update(s.reservations).set(patch).where(eq(s.reservations.id, id));
const auditFor = (id: string, action: string) =>
  env.db
    .select()
    .from(s.auditLog)
    .where(and(eq(s.auditLog.entityId, id), eq(s.auditLog.action, action)))
    .orderBy(desc(s.auditLog.createdAt));
const historyFor = (id: string) => env.db.select().from(s.reservationHistory).where(eq(s.reservationHistory.reservationId, id));

beforeAll(async () => {
  env = await resetTestDb();
  owner = await signIn("9000000001", "1111");
  manager = await signIn("9000000002", "2222");
  host = await signIn("9000000004", "4444");
  waiter = await signIn("9000000005", "5555");
});
afterEach(() => {
  if (realTz === undefined) delete process.env.TZ;
  else process.env.TZ = realTz;
});
afterAll(async () => env.conn.end());

describe("reservation calendar read model", () => {
  it("shows outlet-scoped large-group enquiries and lets a host track a real call", async () => {
    const id = uuidv7();
    const date = dayAhead(8);
    await env.db.insert(s.groupRequests).values({ id, tenantId: owner.tenantId, outletId: owner.outletId, publicReference: `GR-${id.slice(-6)}`, requestId: `group-${id}`, name: "Event Guest", phone: "9876543210", partySize: 24, desiredDate: date, desiredStartAt: at(date, 19), notes: "Birthday dinner", status: "requested" });
    const before = await getReservationCalendar(owner, { date: dayAhead(1) });
    expect(before.groupRequests).toHaveLength(1);
    expect(before.groupRequests[0]).toMatchObject({ id, name: "Event Guest", partySize: 24, status: "requested", notes: "Birthday dinner" });

    await updateGroupRequestStatus(host, id, "contacted");
    const after = await getReservationCalendar(owner, { date: dayAhead(1) });
    expect(after.groupRequests[0].status).toBe("contacted");
    const [entry] = await auditFor(id, "group_request.status");
    expect(entry.actorUserId).toBe(host.userId);
    expect(entry.before).toEqual({ status: "requested" });
    expect(entry.after).toEqual({ status: "contacted" });
    await expect(updateGroupRequestStatus(waiter, id, "cancelled")).rejects.toMatchObject({ code: "forbidden" });
    await updateGroupRequestStatus(host, id, "cancelled");
    expect((await getReservationCalendar(owner)).groupRequests).toEqual([]);
  });

  it("scopes and groups day/week reservations without changing booking allocation", async () => {
    const date = dayAhead(1);
    const created = await createReservation(owner, { name: "Calendar Guest", phone: "9876543210", partySize: 2, startAt: at(date, 20).getTime(), tableIds: [env.demo.tableIds.T10], source: "phone", occasion: "Birthday", advanceReceivedPaise: 50_000 });
    const day = await getReservationCalendar(owner, { date, view: "day", search: "Calendar" });
    const week = await getReservationCalendar(owner, { date, view: "week", statuses: ["confirmed"] });
    expect(day.reservations.some((r) => r.id === created.reservationId && r.phone === "9876543210" && r.occasion === "Birthday" && r.advanceReceivedPaise === 50_000)).toBe(true);
    expect((await row(created.reservationId)).advanceReceivedPaise).toBe(50_000);
    expect(week.view).toBe("week");
    expect(week.timezone).toBe(owner.outlet.timezone);
    const [assignment] = await env.db.select().from(s.reservationTables).where(and(eq(s.reservationTables.tenantId, owner.tenantId), eq(s.reservationTables.reservationId, created.reservationId)));
    expect(assignment.tableId).toBe(env.demo.tableIds.T10);
  });

  it("S: finds guests case-insensitively in the real MySQL test database", async () => {
    const date = dayAhead(1);
    for (const search of ["calendar guest", "CALENDAR GUEST", "cAlEnDaR"]) {
      const res = await getReservationCalendar(owner, { date, search });
      expect(res.reservations.map((r) => r.name)).toContain("Calendar Guest");
    }
  });

  it("O: with no date it shows today in the outlet's time zone, not the server's", async () => {
    // 20:00 UTC on 4 Oct is already 5 Oct in India
    const now = new Date("2026-10-04T20:00:00Z");
    process.env.TZ = "America/New_York";
    const res = await getReservationCalendar(owner, {}, now);
    expect(owner.outlet.timezone).toBe("Asia/Kolkata");
    expect(res.date).toBe("2026-10-05");
    expect(res.today).toBe("2026-10-05");
  });

  it("10: bounds the waitlist to the live queue and parties who joined in the range", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 30 * 86_400_000);
    const base = { tenantId: owner.tenantId, outletId: owner.outletId, partySize: 2 };
    await env.db.insert(s.waitlistEntries).values([
      { ...base, id: uuidv7(), name: "Old Seated", status: "seated", sortOrder: 1, joinedAt: old },
      { ...base, id: uuidv7(), name: "Old Left", status: "left", sortOrder: 2, joinedAt: old },
      { ...base, id: uuidv7(), name: "Waiting Now", status: "waiting", sortOrder: 3, joinedAt: now },
    ]);
    const today = await getReservationCalendar(owner, {}, now);
    const names = today.waitlist.map((w) => w.name);
    expect(names).toContain("Waiting Now");
    expect(names).not.toContain("Old Seated");
    expect(names).not.toContain("Old Left");
    const future = await getReservationCalendar(owner, { date: dayAhead(3) }, now);
    expect(future.waitlist).toEqual([]);
    const past = await getReservationCalendar(owner, { date: serviceDate(old, owner.outlet.timezone) }, now);
    expect(past.waitlist.map((w) => w.name).sort()).toEqual(["Old Left", "Old Seated"]);
  });

  it("R: offers no-show only after the outlet policy's grace period", async () => {
    await env.db.insert(s.bookingPolicies).values({ id: uuidv7(), tenantId: owner.tenantId, outletId: owner.outletId, graceMinutes: 30, updatedAt: new Date() });
    try {
      const date = dayAhead(2);
      const start = at(date, 13);
      const { reservationId } = await createReservation(owner, { name: "Grace Guest", partySize: 2, startAt: start.getTime() });
      const view = async (minutesLate: number) => (await getReservationCalendar(owner, { date }, new Date(start.getTime() + minutesLate * 60_000))).reservations.find((r) => r.id === reservationId)!;
      expect((await view(20)).canNoShow).toBe(false); // past the old hardcoded 15, inside the policy's 30
      expect((await view(29)).canNoShow).toBe(false);
      expect((await view(30)).canNoShow).toBe(true);
      expect((await view(30)).lateMinutes).toBe(30);
      expect((await getReservationCalendar(owner, { date }, start)).graceMinutes).toBe(30);
    } finally {
      await env.db.delete(s.bookingPolicies).where(and(eq(s.bookingPolicies.tenantId, owner.tenantId), eq(s.bookingPolicies.outletId, owner.outletId)));
    }
  });
});

describe("guest-detail edits (patch semantics)", () => {
  let n = 0;
  async function fullBooking() {
    // A fresh day each time so the fixed table never clashes
    const { reservationId } = await createReservation(owner, { name: "Full Details", phone: "9811111111", partySize: 2, startAt: at(dayAhead(20 + n++), 19).getTime(), occasion: "Anniversary", notes: "Window table", tableIds: [env.demo.tableIds.T11] });
    await setStatus(reservationId, { seatingPreference: "window", requestedTableClass: "2-top", requestedZoneId: Object.values(env.demo.zoneIds)[0] });
    return { id: reservationId, before: await row(reservationId) };
  }

  it("A/B/C: editing name and phone preserves occasion, notes, seating and every other field", async () => {
    const { id, before } = await fullBooking();
    await editReservationDetails(owner, id, { name: "Renamed Guest", phone: "98222 22222" });
    const after = await row(id);
    expect(after.name).toBe("Renamed Guest");
    expect(after.phone).toBe("9822222222");
    expect(after.occasion).toBe("Anniversary");
    expect(after.notes).toBe("Window table");
    expect(after.seatingPreference).toBe("window");
    expect(after.requestedZoneId).toBe(before.requestedZoneId);
    expect(after.requestedTableClass).toBe("2-top");
    expect(after.startAt.getTime()).toBe(before.startAt.getTime());
    expect(after.status).toBe(before.status);
    expect(after.partySize).toBe(before.partySize);
  });

  it("clears a field only when that field is sent as empty", async () => {
    const { id } = await fullBooking();
    await editReservationDetails(owner, id, { notes: null });
    const after = await row(id);
    expect(after.notes).toBeNull();
    expect(after.occasion).toBe("Anniversary");
    expect(after.seatingPreference).toBe("window");
    await expect(editReservationDetails(owner, id, { name: "  " })).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("Q: an edit writes a staff audit entry with only the changed fields and no lifecycle history", async () => {
    const { id } = await fullBooking();
    const historyBefore = (await historyFor(id)).length;
    await editReservationDetails(owner, id, { name: "Audited Name", phone: "9811111111" });
    const [entry] = await auditFor(id, "reservation.edit");
    expect(entry.actorUserId).toBe(owner.userId);
    expect(entry.before).toEqual({ name: "Full Details" });
    expect(entry.after).toEqual({ name: "Audited Name" });
    const history = await historyFor(id);
    expect(history.length).toBe(historyBefore);
    expect(history.some((h) => h.kind === "created" && h.reason === "staff_edit")).toBe(false);
    // Saving with nothing changed writes nothing
    await editReservationDetails(owner, id, { name: "Audited Name" });
    expect((await auditFor(id, "reservation.edit")).length).toBe(1);
  });

  it("D: an edit is applied only to the booking named, never another", async () => {
    const a = await fullBooking();
    const b = await createReservation(owner, { name: "Booking B", phone: "9833333333", partySize: 2, startAt: at(dayAhead(4), 21).getTime(), notes: "B notes" });
    await editReservationDetails(owner, b.reservationId, { name: "Booking B edited" });
    expect((await row(a.id)).name).toBe("Full Details");
    const bRow = await row(b.reservationId);
    expect(bRow.name).toBe("Booking B edited");
    expect(bRow.phone).toBe("9833333333");
    expect(bRow.notes).toBe("B notes");
  });
});

describe("outlet-local times (create and reschedule)", () => {
  it("E/G: the same local input stores the same instant whatever the process time zone", async () => {
    const date = dayAhead(5);
    const ids: string[] = [];
    for (const tz of ["UTC", "America/New_York", "Asia/Kolkata"]) {
      process.env.TZ = tz;
      const { reservationId } = await createCalendarReservation(owner, { name: `TZ ${tz}`, partySize: 2, localDateTime: `${date}T20:00` });
      ids.push(reservationId);
    }
    const expected = at(date, 20).getTime();
    for (const id of ids) expect((await row(id)).startAt.getTime()).toBe(expected);
    // 20:00 IST is 14:30 UTC
    expect(new Date(expected).toISOString().slice(11, 16)).toBe("14:30");
    await expect(createCalendarReservation(owner, { name: "Bad", partySize: 2, localDateTime: "2026-02-30T20:00" })).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("F/G: reschedule converts outlet-local input on the server, the same under any process time zone", async () => {
    const date = dayAhead(6);
    for (const [tz, hh] of [
      ["UTC", 18],
      ["America/New_York", 19],
    ] as const) {
      const { reservationId } = await createReservation(owner, { name: `Move ${tz}`, partySize: 2, startAt: at(date, 12).getTime() });
      process.env.TZ = tz;
      await rescheduleReservationStaff(owner, reservationId, { localDateTime: `${date}T${hh}:30` });
      expect((await row(reservationId)).startAt.getTime()).toBe(at(date, hh, 30).getTime());
    }
  });
});

describe("reschedule lifecycle safety", () => {
  const make = async (name: string, hh: number) => (await createReservation(owner, { name, partySize: 2, startAt: at(dayAhead(7), hh).getTime() })).reservationId;
  const moveTo = (id: string, hh: number) => rescheduleReservationStaff(owner, id, { localDateTime: `${dayAhead(8)}T${String(hh).padStart(2, "0")}:00` });

  it("H: a requested booking stays requested", async () => {
    const id = await make("Requested", 12);
    await setStatus(id, { status: "requested", confirmedAt: null });
    await moveTo(id, 12);
    const r = await row(id);
    expect(r.status).toBe("requested");
    expect(r.confirmedAt).toBeNull();
  });

  it("a confirmed booking stays confirmed; a reminded one goes back to confirmed so it is reminded again", async () => {
    const confirmed = await make("Confirmed", 13);
    await moveTo(confirmed, 13);
    expect((await row(confirmed)).status).toBe("confirmed");
    const reminded = await make("Reminded", 14);
    await setStatus(reminded, { status: "reminded", remindedAt: new Date() });
    await moveTo(reminded, 14);
    const r = await row(reminded);
    expect(r.status).toBe("confirmed");
    expect(r.remindedAt).toBeNull();
  });

  it("I: an arrived party is refused and keeps its status", async () => {
    const id = await make("Arrived", 15);
    await setStatus(id, { status: "arrived", arrivedAt: new Date() });
    const before = await row(id);
    await expect(moveTo(id, 15)).rejects.toMatchObject({ code: "invalid_state" });
    const after = await row(id);
    expect(after.status).toBe("arrived");
    expect(after.startAt.getTime()).toBe(before.startAt.getTime());
  });

  it("J: seated, completed, cancelled and no-show bookings and live online holds are refused explicitly", async () => {
    for (const status of ["seated", "completed", "cancelled", "no_show"] as const) {
      const id = await make(`Closed ${status}`, 16);
      await setStatus(id, { status });
      await expect(moveTo(id, 16)).rejects.toMatchObject({ code: "invalid_state" });
      expect((await row(id)).status).toBe(status);
    }
    const held = await make("Online hold", 17);
    await setStatus(held, { status: "requested", holdExpiresAt: new Date(Date.now() + 5 * 60_000) });
    await expect(moveTo(held, 17)).rejects.toMatchObject({ code: "conflict" });
  });

  it("P: writes reservation history and a staff audit entry with before and after", async () => {
    const id = await make("Audited Move", 18);
    const before = await row(id);
    await moveTo(id, 19);
    const history = (await historyFor(id)).filter((h) => h.kind === "rescheduled");
    expect(history).toHaveLength(1);
    expect(history[0].actorUserId).toBe(owner.userId);
    expect(history[0].reason).toBe("staff_reschedule");
    expect(history[0].before).toMatchObject({ status: "confirmed", partySize: 2, startAt: before.startAt.toISOString() });
    expect(history[0].after).toMatchObject({ status: "confirmed", startAt: at(dayAhead(8), 19).toISOString() });
    const [entry] = await auditFor(id, "reservation.reschedule");
    expect(entry.actorUserId).toBe(owner.userId);
    expect((entry.after as { tableIds: string[] }).tableIds.length).toBeGreaterThan(0);
  });
});

describe("staff reschedule time window", () => {
  // The outlet clock is fixed at 19:00 on a quiet day, with the online cutoff saved at 60 minutes
  let date: string;
  let now: Date;
  const local = (hh: number, mm: number) => `${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  const make = async (name: string) => (await createReservation(owner, { name, partySize: 2, startAt: at(date, 13).getTime() })).reservationId;
  beforeAll(async () => {
    date = dayAhead(30);
    now = at(date, 19);
    await env.db.insert(s.bookingPolicies).values({ id: uuidv7(), tenantId: owner.tenantId, outletId: owner.outletId, onlineCutoffMinutes: 60, updatedAt: new Date() });
  });
  afterAll(() => env.db.delete(s.bookingPolicies).where(and(eq(s.bookingPolicies.tenantId, owner.tenantId), eq(s.bookingPolicies.outletId, owner.outletId))));

  it("Owner and Manager can move a booking to 30 minutes from now, inside the 60-minute online cutoff", async () => {
    for (const staff of [owner, manager]) {
      const id = await make(`Soon ${staff.roles.join()}`);
      await rescheduleReservationStaff(staff, id, { localDateTime: local(19, 30) }, now);
      expect((await row(id)).startAt.getTime()).toBe(at(date, 19, 30).getTime());
    }
  });

  it("a guest moving their own booking to 30 minutes from now is still refused by the online cutoff", async () => {
    const hold = await createBookingHold("SRJ01", { date, startAt: at(date, 21).getTime(), partySize: 2, requestId: "staff-window-public", holdToken: "staff-window-public-token" }, at(date, 12));
    await expect(rescheduleBookingPublic("SRJ01", hold.manageToken, { date, startAt: at(date, 19, 30).getTime() }, now)).rejects.toMatchObject({ code: "conflict", details: { reason: "cutoff" } });
    expect((await row(hold.reservationId)).startAt.getTime()).toBe(at(date, 21).getTime());
    // The cutoff itself is unchanged: 60 minutes ahead is accepted
    await rescheduleBookingPublic("SRJ01", hold.manageToken, { date, startAt: at(date, 20).getTime() }, now);
    expect((await row(hold.reservationId)).startAt.getTime()).toBe(at(date, 20).getTime());
  });

  it("staff cannot move a booking more than 15 minutes into the past", async () => {
    for (const staff of [owner, manager]) {
      const id = await make(`Too early ${staff.roles.join()}`);
      await expect(rescheduleReservationStaff(staff, id, { localDateTime: local(18, 44) }, now)).rejects.toMatchObject({ code: "conflict", details: { reason: "cutoff" } });
      expect((await row(id)).startAt.getTime()).toBe(at(date, 13).getTime());
    }
  });

  it("staff can correct a booking to exactly 15 minutes ago or anything since", async () => {
    const exact = await make("Exactly 15 back");
    await rescheduleReservationStaff(manager, exact, { localDateTime: local(18, 45) }, now);
    expect((await row(exact)).startAt.getTime()).toBe(at(date, 18, 45).getTime());
    const within = await make("5 back");
    await rescheduleReservationStaff(owner, within, { localDateTime: local(18, 55) }, now);
    expect((await row(within)).startAt.getTime()).toBe(at(date, 18, 55).getTime());
  });

  it("Host is still refused, even inside the staff window", async () => {
    const id = await make("Host window");
    await expect(rescheduleReservationStaff(host, id, { localDateTime: local(19, 30) }, now)).rejects.toMatchObject({ code: "forbidden" });
    expect((await row(id)).startAt.getTime()).toBe(at(date, 13).getTime());
  });
});

describe("T: role authorization", () => {
  it("only Owner, Manager and Host see the Reservations section", () => {
    expect(staffRoles.filter((r) => canSee([r], "reservations")).sort()).toEqual(["host", "manager", "owner"]);
  });

  it("Host reads and operates bookings but cannot edit guest details or reschedule", async () => {
    const date = dayAhead(9);
    const { reservationId } = await createReservation(owner, { name: "Host Case", partySize: 2, startAt: at(date, 20).getTime() });
    const view = await getReservationCalendar(host, { date });
    expect(view.mayEdit).toBe(false);
    expect(view.mayOperate).toBe(true);
    await expect(editReservationDetails(host, reservationId, { name: "Blocked" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(rescheduleReservationStaff(host, reservationId, { localDateTime: `${date}T21:00` })).rejects.toMatchObject({ code: "forbidden" });
    expect((await row(reservationId)).name).toBe("Host Case");
    await cancelReservation(host, reservationId);
    expect((await row(reservationId)).status).toBe("cancelled");
  });

  it("Waiter is refused by the server", async () => {
    await expect(getReservationCalendar(waiter, {})).rejects.toMatchObject({ code: "forbidden" });
    await expect(createCalendarReservation(waiter, { name: "x", partySize: 2, localDateTime: `${dayAhead(9)}T20:00` })).rejects.toMatchObject({ code: "forbidden" });
  });
});
