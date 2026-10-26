"use server";
import { assignTeamRider, riderReportLocation, riderCollectCash, riderDelivered, riderJobs, riderPickUp, riderProfile, riderSetOnline, saveRiderProfile } from "@/server/delivery/riders";
import { AppError } from "@/server/errors";
import { staffFor } from "@/server/staff/request";
import { deliveryStaffRoles } from "@/server/delivery/staff";

async function run<T>(roles: Parameters<typeof staffFor>[0], work: (staff: Awaited<ReturnType<typeof staffFor>>) => Promise<T>) {
  try { return { ok: true as const, data: await work(await staffFor(roles)) }; }
  catch (e) { if (!(e instanceof AppError)) console.error("[rider]", e); return { ok: false as const, error: e instanceof AppError ? e.message : "Could not complete this. Check your connection and try again." }; }
}

export async function riderJobsAction() { return run(["rider"], (s) => riderJobs(s)); }
export async function riderPickUpAction(id: string) { return run(["rider"], (s) => riderPickUp(s, id)); }
export async function riderCashAction(id: string, requestId: string) { return run(["rider"], (s) => riderCollectCash(s, id, requestId)); }
export async function riderDeliveredAction(id: string) { return run(["rider"], (s) => riderDelivered(s, id)); }
export async function riderOnlineAction(online: boolean) { return run(["rider"], (s) => riderSetOnline(s, !!online)); }
export async function riderProfileAction() { return run(["rider"], (s) => riderProfile(s)); }
export async function riderSaveProfileAction(form: FormData) {
  return run(["rider"], async (s) => {
    const file = form.get("photo");
    const photo = file instanceof File && file.size > 0 ? { bytes: Buffer.from(await file.arrayBuffer()), contentType: file.type, filename: file.name } : null;
    const vehicle = form.get("vehicleNo");
    return saveRiderProfile(s, { vehicleNo: typeof vehicle === "string" ? vehicle : undefined, photo });
  });
}
/** Console: give a delivery to a team rider */
export async function assignTeamRiderAction(deliveryId: string, riderId: string) { return run(deliveryStaffRoles, (s) => assignTeamRider(s, deliveryId, riderId)); }
export async function riderLocationAction(lat: number, lng: number) { return run(["rider"], (s) => riderReportLocation(s, { lat, lng })); }
