import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import { createReservation } from "@/server/floor/reservations";
import { getReservationCalendar, editReservationDetails } from "@/server/staff/reservations";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { resetTestDb } from "./setup-db";
import { localTime, serviceDate } from "@/domain/booking-policy";

let env: Awaited<ReturnType<typeof resetTestDb>>; let owner: StaffSession; let host: StaffSession;
beforeAll(async () => { env = await resetTestDb(); owner = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000001", pin: "1111" })).token))!; host = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000004", pin: "4444" })).token))!; });
afterAll(async () => env.conn.end());
describe("reservation calendar read model", () => {
  it("scopes and groups day/week reservations without changing booking allocation", async () => {
    const start = localTime(serviceDate(new Date(Date.now() + 24 * 3600_000), owner.outlet.timezone), 20 * 60, owner.outlet.timezone).getTime(); const created = await createReservation(owner, { name: "Calendar Guest", phone: "9876543210", partySize: 2, startAt: start, tableIds: [env.demo.tableIds.T10], source: "phone", occasion: "Birthday" });
    const bookingDate = serviceDate(new Date(start), owner.outlet.timezone); const day = await getReservationCalendar(owner, { date: bookingDate, view: "day", search: "Calendar" }); const week = await getReservationCalendar(owner, { date: bookingDate, view: "week", statuses: ["confirmed"] });
    expect(day.reservations.some((r) => r.id === created.reservationId && r.phone === "9876543210" && r.occasion === "Birthday")).toBe(true);
    expect(week.view).toBe("week"); const [assignment] = await env.db.select().from(s.reservationTables).where(and(eq(s.reservationTables.tenantId, owner.tenantId), eq(s.reservationTables.reservationId, created.reservationId))); expect(assignment.tableId).toBe(env.demo.tableIds.T10);
  });
  it("allows owner detail edits and rejects host edits server-side", async () => {
    const created = await createReservation(owner, { name: "Editable", partySize: 2, startAt: Date.now() + 4 * 3600_000, tableIds: [env.demo.tableIds.T11] });
    await editReservationDetails(owner, created.reservationId, { name: "Edited", phone: "9876500000", notes: "Window" });
    await expect(editReservationDetails(host, created.reservationId, { name: "Blocked" })).rejects.toMatchObject({ code: "forbidden" });
    const [row] = await env.db.select().from(s.reservations).where(eq(s.reservations.id, created.reservationId)); expect(row.name).toBe("Edited");
  });
});
