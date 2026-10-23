"use server";
import { cookies } from "next/headers";
import { headers } from "next/headers";
import { uuidv7 } from "@/db/id";
import type { DeliveryAddress, DeliveryCartLine } from "@/db/schema/delivery";
import { claimManualQrDeliveryPayment, createDeliveryCheckout, deliveryStatus, placeDeliveryOrder } from "@/server/delivery/checkout";
import { priceDeliveryCart, deliveryOutlet } from "@/server/delivery/catalog";
import { sendDeliveryOtp, verifyDeliveryOtp } from "@/server/delivery/otp";
import { db } from "@/db";
import { AppError } from "@/server/errors";
import { publicOrigin } from "@/server/guest/invite";
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
export async function quoteDeliveryAction(outlet: string, lines: DeliveryCartLine[], pincode: string) {
  return result(async () => priceDeliveryCart(db, await deliveryOutlet(outlet), lines, pincode));
}
export async function startDeliveryAction(outlet: string, lines: DeliveryCartLine[], address: DeliveryAddress, phone: string) {
  return result(async () => {
    const identityData = await identity(outlet);
    const checkout = await createDeliveryCheckout(outlet, identityData.deviceId, { lines, address });
    identityData.jar.set(cookieName(outlet), checkout.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 7 * 86400 });
    const otp = await sendDeliveryOtp(outlet, checkout.token, identityData.deviceId, phone);
    return { quote: checkout.quote, otp };
  });
}
export async function resendDeliveryAction(outlet: string, phone: string) {
  return result(async () => { const who = await identity(outlet); return sendDeliveryOtp(outlet, who.token, who.deviceId, phone); });
}
export async function verifyDeliveryAction(outlet: string, challengeId: string, code: string, name: string) {
  return result(async () => { const who = await identity(outlet); await verifyDeliveryOtp(outlet, who.token, who.deviceId, challengeId, code, name); });
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
    const callback = `${publicOrigin(await headers())}/api/delivery/payments/return?c={checkoutId}&o=${encodeURIComponent(outlet)}`;
    return startDeliveryPayment(outlet, who.token, who.deviceId, callback);
  });
}
export async function deliveryStatusAction(outlet: string) {
  return result(async () => { const who = await identity(outlet); await reconcileDeliveryPayment(outlet, who.token, who.deviceId); return deliveryStatus(outlet, who.token, who.deviceId); });
}
