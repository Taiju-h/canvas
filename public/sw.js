const CACHE = "uzero-canvas-shell-__BUILD_ID__";
const OFFLINE = "/canvas/index.html";
const ASSETS = "/canvas/offline-assets.json";

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const manifest = await fetch(ASSETS).then(response => {
      if (!response.ok) throw new Error("Offline asset list unavailable");
      return response.json();
    });
    await cache.addAll([OFFLINE, "/canvas/manifest.webmanifest", "/canvas/favicon.svg", ...manifest]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter(key => key.startsWith("uzero-canvas-shell-") && key !== CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/canvas/") ||
      url.pathname.endsWith(".php")) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await Promise.race([
          fetch(request),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Slow connection")), 2500)),
        ]);
        if (response.status >= 500) throw new Error("Service unavailable");
        return response;
      } catch {
        return await (await caches.open(CACHE)).match(OFFLINE) || Response.error();
      }
    })());
    return;
  }
  if (url.pathname.startsWith("/canvas/assets/") || /^\/canvas\/(?:icon-\d+\.png|favicon\.svg)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      return fetch(request);
    })());
  }
});
