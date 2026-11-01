/* Staff PWA: cache the user-independent offline POS shell and immutable app code. */
const STAFF_SHELL_CACHE = "tableeqr-staff-shell-v2";
const STAFF_ASSET_CACHE = "tableeqr-staff-assets-v2";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const response = await fetch("/offline-pos", { cache: "reload" });
    if (!response.ok) throw new Error("Could not prepare the offline POS shell.");
    const cache = await caches.open(STAFF_SHELL_CACHE);
    await cache.put("/offline-pos", response.clone());
    const html = await response.text();
    const assets = [...html.matchAll(/(?:src|href)="([^\"]*\/_next\/static\/[^\"]+)"/g)]
      .map((match) => new URL(match[1], self.location.origin).href);
    const assetCache = await caches.open(STAFF_ASSET_CACHE);
    await Promise.all([...new Set(assets)].map(async asset => {
      const response = await fetch(asset, { cache: "no-cache" });
      if (response.ok && response.headers.get("cache-control")?.includes("immutable")) await assetCache.put(asset, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    // Only remove the retired legacy caches. Keep prior Tableeqr caches: an already-open
    // tab can still be reading one while this service worker activates.
    await Promise.all(names.filter((name) => name.startsWith("tableqr-staff-")).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    // Development chunks reuse URLs across edits and must never be served cache-first.
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return;
    event.respondWith((async () => {
      const cache = await caches.open(STAFF_ASSET_CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok && response.headers.get("cache-control")?.includes("immutable")) await cache.put(request, response.clone());
      return response;
    })());
    return;
  }

  if (request.mode === "navigate" && url.pathname === "/offline-pos") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) await (await caches.open(STAFF_SHELL_CACHE)).put("/offline-pos", response.clone());
        return response;
      } catch {
        return (await caches.open(STAFF_SHELL_CACHE)).match("/offline-pos") ?? Response.error();
      }
    })());
    return;
  }

  const staffRoute = url.pathname === "/console" || url.pathname.startsWith("/console/");
  const loginRoute = url.pathname === "/console/login" || url.pathname.startsWith("/console/login/");
  if (request.mode === "navigate" && staffRoute && !loginRoute) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.status < 500) return response;
      } catch {
        // Fall back to the device-local POS shell when the server cannot be reached.
      }
      return Response.redirect(new URL("/offline-pos", self.location.origin), 302);
    })());
  }
});

/* Staff push notifications for the installable Tableeqr PWA. */
// true or false once the server has answered; null when it could not be reached.
const pushSessionActive = async (sessionId) => {
  const check = new URL("/api/staff/push-session", self.location.origin);
  check.searchParams.set("sessionId", sessionId);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    try {
      const response = await fetch(check.href, { credentials: "include", cache: "no-store" });
      if (response.ok) return (await response.json()).active === true;
    } catch { /* a phone waking from sleep may need a moment to reconnect */ }
  }
  return null;
};

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() ?? "" }; }
  event.waitUntil((async () => {
    const url = typeof data.url === "string" ? data.url : "/console";
    const staffNotification = /^\/(console|waiter|rider)(\/|$)/.test(url);
    const sessionId = typeof data.sessionId === "string" ? data.sessionId : "";
    if (staffNotification) {
      // Old or queued staff alerts must not appear after sign-out or after another account signs in.
      if (!sessionId) return;
      const active = await pushSessionActive(sessionId);
      if (active === false) return;
      // Never lose a new order to a bad connection, but show no details until the session is confirmed.
      if (active === null) data = { url };
    }
    const title = typeof data.title === "string" ? data.title : "Tableeqr update";
    const options = {
      body: typeof data.body === "string" ? data.body : "There is a new update for your restaurant.",
      icon: typeof data.icon === "string" ? data.icon : "/staff-icon/192",
      badge: typeof data.badge === "string" ? data.badge : "/staff-icon/180",
      tag: typeof data.tag === "string" ? data.tag : "tableeqr-staff",
      renotify: true,
      data: { url, sessionId: staffNotification ? sessionId : null },
    };
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    let target = new URL("/console", self.location.origin);
    try {
      const requested = new URL(event.notification.data?.url ?? "/console", self.location.origin);
      if (requested.origin === self.location.origin) target = requested;
    } catch { /* open the staff home when payload data is malformed */ }

    const sessionId = event.notification.data?.sessionId;
    if (/^\/(console|waiter|rider)(\/|$)/.test(target.pathname) && typeof sessionId !== "string") return;
    if (typeof sessionId === "string") {
      try {
        const check = new URL("/api/staff/push-session", self.location.origin);
        check.searchParams.set("sessionId", sessionId);
        const response = await fetch(check.href, { credentials: "include", cache: "no-store" });
        if (!response.ok || (await response.json()).active !== true) return;
      } catch {
        return;
      }
    }

    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      if ("navigate" in client) await client.navigate(target.href);
      return client.focus();
    }
    return self.clients.openWindow(target.href);
  })());
});
