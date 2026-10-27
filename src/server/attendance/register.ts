import "server-only";
import { and, between, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { csvRows, datesOfMonth, isDate, isMonth, isStatus, monthCounts, STATUS_LABEL, STATUSES, type AttendanceStatus, type MonthCounts } from "@/lib/attendance";
import { canSee } from "@/lib/staff-permissions";
import { AppError } from "../errors";
import { audit } from "../staff/audit";
import { outletsFor, type StaffSession } from "../staff/auth";

// The attendance register: for each person and day, Present, Half day, Absent, Leave or Week off,
// marked by a manager or owner at an outlet they have a role at. One mark per person per day.

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "userId" | "name" | "roles" | "access" | "outlet">;

export const NOTE_MAX = 200;

function assertMay(staff: Staff) {
  if (!canSee(staff, "attendance")) throw new AppError("forbidden", "Your role cannot see attendance.");
}

/** The outlet the request is about, which must be one this person has a role at */
async function outletOf(staff: Staff, requested?: string) {
  const outlets = await outletsFor(staff);
  const id = requested || staff.outletId;
  const outlet = outlets.find((o) => o.id === id);
  if (!outlet) throw new AppError("forbidden", "You don't have access to that outlet.");
  const [row] = await db.select({ timezone: s.outlets.timezone }).from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, id)));
  return { id, name: outlet.name, timezone: row?.timezone ?? staff.outlet.timezone, outlets };
}

/** The outlet's own date for an instant */
export const localDate = (at: Date | number, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

async function roster(tenantId: string, outletId: string) {
  const rows = await db
    .select({ id: s.users.id, name: s.users.name, photoUrl: s.users.photoUrl, role: s.staffRoles.role })
    .from(s.staffRoles)
    .innerJoin(s.users, and(eq(s.users.tenantId, s.staffRoles.tenantId), eq(s.users.id, s.staffRoles.userId)))
    .where(and(eq(s.staffRoles.tenantId, tenantId), eq(s.users.isActive, true), or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, outletId))));
  const people = new Map<string, { id: string; name: string; photoUrl: string | null; roles: string[] }>();
  for (const r of rows) {
    const p = people.get(r.id) ?? { id: r.id, name: r.name, photoUrl: r.photoUrl, roles: [] };
    if (!p.roles.includes(r.role)) p.roles.push(r.role);
    people.set(r.id, p);
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type RegisterPerson = { id: string; name: string; photoUrl: string | null; roles: string[]; status: AttendanceStatus | null; note: string | null };
export type Register = {
  date: string;
  today: string;
  outletId: string;
  outlets: { id: string; name: string }[];
  people: RegisterPerson[];
  counts: Record<AttendanceStatus | "unmarked", number>;
};

export async function getRegister(staff: Staff, input: { date?: string; outletId?: string } = {}, now = new Date()): Promise<Register> {
  assertMay(staff);
  const outlet = await outletOf(staff, input.outletId);
  const today = localDate(now, outlet.timezone);
  const date = isDate(input.date) ? input.date : today;
  const people = await roster(staff.tenantId, outlet.id);
  const marks = people.length ? await db.select().from(s.attendanceMarks).where(and(eq(s.attendanceMarks.tenantId, staff.tenantId), eq(s.attendanceMarks.markDate, date), inArray(s.attendanceMarks.userId, people.map((p) => p.id)))) : [];
  const byUser = new Map(marks.map((m) => [m.userId, m]));
  const rows = people.map((p) => ({ ...p, status: byUser.get(p.id)?.status ?? null, note: byUser.get(p.id)?.note ?? null }));
  const counts = { present: 0, half_day: 0, absent: 0, leave: 0, week_off: 0, unmarked: 0 };
  for (const r of rows) counts[r.status ?? "unmarked"]++;
  return { date, today, outletId: outlet.id, outlets: outlet.outlets, people: rows, counts };
}

/** Marks one person for one day, or clears the mark when `status` is null. Days after today cannot be marked. */
export async function markAttendance(staff: Staff, input: { userId: string; date: string; status: string | null; note?: string | null; outletId?: string }, now = new Date()) {
  assertMay(staff);
  if (!isDate(input.date)) throw new AppError("invalid_state", "Choose a date.");
  if (input.status !== null && !isStatus(input.status)) throw new AppError("invalid_state", "Choose Present, Half day, Absent, Leave or Week off.");
  const status = input.status as AttendanceStatus | null;
  const outlet = await outletOf(staff, input.outletId);
  if (input.date > localDate(now, outlet.timezone)) throw new AppError("invalid_state", "You can't mark a day that hasn't happened yet.");
  const note = String(input.note ?? "").trim().slice(0, NOTE_MAX) || null;
  const scope = { tenantId: staff.tenantId };

  // Only people on this outlet's staff list: an id from anywhere else is not found. Checked before the
  // transaction opens, so a transaction never waits for a second connection from the pool
  const onList = (await roster(staff.tenantId, outlet.id)).some((p) => p.id === String(input.userId));
  if (!onList) throw new AppError("not_found", "That person is not on this outlet's staff list.");

  return db.transaction(async (tx) => {
    if (status === null) {
      const [before] = await tx.select().from(s.attendanceMarks).where(and(eq(s.attendanceMarks.tenantId, scope.tenantId), eq(s.attendanceMarks.userId, input.userId), eq(s.attendanceMarks.markDate, input.date))).for("update");
      if (before) {
        await tx.delete(s.attendanceMarks).where(and(eq(s.attendanceMarks.tenantId, scope.tenantId), eq(s.attendanceMarks.id, before.id)));
        await audit(tx, { ...staff, outletId: outlet.id }, { action: "attendance.cleared", entity: "user", entityId: input.userId, before: { date: input.date, status: before.status }, now });
      }
      return null;
    }
    // Take the day's row with a statement that cannot deadlock when taps arrive together (insert it, or
    // touch the one there without changing it), then lock it: the taps queue up and only a real change is logged
    const newId = uuidv7();
    await tx.insert(s.attendanceMarks).values({ id: newId, tenantId: scope.tenantId, outletId: outlet.id, userId: input.userId, markDate: input.date, status, note, markedBy: staff.userId, createdAt: now })
      .onDuplicateKeyUpdate({ set: { id: sql`${s.attendanceMarks.id}` } });
    const [row] = await tx.select().from(s.attendanceMarks).where(and(eq(s.attendanceMarks.tenantId, scope.tenantId), eq(s.attendanceMarks.userId, input.userId), eq(s.attendanceMarks.markDate, input.date))).for("update");
    if (row.id === newId) {
      await audit(tx, { ...staff, outletId: outlet.id }, { action: "attendance.marked", entity: "user", entityId: input.userId, before: null, after: { date: input.date, status }, now });
    } else if (row.status !== status || (row.note ?? null) !== note) {
      await tx.update(s.attendanceMarks).set({ status, note, markedBy: staff.userId, outletId: outlet.id }).where(and(eq(s.attendanceMarks.tenantId, scope.tenantId), eq(s.attendanceMarks.id, row.id)));
      await audit(tx, { ...staff, outletId: outlet.id }, { action: "attendance.marked", entity: "user", entityId: input.userId, before: { date: input.date, status: row.status }, after: { date: input.date, status }, now });
    }
    return status;
  });
}

/** Marks everyone on the list who has no mark yet for the day as present; people already marked are left alone */
export async function markAllPresent(staff: Staff, input: { date: string; outletId?: string }, now = new Date()) {
  assertMay(staff);
  if (!isDate(input.date)) throw new AppError("invalid_state", "Choose a date.");
  const outlet = await outletOf(staff, input.outletId);
  if (input.date > localDate(now, outlet.timezone)) throw new AppError("invalid_state", "You can't mark a day that hasn't happened yet.");
  const people = await roster(staff.tenantId, outlet.id);
  if (!people.length) return 0;
  const done = new Set((await db.select({ id: s.attendanceMarks.userId }).from(s.attendanceMarks).where(and(eq(s.attendanceMarks.tenantId, staff.tenantId), eq(s.attendanceMarks.markDate, input.date), inArray(s.attendanceMarks.userId, people.map((p) => p.id))))).map((r) => r.id));
  const open = people.filter((p) => !done.has(p.id));
  if (!open.length) return 0;
  await db.transaction(async (tx) => {
    await tx.insert(s.attendanceMarks).values(open.map((p) => ({ tenantId: staff.tenantId, outletId: outlet.id, userId: p.id, markDate: input.date, status: "present" as const, markedBy: staff.userId, createdAt: now })))
      .onDuplicateKeyUpdate({ set: { id: sql`${s.attendanceMarks.id}` } });
    await audit(tx, { ...staff, outletId: outlet.id }, { action: "attendance.marked_all_present", entity: "outlet", entityId: outlet.id, after: { date: input.date, people: open.length }, now });
  });
  return open.length;
}

export type MonthRow = { id: string; name: string; photoUrl: string | null; roles: string[]; counts: MonthCounts; days: (AttendanceStatus | null)[] };
export type Month = { month: string; dates: string[]; outletId: string; outlets: { id: string; name: string }[]; rows: MonthRow[]; daysCounted: number };

export async function getMonth(staff: Staff, input: { month?: string; outletId?: string } = {}, now = new Date()): Promise<Month> {
  assertMay(staff);
  const outlet = await outletOf(staff, input.outletId);
  const today = localDate(now, outlet.timezone);
  const month = isMonth(input.month) ? input.month : today.slice(0, 7);
  const dates = datesOfMonth(month);
  // A month still going counts only up to today; unmarked days after today are not "missing"
  const daysCounted = dates.filter((d) => d <= today).length;
  const people = await roster(staff.tenantId, outlet.id);
  const marks = people.length ? await db.select().from(s.attendanceMarks).where(and(eq(s.attendanceMarks.tenantId, staff.tenantId), inArray(s.attendanceMarks.userId, people.map((p) => p.id)), between(s.attendanceMarks.markDate, dates[0], dates[dates.length - 1]))) : [];
  const rows = people.map((p) => {
    const mine = new Map(marks.filter((m) => m.userId === p.id).map((m) => [m.markDate, m.status]));
    return { id: p.id, name: p.name, photoUrl: p.photoUrl, roles: p.roles, counts: monthCounts([...mine.entries()].filter(([d]) => d <= today).map(([, status]) => ({ status })), daysCounted), days: dates.map((d) => mine.get(d) ?? null) };
  });
  return { month, dates, outletId: outlet.id, outlets: outlet.outlets, rows, daysCounted };
}

/** The month as a spreadsheet file: one row per person, totals then one column per day */
export async function monthCsv(staff: Staff, input: { month?: string; outletId?: string } = {}, now = new Date()) {
  const m = await getMonth(staff, input, now);
  const short: Record<AttendanceStatus, string> = { present: "P", half_day: "H", absent: "A", leave: "L", week_off: "W" };
  const head = ["Name", "Role", ...STATUSES.map((x) => STATUS_LABEL[x]), "Not marked", "Days worked", ...m.dates.map((d) => d.slice(8))];
  const body = m.rows.map((r) => [r.name, r.roles.join(" / "), r.counts.present, r.counts.half_day, r.counts.absent, r.counts.leave, r.counts.week_off, r.counts.unmarked, r.counts.daysWorked, ...r.days.map((x) => (x ? short[x] : ""))]);
  return { month: m.month, csv: csvRows([head, ...body]) };
}

export type MyMonth = { today: string; todayStatus: AttendanceStatus | null; month: string; days: { date: string; status: AttendanceStatus | null }[]; counts: MonthCounts };

/** A staff member's own register: today's mark and a month of days. Anyone may see their own. */
export async function myAttendance(staff: Pick<StaffSession, "tenantId" | "userId" | "outlet">, input: { month?: string } = {}, now = new Date()): Promise<MyMonth> {
  if (!staff.userId) throw new AppError("forbidden", "Sign in to see your attendance.");
  const today = localDate(now, staff.outlet.timezone);
  const month = isMonth(input.month) && input.month <= today.slice(0, 7) ? input.month : today.slice(0, 7);
  const dates = datesOfMonth(month);
  const marks = await db.select({ date: s.attendanceMarks.markDate, status: s.attendanceMarks.status }).from(s.attendanceMarks)
    .where(and(eq(s.attendanceMarks.tenantId, staff.tenantId), eq(s.attendanceMarks.userId, staff.userId), between(s.attendanceMarks.markDate, dates[0], dates[dates.length - 1])));
  const byDate = new Map(marks.map((m) => [m.date, m.status]));
  const counted = dates.filter((d) => d <= today);
  const [todayMark] = month === today.slice(0, 7) ? [byDate.get(today) ?? null] : await db.select({ status: s.attendanceMarks.status }).from(s.attendanceMarks)
    .where(and(eq(s.attendanceMarks.tenantId, staff.tenantId), eq(s.attendanceMarks.userId, staff.userId), eq(s.attendanceMarks.markDate, today))).then((r) => [r[0]?.status ?? null]);
  return {
    today, todayStatus: todayMark, month,
    days: dates.map((date) => ({ date, status: byDate.get(date) ?? null })),
    counts: monthCounts(counted.flatMap((d) => (byDate.has(d) ? [{ status: byDate.get(d)! }] : [])), counted.length),
  };
}
