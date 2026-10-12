import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import { AppError } from "@/server/errors";
import { checkIn, myDuty, setDuty, teamDuty } from "@/server/staff/duty";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { waiterBoard } from "@/server/staff/waiter-read";
import { resetTestDb } from "./setup-db";

// Waiters mark themselves on duty, on a break or off duty; the manager sees who is working and
// whose app is open.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let waiter: StaffSession;
let manager: StaffSession;
const signIn = async (phone: string, pin: string) => (await resolveStaff((await signInStaff({ outletCode: "SRJ01", phone, pin })).token))!;

beforeAll(async () => {
  env = await resetTestDb();
  waiter = await signIn("9000000005", "5555");
  manager = await signIn("9000000002", "2222");
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("staff duty", () => {
  it("starts on duty, and the waiter app shows it and counts as online", async () => {
    expect((await myDuty(waiter)).status).toBe("on");
    const board = await waiterBoard(waiter);
    expect(board.identity.duty).toBe("on");
    const me = (await teamDuty(manager)).find((r) => r.id === waiter.userId)!;
    expect(me).toMatchObject({ status: "on", online: true });
  });

  it("switches to break and off duty; the manager sees it, the waiter cannot see the team", async () => {
    await setDuty(waiter, "break");
    expect((await teamDuty(manager)).find((r) => r.id === waiter.userId)?.status).toBe("break");
    await setDuty(waiter, "off");
    const rows = await teamDuty(manager);
    expect(rows.find((r) => r.id === waiter.userId)?.status).toBe("off");
    expect(rows[rows.length - 1].status).toBe("off");
    await expect(teamDuty(waiter)).rejects.toBeInstanceOf(AppError);
    await expect(setDuty(waiter, "nap" as never)).rejects.toBeInstanceOf(AppError);
  });

  it("is no longer online when the app has not checked in for a while", async () => {
    await checkIn(waiter, new Date(Date.now() + 61_000));
    const later = new Date(Date.now() + 10 * 60_000);
    expect((await teamDuty(manager, later)).find((r) => r.id === waiter.userId)?.online).toBe(false);
  });
});
