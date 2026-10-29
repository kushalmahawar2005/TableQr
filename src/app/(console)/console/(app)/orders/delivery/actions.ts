"use server";
import { revalidatePath } from "next/cache";
import { confirmManualQrDeliveryPayment } from "@/server/delivery/checkout";
import { advanceDelivery, assignDeliveryCourier, cancelDeliveryOrder, deliveryStaffRoles } from "@/server/delivery/staff";
import { staffFor } from "@/server/staff/request";
import { staffRealtimeToken, topics } from "@/server/realtime/token";
import { AppError } from "@/server/errors";
export async function advanceDeliveryAction(id: string, status: "dispatched" | "delivered" | "collected") {
  try { await advanceDelivery(await staffFor(deliveryStaffRoles, "orders"), id, status); revalidatePath("/console/orders"); return { ok: true as const }; }
  catch (error) { if (!(error instanceof AppError)) console.error("[delivery] status update", error); return { ok: false as const, message: error instanceof AppError ? error.message : "Could not update delivery. Please try again." }; }
}
export async function assignDeliveryCourierAction(id: string, name: string, phone: string) {
  try { await assignDeliveryCourier(await staffFor(["owner", "manager"], "orders"), id, { name, phone }); revalidatePath("/console/orders"); return { ok: true as const }; }
  catch (error) { if (!(error instanceof AppError)) console.error("[delivery] courier assignment", error); return { ok: false as const, message: error instanceof AppError ? error.message : "Could not update the rider. Please try again." }; }
}
export async function confirmManualQrDeliveryPaymentAction(id: string) {
  try { await confirmManualQrDeliveryPayment(await staffFor(deliveryStaffRoles, "orders"), id); revalidatePath("/console/orders"); revalidatePath("/console/billing"); return { ok: true as const }; }
  catch (error) { if (!(error instanceof AppError)) console.error("[delivery] manual QR confirmation", error); return { ok: false as const, message: error instanceof AppError ? error.message : "Could not confirm this payment. Please try again." }; }
}
export async function cancelDeliveryOrderAction(id: string, reason: string) {
  try { const r = await cancelDeliveryOrder(await staffFor(["owner", "manager"], "orders"), id, reason); revalidatePath("/console/orders"); revalidatePath("/console/billing"); return { ok: true as const, refunds: r.refunds.length }; }
  catch (error) { if (!(error instanceof AppError)) console.error("[delivery] cancel", error); return { ok: false as const, message: error instanceof AppError ? error.message : "Could not cancel this delivery. Please try again." }; }
}
/** Live updates for the delivery desk: deliveries and rider positions (floor) and the kitchen */
export async function deliveryDeskTokenAction() {
  try { return staffRealtimeToken(await staffFor(deliveryStaffRoles, "orders"), [topics.floor, topics.kitchen]); }
  catch { return null; }
}
