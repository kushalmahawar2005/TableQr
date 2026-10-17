import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { outletsFor, resolveStaff, signInStaff, switchOutlet } from "@/server/staff/auth";
import { resetTestDb } from "./setup-db";

// A restaurant with two outlets: the owner moves between them without signing in again; staff
// tied to one outlet cannot reach the other, and nobody reaches another restaurant's outlet.

let env: Awaited<ReturnType<typeof resetTestDb>>;
let secondId: string;

beforeAll(async () => {
  env = await resetTestDb();
  secondId = uuidv7();
  const [brand] = await env.db.select({ id: s.brands.id }).from(s.brands).where(eq(s.brands.tenantId, env.demo.tenantId)).limit(1);
  await env.db.insert(s.outlets).values({ id: secondId, tenantId: env.demo.tenantId, brandId: brand.id, code: "SRJ02", name: "Spice Route Two", city: "Jaipur", address: "MI Road" });
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("switching outlet", () => {
  it("the owner sees both outlets and moves to the second; the old session ends", async () => {
    const { token } = await signInStaff({ outletCode: env.demo.outletCode, phone: "9000000001", pin: "1111" });
    const owner = (await resolveStaff(token))!;
    expect((await outletsFor(owner)).map((o) => o.code)).toEqual(["SRJ01", "SRJ02"]);
    const moved = await switchOutlet(token, secondId);
    expect(moved.outletCode).toBe("SRJ02");
    expect((await resolveStaff(moved.token))!.outletId).toBe(secondId);
    expect(await resolveStaff(token)).toBeNull();
  });

  it("a manager of one outlet cannot switch, and no one reaches another restaurant", async () => {
    const { token } = await signInStaff({ outletCode: env.demo.outletCode, phone: "9000000002", pin: "2222" });
    const manager = (await resolveStaff(token))!;
    expect((await outletsFor(manager)).map((o) => o.code)).toEqual(["SRJ01"]);
    const err = await switchOutlet(token, secondId).then(() => null, (e: unknown) => e);
    expect((err as AppError).code).toBe("forbidden");
    const other = await switchOutlet(token, env.other.outletId).then(() => null, (e: unknown) => e);
    expect((other as AppError).code).toBe("forbidden");
    // The demo owner's role covers every outlet
    const [ownerRole] = await env.db.select({ id: s.staffRoles.id }).from(s.staffRoles).where(and(eq(s.staffRoles.tenantId, env.demo.tenantId), eq(s.staffRoles.role, "owner"), isNull(s.staffRoles.outletId)));
    expect(ownerRole).toBeTruthy();
  });
});
