import "server-only";
import { and, between, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
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
    .select({ id: s.users.id, name: s.users.name, role: s.staffRoles.role })
    .from(s.staffRoles)
    .innerJoin(s.users, and(eq(s.users.tenantId, s.staffRoles.tenantId), eq(s.users.id, s.staffRoles.userId)))
    .where(and(eq(s.staffRoles.tenantId, tenantId), eq(s.users.isActive, true), or(isNull(s.staffRoles.outletId), eq(s.staffRoles.outletId, outletId))));
  const people = new Map<string, { id: string; name: string; roles: string[] }>();
  for (const r of rows) {
    const p = people.get(r.id) ?? { id: r.id, name: r.name, roles: [] };
    if (!p.roles.includes(r.role)) p.roles.push(r.role);
    people.set(r.id, p);
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type RegisterPerson = { id: string; name: string; roles: string[]; status: AttendanceStatus | null; note: string | null };
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
    const [before] = await tx.select().from(s.attendanceMarks).where(and(eq(s.attendanceMarks.tenantId, scope.tenantId), eq(s.attendanceMarks.userId, input.userId), eq(s.attendanceMarks.markDate, input.date)));
    if (status === null) {
      if (before) {
        await tx.delete(s.attendanceMarks).where(and(eq(s.attendanceMarks.tenantId, scope.tenantId), eq(s.attendanceMarks.id, before.id)));
        await audit(tx, { ...staff, outletId: outlet.id }, { action: "attendance.cleared", entity: "user", entityId: input.userId, before: { date: input.date, status: before.status }, now });
      }
      return null;
    }
    const [res] = await tx.insert(s.attendanceMarks).values({ tenantId: scope.tenantId, outletId: outlet.id, userId: input.userId, markDate: input.date, status, note, markedBy: staff.userId, createdAt: now })
      .onDuplicateKeyUpdate({ set: { status, note, markedBy: staff.userId, outletId: outlet.id } });
    // The database says whether anything changed (a new mark, or a different one): only a change is logged,
    // so twenty identical taps at once leave one entry
    if (res.affectedRows > 0) {
      await audit(tx, { ...staff, outletId: outlet.id }, { action: "attendance.marked", entity: "user", entityId: input.userId, before: before ? { date: input.date, status: before.status } : null, after: { date: input.date, status }, now });
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

export type MonthRow = { id: string; name: string; roles: string[]; counts: MonthCounts; days: (AttendanceStatus | null)[] };
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
    return { id: p.id, name: p.name, roles: p.roles, counts: monthCounts([...mine.entries()].filter(([d]) => d <= today).map(([, status]) => ({ status })), daysCounted), days: dates.map((d) => mine.get(d) ?? null) };
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
