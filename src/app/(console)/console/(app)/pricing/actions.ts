"use server";
import { AppError } from "@/server/errors";
import { clearMenuCache } from "@/server/guest/menu";
import type { StaffSession } from "@/server/staff/auth";
import { bulkOutletPrice, clearOutletPrice, getPricingData, setOutletPrice, type BulkInput } from "@/server/staff/pricing";
import { staffFor } from "@/server/staff/request";
import { pricingPermissions } from "@/lib/staff-permissions";

// O4 Pricing actions. Staff, role and outlet come from the httpOnly cookie; the client sends only
// item ids, whole-rupee values and what it last showed (for stale checks). Every write checks
// pricing.edit again on the server.

export type PricingResult<T = null> = { ok: true; data: T } | { ok: false; code: string; message: string };

async function run<T>(work: (staff: StaffSession) => Promise<T>): Promise<PricingResult<T>> {
  try {
    const staff = await staffFor(pricingPermissions["pricing.view"], "pricing");
    const data = await work(staff);
    // A new price shows to guests at once, not after the menu cache runs out
    clearMenuCache(staff.tenantId);
    return { ok: true, data };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, code: err.code, message: err.message };
    console.error("[pricing] action failed", err);
    return { ok: false, code: "failed", message: "That didn't go through. Try again." };
  }
}

const expectedOf = (value: unknown) => (value === null ? null : typeof value === "number" ? value : undefined);

export async function pricingDataAction() {
  return run((s) => getPricingData(s));
}

export async function setOutletPriceAction(itemId: string, pricePaise: number, expectedOutletPricePaise: number | null) {
  return run((s) => setOutletPrice(s, String(itemId), Number(pricePaise), { expectedOutletPricePaise: expectedOf(expectedOutletPricePaise) }));
}

export async function clearOutletPriceAction(itemId: string, expectedOutletPricePaise: number | null) {
  return run((s) => clearOutletPrice(s, String(itemId), { expectedOutletPricePaise: expectedOf(expectedOutletPricePaise) }));
}

export async function bulkOutletPriceAction(input: BulkInput) {
  return run((s) => bulkOutletPrice(s, input));
}
