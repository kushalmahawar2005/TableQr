"use server";
import { customerCookie, customerCookieOptions, identifyCustomerCheckout, renewCustomerSession, startCustomerSession } from "@/server/guest/customer-account";
import { cookies } from "next/headers";
import { headers } from "next/headers";
import { uuidv7 } from "@/db/id";
import type { DeliveryAddress, DeliveryCartLine } from "@/db/schema/delivery";
import type { OrderServiceMode } from "@/domain/delivery";
import { prepaidCheckoutContact, claimManualQrDeliveryPayment, createDeliveryCheckout, deliveryRealtimeToken, deliveryStatus, placeDeliveryOrder, rateDeliveryRider } from "@/server/delivery/checkout";
import { priceDeliveryCart, deliveryOutlet } from "@/server/delivery/catalog";
import { sendDeliveryOtp, verifyDeliveryOtp } from "@/server/delivery/otp";
import { lookupPincode, reverseGeocode } from "@/server/delivery/pincode";
import { saveDeliveryPush } from "@/server/guest/push";
import { staffPushConfig, type PushSubscriptionInput } from "@/server/staff/web-push";
import { db } from "@/db";
import { AppError } from "@/server/errors";
import { requestOrigin } from "@/server/request-host";
import { reconcileDeliveryPayment, startDeliveryPayment } from "@/server/delivery/payment";

const cookieName = (outlet: string) => `tq_delivery_${String(outlet).trim().toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
async function identity(outlet: string) {
  const jar = await cookies();
  let deviceId = jar.get("tq_device")?.value;
  if (!deviceId) { deviceId = uuidv7(); jar.set("tq_device", deviceId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 365 * 86400 }); }
  return { deviceId, token: jar.get(cookieName(outlet))?.value ?? "", jar };
}
async function result<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try { return { ok: true, data: await fn() }; } catch (error) {
    if (!(error instanceof AppError)) console.error("[delivery]", error);
    return { ok: false, message: error instanceof AppError ? error.message : "Could not complete that request. Please try again." };
  }
}
export async function quoteDeliveryAction(outlet: string, lines: DeliveryCartLine[], pincode: string, serviceMode: OrderServiceMode = "delivery") {
  return result(async () => priceDeliveryCart(db, await deliveryOutlet(outlet, true, new Date(), serviceMode), lines, serviceMode === "delivery" ? pincode : undefined, new Date(), serviceMode));
}
export async function startDeliveryAction(outlet: string, lines: DeliveryCartLine[], address: DeliveryAddress, phone: string, serviceMode: OrderServiceMode = "delivery", paymentMode?: "cod" | "gateway" | "manual_qr", name = "") {
  return result(async () => {
    const identityData = await identity(outlet);
    const checkout = await createDeliveryCheckout(outlet, identityData.deviceId, { lines, address, serviceMode, paymentMode });
    identityData.jar.set(cookieName(outlet), checkout.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 7 * 86400 });
    const signedIn = identityData.jar.get(customerCookie(outlet))?.value;
    if (await identifyCustomerCheckout(outlet,signedIn,checkout.token,identityData.deviceId)) {
      if (await renewCustomerSession(outlet,signedIn)) identityData.jar.set(customerCookie(outlet),signedIn!,customerCookieOptions);
      return {quote:checkout.quote,otp:null};
    }
    if (await prepaidCheckoutContact(outlet, checkout.token, identityData.deviceId, name, phone)) return { quote: checkout.quote, otp: null };
    const otp = await sendDeliveryOtp(outlet, checkout.token, identityData.deviceId, phone, new Date(), { reuseLiveCode: true });
    return { quote: checkout.quote, otp };
  });
}
export async function resendDeliveryAction(outlet: string, phone: string) {
  return result(async () => { const who = await identity(outlet); return sendDeliveryOtp(outlet, who.token, who.deviceId, phone); });
}
export async function verifyDeliveryAction(outlet: string, challengeId: string, code: string, name: string) {
  return result(async () => {
    const who = await identity(outlet);
    const verified = await verifyDeliveryOtp(outlet, who.token, who.deviceId, challengeId, code, name);
    who.jar.set(customerCookie(outlet), await startCustomerSession(verified.tenantId, verified.guestId), customerCookieOptions);
  });
}
export async function placeDeliveryAction(outlet: string, totalPaise: number) {
  return result(async () => { const who = await identity(outlet); return placeDeliveryOrder(outlet, who.token, who.deviceId, totalPaise); });
}
export async function claimManualQrDeliveryAction(outlet: string, totalPaise: number, reference: string) {
  return result(async () => { const who = await identity(outlet); return claimManualQrDeliveryPayment(outlet, who.token, who.deviceId, totalPaise, reference); });
}
export async function startDeliveryPaymentAction(outlet: string) {
  return result(async () => {
    const who = await identity(outlet);
    const callback = `${requestOrigin(await headers())}/api/delivery/payments/return?c={checkoutId}&o=${encodeURIComponent(outlet)}`;
    return startDeliveryPayment(outlet, who.token, who.deviceId, callback);
  });
}
export async function deliveryStatusAction(outlet: string) {
  return result(async () => { const who = await identity(outlet); await reconcileDeliveryPayment(outlet, who.token, who.deviceId); return deliveryStatus(outlet, who.token, who.deviceId); });
}

/** Stars for the rider, once the food has arrived */
export async function rateRiderAction(outlet: string, stars: number, note: string) {
  return result(async () => { const who = await identity(outlet); return rateDeliveryRider(outlet, who.token, who.deviceId, { stars: Number(stars), note: String(note ?? "") }); });
}

/** City and areas for the address form; null when the pincode is unknown or the lookup is down */
export async function pincodeAction(pincode: string) {
  return lookupPincode(String(pincode ?? "").trim());
}

/** Pincode, area and street for the guest's shared location or dropped pin */
export async function placeAction(lat: number, lng: number) {
  return reverseGeocode(Number(lat), Number(lng));
}

/** Live updates for the customer's own delivery; null when realtime is off (the page polls) */
export async function deliveryTokenAction(outlet: string) {
  const { deviceId, token } = await identity(outlet);
  return result(async () => (token ? deliveryRealtimeToken(outlet, token, deviceId) : null));
}

/** Updates on this phone for the customer's own delivery */
export async function deliveryPushAction(outlet: string, subscription: PushSubscriptionInput) {
  const { deviceId, token } = await identity(outlet);
  return result(async () => saveDeliveryPush(outlet, token, deviceId, subscription));
}
export async function pushKeyAction() { const c = staffPushConfig(); return c.enabled ? c.publicKey : null; }
