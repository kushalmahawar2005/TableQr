// Turns on push for a guest's phone. The caller passes how to get the server's public key and
// how to save the subscription, so the same steps serve deliveries and bookings.
const keyBytes = (value: string) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(window.atob(padded), (c) => c.charCodeAt(0));
};

type SavedSubscription = { endpoint: string; expirationTime: number | null; keys: { p256dh: string; auth: string } };
function serialize(subscription: PushSubscription): SavedSubscription {
  const v = subscription.toJSON();
  if (!v.endpoint || !v.keys?.p256dh || !v.keys.auth) throw new Error("Incomplete push subscription.");
  return { endpoint: v.endpoint, expirationTime: v.expirationTime ?? null, keys: { p256dh: v.keys.p256dh, auth: v.keys.auth } };
}

export const guestPushSupported = () => typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;

export async function enableGuestPush(getKey: () => Promise<string | null>, save: (sub: SavedSubscription) => Promise<{ ok: boolean }>) {
  if (!guestPushSupported()) return { ok: false as const, error: "unsupported" as const };
  // Before any other await: browsers ask for permission only straight after a tap
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") return { ok: false as const, error: permission === "denied" ? ("blocked" as const) : ("dismissed" as const) };
  const publicKey = await getKey();
  if (!publicKey) return { ok: false as const, error: "off" as const };
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const subscription = (await registration.pushManager.getSubscription()) ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
    const saved = await save(serialize(subscription));
    return saved.ok ? { ok: true as const } : { ok: false as const, error: "failed" as const };
  } catch {
    return { ok: false as const, error: "failed" as const };
  }
}
