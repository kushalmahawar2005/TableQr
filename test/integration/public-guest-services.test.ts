import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db as appDb } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { serviceDate } from "@/domain/booking-policy";
import { bookingByToken, createBookingHold, createGroupRequest, getBookingAvailability, getBookingZones } from "@/server/booking/core";
import { getRestaurantHome } from "@/server/guest/restaurant-home";
import { getOutletSettings } from "@/server/staff/settings-read";
import { saveRestaurantCashfree, updateBookingPaymentQr, updateBrandLogo, updateOutletSettings, type SettingsPatch } from "@/server/staff/settings-write";
import { resetTestDb } from "./setup-db";

let env: Awaited<ReturnType<typeof resetTestDb>>;
let secondOutletId: string;
const owner = (outletId = env.demo.outletId) => ({ tenantId: env.demo.tenantId, outletId, roles: ["owner" as const], userId: env.demo.staffIds.owner, name: "Owner" });
const patch = (overrides: Partial<SettingsPatch> = {}): SettingsPatch => ({ city: "Jaipur", address: "Test restaurant", gstin: "", fssai: "", serviceChargeBp: 0, tipPresetsBp: null, autoAcceptOrders: false, reviewUrl: "", openingHours: null, roomServices: [], wifiSsid: "", wifiPassword: "", ...overrides });
beforeAll(async () => {
  env = await resetTestDb();
  secondOutletId = uuidv7();
  await env.db.insert(s.outlets).values({ id: secondOutletId, tenantId: env.demo.tenantId, brandId: env.demo.brandId, code: "SRJ02", name: "Spice Route Two", city: "Jaipur", address: "MI Road" });
});
afterAll(async () => { vi.unstubAllEnvs(); await env.conn.end(); await appDb.$client.end(); });

describe("public restaurant service choices", () => {
  it("defaults existing restaurants to their package's services and never grants an excluded feature", async () => {
    expect((await getRestaurantHome("SRJ01")).services).toMatchObject({ dineIn: true, reservations: true, rooms: false });
    await updateOutletSettings(owner(), patch({ guestServices: ["dineIn", "reservations", "rooms"] }));
    expect((await getRestaurantHome("SRJ01")).services.rooms).toBe(false);
    expect((await getOutletSettings(owner())).availableGuestServices).not.toContain("rooms");
  });

  it("pauses new online reservations while preserving existing booking links and other tenants", async () => {
    const date = serviceDate(new Date(Date.now() + 24 * 3600_000), "Asia/Kolkata");
    const slot = (await getBookingAvailability("SRJ01", { date, partySize: 2 })).slots.find(value => value.available)!;
    const held = await createBookingHold("SRJ01", { date, startAt: slot.startAt, partySize: 2, requestId: "public-choice-hold", holdToken: "public-choice-token" });
    const otherBefore = await getRestaurantHome("CNJ01");
    await updateOutletSettings(owner(), patch({ guestServices: ["dineIn"], guestOnlinePayments: false }));
    expect((await getRestaurantHome("SRJ01")).services).toEqual({ delivery: false, dineIn: true, reservations: false, rooms: false });
    expect((await getOutletSettings(owner())).guestOnlinePayments).toBe(false);
    await expect(getBookingAvailability("SRJ01", { date, partySize: 2 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(getBookingZones("SRJ01")).rejects.toMatchObject({ code: "forbidden" });
    await expect(createBookingHold("SRJ01", { date, startAt: slot.startAt, partySize: 2, requestId: "paused-hold", holdToken: "paused-token" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(createGroupRequest("SRJ01", { requestId: "paused-group", name: "Group", phone: "9876543210", partySize: 20, desiredDate: date, desiredLocalDateTime: `${date}T19:00` })).rejects.toMatchObject({ code: "forbidden" });
    expect((await bookingByToken("SRJ01", held.manageToken)).row.id).toBe(held.reservationId);
    expect(await getRestaurantHome("CNJ01")).toEqual(otherBefore);
  });

  it("allows an empty selection, validates choices and requires owner access", async () => {
    await updateOutletSettings(owner(), patch({ guestServices: [] }));
    expect((await getRestaurantHome("SRJ01")).services).toEqual({ delivery: false, dineIn: false, reservations: false, rooms: false });
    await expect(updateOutletSettings({ ...owner(), roles: ["manager"] }, patch({ guestServices: ["reservations"] }))).rejects.toMatchObject({ code: "forbidden" });
    await expect(updateOutletSettings(owner(), patch({ guestServices: ["unknown"] as never }))).rejects.toMatchObject({ code: "invalid_state" });
    await expect(updateOutletSettings(owner(), patch({ guestOnlinePayments: "false" as never }))).rejects.toMatchObject({ code: "invalid_state" });
    const [outlet] = await env.db.select().from(s.outlets).where(eq(s.outlets.id, env.demo.outletId));
    expect(outlet.guestServices).toEqual([]);
    expect(outlet.guestOnlinePayments).toBe(false);
  });

  it("keeps payment, QR, service, and Wi-Fi settings isolated per outlet while sharing the tenant brand", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PAYMENT_CREDENTIALS_KEY", "c".repeat(64));
    const firstOwner = owner();
    const secondOwner = owner(secondOutletId);

    await updateBrandLogo(firstOwner, "/uploads/shared-brand-logo.png");
    await updateBookingPaymentQr(firstOwner, "/uploads/branch-one-qr.png");
    await updateBookingPaymentQr(secondOwner, "/uploads/branch-two-qr.png");
    await saveRestaurantCashfree(firstOwner, { mode: "sandbox", clientId: "merchant_branch_001", clientSecret: "branch_one_secret_123" });
    await saveRestaurantCashfree(secondOwner, { mode: "sandbox", clientId: "merchant_branch_002", clientSecret: "branch_two_secret_456" });
    await updateOutletSettings(firstOwner, patch({ guestServices: ["dineIn"], guestOnlinePayments: false, bookingPaymentMode: "manual_qr", wifiSsid: "Branch One WiFi", wifiPassword: "branch-one-pass" }));
    await updateOutletSettings(secondOwner, patch({ guestServices: ["reservations"], guestOnlinePayments: false, bookingPaymentMode: "manual_qr", wifiSsid: "Branch Two WiFi", wifiPassword: "branch-two-pass" }));

    const [first, second] = await Promise.all([getOutletSettings(firstOwner), getOutletSettings(secondOwner)]);
    expect(first).toMatchObject({ logoUrl: "/uploads/shared-brand-logo.png", bookingPaymentQrUrl: "/uploads/branch-one-qr.png", guestServices: ["dineIn"], wifiSsid: "Branch One WiFi", wifiPassword: "branch-one-pass", paymentGateway: { configured: true, appIdHint: "••••_001" } });
    expect(second).toMatchObject({ logoUrl: "/uploads/shared-brand-logo.png", bookingPaymentQrUrl: "/uploads/branch-two-qr.png", guestServices: ["reservations"], wifiSsid: "Branch Two WiFi", wifiPassword: "branch-two-pass", paymentGateway: { configured: true, appIdHint: "••••_002" } });
    expect(first.bookingPaymentQrUrl).not.toBe(second.bookingPaymentQrUrl);
    expect(first.paymentGateway.appIdHint).not.toBe(second.paymentGateway.appIdHint);
  });
});
