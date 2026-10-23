import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as appDb } from "@/db";
import * as s from "@/db/schema";
import { DEFAULT_DELIVERY_POLICY } from "@/domain/delivery";
import { getOutletSettings } from "@/server/staff/settings-read";
import { updateOutletSettings, type SettingsPatch } from "@/server/staff/settings-write";
import { resetTestDb } from "./setup-db";

let env: Awaited<ReturnType<typeof resetTestDb>>;
const owner = () => ({ tenantId: env.demo.tenantId, outletId: env.demo.outletId, roles: ["owner" as const], userId: env.demo.staffIds.owner, name: "Owner" });
const policy = { ...DEFAULT_DELIVERY_POLICY, acceptingOrders: true, pincodes: ["302001"], deliveryFeePaise: 3000 };
const patch = (deliveryPolicy = policy): SettingsPatch => ({ city: "Jaipur", address: "Test", gstin: "", fssai: "", serviceChargeBp: 0, tipPresetsBp: null, autoAcceptOrders: false, reviewUrl: "", openingHours: null, roomServices: [], wifiSsid: "", wifiPassword: "", deliveryPolicy });
beforeAll(async () => { env = await resetTestDb(); });
afterAll(async () => { await env.conn.end(); await appDb.$client.end(); });

describe("outlet delivery settings", () => {
  it("requires the package feature and owner role on the server", async () => {
    expect((await getOutletSettings(owner())).deliveryAvailable).toBe(false);
    await expect(updateOutletSettings(owner(), patch())).rejects.toMatchObject({ code: "forbidden" });
    await env.db.update(s.tenants).set({ customFeatures: { delivery: true } }).where(eq(s.tenants.id, owner().tenantId));
    await expect(updateOutletSettings({ ...owner(), roles: ["manager"] }, patch())).rejects.toMatchObject({ code: "forbidden" });
  });
  it("persists only this outlet's policy and preserves it for older settings clients", async () => {
    const [otherBefore] = await env.db.select().from(s.outlets).where(eq(s.outlets.code, "CNJ01"));
    await updateOutletSettings(owner(), patch());
    expect((await getOutletSettings(owner())).deliveryPolicy).toEqual(policy);
    const omitted = patch(); delete omitted.deliveryPolicy;
    await updateOutletSettings(owner(), omitted);
    expect((await getOutletSettings(owner())).deliveryPolicy).toEqual(policy);
    const [otherAfter] = await env.db.select().from(s.outlets).where(eq(s.outlets.code, "CNJ01"));
    expect(otherAfter.deliveryPolicy).toEqual(otherBefore.deliveryPolicy);
  });
  it("rejects invalid configuration and manual QR payments without a merchant QR", async () => {
    await expect(updateOutletSettings(owner(), patch({ ...policy, pincodes: [] }))).rejects.toMatchObject({ code: "invalid_state" });
    await expect(updateOutletSettings(owner(), patch({ ...policy, paymentMode: "manual_qr" }))).rejects.toMatchObject({ code: "invalid_state" });
    expect((await getOutletSettings(owner())).deliveryPolicy).toEqual(policy);
  });
  it("enables manual QR only after the restaurant saves its own payment QR", async () => {
    await env.db.update(s.outlets).set({ bookingPaymentQrUrl: "https://assets.tableqr.test/restaurant-qr.png" }).where(eq(s.outlets.id, owner().outletId));
    const manual = { ...policy, paymentMode: "manual_qr" as const };
    await updateOutletSettings(owner(), patch(manual));
    expect((await getOutletSettings(owner())).deliveryPolicy.paymentMode).toBe("manual_qr");
    await env.db.update(s.outlets).set({ bookingPaymentQrUrl: null }).where(eq(s.outlets.id, owner().outletId));
    await expect(updateOutletSettings(owner(), patch(manual))).rejects.toMatchObject({ code: "invalid_state" });
  });
});
