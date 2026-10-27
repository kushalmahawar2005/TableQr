"use server";

import { cookies } from "next/headers";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import { AppError } from "@/server/errors";
import { addCartLine, removeCartLine, setCartLineQty, type RemovedLine } from "@/server/guest/cart";
import { guestContextForDevice } from "@/server/guest/menu-screen";
import { placeOrder } from "@/server/guest/order";

// G5 actions. Every one finds the guest from their device cookie and goes through the cart
// rules on the server; the phone only says which line and how many.

type Err = "blocked" | "gone" | "failed";

async function context(outletCode: string, shortCode: string) {
  const deviceId = (await cookies()).get(DEVICE_COOKIE)?.value ?? null;
  return (await guestContextForDevice(outletCode, shortCode, deviceId)).ctx;
}

function common(err: unknown): Err {
  if (!(err instanceof AppError)) return "failed";
  if (err.code === "ordering_locked" || err.code === "table_settling") return "blocked";
  if (["session_expired", "not_found", "qr_revoked", "outlet_unavailable"].includes(err.code)) return "gone";
  return "failed";
}

export type LineResult = { ok: true; at: number } | { ok: false; error: Err };

export async function setLineQtyAction(outletCode: string, shortCode: string, lineId: string, qty: number): Promise<LineResult> {
  try {
    await setCartLineQty(await context(outletCode, shortCode), String(lineId), Number(qty));
    return { ok: true, at: Date.now() };
  } catch (err) {
    return { ok: false, error: common(err) };
  }
}

export type RemoveResult = { ok: true; at: number; snapshot: RemovedLine | null } | { ok: false; error: Err };

export async function removeLineAction(outletCode: string, shortCode: string, lineId: string): Promise<RemoveResult> {
  try {
    const snapshot = await removeCartLine(await context(outletCode, shortCode), String(lineId));
    return { ok: true, at: Date.now(), snapshot };
  } catch (err) {
    return { ok: false, error: common(err) };
  }
}

export type RestoreResult = { ok: true } | { ok: false; error: Err | "unavailable" };

/**
 * Undo after Remove. Only the configuration comes from the phone; the dish, options and hours are
 * checked again and the line is priced at today's menu price.
 */
export async function restoreLineAction(outletCode: string, shortCode: string, snap: RemovedLine): Promise<RestoreResult> {
  try {
    await addCartLine(await context(outletCode, shortCode), {
      itemId: String(snap.itemId),
      qty: Number(snap.qty),
      modifierIds: Array.isArray(snap.modifierIds) ? snap.modifierIds.map(String) : [],
      note: snap.note ? String(snap.note) : undefined,
      sharedWith: Array.isArray(snap.sharedWith) ? snap.sharedWith.map(String) : undefined,
      personalForPickup: snap.personalForPickup === true,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof AppError && (err.code === "items_unavailable" || err.code === "invalid_line")) return { ok: false, error: "unavailable" };
    return { ok: false, error: common(err) };
  }
}

export type PlaceResult =
  | { ok: true; roundNo: number }
  | { ok: false; error: Err | "items" | "cap" | "name_required" | "invalid_name" | "phone_required" | "empty" | "prices" | "verification_required" };

/** The reviewed prices from the phone, reduced to plain numbers; used only to compare */
function cleanQuote(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, 200)) {
    if (typeof value === "number" && Number.isInteger(value)) out[String(key).slice(0, 400)] = value;
  }
  return out;
}

/** Place order. The request id comes from the phone and is reused on every retry of one attempt. */
export async function placeOrderAction(
  outletCode: string,
  shortCode: string,
  input: { requestId: string; name?: string; phone?: string; note?: string; quote: Record<string, number> },
): Promise<PlaceResult> {
  try {
    const ctx = await context(outletCode, shortCode);
    // Always compared: a missing or empty quote means nothing was reviewed, so prices must be confirmed
    const res = await placeOrder(ctx, { requestId: String(input.requestId).slice(0, 64), name: input.name ? String(input.name) : undefined, phone: input.phone ? String(input.phone) : undefined, note: input.note ? String(input.note) : undefined, quote: cleanQuote(input.quote) });
    return { ok: true, roundNo: res.roundNo };
  } catch (err) {
    if (err instanceof AppError) {
      switch (err.code) {
        case "verification_required":
          return { ok: false, error: "verification_required" };
        case "items_unavailable":
          return { ok: false, error: "items" };
        case "needs_staff_confirmation":
          return { ok: false, error: "cap" };
        case "name_required":
        case "invalid_name":
        case "phone_required":
          return { ok: false, error: err.code };
        case "cart_empty":
          return { ok: false, error: "empty" };
        case "price_changed":
          return { ok: false, error: "prices" };
      }
    }
    return { ok: false, error: common(err) };
  }
}
