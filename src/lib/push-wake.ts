// When a push alert reaches this phone, the service worker tells every open Tableeqr tab (see
// public/sw.js). Screens reload their data at once instead of waiting for the next poll, so an
// alert and the screen behind it agree even when the realtime hub is not configured.

export const PUSH_WAKE = "tableeqr:push";

/** Calls `wake` whenever a push arrives while this page is open; returns the unsubscribe */
export function onPushWake(wake: () => void): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => {};
  const handler = (event: MessageEvent) => {
    if ((event.data as { type?: unknown } | null)?.type === PUSH_WAKE) wake();
  };
  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}
