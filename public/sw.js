/* Staff push notifications for the installable TableQR PWA. */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() ?? "" }; }
  const title = typeof data.title === "string" ? data.title : "TableQR update";
  const options = {
    body: typeof data.body === "string" ? data.body : "There is a new update for your restaurant.",
    icon: typeof data.icon === "string" ? data.icon : "/staff-icon/192",
    badge: "/staff-icon/180",
    tag: typeof data.tag === "string" ? data.tag : "tableqr-staff",
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
