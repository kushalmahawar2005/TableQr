/** Show a staff alert only while the same login is still active in this browser. */
export async function showStaffNotification(input: { sessionId: string; title: string; body: string; tag: string; url: string }) {
  if (!input.sessionId || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  let target: URL;
  try {
    target = new URL(input.url, window.location.origin);
  } catch {
    return;
  }
  if (target.origin !== window.location.origin || !/^\/(console|waiter|rider)(\/|$)/.test(target.pathname)) return;

  try {
    const check = new URL("/api/staff/push-session", window.location.origin);
    check.searchParams.set("sessionId", input.sessionId);
    const response = await fetch(check.href, { credentials: "include", cache: "no-store" });
    if (!response.ok || (await response.json()).active !== true) return;
    const registration = await navigator.serviceWorker.getRegistration("/");
    if (!registration) return;
    // This is the fallback for phones without push. With push on, the server's alert arrives too,
    // and showing this one as well would put two notifications on the phone for one event.
    if (await registration.pushManager?.getSubscription().catch(() => null)) return;
    await registration.showNotification(input.title, {
      body: input.body,
      tag: input.tag,
      data: { url: target.pathname + target.search + target.hash, sessionId: input.sessionId },
    });
  } catch {
    // A transient auth/network failure must not show potentially stale staff details.
  }
}
