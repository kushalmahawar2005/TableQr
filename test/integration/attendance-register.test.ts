import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { getMonth, getRegister, markAllPresent, markAttendance, monthCsv } from "@/server/attendance/register";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { hashPin } from "@/server/staff/pin";
import { resetTestDb } from "./setup-db";

// The attendance register: who may mark, one mark per person per day, half days worth half, the month
// adding up, the spreadsheet, and one restaurant never touching another's.

let env: Awaited<ReturnType<typeof resetTestDb>>;
const NOW = new Date("2026-11-20T08:00:00Z"); // 20 November 2026, 13:30 in Jaipur
const staffOf = async (outletCode: string, phone: string, pin: string) => (await resolveStaff((await signInStaff({ outletCode, phone, pin })).token))!;
const code = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof AppError ? e.code : `other:${String(e)}`));
let owner: StaffSession, manager: StaffSession, cashier: StaffSession, waiter: StaffSession, kitchen: StaffSession, otherManager: StaffSession;
const marks = () => appDb.select().from(s.attendanceMarks);

beforeAll(async () => {
  env = await resetTestDb();
  await env.db.insert(s.users).values({ id: uuidv7(), tenantId: env.other.tenantId, phone: "9000000095", name: "Other Manager", pinHash: await hashPin("9595") });
  const [u] = await env.db.select().from(s.users).where(eq(s.users.phone, "9000000095"));
  await env.db.insert(s.staffRoles).values({ tenantId: env.other.tenantId, userId: u.id, outletId: env.other.outletId, role: "manager" });
  [owner, manager, cashier, waiter, kitchen, otherManager] = await Promise.all([
    staffOf("SRJ01", "9000000001", "1111"), staffOf("SRJ01", "9000000002", "2222"), staffOf("SRJ01", "9000000003", "3333"),
    staffOf("SRJ01", "9000000005", "5555"), staffOf("SRJ01", "9000000006", "6666"), staffOf("CNJ01", "9000000095", "9595"),
  ]);
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("who may mark attendance", () => {
  it("lets managers and owners in and nobody else", async () => {
    expect((await getRegister(manager, { date: "2026-11-20" }, NOW)).people.length).toBeGreaterThan(3);
    expect((await getRegister(owner, { date: "2026-11-20" }, NOW)).date).toBe("2026-11-20");
    for (const who of [cashier, waiter, kitchen]) {
      expect(await code(getRegister(who, {}, NOW))).toBe("forbidden");
      expect(await code(markAttendance(who, { userId: who.userId, date: "2026-11-20", status: "present" }, NOW))).toBe("forbidden");
      expect(await code(markAllPresent(who, { date: "2026-11-20" }, NOW))).toBe("forbidden");
      expect(await code(getMonth(who, {}, NOW))).toBe("forbidden");
    }
    expect(await marks()).toHaveLength(0);
  });
});

describe("marking a day", () => {
  it("marks, changes and clears one person's day, keeping one mark per day, and records who did it", async () => {
    await markAttendance(manager, { userId: waiter.userId, date: "2026-11-20", status: "present" }, NOW);
    await markAttendance(manager, { userId: waiter.userId, date: "2026-11-20", status: "half_day", note: "  left at lunch  " }, NOW);
    let rows = (await marks()).filter((m) => m.userId === waiter.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "half_day", note: "left at lunch", markedBy: manager.userId, markDate: "2026-11-20", outletId: env.demo.outletId });
    await markAttendance(manager, { userId: waiter.userId, date: "2026-11-20", status: null }, NOW);
    expect((await marks()).filter((m) => m.userId === waiter.userId)).toHaveLength(0);
    const log = (await env.db.select().from(s.auditLog).where(eq(s.auditLog.entityId, waiter.userId))).filter((l) => l.action.startsWith("attendance."));
    expect(log.map((l) => l.action).sort()).toEqual(["attendance.cleared", "attendance.marked", "attendance.marked"]);
    rows = [];
  });

  it("makes one mark out of 20 simultaneous taps, and does not log a repeat", async () => {
    await Promise.all(Array.from({ length: 20 }, () => markAttendance(manager, { userId: cashier.userId, date: "2026-11-19", status: "absent" }, NOW)));
    expect((await marks()).filter((m) => m.userId === cashier.userId && m.markDate === "2026-11-19")).toHaveLength(1);
    const logged = async () => (await env.db.select().from(s.auditLog).where(eq(s.auditLog.entityId, cashier.userId))).filter((l) => l.action.startsWith("attendance.")).length;
    const before = await logged();
    expect(before).toBe(1);
    await markAttendance(manager, { userId: cashier.userId, date: "2026-11-19", status: "absent" }, NOW);
    expect(await logged()).toBe(before);
  });

  it("refuses a day that has not happened, a bad date, a bad status and someone not on the list", async () => {
    expect(await code(markAttendance(manager, { userId: waiter.userId, date: "2026-11-21", status: "present" }, NOW))).toBe("invalid_state");
    expect(await code(markAttendance(manager, { userId: waiter.userId, date: "2026-02-30", status: "present" }, NOW))).toBe("invalid_state");
    expect(await code(markAttendance(manager, { userId: waiter.userId, date: "2026-11-20", status: "holiday" }, NOW))).toBe("invalid_state");
    expect(await code(markAttendance(manager, { userId: uuidv7(), date: "2026-11-20", status: "present" }, NOW))).toBe("not_found");
    expect(await code(markAllPresent(manager, { date: "2026-11-21" }, NOW))).toBe("invalid_state");
  });

  it("uses the outlet's own date: late evening in another time zone is still that day", async () => {
    await env.db.update(s.outlets).set({ timezone: "America/New_York" }).where(eq(s.outlets.id, env.demo.outletId));
    const ny = await staffOf("SRJ01", "9000000002", "2222");
    const lateNight = new Date("2026-11-21T03:00:00Z"); // 22:00 on the 20th in New York, already the 21st in UTC
    expect((await getRegister(ny, {}, lateNight)).today).toBe("2026-11-20");
    expect(await code(markAttendance(ny, { userId: waiter.userId, date: "2026-11-21", status: "present" }, lateNight))).toBe("invalid_state");
    await markAttendance(ny, { userId: waiter.userId, date: "2026-11-20", status: "present" }, lateNight);
    await env.db.update(s.outlets).set({ timezone: "Asia/Kolkata" }).where(eq(s.outlets.id, env.demo.outletId));
    await markAttendance(manager, { userId: waiter.userId, date: "2026-11-20", status: null }, NOW);
  });
});

describe("mark all present", () => {
  it("marks only the people who have no mark yet and leaves the others as they were", async () => {
    await markAttendance(manager, { userId: kitchen.userId, date: "2026-11-18", status: "leave" }, NOW);
    const people = (await getRegister(manager, { date: "2026-11-18" }, NOW)).people.length;
    const made = await markAllPresent(manager, { date: "2026-11-18" }, NOW);
    expect(made).toBe(people - 1);
    const day = (await marks()).filter((m) => m.markDate === "2026-11-18");
    expect(day).toHaveLength(people);
    expect(day.find((m) => m.userId === kitchen.userId)?.status).toBe("leave");
    expect(await markAllPresent(manager, { date: "2026-11-18" }, NOW)).toBe(0);
    const [{ n }] = await env.db.select({ n: s.auditLog.id }).from(s.auditLog).where(eq(s.auditLog.action, "attendance.marked_all_present")).limit(1);
    expect(n).toBeTruthy();
  });
});

describe("the register and the month", () => {
  it("shows each person's status and the day's counts", async () => {
    await markAttendance(manager, { userId: waiter.userId, date: "2026-11-17", status: "present" }, NOW);
    await markAttendance(manager, { userId: cashier.userId, date: "2026-11-17", status: "half_day", note: "doctor" }, NOW);
    await markAttendance(manager, { userId: kitchen.userId, date: "2026-11-17", status: "week_off" }, NOW);
    const r = await getRegister(manager, { date: "2026-11-17" }, NOW);
    expect(r.people.find((p) => p.id === cashier.userId)).toMatchObject({ status: "half_day", note: "doctor" });
    expect(r.counts).toMatchObject({ present: 1, half_day: 1, week_off: 1 });
    expect(r.counts.unmarked).toBe(r.people.length - 3);
  });

  it("adds up a month: a half day is half a day worked, leave and a week off are not worked days, and unmarked days are counted", async () => {
    const m = await getMonth(manager, { month: "2026-11" }, NOW);
    expect(m.daysCounted).toBe(20);
    const w = m.rows.find((r) => r.id === waiter.userId)!;
    expect(w.counts).toMatchObject({ present: 2, half_day: 0, daysWorked: 2 });
    const c = m.rows.find((r) => r.id === cashier.userId)!;
    expect(c.counts).toMatchObject({ half_day: 1, absent: 1, daysWorked: 0.5, present: 1 });
    expect(c.counts.unmarked).toBe(20 - 3);
    const k = m.rows.find((r) => r.id === kitchen.userId)!;
    expect(k.counts).toMatchObject({ leave: 1, week_off: 1, daysWorked: 0 });
    expect(c.days[16]).toBe("half_day");
    expect(m.dates).toHaveLength(30);
    const past = await getMonth(manager, { month: "2026-10" }, NOW);
    expect(past.daysCounted).toBe(31);
    expect(past.rows.every((r) => r.counts.unmarked === 31 && r.counts.daysWorked === 0)).toBe(true);
  });

  it("makes a spreadsheet file: totals then a column per day, and defuses text that looks like a formula", async () => {
    await env.db.update(s.users).set({ name: "=HYPERLINK(\"x\")" }).where(eq(s.users.id, kitchen.userId));
    const { month, csv } = await monthCsv(manager, { month: "2026-11" }, NOW);
    expect(month).toBe("2026-11");
    const lines = csv.trim().split("\r\n");
    expect(lines[0].split(",").slice(0, 9)).toEqual(["Name", "Role", "Present", "Half day", "Absent", "Leave", "Week off", "Not marked", "Days worked"]);
    expect(lines[0].split(",")).toHaveLength(9 + 30);
    const cashierLine = lines.find((l) => l.startsWith("Priya Singh"))!.split(",");
    expect(cashierLine.slice(2, 9)).toEqual(["1", "1", "1", "0", "0", "17", "0.5"]);
    expect(cashierLine[9 + 16]).toBe("H");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    await env.db.update(s.users).set({ name: "Ramesh Yadav" }).where(eq(s.users.id, kitchen.userId));
  });
});

describe("one restaurant's register is not another's", () => {
  it("shows another restaurant's manager only their own people, and refuses a person or outlet from elsewhere", async () => {
    const theirs = await getRegister(otherManager, { date: "2026-11-20" }, NOW);
    expect(theirs.people.map((p) => p.name)).toEqual(["Other Manager"]);
    expect(theirs.outlets.map((o) => o.id)).toEqual([env.other.outletId]);
    expect(await code(markAttendance(otherManager, { userId: waiter.userId, date: "2026-11-20", status: "absent" }, NOW))).toBe("not_found");
    expect(await code(markAttendance(manager, { userId: otherManager.userId, date: "2026-11-20", status: "absent" }, NOW))).toBe("not_found");
    expect(await code(getRegister(manager, { outletId: env.other.outletId }, NOW))).toBe("forbidden");
    expect(await code(getRegister(otherManager, { outletId: env.demo.outletId }, NOW))).toBe("forbidden");
    expect(await code(getMonth(otherManager, { outletId: env.demo.outletId }, NOW))).toBe("forbidden");
    expect(await code(markAllPresent(otherManager, { date: "2026-11-20", outletId: env.demo.outletId }, NOW))).toBe("forbidden");
  });

  it("is enforced by the database: a mark cannot name a person of another restaurant", async () => {
    await expect(env.db.insert(s.attendanceMarks).values({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, userId: otherManager.userId, markDate: "2026-11-20", status: "present" })).rejects.toThrow();
    await expect(env.db.insert(s.attendanceMarks).values({ tenantId: env.demo.tenantId, outletId: env.other.outletId, userId: waiter.userId, markDate: "2026-11-20", status: "present" })).rejects.toThrow();
  });
});
