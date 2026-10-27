"use server";
import { assignTeamRider, riderReportLocation, riderCollectCash, riderDelivered, riderJobs, riderPickUp, riderProfile, riderSetOnline, saveRiderProfile } from "@/server/delivery/riders";
import { AppError } from "@/server/errors";
import { myVerification, submitRiderDocuments } from "@/server/delivery/rider-docs";
import { staffFor } from "@/server/staff/request";
import { staffRealtimeToken, topics } from "@/server/realtime/token";
import { deliveryStaffRoles } from "@/server/delivery/staff";
import { riderPaymentIssue, riderQr, riderQrStatus, riderUpiReceived } from "@/server/delivery/rider-pay";
import { requestOrigin } from "@/server/request-host";
import { headers } from "next/headers";

async function run<T>(roles: Parameters<typeof staffFor>[0], work: (staff: Awaited<ReturnType<typeof staffFor>>) => Promise<T>) {
  try { return { ok: true as const, data: await work(await staffFor(roles)) }; }
  catch (e) { if (!(e instanceof AppError)) console.error("[rider]", e); return { ok: false as const, error: e instanceof AppError ? e.message : "Could not complete this. Check your connection and try again." }; }
}

export async function riderJobsAction() { return run(["rider"], (s) => riderJobs(s)); }
export async function riderPickUpAction(id: string) { return run(["rider"], (s) => riderPickUp(s, id)); }
export async function riderCashAction(id: string, requestId: string) { return run(["rider"], (s) => riderCollectCash(s, id, requestId)); }
export async function riderDeliveredAction(id: string, pin: string) { return run(["rider"], (s) => riderDelivered(s, id, String(pin ?? ""))); }
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
/** Live updates for the rider's phone: their own jobs, and the kitchen (food ready to pick up) */
export async function riderTokenAction() {
  try { const s = await staffFor(["rider"]); return staffRealtimeToken(s, [topics.rider(s.userId), topics.kitchen]); }
  catch { return null; }
}
export async function myVerificationAction() { return run(["rider"], (s) => myVerification(s)); }
export async function submitDocumentsAction(form: FormData) {
  return run(["rider"], async (s) => {
    const file = async (name: string) => {
      const f = form.get(name);
      if (!(f instanceof File) || !f.size) throw new AppError("invalid_state", `Add the ${name === "front" ? "front" : "back"} photo of your Aadhaar.`);
      return { bytes: Buffer.from(await f.arrayBuffer()), contentType: f.type };
    };
    return submitRiderDocuments(s, { last4: String(form.get("last4") ?? ""), consent: form.get("consent") === "on", front: await file("front"), back: await file("back") });
  });
}
/** Payment at the door: a QR, its status, UPI checked by hand, or money taken another way with a note */
export async function riderQrAction(id: string) { return run(["rider"], async (s) => riderQr(s, String(id), requestOrigin(await headers()))); }
export async function riderQrStatusAction(id: string, paymentId: string) { return run(["rider"], (s) => riderQrStatus(s, String(id), String(paymentId))); }
export async function riderUpiReceivedAction(id: string, reference: string) { return run(["rider"], (s) => riderUpiReceived(s, String(id), String(reference ?? ""))); }
export async function riderPaymentIssueAction(id: string, method: "cash" | "upi", note: string) { return run(["rider"], (s) => riderPaymentIssue(s, String(id), { method, note: String(note ?? "") })); }
