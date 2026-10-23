"use server";
import { revalidatePath } from "next/cache";
import { confirmManualQrDeliveryPayment } from "@/server/delivery/checkout";
import { advanceDelivery, assignDeliveryCourier, deliveryStaffRoles } from "@/server/delivery/staff";
import { staffFor } from "@/server/staff/request";
import { AppError } from "@/server/errors";
export async function advanceDeliveryAction(id: string, status: "dispatched" | "delivered") {
  try { await advanceDelivery(await staffFor(deliveryStaffRoles), id, status); revalidatePath("/console/orders/delivery"); return { ok: true as const }; }
  catch (error) { if (!(error instanceof AppError)) console.error("[delivery] status update", error); return { ok: false as const, message: error instanceof AppError ? error.message : "Could not update delivery. Please try again." }; }
}
export async function assignDeliveryCourierAction(id: string, name: string, phone: string) {
  try { await assignDeliveryCourier(await staffFor(["owner", "manager"]), id, { name, phone }); revalidatePath("/console/orders/delivery"); return { ok: true as const }; }
  catch (error) { if (!(error instanceof AppError)) console.error("[delivery] courier assignment", error); return { ok: false as const, message: error instanceof AppError ? error.message : "Could not update the rider. Please try again." }; }
}
export async function confirmManualQrDeliveryPaymentAction(id: string) {
  try { await confirmManualQrDeliveryPayment(await staffFor(deliveryStaffRoles), id); revalidatePath("/console/orders/delivery"); revalidatePath("/console/billing"); return { ok: true as const }; }
  catch (error) { if (!(error instanceof AppError)) console.error("[delivery] manual QR confirmation", error); return { ok: false as const, message: error instanceof AppError ? error.message : "Could not confirm this payment. Please try again." }; }
}
