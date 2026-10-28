/* Staff PWA: cache the user-independent offline POS shell and immutable app code. */
const STAFF_SHELL_CACHE = "tableeqr-staff-shell-v1";
const STAFF_ASSET_CACHE = "tableeqr-staff-assets-v1";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const response = await fetch("/offline-pos", { cache: "reload" });
    if (!response.ok) throw new Error("Could not prepare the offline POS shell.");
    const cache = await caches.open(STAFF_SHELL_CACHE);
    await cache.put("/offline-pos", response.clone());
    const html = await response.text();
    const assets = [...html.matchAll(/(?:src|href)="([^\"]*\/_next\/static\/[^\"]+)"/g)]
      .map((match) => new URL(match[1], self.location.origin).href);
    if (assets.length) await (await caches.open(STAFF_ASSET_CACHE)).addAll([...new Set(assets)]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => (name.startsWith("tableeqr-staff-") || name.startsWith("tableqr-staff-")) && ![STAFF_SHELL_CACHE, STAFF_ASSET_CACHE].includes(name)).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith((async () => {
      const cache = await caches.open(STAFF_ASSET_CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
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
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() ?? "" }; }
  const title = typeof data.title === "string" ? data.title : "Tableeqr update";
  const options = {
    body: typeof data.body === "string" ? data.body : "There is a new update for your restaurant.",
    icon: typeof data.icon === "string" ? data.icon : "/staff-icon/192",
    badge: typeof data.badge === "string" ? data.badge : "/staff-icon/180",
    tag: typeof data.tag === "string" ? data.tag : "tableeqr-staff",
    renotify: true,
    data: { url: typeof data.url === "string" ? data.url : "/console" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    let target = new URL("/console", self.location.origin);
    try {
      const requested = new URL(event.notification.data?.url ?? "/console", self.location.origin);
      if (requested.origin === self.location.origin) target = requested;
    } catch { /* open the staff home when payload data is malformed */ }

    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      if ("navigate" in client) await client.navigate(target.href);
      return client.focus();
    }
    return self.clients.openWindow(target.href);
  })());
});
