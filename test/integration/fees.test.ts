import { count, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db as appDb } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { tenantAccess } from "@/server/access";
import { AppError } from "@/server/errors";
import { claimFee, confirmFee, feesData, monthlyFee, ownerPlan, recordFee, reconcileCashfreeFee, rejectFee, settleCashfreeFeeByGatewayRef, startFeePayment } from "@/server/fees";
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

  it("UPI needs the 12-digit reference; an upgrade is paid at the new plan's price and switches the plan once confirmed", async () => {
    await refused(claimFee(owner(), { months: 1, method: "upi", reference: "12345" }), "invalid_state");
    const claim = await claimFee(owner(), { months: 1, method: "upi", reference: "4123 4567 8902", planCode: "growth" });
    expect(claim.amountPaise).toBe(249900);
    await confirmFee(claim.id);
    const [t] = await env.db.select({ planCode: s.tenants.planCode, customPricePaise: s.tenants.customPricePaise }).from(s.tenants).where(eq(s.tenants.id, env.demo.tenantId));
    expect(t).toEqual({ planCode: "growth", customPricePaise: null });
    expect((await monthlyFee(appDb, env.demo.tenantId)).totalPaise).toBe(249900);
    const [row] = await env.db.select({ reference: s.feePayments.reference }).from(s.feePayments).where(eq(s.feePayments.id, claim.id));
    expect(row.reference).toBe("412345678902");
  });

  it("a verified Cashfree success activates exactly once and cannot be confirmed by hand", async () => {
    const amountPaise = (await monthlyFee(appDb, env.demo.tenantId)).totalPaise;
    const id = uuidv7();
    const gatewayRef = `cf_${id}`;
    await env.db.insert(s.feePayments).values({
      id,
      tenantId: env.demo.tenantId,
      months: 1,
      amountPaise,
      method: "cashfree",
      clientRequestId: `req_${id}`,
      gatewayRef,
      status: "claimed",
      claimedBy: "Rohan Sharma",
    });
    await refused(confirmFee(id), "invalid_state");
    const [before] = await env.db.select({ n: count() }).from(s.subscriptions).where(eq(s.subscriptions.tenantId, env.demo.tenantId));
    expect(await settleCashfreeFeeByGatewayRef(gatewayRef, { status: "success", amountPaise, gatewayPaymentId: "cfpay_1" })).toMatchObject({ status: "confirmed", alreadyFinal: false });
    expect(await settleCashfreeFeeByGatewayRef(gatewayRef, { status: "success", amountPaise, gatewayPaymentId: "cfpay_1" })).toEqual({ status: "confirmed", alreadyFinal: true });
    const [after] = await env.db.select({ n: count() }).from(s.subscriptions).where(eq(s.subscriptions.tenantId, env.demo.tenantId));
    expect(Number(after.n)).toBe(Number(before.n) + 1);
    const [payment] = await env.db.select({ status: s.feePayments.status, gatewayPaymentId: s.feePayments.gatewayPaymentId, reference: s.feePayments.reference }).from(s.feePayments).where(eq(s.feePayments.id, id));
    expect(payment).toEqual({ status: "confirmed", gatewayPaymentId: "cfpay_1", reference: "cfpay_1" });
  });

  describe("Cashfree checkout", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });

    it("does not leave a hanging claim when Cashfree cannot start the order", async () => {
      vi.stubEnv("CASHFREE_CLIENT_ID", "cashfree_client_123");
      vi.stubEnv("CASHFREE_CLIENT_SECRET", "cashfree_secret_123");
      vi.stubEnv("CASHFREE_MODE", "sandbox");
      vi.stubEnv("CASHFREE_API_BASE", "https://cashfree.example/pg");
      vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ message: "down" }), { status: 503 }));
      await refused(startFeePayment(owner(), { months: 1, requestId: "pay-down-1", callbackUrl: "https://tableqr.example/api/fees/return?p=PLACEHOLDER" }), "invalid_state");
      expect((await ownerPlan(owner())).waiting).toBe(false);
    });

    it("starts one Cashfree order, replays the same tap, and activates after Cashfree confirms", async () => {
      const amountPaise = (await monthlyFee(appDb, env.demo.tenantId)).totalPaise;
      vi.stubEnv("CASHFREE_CLIENT_ID", "cashfree_client_123");
      vi.stubEnv("CASHFREE_CLIENT_SECRET", "cashfree_secret_123");
      vi.stubEnv("CASHFREE_MODE", "sandbox");
      vi.stubEnv("CASHFREE_API_BASE", "https://cashfree.example/pg");
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        if (String(url).endsWith("/orders") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { order_id: string };
          return new Response(JSON.stringify({ order_id: body.order_id }), { status: 200 });
        }
        if (String(url).includes("/payments")) {
          return new Response(JSON.stringify([{ cf_payment_id: 99, payment_status: "SUCCESS", payment_amount: amountPaise / 100 }]), { status: 200 });
        }
        return new Response(JSON.stringify({ payment_session_id: "session_1" }), { status: 200 });
      });
      const started = await startFeePayment(owner(), { months: 1, requestId: "pay-again-1", callbackUrl: "https://tableqr.example/api/fees/return?p=PLACEHOLDER" });
      expect(started.checkout).toEqual({ provider: "cashfree", kind: "cashfree", mode: "sandbox", paymentSessionId: "session_1" });
      expect(started.replayed).toBe(false);
      const again = await startFeePayment(owner(), { months: 1, requestId: "pay-again-1", callbackUrl: "https://tableqr.example/api/fees/return?p=PLACEHOLDER" });
      expect(again).toMatchObject({ id: started.id, replayed: true });
      const [before] = await env.db.select({ n: count() }).from(s.subscriptions).where(eq(s.subscriptions.tenantId, env.demo.tenantId));
      expect(await reconcileCashfreeFee(started.id)).toBe("confirmed");
      expect(await reconcileCashfreeFee(started.id)).toBe("confirmed");
      const [after] = await env.db.select({ n: count() }).from(s.subscriptions).where(eq(s.subscriptions.tenantId, env.demo.tenantId));
      expect(Number(after.n)).toBe(Number(before.n) + 1);
    });
  });
});
