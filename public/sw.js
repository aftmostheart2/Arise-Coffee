self.addEventListener("push", event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "Arise! Coffee";
  const options = {
    body: payload.body || "Your order is ready for pickup.",
    icon: "/icons/arise-icon-192.png",
    badge: "/icons/arise-icon-192.png",
    data: {
      url: payload.url || "/",
      orderId: payload.orderId || "",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.url === targetUrl && "focus" in client) return client.focus();
    }
    return clients.openWindow(targetUrl);
  })());
});
