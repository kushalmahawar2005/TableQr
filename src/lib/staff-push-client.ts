import { pushSetupAction, savePushSubscriptionAction } from "@/app/(console)/console/(app)/_components/push-actions";

function keyBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const raw = window.atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function sameKey(current: ArrayBuffer | null, expected: Uint8Array) {
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === expected.length && bytes.every((byte, index) => byte === expected[index]);
}

export function serializePushSubscription(subscription: PushSubscription) {
  const value = subscription.toJSON();
  if (!value.endpoint || !value.keys?.p256dh || !value.keys.auth) throw new Error("The browser did not return a complete push subscription.");
  return { endpoint: value.endpoint, expirationTime: value.expirationTime ?? null, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
}

export async function enableStaffPushNotifications() {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false as const, permission: "unsupported", error: "Push notifications are not supported in this browser." };
  }

  // Keep this call before any await: browsers require a direct user gesture for the permission prompt.
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") return { ok: false as const, permission, error: permission === "denied" ? "Notifications are blocked in your device settings." : "Notification permission was not granted." };

  const config = await pushSetupAction();
  if (!config.enabled || !config.publicKey) return { ok: false as const, permission, error: "Push notifications are not configured on the server yet." };

  try {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    const ready = await navigator.serviceWorker.ready;
    const key = keyBytes(config.publicKey);
    let subscription = await ready.pushManager.getSubscription();
    const currentKey = subscription?.options.applicationServerKey ?? null;
    if (subscription && !sameKey(currentKey, key)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const saved = await savePushSubscriptionAction(serializePushSubscription(subscription));
    if (!saved.ok) return { ok: false as const, permission, error: saved.error };
    return { ok: true as const, permission };
  } catch (error) {
    return { ok: false as const, permission, error: error instanceof Error ? error.message : "Could not finish notification setup." };
  }
}
