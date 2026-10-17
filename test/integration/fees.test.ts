import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { tenantAccess } from "@/server/access";
import { AppError } from "@/server/errors";
import { claimFee, confirmFee, feesData, monthlyFee, ownerPlan, recordFee, rejectFee } from "@/server/fees";
import { resetTestDb } from "./setup-db";

// TableQR fees paid by hand: the owner says "I have paid", the admin confirms, the months are added.

let env: Awaited<ReturnType<typeof resetTestDb>>;
const DAY = 86_400_000;
const owner = () => ({ tenantId: env.demo.tenantId, roles: ["owner" as const], name: "Rohan Sharma" });

async function refused(p: Promise<unknown>, code: AppError["code"]) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}

beforeAll(async () => {
  env = await resetTestDb();
  // A restaurant whose trial ended long ago: paused until it pays
  await env.db.delete(s.subscriptions).where(eq(s.subscriptions.tenantId, env.demo.tenantId));
  await env.db.update(s.tenants).set({ status: "trial", trialEndsAt: new Date(Date.now() - 10 * DAY), customPricePaise: 120000 }).where(eq(s.tenants.id, env.demo.tenantId));
});

afterAll(async () => {
  await env.conn.end();
  await appDb.$client.end();
});

describe("fees paid by hand", () => {
  it("the owner claims, the admin confirms, and the restaurant opens with the months added", async () => {
    expect((await tenantAccess(env.demo.tenantId)).state).toBe("blocked");
    expect((await monthlyFee(appDb, env.demo.tenantId)).totalPaise).toBe(120000);
    await refused(claimFee({ ...owner(), roles: ["waiter"] as never }, { months: 1, method: "cash", reference: "" }), "forbidden");
    const claim = await claimFee(owner(), { months: 3, method: "upi", reference: "412345678901" });
    expect(claim.amountPaise).toBe(360000);
    await refused(claimFee(owner(), { months: 1, method: "cash", reference: "" }), "invalid_state");
    expect((await ownerPlan(owner())).waiting).toBe(true);
    expect((await feesData()).claims.map((c) => c.id)).toEqual([claim.id]);

    const done = await confirmFee(claim.id);
    expect(done.paidUntil.getTime()).toBeGreaterThan(Date.now() + 85 * DAY);
    expect(await tenantAccess(env.demo.tenantId)).toMatchObject({ state: "ok", reason: "paid" });
    await refused(confirmFee(claim.id), "invalid_state");
    const data = await feesData();
    expect(data.claims).toEqual([]);
    expect(data.receivedThisMonthPaise).toBe(360000);
  });

  it("a payment that never arrived is turned down and can be claimed again; the admin can record one directly", async () => {
    const claim = await claimFee(owner(), { months: 1, method: "cash", reference: "" });
    await rejectFee(claim.id);
    const [row] = await env.db.select({ status: s.feePayments.status }).from(s.feePayments).where(eq(s.feePayments.id, claim.id));
    expect(row.status).toBe("rejected");
    const before = (await tenantAccess(env.demo.tenantId)).endsAt!;
    const r = await recordFee("admin:test", env.demo.tenantId, { months: 12, amountRupees: 12000, method: "bank", reference: "NEFT" });
    // A year is added after the period already paid
    expect(r.periodEnd.getTime()).toBeGreaterThan(before + 360 * DAY);
    expect((await ownerPlan(owner())).payments.map((p) => p.status)).toEqual(["confirmed", "rejected", "confirmed"]);
  });
});
