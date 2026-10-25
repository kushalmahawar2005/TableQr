"use server";
import { friendlyError } from "@/server/friendly-error";

import { currentStaff } from "@/server/staff/request";
import { removeStaffPushSubscription, saveStaffPushSubscription, staffPushConfig, type PushSubscriptionInput } from "@/server/staff/web-push";

export async function pushSetupAction() {
  const staff = await currentStaff();
  if (!staff) return { enabled: false, publicKey: "" };
  return staffPushConfig();
}

export async function savePushSubscriptionAction(subscription: PushSubscriptionInput) {
  const staff = await currentStaff();
  if (!staff) return { ok: false as const, error: "Please sign in again." };
  try {
    await saveStaffPushSubscription(staff, subscription);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: friendlyError(error, "Could not enable notifications.") };
  }
}

export async function removePushSubscriptionAction(endpoint: string) {
  const staff = await currentStaff();
  if (!staff) return { ok: false as const };
  await removeStaffPushSubscription(staff, endpoint);
  return { ok: true as const };
}
