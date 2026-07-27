/* Harvey Taxi service worker — push notifications only.
   This intentionally does NOT do offline caching / asset interception;
   its only job is to receive push events and let the person tap into
   the right page. index.html already registers this at /service-worker.js. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    payload = { title: "Harvey Taxi", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Harvey Taxi";
  const body = payload.body || "";
  const url = payload.url || "/";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      data: { url }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          const clientUrl = new URL(client.url);
          if (clientUrl.pathname === targetUrl && "focus" in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow(targetUrl);
      })
  );
});
