"use server";

import { cookies } from "next/headers";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import { AppError } from "@/server/errors";
import { addConfiguredLine } from "@/server/guest/cart";
import { guestContextForDevice } from "@/server/guest/menu-screen";

export type AddResult =
  | { ok: true }
  | { ok: false; error: "blocked" | "sold_out" | "unavailable_now" | "max_qty" | "gone" | "failed" }
  | { ok: false; error: "option_unavailable"; modifierIds: string[] };

/** G4 "Add to cart": the server checks the table, the dish, every option and the price again */
export async function addItemAction(
  outletCode: string,
  shortCode: string,
  input: { itemId: string; qty: number; modifierIds: string[]; note: string },
): Promise<AddResult> {
  try {
    const deviceId = (await cookies()).get(DEVICE_COOKIE)?.value ?? null;
    const { ctx } = await guestContextForDevice(outletCode, shortCode, deviceId);
    await addConfiguredLine(ctx, {
      itemId: String(input.itemId),
      qty: Number(input.qty),
      modifierIds: Array.isArray(input.modifierIds) ? input.modifierIds.map(String) : [],
      note: String(input.note ?? ""),
    });
    return { ok: true };
  } catch (err) {
    if (!(err instanceof AppError)) return { ok: false, error: "failed" };
    switch (err.code) {
      case "ordering_locked":
      case "table_settling":
        return { ok: false, error: "blocked" };
      case "items_unavailable":
        return { ok: false, error: err.details?.reason === "outside_hours" ? "unavailable_now" : "sold_out" };
      case "invalid_line":
        if (Array.isArray(err.details?.modifierIds)) {
          return { ok: false, error: "option_unavailable", modifierIds: err.details.modifierIds as string[] };
        }
        return { ok: false, error: err.details?.reason === "max_qty" ? "max_qty" : "failed" };
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
