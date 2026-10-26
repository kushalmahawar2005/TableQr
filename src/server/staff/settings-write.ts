import "server-only";
import { validateDeliveryPolicy, type DeliveryPolicy } from "@/domain/delivery";
import { requireFeature } from "../plan";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { roomRequestKinds, type RoomRequestKind } from "@/domain/rooms";
import { AppError } from "../errors";
import { audit } from "./audit";
import type { StaffSession } from "./auth";
import { guestServices, type GuestService } from "@/domain/guest-services";
import { outletGatewayFromConfig } from "../payments/outlet-gateway";
import { encryptMerchantCredentials, outletPaymentGatewayStatus } from "../payments/outlet-gateway";

// Outlet settings the owner may change. Name, code, time zone, table mode and plan stay with TableQR.

type Staff = Pick<StaffSession, "tenantId" | "outletId" | "roles" | "userId" | "name">;
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export type SettingsPatch = {
  deliveryPolicy?: DeliveryPolicy;
  city: string; address: string; gstin: string; fssai: string;
  serviceChargeBp: number; tipPresetsBp: number[] | null; autoAcceptOrders: boolean; guestOnlinePayments?: boolean; reviewUrl: string;
  openingHours: Record<string, [string, string][]> | null;
  roomServices: RoomRequestKind[]; wifiSsid: string; wifiPassword: string;
  guestServices?: GuestService[];
  bookingPaymentMode?: "gateway" | "manual_qr";
  bookingAdvancePaise?: number;
  /** The restaurant's own UPI for guests to pay the bill; empty turns it off */
  upiId?: string | null;
  upiName?: string | null;
  announcementActive?: boolean; announcementTitle?: string; announcementBody?: string;
};

const bad = (message: string) => new AppError("invalid_state", message, { reason: "settings" });

export async function updateOutletSettings(staff: Staff, input: SettingsPatch, now = new Date()) {
  if (!staff.roles.includes("owner")) throw new AppError("forbidden", "Only the owner can change settings.");
  if (input.guestOnlinePayments !== undefined && typeof input.guestOnlinePayments !== "boolean") throw bad("Choose a valid online payment preference.");
  if (input.bookingPaymentMode !== undefined && !["gateway", "manual_qr"].includes(input.bookingPaymentMode)) throw bad("Choose a valid booking payment method.");
  const upiId = input.upiId === undefined ? undefined : String(input.upiId ?? "").trim().toLowerCase();
  if (upiId && !/^[a-z0-9._-]{2,256}@[a-z][a-z0-9]{1,63}$/.test(upiId)) throw bad("Enter a UPI ID like restaurant@okaxis.");
  const upiName = input.upiName === undefined ? undefined : String(input.upiName ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (input.bookingAdvancePaise !== undefined && (!Number.isSafeInteger(input.bookingAdvancePaise) || input.bookingAdvancePaise < 0 || input.bookingAdvancePaise > 1_000_000_000)) throw bad("Reservation advance must be between ₹0 and ₹10,000,000.");
  if (input.announcementActive !== undefined && typeof input.announcementActive !== "boolean") throw bad("Choose whether the announcement is published.");
  const announcementTitle = String(input.announcementTitle ?? "").trim();
  const announcementBody = String(input.announcementBody ?? "").trim();
  const announcementChanged = input.announcementTitle !== undefined || input.announcementBody !== undefined;
  if (announcementTitle.length > 80 || announcementBody.length > 240) throw bad("Announcement title must be 80 characters or fewer and its message 240 characters or fewer.");
  if (announcementChanged && (!!announcementTitle !== !!announcementBody)) throw bad("Add both an announcement title and message, or clear both.");
  let deliveryPolicy: DeliveryPolicy | undefined;
  if (input.deliveryPolicy !== undefined) {
    await requireFeature(staff.tenantId, "delivery");
    try { deliveryPolicy = validateDeliveryPolicy(input.deliveryPolicy); }
    catch (error) { throw bad(error instanceof Error ? error.message : "Choose valid delivery settings."); }
    if (deliveryPolicy.paymentMode === "gateway" && !outletGatewayFromConfig((await db.select({ paymentGatewayConfig: s.outlets.paymentGatewayConfig }).from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId))))[0]?.paymentGatewayConfig)) throw bad("Connect this restaurant’s own live Cashfree account before enabling online delivery prepayment.");
  }
  const city = String(input.city ?? "").trim();
  const address = String(input.address ?? "").trim();
  if (!city || city.length > 80) throw bad("Enter the city.");
  if (!address || address.length > 300) throw bad("Enter the full address.");
  const gstin = String(input.gstin ?? "").trim().toUpperCase();
  if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(gstin)) throw bad("GSTIN looks wrong. It has 15 letters and numbers, like 08ABCDE1234F1Z5.");
  const fssai = String(input.fssai ?? "").trim();
  if (fssai && !/^\d{14}$/.test(fssai)) throw bad("FSSAI number must be 14 digits.");
  const sc = Number(input.serviceChargeBp);
  if (!Number.isInteger(sc) || sc < 0 || sc > 2000) throw bad("Service charge must be between 0% and 20%.");
  let tips: number[] | null = null;
  if (input.tipPresetsBp) {
    tips = [...new Set(input.tipPresetsBp.map(Number))].sort((a, b) => a - b);
    if (tips.length > 4 || tips.some((t) => !Number.isInteger(t) || t < 100 || t > 3000)) throw bad("Tip choices must be 1% to 30%, up to 4 of them.");
    if (!tips.length) tips = null;
  }
  const reviewUrl = String(input.reviewUrl ?? "").trim();
  if (reviewUrl && (!/^https:\/\//i.test(reviewUrl) || reviewUrl.length > 500)) throw bad("Review link must start with https://");
  if (!Array.isArray(input.roomServices) || input.roomServices.some((kind) => !roomRequestKinds.includes(kind)) || new Set(input.roomServices).size !== input.roomServices.length) throw bad("Choose valid room service options.");
  if (input.guestServices !== undefined && (!Array.isArray(input.guestServices) || input.guestServices.some(service => !guestServices.includes(service)) || new Set(input.guestServices).size !== input.guestServices.length)) throw bad("Choose valid guest services.");
  const roomServices = [...input.roomServices];
  const wifiSsid = String(input.wifiSsid ?? "").trim();
  const wifiPassword = String(input.wifiPassword ?? "");
  if (wifiSsid.length > 32) throw bad("Wi-Fi name must be 32 characters or fewer.");
  if (wifiPassword.length > 63 || /[\r\n]/.test(wifiPassword)) throw bad("Wi-Fi password must be 63 characters or fewer.");
  if (wifiPassword && !wifiSsid) throw bad("Add the Wi-Fi name before its password.");
  let hours: Record<string, [string, string][]> | null = null;
  if (input.openingHours) {
    hours = {};
    for (const d of DAYS) {
      const ranges = (input.openingHours[d] ?? []).map(([a, b]) => [String(a), String(b)] as [string, string]);
      if (ranges.length > 3) throw bad("At most 3 time slots per day.");
      // A closing time earlier than the opening time runs past midnight (08:00 to 02:00 closes at 2 am the next day)
      for (const [a, b] of ranges) if (!TIME.test(a) || !TIME.test(b) || a === b) throw bad("Opening and closing time cannot be the same. A closing time like 2:00 am counts as the next day.");
      hours[d] = ranges.sort((x, y) => x[0].localeCompare(y[0]));
    }
  }
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId))).for("update");
    if (!before) throw new AppError("not_found", "Outlet not found.");
    const savedAnnouncementTitle = input.announcementTitle === undefined ? before.announcementTitle : announcementTitle || null;
    const savedAnnouncementBody = input.announcementBody === undefined ? before.announcementBody : announcementBody || null;
    const announcementWillBeActive = input.announcementActive ?? before.announcementActive;
    if (announcementWillBeActive && (!savedAnnouncementTitle || !savedAnnouncementBody)) throw bad("Add a title and message before publishing the announcement.");
    const next = { city, address, gstin: gstin || null, fssai: fssai || null, serviceChargeBp: sc, tipPresetsBp: tips, autoAcceptOrders: !!input.autoAcceptOrders, guestOnlinePayments: input.guestOnlinePayments ?? before.guestOnlinePayments, reviewUrl: reviewUrl || null, openingHours: hours, roomServices, wifiSsid: wifiSsid || null, wifiPassword: wifiPassword || null, announcementActive: announcementWillBeActive, announcementTitle: savedAnnouncementTitle, announcementBody: savedAnnouncementBody };
    const nextGuestServices = input.guestServices === undefined ? before.guestServices : [...input.guestServices];
    const bookingPaymentMode = input.bookingPaymentMode ?? before.bookingPaymentMode;
    const onlinePayments = input.guestOnlinePayments ?? before.guestOnlinePayments;
    if (onlinePayments && !outletGatewayFromConfig(before.paymentGatewayConfig)) throw bad("Connect this restaurant’s own Cashfree account before enabling guest online payments.");
    if (bookingPaymentMode === "gateway" && before.bookingPaymentMode !== "gateway" && !outletGatewayFromConfig(before.paymentGatewayConfig)) throw bad("Connect this restaurant’s own Cashfree account before enabling online booking advances, or use the restaurant QR option.");
    if (bookingPaymentMode === "manual_qr" && !before.bookingPaymentQrUrl) throw bad("Upload your payment QR before enabling manual booking advances.");
    if ((input.bookingAdvancePaise ?? before.bookingAdvancePaise) > 0 && bookingPaymentMode === "gateway" && !outletGatewayFromConfig(before.paymentGatewayConfig)) throw bad("Connect this restaurant’s own Cashfree account or choose its QR before requiring reservation advances.");
    if ((input.bookingAdvancePaise ?? before.bookingAdvancePaise) > 0 && bookingPaymentMode === "manual_qr" && !before.bookingPaymentQrUrl) throw bad("Upload your restaurant payment QR before requiring reservation advances.");
    if (deliveryPolicy?.paymentMode === "manual_qr" && !before.bookingPaymentQrUrl) throw bad("Upload your restaurant payment QR before selecting manual delivery payments.");
    const bookingAdvancePaise = input.bookingAdvancePaise ?? before.bookingAdvancePaise;
    await tx.update(s.outlets).set({ ...next, ...(deliveryPolicy ? { deliveryPolicy } : {}), guestServices: nextGuestServices, bookingPaymentMode, bookingAdvancePaise, ...(upiId !== undefined ? { upiId: upiId || null } : {}), ...(upiName !== undefined ? { upiName: upiName || null } : {}) }).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId)));
    await audit(tx, staff, {
      action: "outlet.settings_changed", entity: "outlet", entityId: staff.outletId, now,
      before: { deliveryPolicy: before.deliveryPolicy, city: before.city, address: before.address, gstin: before.gstin, fssai: before.fssai, serviceChargeBp: before.serviceChargeBp, tipPresetsBp: before.tipPresetsBp, autoAcceptOrders: before.autoAcceptOrders, guestOnlinePayments: before.guestOnlinePayments, guestServices: before.guestServices, bookingPaymentMode: before.bookingPaymentMode, bookingAdvancePaise: before.bookingAdvancePaise, reviewUrl: before.reviewUrl, openingHours: before.openingHours, roomServices: before.roomServices, wifiSsid: before.wifiSsid, hasWifiPassword: !!before.wifiPassword, announcementActive: before.announcementActive, announcementTitle: before.announcementTitle, announcementBody: before.announcementBody },
      after: { ...next, deliveryPolicy: deliveryPolicy ?? before.deliveryPolicy, guestServices: nextGuestServices, bookingPaymentMode, bookingAdvancePaise, wifiPassword: "[redacted]", hasWifiPassword: !!wifiPassword },
    });
  });
}

/** Store a restaurant's own merchant account. Never audit or return the secret. */
export async function saveRestaurantCashfree(staff: Staff, input: { mode: unknown; clientId: unknown; clientSecret: unknown } | null, now = new Date()) {
  if (!staff.roles.includes("owner")) throw new AppError("forbidden", "Only the owner can connect restaurant payments.");
  const encrypted = input ? encryptMerchantCredentials(input) : null;
  const mode = input ? String(input.mode) : null;
  const clientId = input ? String(input.clientId).trim() : "";
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId))).for("update");
    if (!before) throw new AppError("not_found", "Outlet not found.");
    if (!encrypted && (before.bookingPaymentMode === "gateway" || before.guestOnlinePayments)) throw bad("Turn off online bill payments and switch booking advances to your restaurant QR before removing Cashfree.");
    await tx.update(s.outlets).set({ paymentGatewayConfig: encrypted }).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId)));
    await audit(tx, staff, {
      action: encrypted ? "outlet.payment_gateway_connected" : "outlet.payment_gateway_removed", entity: "outlet", entityId: staff.outletId, now,
      before: { connected: !!before.paymentGatewayConfig }, after: { connected: !!encrypted, provider: encrypted ? "cashfree" : null, mode, appIdHint: encrypted ? `••••${clientId.slice(-4)}` : null },
    });
  });
  return outletPaymentGatewayStatus(staff.tenantId, staff.outletId);
}

/** Change the logo for this tenant's shared brand. Guest pages read it from the brand record. */
export async function updateBrandLogo(staff: Staff, logoUrl: string | null, now = new Date()) {
  if (!staff.roles.includes("owner")) throw new AppError("forbidden", "Only the owner can change the restaurant logo.");
  if (logoUrl !== null && (!/^https:\/\//i.test(logoUrl) && !logoUrl.startsWith("/uploads/"))) {
    throw bad("Upload a logo image before saving it.");
  }
  if (logoUrl && logoUrl.length > 500) throw bad("The logo address is too long.");

  return db.transaction(async (tx) => {
    const [outlet] = await tx.select({ brandId: s.outlets.brandId }).from(s.outlets)
      .where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId))).for("update");
    if (!outlet) throw new AppError("not_found", "Outlet not found.");
    const [brand] = await tx.select({ logoUrl: s.brands.logoUrl }).from(s.brands)
      .where(and(eq(s.brands.tenantId, staff.tenantId), eq(s.brands.id, outlet.brandId))).for("update");
    if (!brand) throw new AppError("not_found", "Restaurant brand not found.");
    await tx.update(s.brands).set({ logoUrl }).where(and(eq(s.brands.tenantId, staff.tenantId), eq(s.brands.id, outlet.brandId)));
    await audit(tx, staff, {
      action: "brand.logo_changed", entity: "brand", entityId: outlet.brandId, now,
      before: { logoUrl: brand.logoUrl }, after: { logoUrl },
    });
  });
}

export async function updateBookingPaymentQr(staff: Staff, url: string, now = new Date()) {
  if (!staff.roles.includes("owner")) throw new AppError("forbidden", "Only the owner can change the payment QR.");
  if (url.length > 500 || (!url.startsWith("/uploads/") && !url.startsWith("https://"))) throw bad("Upload a valid payment QR image.");
  await db.transaction(async tx => {
    const [outlet] = await tx.select({ qr: s.outlets.bookingPaymentQrUrl }).from(s.outlets).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId))).for("update");
    if (!outlet) throw new AppError("not_found", "Outlet not found.");
    await tx.update(s.outlets).set({ bookingPaymentQrUrl: url }).where(and(eq(s.outlets.tenantId, staff.tenantId), eq(s.outlets.id, staff.outletId)));
    await audit(tx, staff, { action: "outlet.booking_payment_qr_changed", entity: "outlet", entityId: staff.outletId, before: { qr: outlet.qr }, after: { qr: url }, now });
  });
}
