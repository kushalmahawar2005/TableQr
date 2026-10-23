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
import { addMember, assignableRoles, listTeam } from "@/server/staff/team";
import { hasOpenRequest, requestPlanChange } from "@/server/staff/plan-request";
import { getTableLanding } from "@/server/guest/table";
import { requireStaff } from "@/server/staff/auth";
import { tenantAccess } from "@/server/access";
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
      const invited = await addMember(owner, { name: "New Waiter", phone: "9333333332", role: "waiter", pin: "4321" });
      expect(invited.existing).toBe(false);
      expect((await listTeam(owner)).find((person) => person.id === invited.id)).toMatchObject({ name: "New Waiter", phone: "9333333332", roles: ["waiter"], isActive: true });
      await refused(addMember(owner, { name: "Duplicate Waiter", phone: "9333333332", role: "waiter", pin: "4321" }), "invalid_state");
      await refused(addMember(owner, { name: " ", phone: "", role: "waiter", pin: "4321" }), "invalid_state");
    } finally {
      await setTenant({ planCode: "pro", customFeatures: null, customPricePaise: null });
    }
    expect((await tenantFeatures(env.demo.tenantId)).pricingRules).toBe(true);
  });

  it("owners and managers ask TableQR to unlock a feature; asking twice makes one request", async () => {
    const first = await requestPlanChange(owner, { feature: "kitchenDisplay" });
    const again = await requestPlanChange(owner, { feature: "kitchenDisplay" });
    expect(again).toEqual({ id: first.id, already: true });
    expect(await hasOpenRequest(env.demo.tenantId, "kitchenDisplay")).toBe(true);
    await refused(requestPlanChange({ ...owner, roles: ["waiter"] }, { feature: "kitchenDisplay" }), "forbidden");
    await refused(requestPlanChange(owner, { feature: "nonsense", note: "" }), "invalid_state");
    const general = await requestPlanChange(owner, { note: "We opened a second branch" });
    expect(general.already).toBe(false);
    const rows = await env.db.select().from(s.planRequests).where(eq(s.planRequests.tenantId, env.demo.tenantId));
    expect(rows.map((r) => r.feature ?? r.note).sort()).toEqual(["We opened a second branch", "kitchenDisplay"]);
  });

  it("a trial past its grace days pauses staff and guests; extending it brings them back", async () => {
    const { token } = await signInStaff({ outletCode: env.demo.outletCode, phone: "9000000001", pin: "1111" });
    const [sub] = await env.db.select({ id: s.subscriptions.id }).from(s.subscriptions).where(eq(s.subscriptions.tenantId, env.demo.tenantId));
    await env.db.update(s.subscriptions).set({ status: "cancelled" }).where(eq(s.subscriptions.id, sub.id));
    await setTenant({ status: "trial", trialEndsAt: new Date(Date.now() - 5 * 86_400_000) });
    try {
      expect((await tenantAccess(env.demo.tenantId)).state).toBe("blocked");
      await refused(requireStaff(token, ["owner"]), "forbidden");
      const tableQr = env.demo.tableQr.T12;
      expect((await getTableLanding(env.demo.outletCode, tableQr, "device-paused")).landing.kind).toBe("unavailable");
      // The owner can still ask to renew while paused
      expect((await requestPlanChange(owner, { note: "Please renew our plan" })).already).toBe(false);
      await setTenant({ trialEndsAt: new Date(Date.now() + 7 * 86_400_000) });
      expect((await requireStaff(token, ["owner"])).tenantId).toBe(env.demo.tenantId);
    } finally {
      await setTenant({ status: "active", trialEndsAt: null });
      await env.db.update(s.subscriptions).set({ status: "active" }).where(eq(s.subscriptions.id, sub.id));
    }
  });
});
