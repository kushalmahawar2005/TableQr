import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { getBookingZones } from "@/server/booking/core";
import { AppError } from "@/server/errors";
import { tenantFeatures } from "@/server/plan";
import { resolveStaff, signInStaff, type StaffSession } from "@/server/staff/auth";
import { getPricingData } from "@/server/staff/pricing";
import { getReport } from "@/server/staff/reports-read";
import { addMember, assignableRoles } from "@/server/staff/team";
import { resetTestDb } from "./setup-db";

// What a plan or a custom package switches on is enforced on the server, not only hidden.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let owner: StaffSession;

const signIn = async (outletCode: string, phone: string, pin: string) => (await resolveStaff((await signInStaff({ outletCode, phone, pin })).token))!;
const setTenant = (values: Partial<typeof s.tenants.$inferInsert>) => env.db.update(s.tenants).set(values).where(eq(s.tenants.id, env.demo.tenantId));

async function refused(p: Promise<unknown>, code: AppError["code"]) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err, "expected the call to be refused").toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}

beforeAll(async () => {
  env = await resetTestDb();
  owner = await signIn(env.demo.outletCode, "9000000001", "1111");
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("plan features", () => {
  it("Starter: no reports, pricing, bookings, waiter or kitchen roles, and only 3 staff logins", async () => {
    await setTenant({ planCode: "starter", kitchenDisplay: null, tableLimit: null });
    try {
      await refused(getReport(owner, 30, new Date()), "forbidden");
      await refused(getPricingData(owner), "forbidden");
      await refused(getBookingZones(env.demo.outletCode), "forbidden");
      expect(await assignableRoles(env.demo.tenantId)).toEqual(["manager", "accountant"]);
      // The demo already has more than 3 staff besides the owner
      await refused(addMember(owner, { name: "New Manager", phone: "9333333331", role: "manager", pin: "4321" }), "invalid_state");
    } finally {
      await setTenant({ planCode: "pro" });
    }
  });

  it("Custom package: only the ticked features, with the admin's limits", async () => {
    const f = await tenantFeatures(env.demo.tenantId);
    await setTenant({
      planCode: "custom",
      customFeatures: { ...f, fullReports: true, pricingRules: false, waiterApp: true, kitchenDisplay: false, maxStaff: null, maxTables: 4 },
      customPricePaise: 150000,
    });
    try {
      const custom = await tenantFeatures(env.demo.tenantId);
      expect(custom.maxTables).toBe(4);
      expect((await getReport(owner, 30, new Date())).range).toBe(30);
      await refused(getPricingData(owner), "forbidden");
      expect(await assignableRoles(env.demo.tenantId)).toEqual(["manager", "waiter", "accountant"]);
      expect((await addMember(owner, { name: "New Waiter", phone: "9333333332", role: "waiter", pin: "4321" })).existing).toBe(false);
    } finally {
      await setTenant({ planCode: "pro", customFeatures: null, customPricePaise: null });
    }
    expect((await tenantFeatures(env.demo.tenantId)).pricingRules).toBe(true);
  });
});
