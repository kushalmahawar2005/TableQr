export type NotificationPermissionState = "default" | "granted" | "denied";
export type NotificationSetupMode = "hidden" | "request-permission" | "finish-setup";

/** One first-launch prompt; granted-but-unsubscribed devices only see a setup action, never another permission ask. */
export function notificationSetupMode(permission: NotificationPermissionState, dismissed: boolean, hasSubscription: boolean): NotificationSetupMode {
  if (dismissed || permission === "denied" || (permission === "granted" && hasSubscription)) return "hidden";
  return permission === "granted" ? "finish-setup" : "request-permission";
}
