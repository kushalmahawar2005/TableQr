"use server";
import { cookies } from "next/headers";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import { AppError } from "@/server/errors";
import { guestContextForDevice } from "@/server/guest/menu-screen";
import { cancelOrderLine, repeatOrderRound } from "@/server/guest/tracker";
import { getTrackerScreen } from "@/server/guest/tracker-screen";
import { createServiceRequest, type ServiceKind } from "@/server/guest/service-requests";
import { guestRealtimeToken } from "@/server/realtime/token";

async function device() { return (await cookies()).get(DEVICE_COOKIE)?.value ?? null; }
function errorOf(err: unknown): "gone" | "accepted" | "host_only" | "blocked" | "failed" {
  if (!(err instanceof AppError)) return "failed";
  if (["session_expired", "not_found", "qr_revoked", "outlet_unavailable"].includes(err.code)) return "gone";
  if (err.details?.reason === "host_only") return "host_only";
  if (err.code === "table_settling") return "blocked";
  if (err.code === "invalid_state") return "accepted";
  return "failed";
}
export async function trackerDataAction(outlet: string, table: string) {
  try { return { ok: true as const, data: await getTrackerScreen(outlet, table, await device()) }; }
  catch (err) { return { ok: false as const, error: errorOf(err) }; }
}
export async function cancelLineAction(outlet: string, table: string, lineId: string) {
  try {
    const { ctx } = await guestContextForDevice(outlet, table, await device());
    await cancelOrderLine(ctx, String(lineId));
    return { ok: true as const };
  } catch (err) { return { ok: false as const, error: errorOf(err) }; }
}
export async function repeatOrderRoundAction(outlet: string, table: string, orderId: string) {
  try {
    const { ctx } = await guestContextForDevice(outlet, table, await device());
    return { ok: true as const, ...(await repeatOrderRound(ctx, String(orderId))) };
  } catch (err) { return { ok: false as const, error: errorOf(err) }; }
}
export async function serviceRequestAction(outlet: string, table: string, kind: ServiceKind, requestId: string) {
  try {
    const { ctx } = await guestContextForDevice(outlet, table, await device());
    const request = await createServiceRequest(ctx, kind, requestId);
    return { ok: true as const, request };
  } catch (err) { return { ok: false as const, error: errorOf(err) }; }
}
export async function trackerTokenAction(outlet: string, table: string) {
  try {
    const { ctx } = await guestContextForDevice(outlet, table, await device());
    return guestRealtimeToken(ctx);
  } catch { return null; }
}
