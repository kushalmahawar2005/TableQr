"use server";
import { revalidatePath } from "next/cache";
import { advanceDelivery, deliveryStaffRoles } from "@/server/delivery/staff";
import { staffFor } from "@/server/staff/request";
import { AppError } from "@/server/errors";
export async function advanceDeliveryAction(id: string, status: "dispatched" | "delivered") {
  try { await advanceDelivery(await staffFor(deliveryStaffRoles), id, status); revalidatePath("/console/orders/delivery"); return { ok: true as const }; }
  catch (error) { if (!(error instanceof AppError)) console.error("[delivery] status update", error); return { ok: false as const, message: error instanceof AppError ? error.message : "Could not update delivery. Please try again." }; }
}
