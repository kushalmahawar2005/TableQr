import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import { AppError } from "@/server/errors";
import { getGuestContext } from "@/server/guest/context";
import { startOrJoinTable } from "@/server/guest/session";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { getCustomers, rememberCustomer } from "@/server/staff/customers";
import { resetTestDb } from "./setup-db";

// Customer list: numbers from bills sent on WhatsApp (and bookings, waitlist, verification).

let env: Awaited<ReturnType<typeof resetTestDb>>;
let owner: StaffSession;
let waiter: StaffSession;

beforeAll(async () => {
  env = await resetTestDb();
  owner = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000001", pin: "1111" })).token))!;
  waiter = (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone: "9000000005", pin: "5555" })).token))!;
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("customers", () => {
  it("keeps the number a bill went to, with the guest's name and visit", async () => {
    const qr = env.demo.tableQr.T3;
    const { participantId } = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: "cust-a", displayName: "Meera" });
    const g = await getGuestContext("SRJ01", qr, participantId, "cust-a");
    await rememberCustomer(owner, { sessionId: g.sessionId, phone: "+91 98111 22334", name: "Meera" });

    const list = (await getCustomers(owner)).customers;
    const meera = list.find((c) => c.phone === "9811122334");
    expect(meera).toMatchObject({ name: "Meera", visits: 1, offersOk: false });
    expect(meera?.lastVisitAt).toBeGreaterThan(0);

    // The same number again does not make a second customer
    await rememberCustomer(owner, { sessionId: g.sessionId, phone: "9811122334" });
    expect((await getCustomers(owner)).customers.filter((c) => c.phone === "9811122334")).toHaveLength(1);
  });

  it("lists the others at the table with the one who gave a number", async () => {
    const qr = env.demo.tableQr.T4;
    const first = await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: "with-a", displayName: "Jayendra" });
    await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: "with-b", displayName: "Hitesh" });
    await startOrJoinTable({ outletCode: "SRJ01", shortCode: qr, deviceId: "with-c" });
    const g = await getGuestContext("SRJ01", qr, first.participantId, "with-a");
    await rememberCustomer(owner, { sessionId: g.sessionId, phone: "9587507407", name: "Jayendra" });

    const jayendra = (await getCustomers(owner)).customers.find((c) => c.phone === "9587507407");
    expect(jayendra?.companions).toEqual({ names: ["Hitesh"], unnamed: 1 });
  });

  it("searches by name or number, filters, and pages the list", async () => {
    const search = await getCustomers(owner, { q: "meera" });
    expect(search.customers.map((c) => c.phone)).toContain("9811122334");
    expect(search.total).toBe(search.customers.length);
    // Spaces and the number's own formatting do not matter
    expect((await getCustomers(owner, { q: "98111 22334" })).customers.map((c) => c.phone)).toEqual(["9811122334"]);
    expect((await getCustomers(owner, { q: "no-one-has-this-name" })).customers).toEqual([]);

    const all = await getCustomers(owner);
    expect(all.counts.all).toBe(all.total);
    expect(all.counts.regulars).toBe((await getCustomers(owner, { filter: "regulars" })).total);
    expect(all.pages).toBeGreaterThanOrEqual(1);
    // A page past the end lands on the last page instead of coming back empty
    expect((await getCustomers(owner, { page: 999 })).page).toBe(all.pages);
    // The CSV asks for everyone at once
    expect((await getCustomers(owner, { all: true })).customers).toHaveLength(all.total);
  });

  it("refuses a bad number, another outlet's visit, and roles without access", async () => {
    const bad = (await rememberCustomer(owner, { sessionId: "x", phone: "123" }).then(() => null, (e: unknown) => e)) as AppError;
    expect(bad.details?.reason).toBe("phone");
    const missing = (await rememberCustomer(owner, { sessionId: "not-a-visit", phone: "9811122335" }).then(() => null, (e: unknown) => e)) as AppError;
    expect(missing.code).toBe("not_found");
    const denied = (await getCustomers(waiter).then(() => null, (e: unknown) => e)) as AppError;
    expect(denied.code).toBe("forbidden");
  });
});
