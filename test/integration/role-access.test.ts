import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { requireStaff, signInStaff } from "@/server/staff/auth";
import { getCustomers } from "@/server/staff/customers";
import { posRoles } from "@/server/staff/pos-read";
import { resetTestDb } from "./setup-db";

// The platform admin changes which roles open which console section, per restaurant; the server
// applies it to pages and actions, not just the sidebar.

let env: Awaited<ReturnType<typeof resetTestDb>>;
const token = async (phone: string, pin: string) => (await signInStaff({ outletCode: "SRJ01", phone, pin })).token;
const refused = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof AppError ? e.code : String(e)));

beforeAll(async () => {
  env = await resetTestDb();
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("role access per restaurant", () => {
  it("stops a cashier at Billing once the admin takes it away, and lets a host into Customers once given", async () => {
    const cashier = await token("9000000003", "3333");
    const host = await token("9000000004", "4444");
    await requireStaff(cashier, posRoles, new Date(), "billing");
    expect(await refused(requireStaff(host, ["manager", "owner"], new Date(), "customers"))).toBe("forbidden");

    await env.db.update(s.tenants).set({ roleAccess: { billing: ["manager"], customers: ["manager", "host"] } }).where(eq(s.tenants.id, env.demo.tenantId));

    expect(await refused(requireStaff(cashier, posRoles, new Date(), "billing"))).toBe("forbidden");
    const hostStaff = await requireStaff(host, ["manager", "owner"], new Date(), "customers");
    await expect(getCustomers(hostStaff)).resolves.toBeDefined();
    // Another restaurant keeps the defaults
    const [other] = await env.db.select({ roleAccess: s.tenants.roleAccess }).from(s.tenants).where(eq(s.tenants.id, env.other.tenantId));
    expect(other.roleAccess).toBeNull();
  });
});
