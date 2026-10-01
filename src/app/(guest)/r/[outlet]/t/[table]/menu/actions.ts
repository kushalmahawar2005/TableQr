"use server";

import { cookies } from "next/headers";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import { AppError } from "@/server/errors";
import { setPlainItemQty } from "@/server/guest/cart";
import { guestContextForDevice } from "@/server/guest/menu-screen";
import { guestRealtimeToken } from "@/server/realtime/token";

// G3 actions. The phone sends a dish and a quantity; who the guest is and what they may do is
// decided here from their device cookie.

export type QtyResult =
  /** at: server time of the write, compared with the page's render time */
  | { ok: true; qty: number; at: number }
  | { ok: false; error: "blocked" | "sold_out" | "unavailable_now" | "needs_choice" | "gone" | "failed" };

export async function setPlainQtyAction(outletCode: string, shortCode: string, itemId: string, qty: number): Promise<QtyResult> {
  try {
    const deviceId = (await cookies()).get(DEVICE_COOKIE)?.value ?? null;
    const { ctx } = await guestContextForDevice(outletCode, shortCode, deviceId);
    const res = await setPlainItemQty(ctx, String(itemId), Number(qty));
    return { ok: true, qty: res.qty, at: Date.now() };
  } catch (err) {
    if (!(err instanceof AppError)) return { ok: false, error: "failed" };
    switch (err.code) {
      case "ordering_locked":
      case "table_settling":
        return { ok: false, error: "blocked" };
      case "items_unavailable":
        return { ok: false, error: err.details?.reason === "outside_hours" ? "unavailable_now" : "sold_out" };
      case "needs_choice":
        return { ok: false, error: "needs_choice" };
      case "session_expired":
      case "not_found":
      case "qr_revoked":
      case "outlet_unavailable":
        return { ok: false, error: "gone" };
      default:
        return { ok: false, error: "failed" };
    }
  }
}

/** A short-lived token for this guest's table and the menu topics; null when not at the table */
export async function menuRealtimeTokenAction(outletCode: string, shortCode: string): Promise<string | null> {
  try {
    const deviceId = (await cookies()).get(DEVICE_COOKIE)?.value ?? null;
    const { ctx } = await guestContextForDevice(outletCode, shortCode, deviceId);
    return guestRealtimeToken(ctx);
  } catch {
    return null;
  }
}
